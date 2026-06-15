/**
 * Comprehensive tests for Doc, Query, and Aggregation subscription managers
 *
 * Tests cover:
 * - DocSubscriptions: reference counting, excessive unsubscribe handling, destroy(), init()
 * - QuerySubscriptions: reference counting, excessive unsubscribe handling, destroy()
 * - sub() function: error handling, promise vs direct return behavior
 * - Rapid subscribe/unsubscribe scenarios and edge cases
 *
 * Note: Some tests are skipped due to ShareDB race conditions when rapidly
 * unsubscribing and resubscribing to the same document.
 */
import { it, describe, before, beforeEach, afterEach } from 'mocha'
import { strict as assert } from 'node:assert'
import { afterEachTestGc, runGc } from './_helpers.js'
import { assertDocSubscriptionsConsistent, assertQuerySubscriptionsConsistent } from './_subscriptionAssertions.js'
import { $, sub, unsub } from '../src/index.ts'
import { docSubscriptions, DocSubscriptions } from '../src/orm/Doc.js'
import { isMissingShareDoc } from '../src/orm/missingDoc.js'
import {
  querySubscriptions,
  QuerySubscriptions,
  Query,
  COLLECTION_NAME as QUERY_COLLECTION_NAME,
  PARAMS as QUERY_PARAMS,
  HASH as QUERY_HASH,
  QUERIES,
  getQuerySignal,
  hashQuery
} from '../src/orm/Query.js'
import { getAggregationSignal, AGGREGATIONS, aggregationSubscriptions } from '../src/orm/Aggregation.js'
import { SEGMENTS } from '../src/orm/Signal.ts'
import { getConnection } from '../src/orm/connection.ts'
import { get as _get } from '../src/orm/dataTree.js'
import { getRootSignal, ROOT_ID } from '../src/orm/Root.ts'
import { getPrivateData } from '../src/orm/privateData.js'
import { getScopedSignalHash } from '../src/orm/rootScope.ts'
import connect from '../src/connect/test.js'
import {
  getSubscriptionGcDelay,
  setSubscriptionGcDelay,
  __resetSubscriptionGcDelayForTests
} from '../src/orm/subscriptionGcDelay.ts'

before(connect)

const TEST_DEFAULT_SUBSCRIPTION_GC_DELAY = getSubscriptionGcDelay()

beforeEach(() => {
  // Keep existing subscription manager tests deterministic.
  setSubscriptionGcDelay(0)
})

const trackedDocManagerRefs = []
const trackedQueryManagerRefs = []

function trackDocManager (manager) {
  trackedDocManagerRefs.push(new WeakRef(manager))
  return manager
}

function trackQueryManager (manager) {
  trackedQueryManagerRefs.push(new WeakRef(manager))
  return manager
}

function createTrackedDocManager (...args) {
  return trackDocManager(new DocSubscriptions(...args))
}

function createTrackedQueryManager (...args) {
  return trackQueryManager(new QuerySubscriptions(...args))
}

function resetTrackedManagers () {
  trackedDocManagerRefs.length = 0
  trackedQueryManagerRefs.length = 0
}

function assertTrackedManagersAndReset () {
  try {
    assertDocSubscriptionsConsistent(docSubscriptions)
    assertQuerySubscriptionsConsistent(querySubscriptions)
    assertQuerySubscriptionsConsistent(aggregationSubscriptions)

    for (const managerRef of trackedDocManagerRefs) {
      const manager = managerRef.deref()
      if (manager) assertDocSubscriptionsConsistent(manager)
    }

    for (const managerRef of trackedQueryManagerRefs) {
      const manager = managerRef.deref()
      if (manager) assertQuerySubscriptionsConsistent(manager)
    }
  } finally {
    resetTrackedManagers()
  }
}

afterEach(() => {
  setSubscriptionGcDelay(TEST_DEFAULT_SUBSCRIPTION_GC_DELAY)
  resetTrackedManagers()
})

function cbPromise (fn) {
  return new Promise((resolve, reject) => {
    fn((err, result) => err ? reject(err) : resolve(result))
  })
}

function wait (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function createDocSignal (collection, docId) {
  return {
    [SEGMENTS]: [collection, docId],
    path: () => `${collection}.${docId}`
  }
}

function createMockQuerySignal (collectionName, params) {
  const clonedParams = JSON.parse(JSON.stringify(params))
  return {
    [QUERY_HASH]: JSON.stringify({ query: [collectionName, clonedParams] }),
    [QUERY_COLLECTION_NAME]: collectionName,
    [QUERY_PARAMS]: clonedParams
  }
}

function getQueryOwnerKeyForTest ($query, rootId) {
  return getScopedSignalHash(rootId, $query[QUERY_HASH], 'queryOwner')
}

function getDocOwnerKeyForTest ($doc, rootId) {
  return JSON.stringify({ owner: [rootId, JSON.stringify($doc[SEGMENTS])] })
}

class MockDoc {
  constructor (collection, docId) {
    this.collection = collection
    this.docId = docId
    this.subscribed = false
    this.initialized = false
    this.activeTransportMode = 'idle'
    this.requestedTransportMode = 'subscribe'
    this.events = []
  }

  init () {
    this.initialized = true
  }

  async subscribe ({ mode } = {}) {
    const nextMode = mode || 'subscribe'
    this.requestedTransportMode = nextMode
    this.activeTransportMode = nextMode
    this.subscribed = nextMode === 'subscribe'
    this.events.push(`subscribe:${nextMode}`)
  }

  async unsubscribe () {
    this.events.push(`unsubscribe:${this.activeTransportMode}`)
    this.activeTransportMode = 'idle'
    this.subscribed = false
  }
}

class PendingMockDoc extends MockDoc {
  pending = false
  destroyed = false
  pendingCallbacks = []

  setPending (value) {
    this.pending = value
    if (!value) {
      const callbacks = this.pendingCallbacks
      this.pendingCallbacks = []
      for (const cb of callbacks) cb()
    }
  }

  hasPending () {
    return this.pending
  }

  whenNothingPending (cb) {
    if (!this.pending) return cb()
    this.pendingCallbacks.push(cb)
  }

  async destroy () {
    this.destroyed = true
  }

  dispose () {
    this.initialized = false
  }
}

class MockQuery {
  constructor () {
    this.subscribed = false
    this.initialized = false
    this.requestedTransportMode = 'subscribe'
    this.activeTransportMode = 'idle'
    this.events = []
    this.rootIds = new Set()
  }

  init () {
    this.initialized = true
  }

  attachRoot (rootId) {
    if (rootId == null) return
    this.rootIds.add(rootId)
  }

  detachRoot (rootId) {
    if (rootId == null) return
    this.rootIds.delete(rootId)
  }

  _detachTransportData ({ keepRoots = true } = {}) {
    if (!keepRoots) this.rootIds.clear()
  }

  async _subscribe () {
    const mode = this.requestedTransportMode || 'subscribe'
    this.events.push(`subscribe:${mode}`)
    this.activeTransportMode = mode
    this.subscribed = mode === 'subscribe'
  }

  async _unsubscribe () {
    this.events.push(`unsubscribe:${this.activeTransportMode}`)
    this.activeTransportMode = 'idle'
    this.subscribed = false
  }

  async subscribe ({ mode } = {}) {
    if (mode) this.requestedTransportMode = mode
    await this._subscribe()
    this.init()
  }

  async unsubscribe () {
    await this._unsubscribe()
  }
}

describe('DocSubscriptions', () => {
  afterEachTestGc()
  afterEach(assertTrackedManagersAndReset)

  it('reference counting - subscribe twice to same doc, count increases, unsubscribing once doesn\'t actually unsubscribe', async () => {
    const gameId = '_refcount1'
    const $game = $.games[gameId]

    // Subscribe first time using the docSubscriptions API directly
    await docSubscriptions.subscribe($game)
    const segments = ['games', gameId]
    const hash = JSON.stringify(segments)

    // Verify doc is subscribed
    assert.equal(docSubscriptions.subCount.get(hash), 1, 'sub count should be 1 after first subscribe')
    assert.ok(docSubscriptions.docs.get(hash), 'doc should exist in docs map')
    assert.ok(docSubscriptions.docs.get(hash).subscribed, 'doc should be subscribed')

    // Create the document
    const doc = getConnection().get('games', gameId)
    await cbPromise(cb => doc.create({ name: 'Game 1', players: 0 }, cb))
    assert.equal($game.name.get(), 'Game 1', 'signal has name')

    // Subscribe second time to same doc
    await docSubscriptions.subscribe($game)
    assert.equal(docSubscriptions.subCount.get(hash), 2, 'sub count should be 2 after second subscribe')
    assert.ok(docSubscriptions.docs.get(hash).subscribed, 'doc should still be subscribed')

    // Unsubscribe once
    await docSubscriptions.unsubscribe($game)
    assert.equal(docSubscriptions.subCount.get(hash), 1, 'sub count should be 1 after first unsubscribe')
    assert.ok(docSubscriptions.docs.get(hash).subscribed, 'doc should still be subscribed')
    assert.equal($game.name.get(), 'Game 1', 'signal should still have data')

    // Cleanup - final unsubscribe
    await docSubscriptions.unsubscribe($game)
    await cbPromise(cb => doc.del(cb))
  })

  it('reference counting - unsubscribe all refs, doc actually unsubscribes', async () => {
    const gameId = '_refcount2'
    let $game = $.games[gameId]

    const doc = getConnection().get('games', gameId)
    await cbPromise(cb => doc.create({ name: 'Game 2', players: 0 }, cb))

    // Subscribe twice using docSubscriptions API
    await docSubscriptions.subscribe($game)
    await docSubscriptions.subscribe($game)

    const segments = ['games', gameId]
    const hash = JSON.stringify(segments)

    assert.equal(docSubscriptions.subCount.get(hash), 2, 'sub count should be 2')
    assert.ok(docSubscriptions.docs.get(hash).subscribed, 'doc should be subscribed')

    // Unsubscribe first time
    await docSubscriptions.unsubscribe($game)
    assert.equal(docSubscriptions.subCount.get(hash), 1, 'sub count should be 1')
    assert.ok(docSubscriptions.docs.get(hash).subscribed, 'doc should still be subscribed')

    // Unsubscribe second time - should fully unsubscribe (and await the destroy)
    await docSubscriptions.unsubscribe($game)
    // After unsubscribe completes, maps should be cleared
    await new Promise(resolve => setImmediate(resolve)) // Wait for destroy to complete
    assert.equal(docSubscriptions.subCount.get(hash), undefined, 'sub count should be removed')
    assert.equal(docSubscriptions.docs.get(hash), undefined, 'doc should be removed from docs map')

    // Cleanup - delete doc and release reference to signal for GC
    await cbPromise(cb => doc.del(cb))
    $game = null
  })

  it('excessive unsubscribe (count goes below 0) - should not throw (ERROR_ON_EXCESSIVE_UNSUBSCRIBES is false)', async () => {
    const gameId = '_excessive1'
    const $game = $.games[gameId]

    // Subscribe once
    await docSubscriptions.subscribe($game)

    const segments = ['games', gameId]
    const hash = JSON.stringify(segments)

    // Create the document
    const doc = getConnection().get('games', gameId)
    await cbPromise(cb => doc.create({ name: 'Game 3', players: 0 }, cb))

    // Unsubscribe once (valid)
    await docSubscriptions.unsubscribe($game)
    await new Promise(resolve => setImmediate(resolve)) // Wait for destroy to complete
    assert.equal(docSubscriptions.subCount.get(hash), undefined, 'sub count should be removed')

    // Unsubscribe again (excessive) - should not throw
    await assert.doesNotReject(
      async () => await docSubscriptions.unsubscribe($game),
      'excessive unsubscribe should not throw'
    )

    // Cleanup
    await cbPromise(cb => doc.del(cb))
  })

  it('destroy() when doc doesn\'t exist - no-op', async () => {
    const segments = ['games', '_nonexistent']

    // Should not throw
    await assert.doesNotReject(
      async () => await docSubscriptions.destroy(segments),
      'destroying non-existent doc should not throw'
    )
  })

  it('destroy() when doc is subscribed - unsubscribes and cleans up maps', async () => {
    const gameId = '_destroy1'
    const $game = $.games[gameId]

    // Subscribe
    await sub($game)

    const segments = ['games', gameId]
    const hash = JSON.stringify(segments)

    // Create the document
    const doc = getConnection().get('games', gameId)
    await cbPromise(cb => doc.create({ name: 'Game 4', players: 0 }, cb))

    assert.ok(docSubscriptions.docs.get(hash), 'doc should exist before destroy')
    assert.ok(docSubscriptions.docs.get(hash).subscribed, 'doc should be subscribed before destroy')

    // Destroy
    await docSubscriptions.destroy(segments)

    assert.equal(docSubscriptions.subCount.get(hash), undefined, 'sub count should be removed after destroy')
    assert.equal(docSubscriptions.docs.get(hash), undefined, 'doc should be removed from docs map after destroy')

    // Cleanup
    await cbPromise(cb => doc.del(cb))
  })

  it('init() for existing doc that\'s already initialized - no-op', async () => {
    const gameId = '_init1'
    const $game = $.games[gameId]

    // Subscribe using docSubscriptions API
    await docSubscriptions.subscribe($game)

    const segments = ['games', gameId]
    const hash = JSON.stringify(segments)
    const doc = docSubscriptions.docs.get(hash)

    assert.ok(doc, 'doc should exist')
    assert.ok(doc.initialized, 'doc should be initialized')

    // Call init again - should be a no-op
    const initializedBefore = doc.initialized
    docSubscriptions.init($game)
    assert.equal(doc.initialized, initializedBefore, 'initialized state should not change')

    // Cleanup
    await docSubscriptions.unsubscribe($game)
    const shareDoc = getConnection().get('games', gameId)
    if (shareDoc.data && !isMissingShareDoc(shareDoc)) await cbPromise(cb => shareDoc.del(cb))
  })

  it('init() for existing doc that\'s not initialized - re-initializes', async () => {
    const gameId = '_init2'
    const $game = $.games[gameId]

    // Subscribe
    await docSubscriptions.subscribe($game)

    const segments = ['games', gameId]
    const hash = JSON.stringify(segments)
    const doc = docSubscriptions.docs.get(hash)

    assert.ok(doc, 'doc should exist')
    assert.ok(doc.initialized, 'doc should be initialized')

    // Manually mark as not initialized
    doc.initialized = undefined

    // Call init - should re-initialize
    docSubscriptions.init($game)
    assert.ok(doc.initialized, 'doc should be re-initialized')

    // Cleanup
    await docSubscriptions.unsubscribe($game)
    const shareDoc = getConnection().get('games', gameId)
    if (shareDoc.data && !isMissingShareDoc(shareDoc)) await cbPromise(cb => shareDoc.del(cb))
  })

  it('uses fetch transport for subscribe on fetchOnly roots', async () => {
    const manager = createTrackedDocManager(MockDoc)
    const $root = getRootSignal({ rootId: '_doc_fetch_root', fetchOnly: true })
    const $doc = $root.games._fetchOnlyDoc
    const hash = JSON.stringify(['games', '_fetchOnlyDoc'])

    await manager.subscribe($doc, { intent: 'subscribe' })

    const doc = manager.docs.get(hash)
    assert.deepEqual(doc.events, ['subscribe:fetch'])
    assert.equal(doc.activeTransportMode, 'fetch')
    assert.equal(doc.subscribed, false)

    await manager.unsubscribe($doc, { intent: 'subscribe' })
    await manager.clear()
  })

  it('uses subscribe transport for subscribe on live roots', async () => {
    const manager = createTrackedDocManager(MockDoc)
    const $root = getRootSignal({ rootId: '_doc_live_root', fetchOnly: false })
    const $doc = $root.games._liveDoc
    const hash = JSON.stringify(['games', '_liveDoc'])

    await manager.subscribe($doc, { intent: 'subscribe' })

    const doc = manager.docs.get(hash)
    assert.deepEqual(doc.events, ['subscribe:subscribe'])
    assert.equal(doc.activeTransportMode, 'subscribe')
    assert.equal(doc.subscribed, true)

    await manager.unsubscribe($doc, { intent: 'subscribe' })
    await manager.clear()
  })

  it('uses fetch transport for explicit fetch intent on live roots', async () => {
    const manager = createTrackedDocManager(MockDoc)
    const $root = getRootSignal({ rootId: '_doc_fetch_intent_root', fetchOnly: false })
    const $doc = $root.games._fetchIntentDoc
    const hash = JSON.stringify(['games', '_fetchIntentDoc'])

    await manager.subscribe($doc, { intent: 'fetch' })

    const doc = manager.docs.get(hash)
    assert.deepEqual(doc.events, ['subscribe:fetch'])
    assert.equal(doc.activeTransportMode, 'fetch')
    assert.equal(doc.subscribed, false)

    await manager.unsubscribe($doc, { intent: 'fetch' })
    await manager.clear()
  })

  it('upgrades and downgrades doc transport for mixed root modes', async () => {
    const manager = createTrackedDocManager(MockDoc)
    const $fetchRoot = getRootSignal({ rootId: '_doc_mixed_fetch_root', fetchOnly: true })
    const $liveRoot = getRootSignal({ rootId: '_doc_mixed_live_root', fetchOnly: false })
    const $fetchDoc = $fetchRoot.games._mixedDoc
    const $liveDoc = $liveRoot.games._mixedDoc
    const hash = JSON.stringify(['games', '_mixedDoc'])

    await manager.subscribe($fetchDoc, { intent: 'subscribe' })
    let doc = manager.docs.get(hash)
    assert.deepEqual(doc.events, ['subscribe:fetch'])
    assert.equal(doc.activeTransportMode, 'fetch')

    await manager.subscribe($liveDoc, { intent: 'subscribe' })
    doc = manager.docs.get(hash)
    assert.deepEqual(doc.events, ['subscribe:fetch', 'unsubscribe:fetch', 'subscribe:subscribe'])
    assert.equal(doc.activeTransportMode, 'subscribe')
    assert.equal(doc.subscribed, true)

    await manager.unsubscribe($liveDoc, { intent: 'subscribe' })
    doc = manager.docs.get(hash)
    assert.deepEqual(doc.events, [
      'subscribe:fetch',
      'unsubscribe:fetch',
      'subscribe:subscribe',
      'unsubscribe:subscribe',
      'subscribe:fetch'
    ])
    assert.equal(doc.activeTransportMode, 'fetch')
    assert.equal(doc.subscribed, false)

    await manager.unsubscribe($fetchDoc, { intent: 'subscribe' })
    await manager.clear()
  })

  it('unsubscribe handles stale canonical owner state when doc runtime is already missing', async () => {
    const manager = createTrackedDocManager(MockDoc)
    const $root = getRootSignal({ rootId: '_doc_stale_owner_root', fetchOnly: false })
    const $doc = $root.games._staleOwner
    const hash = JSON.stringify(['games', '_staleOwner'])
    const ownerKey = getDocOwnerKeyForTest($doc, $root[ROOT_ID])

    await manager.subscribe($doc, { intent: 'subscribe' })

    const entry = manager.entries.get(hash)
    entry.runtime = null
    entry.mode = 'idle'
    manager.ownerRecords.delete(ownerKey)
    entry.owners.delete(ownerKey)

    await assert.doesNotReject(async () => manager.destroyByOwnerKey(ownerKey, { hash, force: true }))

    assert.equal(manager.subCount.get(hash), undefined, 'stale sub count should be removed')
    assert.equal(manager.ownerFetchCount.get(ownerKey), undefined, 'stale fetch count should be removed')
    assert.equal(manager.ownerSubscribeCount.get(ownerKey), undefined, 'stale subscribe count should be removed')
    assert.equal(manager.ownerKeysByHash.get(hash), undefined, 'stale owner key bucket should be removed')
  })

  it('subscribe recreates missing doc runtime from canonical owner state', async () => {
    const manager = createTrackedDocManager(MockDoc)
    const $root = getRootSignal({ rootId: '_doc_stale_subcount_root', fetchOnly: false })
    const $doc = $root.games._staleSubCount
    const hash = JSON.stringify(['games', '_staleSubCount'])

    await manager.subscribe($doc, { intent: 'subscribe' })

    const entry = manager.entries.get(hash)
    entry.runtime = null
    entry.mode = 'idle'

    await assert.doesNotReject(async () => manager.subscribe($doc, { intent: 'subscribe' }))

    const doc = manager.docs.get(hash)
    assert.equal(manager.subCount.get(hash), 2, 'owner count should remain canonical after runtime recreation')
    assert.ok(doc, 'doc entry should be recreated')
    assert.equal(doc.activeTransportMode, 'subscribe')

    await manager.unsubscribe($doc, { intent: 'subscribe' })
    await manager.unsubscribe($doc, { intent: 'subscribe' })
  })

  it('destroyByHash tolerates stale active mode when doc entry was already detached from transport state', async () => {
    const manager = createTrackedDocManager(MockDoc)
    const $root = getRootSignal({ rootId: '_doc_stale_transport_root', fetchOnly: false })
    const $doc = $root.games._staleTransport
    const hash = JSON.stringify(['games', '_staleTransport'])

    await manager.subscribe($doc, { intent: 'subscribe' })

    const doc = manager.docs.get(hash)
    doc.activeTransportMode = 'subscribe'
    const entry = manager.entries.get(hash)
    entry.runtime = doc
    entry.mode = 'subscribe'
    manager.ownerRecords.clear()
    entry.owners.clear()

    await assert.doesNotReject(async () => manager.destroyByHash(hash, { force: true }))

    assert.equal(manager.docs.get(hash), undefined, 'stale doc should be removed')
    assert.equal(manager.subCount.get(hash), undefined, 'stale sub count should be removed')
  })

  it('destroyByOwnerKey and destroyByHash remain idempotent on the same doc transport', async () => {
    const manager = createTrackedDocManager(MockDoc)
    const $root = getRootSignal({ rootId: '_doc_destroy_idempotent_root', fetchOnly: false })
    const $doc = $root.games._destroyIdempotent
    const hash = JSON.stringify(['games', '_destroyIdempotent'])
    const ownerKey = getDocOwnerKeyForTest($doc, $root[ROOT_ID])

    await manager.subscribe($doc, { intent: 'subscribe' })

    await assert.doesNotReject(async () => manager.destroyByOwnerKey(ownerKey, { hash, force: true }))
    await assert.doesNotReject(async () => manager.destroyByHash(hash, { force: true }))

    assert.equal(manager.docs.get(hash), undefined)
    assert.equal(manager.subCount.get(hash), undefined)
    assert.equal(manager.ownerMeta.get(ownerKey), undefined)
  })

  it('retain keeps doc runtime alive after owner unsubscribe until release', async () => {
    const manager = createTrackedDocManager(MockDoc)
    const $root = getRootSignal({ rootId: '_doc_retain_release_root', fetchOnly: false })
    const $doc = $root.games._retainedDoc
    const hash = JSON.stringify(['games', '_retainedDoc'])

    await manager.subscribe($doc, { intent: 'subscribe' })
    manager.retain($doc)
    await manager.unsubscribe($doc, { intent: 'subscribe' })

    const entryAfterUnsubscribe = manager.entries.get(hash)
    const docAfterUnsubscribe = manager.docs.get(hash)
    assert.ok(entryAfterUnsubscribe, 'entry should remain while retained')
    assert.equal(entryAfterUnsubscribe.retainCount, 1)
    assert.equal(entryAfterUnsubscribe.owners.size, 0)
    assert.ok(docAfterUnsubscribe, 'runtime should remain while retained')
    assert.equal(docAfterUnsubscribe.activeTransportMode, 'idle')
    assert.equal(manager.getTrackedCount(hash), 1, 'tracked count should reflect retain only')

    await manager.release($doc)

    assert.equal(manager.entries.get(hash), undefined, 'entry should be removed after final release')
    assert.equal(manager.docs.get(hash), undefined, 'runtime should be removed after final release')
    assert.equal(manager.getTrackedCount(hash), undefined, 'tracked count should be cleared after final release')
  })

  it('destroyByHash does not destroy a retained doc without force', async () => {
    const manager = createTrackedDocManager(MockDoc)
    const $root = getRootSignal({ rootId: '_doc_destroy_retained_root', fetchOnly: false })
    const $doc = $root.games._destroyRetained
    const hash = JSON.stringify(['games', '_destroyRetained'])

    await manager.subscribe($doc, { intent: 'subscribe' })
    manager.retain($doc)
    await manager.unsubscribe($doc, { intent: 'subscribe' })

    await manager.destroyByHash(hash, { force: false })

    const entry = manager.entries.get(hash)
    assert.ok(entry, 'retained entry should survive non-force destroy')
    assert.equal(entry.retainCount, 1)
    assert.ok(manager.docs.get(hash), 'runtime should survive non-force destroy while retained')

    await manager.release($doc)
  })

  it('destroyByOwnerKey tolerates stale owner cleanup when retain keeps the doc alive', async () => {
    const manager = createTrackedDocManager(MockDoc)
    const $root = getRootSignal({ rootId: '_doc_stale_owner_retain_root', fetchOnly: false })
    const $doc = $root.games._staleOwnerRetained
    const hash = JSON.stringify(['games', '_staleOwnerRetained'])
    const ownerKey = getDocOwnerKeyForTest($doc, $root[ROOT_ID])

    await manager.subscribe($doc, { intent: 'subscribe' })
    manager.retain($doc)

    const entry = manager.entries.get(hash)
    manager.ownerRecords.delete(ownerKey)
    entry.owners.delete(ownerKey)

    await assert.doesNotReject(async () => manager.destroyByOwnerKey(ownerKey, { hash, force: true }))

    const nextEntry = manager.entries.get(hash)
    const nextDoc = manager.docs.get(hash)
    assert.ok(nextEntry, 'retained entry should remain after stale owner cleanup')
    assert.equal(nextEntry.retainCount, 1)
    assert.equal(nextEntry.owners.size, 0)
    assert.ok(nextDoc, 'runtime should remain while retained')
    assert.equal(nextDoc.activeTransportMode, 'idle')

    await manager.release($doc)
  })
})

describe('QuerySubscriptions', () => {
  let $game1, $game2, $game3

  before(async () => {
    $game1 = $.gamesQuery._q1
    $game2 = $.gamesQuery._q2
    $game3 = $.gamesQuery._q3
    await $game1.set({ name: 'Game 1', active: true })
    await $game2.set({ name: 'Game 2', active: true })
    await $game3.set({ name: 'Game 3', active: false })
  })

  afterEachTestGc()
  afterEach(assertTrackedManagersAndReset)

  it('reference counting - subscribe twice to same query, count increases, unsubscribing once doesn\'t actually unsubscribe', async () => {
    const params = { active: true }
    const $activeGames = await sub($.gamesQuery, params)

    const hash = $activeGames[QUERY_HASH]
    const ownerKey = getQueryOwnerKeyForTest($activeGames)

    // Verify query is subscribed
    assert.equal(querySubscriptions.subCount.get(ownerKey), 1, 'sub count should be 1 after first subscribe')
    assert.ok(querySubscriptions.queries.get(hash), 'query should exist in queries map')
    assert.ok(querySubscriptions.queries.get(hash).subscribed, 'query should be subscribed')
    assert.equal($activeGames.get().length, 2, 'should have 2 active games')

    // Subscribe second time to same query using querySubscriptions API
    await querySubscriptions.subscribe($activeGames)
    assert.equal(querySubscriptions.subCount.get(ownerKey), 2, 'sub count should be 2 after second subscribe')
    assert.ok(querySubscriptions.queries.get(hash).subscribed, 'query should still be subscribed')

    // Unsubscribe once
    await querySubscriptions.unsubscribe($activeGames)
    assert.equal(querySubscriptions.subCount.get(ownerKey), 1, 'sub count should be 1 after first unsubscribe')
    assert.ok(querySubscriptions.queries.get(hash).subscribed, 'query should still be subscribed')
    assert.equal($activeGames.get().length, 2, 'should still have 2 active games')

    // Cleanup - final unsubscribe
    await querySubscriptions.unsubscribe($activeGames)
  })

  it('reference counting - unsubscribe all refs, query actually unsubscribes', async () => {
    const params = { active: true }

    // Subscribe once first
    const $activeGames = await sub($.gamesQuery, params)
    const hash = $activeGames[QUERY_HASH]
    const ownerKey = getQueryOwnerKeyForTest($activeGames)

    // Subscribe second time using querySubscriptions API
    await querySubscriptions.subscribe($activeGames)

    assert.equal(querySubscriptions.subCount.get(ownerKey), 2, 'sub count should be 2')
    assert.ok(querySubscriptions.queries.get(hash).subscribed, 'query should be subscribed')

    // Unsubscribe first time
    await querySubscriptions.unsubscribe($activeGames)
    assert.equal(querySubscriptions.subCount.get(ownerKey), 1, 'sub count should be 1')
    assert.ok(querySubscriptions.queries.get(hash).subscribed, 'query should still be subscribed')

    // Unsubscribe second time - should fully unsubscribe
    await querySubscriptions.unsubscribe($activeGames)
    assert.equal(querySubscriptions.subCount.get(ownerKey), undefined, 'sub count should be removed')
    assert.equal(querySubscriptions.queries.get(hash), undefined, 'query should be removed from queries map')
  })

  it('excessive unsubscribe for queries - should not throw', async () => {
    const params = { active: false }

    // Subscribe once
    const $inactiveGames = await sub($.gamesQuery, params)
    const ownerKey = getQueryOwnerKeyForTest($inactiveGames)

    // Unsubscribe once (valid)
    await querySubscriptions.unsubscribe($inactiveGames)
    assert.equal(querySubscriptions.subCount.get(ownerKey), undefined, 'sub count should be removed')

    // Unsubscribe again (excessive) - should not throw
    await assert.doesNotReject(
      async () => await querySubscriptions.unsubscribe($inactiveGames),
      'excessive unsubscribe should not throw'
    )
  })

  it('destroy() for queries - unsubscribes and cleans up', async () => {
    const params = { active: true }
    const $activeGames = await sub($.gamesQuery, params)
    const hash = $activeGames[QUERY_HASH]
    const ownerKey = getQueryOwnerKeyForTest($activeGames)

    assert.ok(querySubscriptions.queries.get(hash), 'query should exist before destroy')
    assert.ok(querySubscriptions.queries.get(hash).subscribed, 'query should be subscribed before destroy')

    // Destroy
    await querySubscriptions.destroy('gamesQuery', params)

    assert.equal(querySubscriptions.subCount.get(ownerKey), undefined, 'sub count should be removed after destroy')
    assert.equal(querySubscriptions.queries.get(hash), undefined, 'query should be removed from queries map after destroy')
  })

  it('query retains materialized docs after an unrelated doc subscription unsubscribes', async () => {
    const params = { active: true }
    const $activeGames = await sub($.gamesQuery, params)
    const ownerKey = getQueryOwnerKeyForTest($activeGames)
    const $game = $.gamesQuery._q1

    assert.deepEqual(_get(['gamesQuery', '_q1']), { name: 'Game 1', active: true, _id: '_q1' })

    await docSubscriptions.subscribe($game)
    await docSubscriptions.unsubscribe($game)

    assert.equal(querySubscriptions.subCount.get(ownerKey), 1, 'query should still be subscribed')
    assert.deepEqual(_get(['gamesQuery', '_q1']), { name: 'Game 1', active: true, _id: '_q1' })

    await querySubscriptions.unsubscribe($activeGames)
  })

  it('recreates query runtime when canonical owner state remains but runtime is missing', async () => {
    class MockQuery {
      constructor (collectionName, params) {
        this.collectionName = collectionName
        this.params = params
        this.subscribed = false
      }

      async subscribe () {
        this.subscribed = true
      }

      async unsubscribe () {
        this.subscribed = false
      }
    }

    const manager = createTrackedQueryManager(MockQuery)
    const $query = getQuerySignal('gamesQuery', { active: true })
    const hash = $query[QUERY_HASH]
    const ownerKey = getQueryOwnerKeyForTest($query)

    await manager.subscribe($query)
    const entry = manager.entries.get(hash)
    entry.runtime = null
    entry.mode = 'idle'

    await assert.doesNotReject(async () => manager.subscribe($query))
    assert.equal(manager.subCount.get(ownerKey), 2, 'owner count should remain canonical after runtime recreation')
    assert.ok(manager.queries.get(hash), 'query should be re-created')
    assert.equal(manager.queries.get(hash).subscribed, true, 'query should be subscribed after recovery')

    await assert.doesNotReject(async () => manager.unsubscribe($query))
    await assert.doesNotReject(async () => manager.unsubscribe($query))
  })

  it('unsubscribe is a no-op when query is already missing', async () => {
    const manager = createTrackedQueryManager(class {
      async subscribe () {}
      async unsubscribe () {}
    })
    const $query = getQuerySignal('gamesQuery', { active: false })
    const ownerKey = getQueryOwnerKeyForTest($query)

    assert.equal(manager.queries.get($query[QUERY_HASH]), undefined, 'query entry should be absent')

    await assert.doesNotReject(async () => manager.unsubscribe($query))
    assert.equal(manager.subCount.get(ownerKey), undefined, 'stale sub count should be removed')
  })

  it('unsubscribe handles stale canonical owner state when query entry is already missing', async () => {
    const manager = createTrackedQueryManager(class {
      async subscribe () {}
      async unsubscribe () {}
    })
    const $query = getQuerySignal('gamesQuery', { active: false })
    const transportHash = $query[QUERY_HASH]
    const ownerKey = getQueryOwnerKeyForTest($query)

    await manager.subscribe($query)
    const entry = manager.entries.get(transportHash)
    entry.runtime = null
    manager.entries.delete(transportHash)

    assert.equal(manager.queries.get(transportHash), undefined, 'query entry should be absent')

    await assert.doesNotReject(async () => manager.unsubscribe($query))
    assert.equal(manager.subCount.get(ownerKey), undefined, 'stale sub count should be removed')
    assert.equal(manager.ownerToTransport.get(ownerKey), undefined, 'stale owner transport link should be removed')
    assert.equal(manager.transportSubCount.get(transportHash), undefined, 'stale transport counter should be removed')
  })

  it('subscribe recreates stale canonical query entry when owner state already exists', async () => {
    const manager = createTrackedQueryManager(class {
      async subscribe () {}
      async unsubscribe () {}
    })
    const $query = getQuerySignal('gamesQuery', { active: false })
    const transportHash = $query[QUERY_HASH]
    const ownerKey = getQueryOwnerKeyForTest($query)

    await manager.subscribe($query, { intent: 'fetch' })
    const entry = manager.entries.get(transportHash)
    entry.runtime = null
    entry.mode = 'idle'

    await assert.doesNotReject(async () => manager.subscribe($query, { intent: 'fetch' }))
    assert.equal(manager.subCount.get(ownerKey), 2, 'owner count should remain canonical after runtime recreation')
    assert.equal(manager.ownerToTransport.get(ownerKey), transportHash, 'owner transport link should be reattached')
    assert.equal(manager.transportSubCount.get(transportHash), 1, 'transport counter should be recreated')
    assert.ok(manager.queries.get(transportHash), 'query entry should be recreated')

    await manager.unsubscribe($query, { intent: 'fetch' })
    await manager.unsubscribe($query, { intent: 'fetch' })
  })

  it('destroyByOwnerKey clears stale canonical transport state when query entry is already missing', async () => {
    const manager = createTrackedQueryManager(class {
      async subscribe () {}
      async unsubscribe () {}
    })
    const $query = getQuerySignal('gamesQuery', { active: false })
    const transportHash = $query[QUERY_HASH]
    const ownerKey = getQueryOwnerKeyForTest($query)

    await manager.subscribe($query, { intent: 'fetch' })
    const record = manager.ownerRecords.get(ownerKey)
    record.fetchCount = 0
    record.subscribeCount = 0
    const entry = manager.entries.get(transportHash)
    entry.runtime = null
    manager.entries.delete(transportHash)

    await assert.doesNotReject(async () => manager.destroyByOwnerKey(ownerKey, { force: true }))
    assert.equal(manager.ownerToTransport.get(ownerKey), undefined, 'owner transport link should be removed')
    assert.equal(manager.transportSubCount.get(transportHash), undefined, 'stale transport counter should be removed')
    assert.equal(manager.ownerKeysByTransport.get(transportHash), undefined, 'stale owner key bucket should be removed')
  })

  it('destroyByOwnerKey and destroyByRuntimeHash remain idempotent on the same query transport', async () => {
    const manager = createTrackedQueryManager(class {
      async subscribe () {}
      async unsubscribe () {}
    })
    const $query = getQuerySignal('gamesQuery', { active: false })
    const transportHash = $query[QUERY_HASH]
    const ownerKey = getQueryOwnerKeyForTest($query)

    await manager.subscribe($query, { intent: 'fetch' })

    await assert.doesNotReject(async () => manager.destroyByOwnerKey(ownerKey, { force: true }))
    await assert.doesNotReject(async () => manager.destroyByRuntimeHash(transportHash, { force: true }))

    assert.equal(manager.queries.get(transportHash), undefined)
    assert.equal(manager.subCount.get(ownerKey), undefined)
    assert.equal(manager.ownerMeta.get(ownerKey), undefined)
  })

  it('_unsubscribe is a no-op when shareQuery is already missing', async () => {
    const query = new Query('gamesQuery', { active: false })

    query.activeTransportMode = 'fetch'
    query.shareQuery = undefined

    await assert.doesNotReject(async () => query._unsubscribe())
    assert.equal(query.activeTransportMode, 'idle')
  })

  it('reconcileTransportNow tolerates stale active mode when shareQuery is already missing', async () => {
    const manager = createTrackedQueryManager(class {
      async subscribe () {}
      async unsubscribe () {}
    })
    const $query = getQuerySignal('gamesQuery', { active: false })
    const transportHash = $query[QUERY_HASH]
    const query = new Query('gamesQuery', { active: false }, { hash: transportHash })

    query.activeTransportMode = 'fetch'
    query.shareQuery = undefined
    query.initialized = true

    const entry = manager.getOrCreateEntry(transportHash)
    entry.runtime = query
    entry.mode = 'fetch'

    await assert.doesNotReject(async () => manager.reconcileTransportNow(transportHash))
    assert.equal(query.activeTransportMode, 'idle')
  })

  it('drops undefined object fields in query params without compat warnings', () => {
    const rawParams = {
      $or: [
        { entity: 'group', entityId: undefined },
        { entity: 'lesson', entityId: 'lesson-1' }
      ]
    }
    const expectedParams = {
      $or: [
        { entity: 'group' },
        { entity: 'lesson', entityId: 'lesson-1' }
      ]
    }

    const $query = getQuerySignal('gamesQuery', rawParams)
    const hash = hashQuery('gamesQuery', rawParams)

    assert.deepEqual($query[QUERY_PARAMS], expectedParams, 'stored params should match normalized shape')
    assert.equal(hash, JSON.stringify({ query: ['gamesQuery', expectedParams] }), 'query hash should match normalized params')
  })

  it('creates distinct query signals per root while keeping transport hash shared', () => {
    const params = { active: true }
    const $rootA = getRootSignal({ rootId: '_queryRootA' })
    const $rootB = getRootSignal({ rootId: '_queryRootB' })
    const $queryA1 = getQuerySignal('gamesQuery', params, { root: $rootA })
    const $queryA2 = getQuerySignal('gamesQuery', params, { root: $rootA })
    const $queryB = getQuerySignal('gamesQuery', params, { root: $rootB })
    const $queryGlobal = getQuerySignal('gamesQuery', params)

    assert.equal($queryA1, $queryA2, 'same root should reuse cached query signal')
    assert.notEqual($queryA1, $queryB, 'different roots should get different query signal instances')
    assert.notEqual($queryA1, $queryGlobal, 'root-scoped and global query signals should not share identity')
    assert.equal($queryA1[QUERY_HASH], $queryB[QUERY_HASH], 'transport hash should stay shared across roots')
  })

  it('shares QuerySubscriptions transport entry across root-scoped query signals', async () => {
    const manager = createTrackedQueryManager(MockQuery)
    const params = { active: true }
    const $rootA = getRootSignal({ rootId: '_scopeA_transport' })
    const $rootB = getRootSignal({ rootId: '_scopeB_transport' })
    const $queryA = getQuerySignal('gamesQuery', params, { root: $rootA })
    const $queryB = getQuerySignal('gamesQuery', params, { root: $rootB })
    const transportHash = $queryA[QUERY_HASH]

    await manager.subscribe($queryA)
    await manager.subscribe($queryB)
    assert.equal(manager.subCount.size, 2, 'two root-owned counters should exist')
    assert.equal(manager.transportSubCount.get(transportHash), 2, 'transport ref-count should aggregate across roots')
    assert.equal(manager.queries.size, 1, 'single transport query entry should be shared')

    await manager.unsubscribe($queryA)
    assert.equal(manager.subCount.size, 1, 'first root counter should be removed')
    assert.equal(manager.transportSubCount.get(transportHash), 1, 'first root unsubscribe should keep transport query alive')
    await manager.unsubscribe($queryB)
    assert.equal(manager.subCount.size, 0, 'last root counter should be removed')
    assert.equal(manager.transportSubCount.get(transportHash), undefined, 'transport ref-count should be removed')
    assert.equal(manager.queries.get(transportHash), undefined, 'transport query entry should be removed')
  })

  it('uses fetch transport for query subscribe on fetchOnly roots', async () => {
    const manager = createTrackedQueryManager(MockQuery)
    const $root = getRootSignal({ rootId: '_query_fetch_root', fetchOnly: true })
    const $query = getQuerySignal('gamesQuery', { active: true }, { root: $root })
    const transportHash = $query[QUERY_HASH]

    await manager.subscribe($query, { intent: 'subscribe' })

    const query = manager.queries.get(transportHash)
    assert.deepEqual(query.events, ['subscribe:fetch'])
    assert.equal(query.activeTransportMode, 'fetch')
    assert.equal(query.subscribed, false)

    await manager.unsubscribe($query, { intent: 'subscribe' })
    await manager.clear()
  })

  it('uses subscribe transport for query subscribe on live roots', async () => {
    const manager = createTrackedQueryManager(MockQuery)
    const $root = getRootSignal({ rootId: '_query_live_root', fetchOnly: false })
    const $query = getQuerySignal('gamesQuery', { active: true }, { root: $root })
    const transportHash = $query[QUERY_HASH]

    await manager.subscribe($query, { intent: 'subscribe' })

    const query = manager.queries.get(transportHash)
    assert.deepEqual(query.events, ['subscribe:subscribe'])
    assert.equal(query.activeTransportMode, 'subscribe')
    assert.equal(query.subscribed, true)

    await manager.unsubscribe($query, { intent: 'subscribe' })
    await manager.clear()
  })

  it('uses fetch transport for explicit fetch intent on live query roots', async () => {
    const manager = createTrackedQueryManager(MockQuery)
    const $root = getRootSignal({ rootId: '_query_fetch_intent_root', fetchOnly: false })
    const $query = getQuerySignal('gamesQuery', { active: true }, { root: $root })
    const transportHash = $query[QUERY_HASH]

    await manager.subscribe($query, { intent: 'fetch' })

    const query = manager.queries.get(transportHash)
    assert.deepEqual(query.events, ['subscribe:fetch'])
    assert.equal(query.activeTransportMode, 'fetch')
    assert.equal(query.subscribed, false)

    await manager.unsubscribe($query, { intent: 'fetch' })
    await manager.clear()
  })

  it('upgrades and downgrades query transport for mixed root modes', async () => {
    const manager = createTrackedQueryManager(MockQuery)
    const $fetchRoot = getRootSignal({ rootId: '_query_mixed_fetch_root', fetchOnly: true })
    const $liveRoot = getRootSignal({ rootId: '_query_mixed_live_root', fetchOnly: false })
    const params = { active: true }
    const $fetchQuery = getQuerySignal('gamesQuery', params, { root: $fetchRoot })
    const $liveQuery = getQuerySignal('gamesQuery', params, { root: $liveRoot })
    const transportHash = $fetchQuery[QUERY_HASH]

    await manager.subscribe($fetchQuery, { intent: 'subscribe' })
    let query = manager.queries.get(transportHash)
    assert.deepEqual(query.events, ['subscribe:fetch'])
    assert.equal(query.activeTransportMode, 'fetch')

    await manager.subscribe($liveQuery, { intent: 'subscribe' })
    query = manager.queries.get(transportHash)
    assert.deepEqual(query.events, ['subscribe:fetch', 'unsubscribe:fetch', 'subscribe:subscribe'])
    assert.equal(query.activeTransportMode, 'subscribe')
    assert.equal(query.subscribed, true)

    await manager.unsubscribe($liveQuery, { intent: 'subscribe' })
    query = manager.queries.get(transportHash)
    assert.deepEqual(query.events, [
      'subscribe:fetch',
      'unsubscribe:fetch',
      'subscribe:subscribe',
      'unsubscribe:subscribe',
      'subscribe:fetch'
    ])
    assert.equal(query.activeTransportMode, 'fetch')
    assert.equal(query.subscribed, false)

    await manager.unsubscribe($fetchQuery, { intent: 'subscribe' })
    await manager.clear()
  })

  it('creates distinct aggregation signals per root while keeping transport hash shared', () => {
    const params = { $aggregate: [{ $match: { active: true } }] }
    const $rootA = getRootSignal({ rootId: '_aggregationRootA' })
    const $rootB = getRootSignal({ rootId: '_aggregationRootB' })
    const $aggregationA1 = getAggregationSignal('gamesQuery', params, { root: $rootA })
    const $aggregationA2 = getAggregationSignal('gamesQuery', params, { root: $rootA })
    const $aggregationB = getAggregationSignal('gamesQuery', params, { root: $rootB })
    const $aggregationGlobal = getAggregationSignal('gamesQuery', params)

    assert.equal($aggregationA1, $aggregationA2, 'same root should reuse cached aggregation signal')
    assert.notEqual($aggregationA1, $aggregationB, 'different roots should get different aggregation signal')
    assert.notEqual($aggregationA1, $aggregationGlobal, 'root-scoped and global aggregations should not share signal')
    assert.equal($aggregationA1[QUERY_HASH], $aggregationB[QUERY_HASH], 'aggregation transport hash should stay shared')
  })

  it('uses fetch transport for aggregation subscribe on fetchOnly roots', async () => {
    const params = { $aggregate: [{ $match: { active: true } }] }
    const manager = createTrackedQueryManager(MockQuery)
    const $root = getRootSignal({ rootId: '_aggregation_fetch_root', fetchOnly: true })
    const $aggregation = getAggregationSignal('gamesQuery', params, { root: $root })
    const transportHash = $aggregation[QUERY_HASH]

    await manager.subscribe($aggregation, { intent: 'subscribe' })

    const aggregation = manager.queries.get(transportHash)
    assert.deepEqual(aggregation.events, ['subscribe:fetch'])
    assert.equal(aggregation.activeTransportMode, 'fetch')
    assert.equal(aggregation.subscribed, false)

    await manager.unsubscribe($aggregation, { intent: 'subscribe' })
    await manager.clear()
  })

  it('uses subscribe transport for aggregation subscribe on live roots', async () => {
    const params = { $aggregate: [{ $match: { active: true } }] }
    const manager = createTrackedQueryManager(MockQuery)
    const $root = getRootSignal({ rootId: '_aggregation_live_root', fetchOnly: false })
    const $aggregation = getAggregationSignal('gamesQuery', params, { root: $root })
    const transportHash = $aggregation[QUERY_HASH]

    await manager.subscribe($aggregation, { intent: 'subscribe' })

    const aggregation = manager.queries.get(transportHash)
    assert.deepEqual(aggregation.events, ['subscribe:subscribe'])
    assert.equal(aggregation.activeTransportMode, 'subscribe')
    assert.equal(aggregation.subscribed, true)

    await manager.unsubscribe($aggregation, { intent: 'subscribe' })
    await manager.clear()
  })

  it('upgrades and downgrades aggregation transport for mixed root modes', async () => {
    const params = { $aggregate: [{ $match: { active: true } }] }
    const manager = createTrackedQueryManager(MockQuery)
    const $fetchRoot = getRootSignal({ rootId: '_aggregation_mixed_fetch_root', fetchOnly: true })
    const $liveRoot = getRootSignal({ rootId: '_aggregation_mixed_live_root', fetchOnly: false })
    const $fetchAggregation = getAggregationSignal('gamesQuery', params, { root: $fetchRoot })
    const $liveAggregation = getAggregationSignal('gamesQuery', params, { root: $liveRoot })
    const transportHash = $fetchAggregation[QUERY_HASH]

    await manager.subscribe($fetchAggregation, { intent: 'subscribe' })
    let aggregation = manager.queries.get(transportHash)
    assert.deepEqual(aggregation.events, ['subscribe:fetch'])
    assert.equal(aggregation.activeTransportMode, 'fetch')

    await manager.subscribe($liveAggregation, { intent: 'subscribe' })
    aggregation = manager.queries.get(transportHash)
    assert.deepEqual(aggregation.events, ['subscribe:fetch', 'unsubscribe:fetch', 'subscribe:subscribe'])
    assert.equal(aggregation.activeTransportMode, 'subscribe')
    assert.equal(aggregation.subscribed, true)

    await manager.unsubscribe($liveAggregation, { intent: 'subscribe' })
    aggregation = manager.queries.get(transportHash)
    assert.deepEqual(aggregation.events, [
      'subscribe:fetch',
      'unsubscribe:fetch',
      'subscribe:subscribe',
      'unsubscribe:subscribe',
      'subscribe:fetch'
    ])
    assert.equal(aggregation.activeTransportMode, 'fetch')
    assert.equal(aggregation.subscribed, false)

    await manager.unsubscribe($fetchAggregation, { intent: 'subscribe' })
    await manager.clear()
  })

  it('keeps query runtime materialized per root while sharing transport subscription', async () => {
    const collectionName = 'gamesScopedViews'
    const doc1 = getConnection().get(collectionName, '_1')
    const doc2 = getConnection().get(collectionName, '_2')
    await cbPromise(cb => doc1.create({ name: 'Scoped 1', active: true }, cb))
    await cbPromise(cb => doc2.create({ name: 'Scoped 2', active: true }, cb))

    const $rootA = getRootSignal({ rootId: '_queryScopeA' })
    const $rootB = getRootSignal({ rootId: '_queryScopeB' })
    const $queryA = getQuerySignal(collectionName, { active: true }, { root: $rootA })
    const $queryB = getQuerySignal(collectionName, { active: true }, { root: $rootB })
    await querySubscriptions.subscribe($queryA)
    await querySubscriptions.subscribe($queryB)

    assert.equal($queryA[QUERY_HASH], $queryB[QUERY_HASH], 'transport hash should stay shared')

    const idsA = getPrivateData($rootA[ROOT_ID], [QUERIES, $queryA[QUERY_HASH], 'ids'])
    const idsB = getPrivateData($rootB[ROOT_ID], [QUERIES, $queryB[QUERY_HASH], 'ids'])
    assert.deepEqual(idsA.slice().sort(), ['_1', '_2'])
    assert.deepEqual(idsB.slice().sort(), ['_1', '_2'])
    assert.notEqual(idsA, idsB, 'per-root runtime state should use separate arrays')

    await querySubscriptions.unsubscribe($queryA)
    assert.equal(getPrivateData($rootA[ROOT_ID], [QUERIES, $queryA[QUERY_HASH]]), undefined, 'root A runtime state should be removed')
    assert.deepEqual(getPrivateData($rootB[ROOT_ID], [QUERIES, $queryB[QUERY_HASH], 'ids']).slice().sort(), ['_1', '_2'], 'root B should remain')

    await querySubscriptions.unsubscribe($queryB)
    await cbPromise(cb => doc1.del(cb))
    await cbPromise(cb => doc2.del(cb))
  })

  it('keeps aggregation runtime materialized per root while sharing transport subscription', async () => {
    const collectionName = 'gamesScopedAggregations'
    const doc1 = getConnection().get(collectionName, '_1')
    const doc2 = getConnection().get(collectionName, '_2')
    await cbPromise(cb => doc1.create({ name: 'Agg 1', active: true }, cb))
    await cbPromise(cb => doc2.create({ name: 'Agg 2', active: true }, cb))

    const params = { $aggregate: [{ $match: { active: true } }] }
    const $rootA = getRootSignal({ rootId: '_aggregationViewScopeA' })
    const $rootB = getRootSignal({ rootId: '_aggregationViewScopeB' })
    const $aggregationA = getAggregationSignal(collectionName, params, { root: $rootA })
    const $aggregationB = getAggregationSignal(collectionName, params, { root: $rootB })

    await aggregationSubscriptions.subscribe($aggregationA)
    await aggregationSubscriptions.subscribe($aggregationB)

    assert.equal($aggregationA[QUERY_HASH], $aggregationB[QUERY_HASH], 'transport hash should stay shared')

    const aggA = getPrivateData($rootA[ROOT_ID], [AGGREGATIONS, $aggregationA[QUERY_HASH]])
    const aggB = getPrivateData($rootB[ROOT_ID], [AGGREGATIONS, $aggregationB[QUERY_HASH]])
    assert.equal(Array.isArray(aggA), true)
    assert.equal(Array.isArray(aggB), true)
    assert.deepEqual(aggA.map(item => item._id).sort(), ['_1', '_2'])
    assert.deepEqual(aggB.map(item => item._id).sort(), ['_1', '_2'])

    await aggregationSubscriptions.unsubscribe($aggregationA)
    assert.equal(getPrivateData($rootA[ROOT_ID], [AGGREGATIONS, $aggregationA[QUERY_HASH]]), undefined, 'root A aggregation runtime should be removed')
    assert.equal(Array.isArray(getPrivateData($rootB[ROOT_ID], [AGGREGATIONS, $aggregationB[QUERY_HASH]])), true, 'root B should remain')

    await aggregationSubscriptions.unsubscribe($aggregationB)
    await cbPromise(cb => doc1.del(cb))
    await cbPromise(cb => doc2.del(cb))
  })
})

describe('Subscription GC grace delay', () => {
  afterEach(assertTrackedManagersAndReset)
  const gcDelay = 30
  const defaultGcDelay = 3000

  beforeEach(() => {
    setSubscriptionGcDelay(gcDelay)
  })

  afterEach(async () => {
    setSubscriptionGcDelay(0)
    __resetSubscriptionGcDelayForTests()
  })

  it('uses the same non-zero default delay in compat and non-compat modes', () => {
    __resetSubscriptionGcDelayForTests()
    assert.equal(getSubscriptionGcDelay(), defaultGcDelay, 'default delay should keep a grace window')
    setSubscriptionGcDelay(gcDelay)
  })

  it('doc: does not destroy immediately when refCount hits zero', async () => {
    const manager = createTrackedDocManager(MockDoc)
    const $doc = createDocSignal('gamesGrace', 'doc-immediate')
    const hash = JSON.stringify($doc[SEGMENTS])

    await manager.subscribe($doc)
    const unsubscribePromise = manager.unsubscribe($doc)

    assert.equal(manager.subCount.get(hash), 0, 'count stays at 0 during grace delay')
    assert.ok(manager.docs.get(hash), 'doc should still exist before delay expires')
    await unsubscribePromise
    assert.equal(manager.subCount.get(hash), undefined, 'count should be removed after delayed cleanup')
    assert.equal(manager.docs.get(hash), undefined, 'doc should be removed after delayed cleanup')

    await manager.clear()
  })

  it('doc: rapid unsubscribe/subscribe reuses the same instance', async () => {
    const manager = createTrackedDocManager(MockDoc)
    const $docA = createDocSignal('gamesGrace', 'doc-reuse')
    const hash = JSON.stringify($docA[SEGMENTS])

    await manager.subscribe($docA)
    const instance = manager.docs.get(hash)
    const unsubscribePromise = manager.unsubscribe($docA)
    await wait(5)

    const $docB = createDocSignal('gamesGrace', 'doc-reuse')
    await manager.subscribe($docB)
    assert.equal(manager.docs.get(hash), instance, 'same instance should be reused on quick resubscribe')
    await unsubscribePromise

    await wait(gcDelay + 10)
    assert.ok(manager.docs.get(hash), 'timer callback must not remove re-subscribed doc')

    await manager.unsubscribe($docB)
    await manager.clear()
  })

  it('doc: destroys after delay if no resubscribe', async () => {
    const manager = createTrackedDocManager(MockDoc)
    const $doc = createDocSignal('gamesGrace', 'doc-destroy')
    const hash = JSON.stringify($doc[SEGMENTS])

    await manager.subscribe($doc)
    const unsubscribePromise = manager.unsubscribe($doc)
    assert.ok(manager.docs.get(hash), 'doc is still present right after unsubscribe')
    await unsubscribePromise
    assert.equal(manager.docs.get(hash), undefined, 'doc should be destroyed after grace delay')
    assert.equal(manager.subCount.get(hash), undefined, 'count should be removed after destroy')

    await manager.clear()
  })

  it('doc: waits pending operations before destroy', async () => {
    const manager = createTrackedDocManager(PendingMockDoc)
    const $doc = createDocSignal('gamesGrace', 'doc-pending')
    const hash = JSON.stringify($doc[SEGMENTS])

    await manager.subscribe($doc)
    const docInstance = manager.docs.get(hash)
    docInstance.setPending(true)

    const unsubscribePromise = manager.unsubscribe($doc)
    let unsubscribeResolved = false
    unsubscribePromise.then(() => {
      unsubscribeResolved = true
    })
    await wait(gcDelay + 10)

    assert.ok(manager.docs.get(hash), 'doc should stay while pending')
    assert.equal(docInstance.destroyed, false, 'destroy must be deferred')
    assert.equal(unsubscribeResolved, false, 'unsubscribe should wait until pending ops are done')

    docInstance.setPending(false)
    await unsubscribePromise

    assert.equal(manager.docs.get(hash), undefined, 'doc should be destroyed after pending resolves')
    assert.equal(manager.subCount.get(hash), undefined, 'count should be removed after destroy')

    await manager.clear()
  })

  it('query: does not destroy immediately when refCount hits zero', async () => {
    const manager = createTrackedQueryManager(MockQuery)
    const $query = createMockQuerySignal('gamesGrace', { active: true })
    const hash = $query[QUERY_HASH]

    await manager.subscribe($query)
    const unsubscribePromise = manager.unsubscribe($query)

    assert.deepEqual(Array.from(manager.subCount.values()), [0], 'count stays at 0 during grace delay')
    assert.ok(manager.queries.get(hash), 'query should still exist before delay expires')
    await unsubscribePromise
    assert.equal(manager.subCount.get(hash), undefined, 'count should be removed after delayed cleanup')
    assert.equal(manager.queries.get(hash), undefined, 'query should be removed after delayed cleanup')

    await manager.clear()
  })

  it('query: rapid unsubscribe/subscribe reuses the same instance', async () => {
    const manager = createTrackedQueryManager(MockQuery)
    const $queryA = createMockQuerySignal('gamesGrace', { active: true, tab: 1 })
    const hash = $queryA[QUERY_HASH]

    await manager.subscribe($queryA)
    const instance = manager.queries.get(hash)
    const unsubscribePromise = manager.unsubscribe($queryA)
    await wait(5)

    const $queryB = createMockQuerySignal('gamesGrace', { active: true, tab: 1 })
    await manager.subscribe($queryB)
    assert.equal(manager.queries.get(hash), instance, 'same instance should be reused on quick resubscribe')
    await unsubscribePromise

    await wait(gcDelay + 10)
    assert.ok(manager.queries.get(hash), 'timer callback must not remove re-subscribed query')

    await manager.unsubscribe($queryB)
    await manager.clear()
  })

  it('query: destroys after delay if no resubscribe', async () => {
    const manager = createTrackedQueryManager(MockQuery)
    const $query = createMockQuerySignal('gamesGrace', { active: false })
    const hash = $query[QUERY_HASH]

    await manager.subscribe($query)
    const unsubscribePromise = manager.unsubscribe($query)
    assert.ok(manager.queries.get(hash), 'query is still present right after unsubscribe')
    await unsubscribePromise
    assert.equal(manager.queries.get(hash), undefined, 'query should be destroyed after grace delay')
    assert.equal(manager.subCount.get(hash), undefined, 'count should be removed after destroy')

    await manager.clear()
  })

  it('clear cancels pending doc/query destroy timers', async () => {
    const docManager = createTrackedDocManager(MockDoc)
    const queryManager = createTrackedQueryManager(MockQuery)
    const $doc = createDocSignal('gamesGrace', 'doc-clear')
    const $query = createMockQuerySignal('gamesGrace', { active: true, clear: 1 })
    const docHash = JSON.stringify($doc[SEGMENTS])
    const queryHash = $query[QUERY_HASH]

    await docManager.subscribe($doc)
    await queryManager.subscribe($query)
    const docUnsubscribePromise = docManager.unsubscribe($doc)
    const queryUnsubscribePromise = queryManager.unsubscribe($query)

    assert.equal(docManager.pendingDestroyTimers.size, 1, 'doc pending destroy timer is scheduled')
    assert.equal(queryManager.pendingDestroyTimers.size, 1, 'query pending destroy timer is scheduled')

    await docManager.clear()
    await queryManager.clear()
    await Promise.all([docUnsubscribePromise, queryUnsubscribePromise])

    assert.equal(docManager.pendingDestroyTimers.size, 0, 'doc pending timers are cleared')
    assert.equal(queryManager.pendingDestroyTimers.size, 0, 'query pending timers are cleared')
    assert.equal(docManager.docs.get(docHash), undefined, 'doc map cleaned after clear')
    assert.equal(queryManager.queries.get(queryHash), undefined, 'query map cleaned after clear')

    await wait(gcDelay + 10)
    assert.equal(docManager.docs.get(docHash), undefined, 'no late timer side effects for docs')
    assert.equal(queryManager.queries.get(queryHash), undefined, 'no late timer side effects for queries')
  })
})

describe('sub() function - error handling and edge cases', () => {
  afterEachTestGc()
  afterEach(assertTrackedManagersAndReset)

  it('sub() with array throws error', async () => {
    await assert.rejects(
      async () => await sub([$.games._test1, $.games._test2]),
      { message: /sub\(\) does not support multiple subscriptions yet/ },
      'should throw error for array argument'
    )
  })

  it('sub() with invalid args throws error', async () => {
    await assert.rejects(
      async () => await sub('invalid'),
      { message: /Invalid args passed for sub\(\)/ },
      'should throw error for invalid arguments'
    )
  })

  it('sub() returns signal directly when already subscribed (not a promise)', async () => {
    const gameId = '_alreadysub1'
    const $game = $.games[gameId]

    // First subscription returns a promise
    const result1 = sub($game)
    assert.ok(result1 instanceof Promise, 'first sub should return a promise')
    await result1

    // Second subscription returns the signal directly (not a promise)
    const result2 = sub($game)
    assert.ok(!(result2 instanceof Promise), 'second sub should not return a promise')
    assert.equal(result2, $game, 'should return the signal directly')

    // Cleanup
    await docSubscriptions.unsubscribe($game)
    const doc = getConnection().get('games', gameId)
    if (doc.data && !isMissingShareDoc(doc)) await cbPromise(cb => doc.del(cb))
  })

  it('sub() returns promise for new subscription', async () => {
    const gameId = '_newsub1'
    const $game = $.games[gameId]

    const result = sub($game)
    assert.ok(result instanceof Promise, 'sub should return a promise for new subscription')

    const resolved = await result
    assert.equal(resolved, $game, 'promise should resolve to the signal')

    // Cleanup
    await docSubscriptions.unsubscribe($game)
    const doc = getConnection().get('games', gameId)
    if (doc.data && !isMissingShareDoc(doc)) await cbPromise(cb => doc.del(cb))
  })

  it('unsub() uses the mode recorded by sub()', async () => {
    const gameId = '_sub_unsub_mode'
    const $game = $.games[gameId]
    const doc = getConnection().get('games', gameId)
    const originalFetch = doc.fetch.bind(doc)
    const originalUnfetch = doc.unfetch?.bind(doc)
    const originalSubscribe = doc.subscribe.bind(doc)
    const originalUnsubscribe = doc.unsubscribe.bind(doc)
    const calls = []

    doc.fetch = function (...args) {
      calls.push('fetch')
      return originalFetch(...args)
    }
    if (originalUnfetch) {
      doc.unfetch = function (...args) {
        calls.push('unfetch')
        return originalUnfetch(...args)
      }
    }
    doc.subscribe = function (...args) {
      calls.push('subscribe')
      return originalSubscribe(...args)
    }
    doc.unsubscribe = function (...args) {
      calls.push('unsubscribe')
      return originalUnsubscribe(...args)
    }

    try {
      await sub($game, { mode: 'fetch' })
      await sub($game, { mode: 'subscribe' })
      await unsub($game)
      await unsub($game)

      assert.deepEqual(calls, [
        'fetch',
        originalUnfetch ? 'unfetch' : 'unsubscribe',
        'subscribe',
        'unsubscribe',
        'fetch',
        originalUnfetch ? 'unfetch' : 'unsubscribe'
      ])
    } finally {
      doc.fetch = originalFetch
      if (originalUnfetch) doc.unfetch = originalUnfetch
      doc.subscribe = originalSubscribe
      doc.unsubscribe = originalUnsubscribe
      if (doc.data && !isMissingShareDoc(doc)) await cbPromise(cb => doc.del(cb))
    }
  })
})

describe('Rapid subscribe/unsubscribe integration tests', () => {
  afterEachTestGc()
  afterEach(assertTrackedManagersAndReset)

  afterEach(async () => {
    // Run GC first to clean up signal references
    await runGc()

    // Clean up rapid test games - properly destroy ShareDB docs
    const collections = getConnection().collections?.gamesRapid || {}
    for (const docId in collections) {
      const doc = collections[docId]
      if (doc) {
        await new Promise((resolve, reject) => {
          doc.destroy(err => err ? reject(err) : resolve())
        })
      }
    }

    assert.deepEqual(_get(['gamesRapid']), {}, 'gamesRapid collection is empty in signal\'s data tree')
    assert.equal(Object.keys(getConnection().collections?.gamesRapid || {}).length, 0, 'no gamesRapid in ShareDB\'s connection')
  })

  it('rapid sub/unsub/sub on the same doc signal via sub() function', async () => {
    const gameId = '_rapid1'
    const $game = $.gamesRapid[gameId]

    // Create the document first
    const doc = getConnection().get('gamesRapid', gameId)
    await cbPromise(cb => doc.create({ name: 'Rapid Game 1', players: 0 }, cb))

    // First subscribe
    await sub($game)
    const hash = JSON.stringify(['gamesRapid', gameId])
    assert.ok(docSubscriptions.docs.get(hash).subscribed, 'should be subscribed after first sub')
    assert.equal($game.name.get(), 'Rapid Game 1', 'signal should have data')

    // Unsubscribe using docSubscriptions API
    await docSubscriptions.unsubscribe($game)
    assert.equal(docSubscriptions.docs.get(hash), undefined, 'doc should be removed after unsubscribe')

    // Subscribe again
    await sub($game)
    assert.ok(docSubscriptions.docs.get(hash), 'doc should exist after re-sub')
    assert.ok(docSubscriptions.docs.get(hash).subscribed, 'should be subscribed after re-sub')

    // Data should still be accessible
    assert.equal($game.name.get(), 'Rapid Game 1', 'signal should still have data after re-subscribe')

    // Cleanup
    await docSubscriptions.unsubscribe($game)
  })

  it('subscribe to doc, unsubscribe, resubscribe', async () => {
    const gameId = '_resubscribe1'
    const $game = $.gamesRapid[gameId]

    const doc = getConnection().get('gamesRapid', gameId)
    await cbPromise(cb => doc.create({ name: 'Resubscribe Game', players: 5 }, cb))

    // First subscribe
    await sub($game)

    const hash = JSON.stringify(['gamesRapid', gameId])
    assert.equal($game.name.get(), 'Resubscribe Game', 'signal has name after first subscribe')
    assert.equal($game.players.get(), 5, 'signal has players after first subscribe')

    // Modify the data while subscribed
    await cbPromise(cb => doc.submitOp([{ p: ['players'], na: 1 }], cb))
    assert.equal($game.players.get(), 6, 'signal should update after modification')

    // Unsubscribe using docSubscriptions API
    await docSubscriptions.unsubscribe($game)
    assert.equal(docSubscriptions.docs.get(hash), undefined, 'doc should be removed after unsubscribe')

    // Resubscribe
    await sub($game)
    assert.ok(docSubscriptions.docs.get(hash), 'doc should exist after resubscribe')
    assert.ok(docSubscriptions.docs.get(hash).subscribed, 'doc should be subscribed after resubscribe')

    // Data should still be accessible (including the modification from before)
    assert.equal($game.name.get(), 'Resubscribe Game', 'signal should have name after resubscribe')
    assert.equal($game.players.get(), 6, 'signal should have players after resubscribe')

    // Cleanup
    await docSubscriptions.unsubscribe($game)
  })

  it('rapid subscribe/unsubscribe during async operations', async () => {
    const gameId = '_asyncrapid1'
    let $game = $.gamesRapid[gameId]

    // Start subscribing using docSubscriptions API
    const subscribePromise1 = docSubscriptions.subscribe($game)

    // Immediately try to subscribe again (before first completes)
    const subscribePromise2 = docSubscriptions.subscribe($game)

    // Both should complete
    await Promise.all([subscribePromise1, subscribePromise2])

    // Verify both subscriptions were counted
    const hash = JSON.stringify(['gamesRapid', gameId])
    assert.equal(docSubscriptions.subCount.get(hash), 2, 'sub count should be 2 (two subscribe calls)')

    // Create data
    const doc = getConnection().get('gamesRapid', gameId)
    await cbPromise(cb => doc.create({ name: 'Async Rapid Game', players: 0 }, cb))
    assert.equal($game.name.get(), 'Async Rapid Game', 'signal should have data')

    // Unsubscribe both
    await docSubscriptions.unsubscribe($game)
    assert.equal(docSubscriptions.subCount.get(hash), 1, 'sub count should be 1 after first unsubscribe')

    await docSubscriptions.unsubscribe($game)
    await new Promise(resolve => setImmediate(resolve)) // Wait for destroy to complete
    assert.equal(docSubscriptions.docs.get(hash), undefined, 'doc should be removed after both unsubscribes')

    // Cleanup - delete doc and release signal reference for GC
    await cbPromise(cb => doc.del(cb))
    $game = null
  })
})
