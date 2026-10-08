// Writes through aggregation rows (`$rows[0].price.set(x)`) need the source
// document loaded, so the row setter subscribes it for the duration of the
// write. That ownership must end with the write.
import { after, afterEach, before, describe, it } from 'mocha'
import { strict as assert } from 'node:assert'
import { $, sub, unsub, aggregation, diagnostics } from '../src/index.ts'
import connect from '../src/connect/test.js'
import { getConnection } from '../src/orm/connection.ts'
import { docSubscriptions } from '../src/orm/Doc.js'
import { getSubscriptionGcDelay, setSubscriptionGcDelay } from '../src/orm/subscriptionGcDelay.ts'

before(connect)

const COLLECTION = 'aggregationRowWrites'
const _rows = aggregation(({ active }) => [{ $match: { active } }])

function cbPromise (fn) {
  return new Promise((resolve, reject) => fn(err => err ? reject(err) : resolve()))
}

async function createDoc (id, data) {
  const doc = getConnection().get(COLLECTION, id)
  await cbPromise(cb => doc.fetch(cb))
  if (doc.type == null) await cbPromise(cb => doc.create(data, cb))
}

function docHash (id) {
  return JSON.stringify([COLLECTION, id])
}

function ownerCount (id) {
  let count = 0
  for (const record of docSubscriptions.ownerRecords.values()) {
    if (record.hash === docHash(id)) count += record.fetchCount + record.subscribeCount
  }
  return count
}

describe('aggregation row writes', () => {
  const baselineGcDelay = getSubscriptionGcDelay()

  before(async () => {
    await createDoc('a', { name: 'a', active: true, price: 1 })
  })

  afterEach(() => {
    setSubscriptionGcDelay(baselineGcDelay)
    diagnostics.disable()
  })

  after(async () => {
    setSubscriptionGcDelay(0)
    await docSubscriptions.flushPendingDestroys()
    setSubscriptionGcDelay(baselineGcDelay)
  })

  it('releases the source document once each write completes', async () => {
    setSubscriptionGcDelay(0)
    diagnostics.enable()
    const $rows = await sub(_rows, { $collection: COLLECTION, active: true })
    for (let i = 0; i < 3; i++) {
      await $rows[0].price.set(10 + i)
      assert.equal($rows[0].price.get(), 10 + i)
    }
    await unsub($rows)
    assert.equal(ownerCount('a'), 0, 'no owner is left on the source doc')
    // the release of the last write is applied asynchronously
    await diagnostics.waitForIdle()
    assert.equal(docSubscriptions.entries.has(docHash('a')), false, 'the source doc entry is torn down')
    const codes = diagnostics.checkLeaks().findings.map(finding => finding.code)
    assert.equal(codes.includes('doc.subscribe.bypassedSub'), false, JSON.stringify(codes))
  })

  it('keeps the source document live through the grace after a write', async () => {
    setSubscriptionGcDelay(50)
    const $rows = await sub(_rows, { $collection: COLLECTION, active: true })
    await $rows[0].price.set(20)
    assert.equal(ownerCount('a'), 0)
    const entry = docSubscriptions.entries.get(docHash('a'))
    assert.ok(entry?.pendingDestroy, 'the released doc lingers in its grace')
    // a write in the grace joins the lingering transport synchronously
    await $rows[0].price.set(21)
    assert.equal(ownerCount('a'), 0)
    await unsub($rows)
    await new Promise(resolve => setTimeout(resolve, 80))
    assert.equal(docSubscriptions.entries.has(docHash('a')), false)
  })

  it('does not take counts from an owner that subscribed the document itself', async () => {
    setSubscriptionGcDelay(0)
    const $doc = await sub($[COLLECTION].a)
    const $rows = await sub(_rows, { $collection: COLLECTION, active: true })
    await $rows[0].price.set(30)
    assert.equal(ownerCount('a'), 1)
    await unsub($rows)
    assert.equal(ownerCount('a'), 1)
    assert.equal($doc.price.get(), 30)
    await unsub($doc)
    assert.equal(ownerCount('a'), 0)
  })

  it('releases the source document when the write fails', async () => {
    setSubscriptionGcDelay(0)
    const $rows = await sub(_rows, { $collection: COLLECTION, active: true })
    await assert.rejects(() => $rows[0].increment('not a number'), /expects a number/)
    assert.equal(ownerCount('a'), 0)
    await unsub($rows)
  })

  it('rejects instead of hanging when the source document cannot be loaded', async () => {
    setSubscriptionGcDelay(0)
    const $rows = await sub(_rows, { $collection: COLLECTION, active: true })
    const proto = docSubscriptions.DocClass.prototype
    const original = proto._subscribe
    proto._subscribe = async function () { throw Error('subscribe denied') }
    try {
      await assert.rejects(() => $rows[0].price.set(40), /subscribe denied/)
    } finally {
      proto._subscribe = original
    }
    assert.equal(ownerCount('a'), 0)
    await unsub($rows)
  })
})
