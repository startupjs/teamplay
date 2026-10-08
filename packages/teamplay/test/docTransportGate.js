// The doc manager's reconcile loop (subscriptionTransport.js) is the only
// coalescing layer for doc transports: it runs at most one transition per
// entry and re-reads the target after each step. Every transport call on the
// Doc runtime must therefore happen inside that gate (phase 'transition') and
// never overlap another call, whatever races the public API produces.
import { afterEach, before, beforeEach, describe, it } from 'mocha'
import { strict as assert } from 'node:assert'
import { $, sub, unsub, getRootSignal } from '../src/index.ts'
import connect from '../src/connect/test.js'
import { getConnection } from '../src/orm/connection.ts'
import { docSubscriptions } from '../src/orm/Doc.js'
import { getSubscriptionGcDelay, setSubscriptionGcDelay } from '../src/orm/subscriptionGcDelay.ts'
import { assertDocSubscriptionsConsistent } from './_subscriptionAssertions.js'

before(connect)

const COLLECTION = 'docTransportGate'
let counter = 0

function wait (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function createDoc (id) {
  const doc = getConnection().get(COLLECTION, id)
  await new Promise((resolve, reject) => doc.fetch(err => err ? reject(err) : resolve()))
  if (doc.type == null) await new Promise((resolve, reject) => doc.create({ name: id }, err => err ? reject(err) : resolve()))
}

describe('doc transport calls go through the reconcile gate', () => {
  const baselineGcDelay = getSubscriptionGcDelay()
  let calls, violations, restore

  beforeEach(() => {
    calls = []
    violations = []
    const inFlight = new Map()
    const proto = docSubscriptions.DocClass.prototype
    const originals = { _subscribe: proto._subscribe, _unsubscribe: proto._unsubscribe }
    for (const method of Object.keys(originals)) {
      proto[method] = async function (...args) {
        const hash = JSON.stringify([this.collection, this.docId])
        const phase = docSubscriptions.entries.get(hash)?.phase
        if (inFlight.get(hash) > 0) violations.push(`${method} overlapped another call on ${hash}`)
        if (phase !== 'transition') violations.push(`${method} ran outside the gate (phase ${phase})`)
        inFlight.set(hash, (inFlight.get(hash) || 0) + 1)
        calls.push(method)
        try {
          await wait(3)
          return await originals[method].apply(this, args)
        } finally {
          inFlight.set(hash, inFlight.get(hash) - 1)
        }
      }
    }
    restore = () => Object.assign(proto, originals)
  })

  afterEach(async () => {
    restore()
    setSubscriptionGcDelay(0)
    await docSubscriptions.flushPendingDestroys()
    await docSubscriptions.clear()
    setSubscriptionGcDelay(baselineGcDelay)
  })

  async function newDoc () {
    const id = 'gate' + ++counter
    await createDoc(id)
    return { id, $doc: $[COLLECTION][id], hash: JSON.stringify([COLLECTION, id]) }
  }

  async function settle (hash) {
    for (let i = 0; i < 50; i++) {
      const entry = docSubscriptions.entries.get(hash)
      if (!entry || (entry.phase === 'stable' && !entry.reconcilePromise)) return
      await wait(5)
    }
  }

  it('rapid sub/unsub/sub/unsub without a grace', async () => {
    setSubscriptionGcDelay(0)
    const { $doc, hash } = await newDoc()
    const pending = [sub($doc), unsub($doc), sub($doc), unsub($doc), sub($doc)]
    await Promise.allSettled(pending)
    await settle(hash)
    assert.deepEqual(violations, [])
    assert.equal(docSubscriptions.entries.get(hash)?.mode, 'subscribe')
    await unsub($doc)
    await settle(hash)
    assert.deepEqual(violations, [])
    assertDocSubscriptionsConsistent(docSubscriptions)
  })

  it('a grace expiring while a new owner subscribes', async () => {
    setSubscriptionGcDelay(20)
    const { $doc, hash } = await newDoc()
    await sub($doc)
    await unsub($doc)
    await wait(19)
    const again = sub($doc)
    await wait(10)
    await again
    await settle(hash)
    assert.deepEqual(violations, [])
    assert.equal(docSubscriptions.entries.get(hash)?.mode, 'subscribe')
    assertDocSubscriptionsConsistent(docSubscriptions)
  })

  it('explicit destroy and root close while a subscribe is in flight', async () => {
    setSubscriptionGcDelay(0)
    const first = await newDoc()
    const pendingSub = sub(first.$doc)
    await wait(1)
    await docSubscriptions.destroy([COLLECTION, first.id])
    await Promise.allSettled([pendingSub])
    await settle(first.hash)

    const second = await newDoc()
    const $root = getRootSignal({ rootId: 'doc-transport-gate-' + counter })
    const pendingRootSub = sub($root[COLLECTION][second.id])
    await wait(1)
    await $root.close()
    await Promise.allSettled([pendingRootSub])
    await settle(second.hash)

    assert.deepEqual(violations, [])
    assert.equal(docSubscriptions.entries.get(first.hash)?.mode ?? 'idle', 'idle')
    assert.equal(docSubscriptions.entries.get(second.hash)?.mode ?? 'idle', 'idle')
  })

  it('clear() while transitions are in flight', async () => {
    setSubscriptionGcDelay(1000)
    const a = await newDoc()
    const b = await newDoc()
    await sub(a.$doc)
    const pending = [unsub(a.$doc), sub(b.$doc)]
    await docSubscriptions.clear()
    await Promise.allSettled(pending)
    await settle(a.hash)
    await settle(b.hash)
    assert.deepEqual(violations, [])
    assert.ok(calls.length > 0)
  })
})
