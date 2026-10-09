// Reconcile-loop races in the subscription managers.
import { it, describe, afterEach } from 'mocha'
import { strict as assert } from 'node:assert'
import { DocSubscriptions } from '../src/orm/Doc.js'
import { QuerySubscriptions, getQuerySignal } from '../src/orm/Query.js'
import { getRootSignal } from '../src/orm/Root.ts'
import { SEGMENTS } from '../src/orm/Signal.ts'
import { setSubscriptionGcDelay, __resetSubscriptionGcDelayForTests } from '../src/orm/subscriptionGcDelay.ts'
import { assertDocSubscriptionsConsistent, assertQuerySubscriptionsConsistent } from './_subscriptionAssertions.js'

class MockQuery {
  constructor () {
    this.initialized = false
    this.requestedTransportMode = 'subscribe'
    this.activeTransportMode = 'idle'
    this.events = []
    this.rootIds = new Set()
  }

  init () { this.initialized = true }
  attachRoot (rootId) { if (rootId != null) this.rootIds.add(rootId) }
  detachRoot (rootId) { if (rootId != null) this.rootIds.delete(rootId) }
  _detachTransportData ({ keepRoots = true } = {}) { if (!keepRoots) this.rootIds.clear() }

  async _subscribe () {
    const mode = this.requestedTransportMode || 'subscribe'
    this.events.push(`subscribe:${mode}`)
    this.activeTransportMode = mode
  }

  async _unsubscribe () {
    this.events.push(`unsubscribe:${this.activeTransportMode}`)
    this.activeTransportMode = 'idle'
  }
}

class MockDoc {
  constructor (collection, docId) {
    this.collection = collection
    this.docId = docId
    this.activeTransportMode = 'idle'
    this.events = []
  }

  init () {}

  async subscribe ({ mode } = {}) {
    const nextMode = mode || 'subscribe'
    this.activeTransportMode = nextMode
    this.events.push(`subscribe:${nextMode}`)
  }

  async unsubscribe () {
    this.events.push(`unsubscribe:${this.activeTransportMode}`)
    this.activeTransportMode = 'idle'
  }
}

// Steps microtasks until `predicate` holds; returns whether it did.
async function stepMicrotasksUntil (predicate, limit = 100) {
  for (let i = 0; i < limit; i++) {
    await Promise.resolve()
    if (predicate()) return true
  }
  return false
}

describe('reconcileTransport settles in the same tick as its final check (bug E)', () => {
  afterEach(() => {
    __resetSubscriptionGcDelayForTests()
  })

  it('query: a subscribe landing right after a teardown loop exits is not lost', async () => {
    setSubscriptionGcDelay(60_000)
    const manager = new QuerySubscriptions(MockQuery)
    const $root = getRootSignal({ rootId: '_reconcile_gap_query', fetchOnly: true })
    const $query = getQuerySignal('reconcileGapQueries', { gap: 1 }, { root: $root })

    await manager.subscribe($query)
    const entry = manager.entries.values().next().value
    const query = entry.runtime
    const release = manager.unsubscribe($query) // fetch transports tear down eagerly

    const tornDown = await stepMicrotasksUntil(() => entry.mode === 'idle')
    assert.ok(tornDown, 'the fetch teardown finished')
    await manager.subscribe($query)

    assert.equal(query.activeTransportMode, 'fetch', 'the new owner gets a transport')
    assert.deepEqual(query.events, ['subscribe:fetch', 'unsubscribe:fetch', 'subscribe:fetch'])
    assertQuerySubscriptionsConsistent(manager)

    setSubscriptionGcDelay(0)
    await manager.unsubscribe($query)
    await release
    await manager.clear()
  })

  it('doc: a subscribe landing right after a teardown loop exits is not lost', async () => {
    setSubscriptionGcDelay(60_000)
    const manager = new DocSubscriptions(MockDoc)
    const $root = getRootSignal({ rootId: '_reconcile_gap_doc', fetchOnly: true })
    const $doc = $root.reconcileGapDocs.gap1
    assert.deepEqual($doc[SEGMENTS], ['reconcileGapDocs', 'gap1'])

    await manager.subscribe($doc)
    const entry = manager.entries.values().next().value
    const doc = entry.runtime
    const release = manager.unsubscribe($doc)

    const tornDown = await stepMicrotasksUntil(() => entry.mode === 'idle')
    assert.ok(tornDown, 'the fetch teardown finished')
    await manager.subscribe($doc)

    assert.equal(doc.activeTransportMode, 'fetch', 'the new owner gets a transport')
    assert.deepEqual(doc.events, ['subscribe:fetch', 'unsubscribe:fetch', 'subscribe:fetch'])
    assertDocSubscriptionsConsistent(manager)

    setSubscriptionGcDelay(0)
    await manager.unsubscribe($doc)
    await release
    await manager.clear()
  })
})
