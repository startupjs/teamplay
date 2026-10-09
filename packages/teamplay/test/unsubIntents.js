// unsub($signal) releases one sub() record of that signal. When the signal
// holds records of both intents ('fetch' and 'subscribe'), it must not release
// a live subscription that another caller still holds.
import { after, afterEach, before, describe, it } from 'mocha'
import { strict as assert } from 'node:assert'
import { $, sub, unsub, getRootSignal } from '../src/index.ts'
import connect from '../src/connect/test.js'
import { getConnection } from '../src/orm/connection.ts'
import { docSubscriptions } from '../src/orm/Doc.js'
import { querySubscriptions } from '../src/orm/Query.js'
import { acquireSub } from '../src/orm/sub.ts'
import { getSubscriptionGcDelay, setSubscriptionGcDelay } from '../src/orm/subscriptionGcDelay.ts'

before(connect)

const COLLECTION = 'unsubIntents'
let counter = 0

function cbPromise (fn) {
  return new Promise((resolve, reject) => fn(err => err ? reject(err) : resolve()))
}

async function createDoc (id) {
  const doc = getConnection().get(COLLECTION, id)
  await cbPromise(cb => doc.fetch(cb))
  if (doc.type == null) await cbPromise(cb => doc.create({ name: id }, cb))
}

function docCounts (id) {
  const record = docSubscriptions.ownerRecords.get(JSON.stringify({ owner: [undefined, JSON.stringify([COLLECTION, id])] }))
  return { fetch: record?.fetchCount ?? 0, subscribe: record?.subscribeCount ?? 0 }
}

function docMode (id) {
  return docSubscriptions.entries.get(JSON.stringify([COLLECTION, id]))?.mode ?? 'idle'
}

async function newDoc () {
  const id = 'doc' + ++counter
  await createDoc(id)
  return id
}

describe('unsub() with mixed intents', () => {
  const baselineGcDelay = getSubscriptionGcDelay()

  afterEach(async () => {
    setSubscriptionGcDelay(0)
    await docSubscriptions.flushPendingDestroys()
    await querySubscriptions.flushPendingDestroys()
    setSubscriptionGcDelay(baselineGcDelay)
  })

  after(() => setSubscriptionGcDelay(baselineGcDelay))

  it('keeps a single-intent signal last-in-first-out', async () => {
    setSubscriptionGcDelay(0)
    const id = await newDoc()
    const $doc = $[COLLECTION][id]
    await sub($doc)
    await sub($doc)
    assert.deepEqual(docCounts(id), { fetch: 0, subscribe: 2 })
    await unsub($doc)
    assert.deepEqual(docCounts(id), { fetch: 0, subscribe: 1 })
    await unsub($doc)
    assert.deepEqual(docCounts(id), { fetch: 0, subscribe: 0 })
    assert.equal(await unsub($doc), undefined, 'an extra unsub() is a no-op')
  })

  it('does not downgrade a live subscription when a fetch holder releases', async () => {
    setSubscriptionGcDelay(0)
    const id = await newDoc()
    const $doc = $[COLLECTION][id]
    await sub($doc, { mode: 'fetch' }) // caller A
    await sub($doc) // caller B, more recent
    assert.equal(docMode(id), 'subscribe')
    await unsub($doc) // caller A is done
    assert.deepEqual(docCounts(id), { fetch: 0, subscribe: 1 })
    assert.equal(docMode(id), 'subscribe', 'B still gets live updates')
    await unsub($doc) // caller B is done
    assert.deepEqual(docCounts(id), { fetch: 0, subscribe: 0 })
  })

  it('releases the intent named by the mode option', async () => {
    setSubscriptionGcDelay(0)
    const id = await newDoc()
    const $doc = $[COLLECTION][id]
    await sub($doc)
    await sub($doc, { mode: 'fetch' })
    await unsub($doc, { mode: 'subscribe' })
    assert.deepEqual(docCounts(id), { fetch: 1, subscribe: 0 })
    assert.equal(docMode(id), 'fetch')
    assert.equal(await unsub($doc, { mode: 'subscribe' }), undefined, 'no subscribe record left: no-op')
    assert.deepEqual(docCounts(id), { fetch: 1, subscribe: 0 })
    await unsub($doc, { mode: 'fetch' })
    assert.deepEqual(docCounts(id), { fetch: 0, subscribe: 0 })
  })

  it('applies the same rules to queries', async () => {
    setSubscriptionGcDelay(0)
    const id = await newDoc()
    const params = { name: id }
    const $query = await sub($[COLLECTION], params, { mode: 'fetch' })
    await sub($[COLLECTION], params)
    await unsub($query)
    const record = Array.from(querySubscriptions.ownerRecords.values()).find(item => item.params?.name === id)
    assert.deepEqual({ fetch: record.fetchCount, subscribe: record.subscribeCount }, { fetch: 0, subscribe: 1 })
    await unsub($query)
    assert.equal(Array.from(querySubscriptions.ownerRecords.values()).some(item => item.params?.name === id), false)
  })

  it('ignores a non-object second argument (e.g. Array#map index)', async () => {
    setSubscriptionGcDelay(0)
    const id = await newDoc()
    const $doc = $[COLLECTION][id]
    await sub($doc, { mode: 'fetch' })
    await sub($doc)
    await Promise.all([$doc].map(unsub))
    assert.deepEqual(docCounts(id), { fetch: 0, subscribe: 1 })
    await unsub($doc)
  })

  it('rejects an unknown mode', async () => {
    const id = await newDoc()
    assert.throws(() => unsub($[COLLECTION][id], { mode: 'live' }), /mode/)
  })

  it('an acquisition releases its own record even after unsub() took it by recency', async () => {
    setSubscriptionGcDelay(0)
    const $root = getRootSignal({ rootId: 'unsub-intents-acquisition' })
    const id = await newDoc()
    const $doc = $root[COLLECTION][id]
    const key = JSON.stringify({ owner: ['unsub-intents-acquisition', JSON.stringify([COLLECTION, id])] })
    const counts = () => {
      const record = docSubscriptions.ownerRecords.get(key)
      return { fetch: record?.fetchCount ?? 0, subscribe: record?.subscribeCount ?? 0 }
    }
    await sub($doc) // caller A
    const lease = acquireSub($doc) // e.g. a useSub() lease, more recent
    await lease.value
    await unsub($doc) // caller A is done; by recency this takes the lease's record
    assert.deepEqual(counts(), { fetch: 0, subscribe: 1 })
    await lease.release() // releases the record caller A left behind
    await lease.release() // idempotent
    assert.deepEqual(counts(), { fetch: 0, subscribe: 0 })
    assert.equal(await unsub($doc), undefined)
    await $root.close()
  })
})
