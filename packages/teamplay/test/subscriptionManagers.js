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
import { it, describe, before, afterEach } from 'mocha'
import { strict as assert } from 'node:assert'
import { afterEachTestGc, runGc } from './_helpers.js'
import { $, sub } from '../index.js'
import { docSubscriptions } from '../orm/Doc.js'
import { querySubscriptions, HASH as QUERY_HASH } from '../orm/Query.js'
import { getConnection } from '../orm/connection.js'
import { get as _get } from '../orm/dataTree.js'
import connect from '../connect/test.js'

before(connect)

function cbPromise (fn) {
  return new Promise((resolve, reject) => {
    fn((err, result) => err ? reject(err) : resolve(result))
  })
}

describe('DocSubscriptions', () => {
  afterEachTestGc()

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
    if (shareDoc.data) await cbPromise(cb => shareDoc.del(cb))
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
    if (shareDoc.data) await cbPromise(cb => shareDoc.del(cb))
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

  it('reference counting - subscribe twice to same query, count increases, unsubscribing once doesn\'t actually unsubscribe', async () => {
    const params = { active: true }
    const $activeGames = await sub($.gamesQuery, params)

    const hash = $activeGames[QUERY_HASH]

    // Verify query is subscribed
    assert.equal(querySubscriptions.subCount.get(hash), 1, 'sub count should be 1 after first subscribe')
    assert.ok(querySubscriptions.queries.get(hash), 'query should exist in queries map')
    assert.ok(querySubscriptions.queries.get(hash).subscribed, 'query should be subscribed')
    assert.equal($activeGames.get().length, 2, 'should have 2 active games')

    // Subscribe second time to same query using querySubscriptions API
    await querySubscriptions.subscribe($activeGames)
    assert.equal(querySubscriptions.subCount.get(hash), 2, 'sub count should be 2 after second subscribe')
    assert.ok(querySubscriptions.queries.get(hash).subscribed, 'query should still be subscribed')

    // Unsubscribe once
    await querySubscriptions.unsubscribe($activeGames)
    assert.equal(querySubscriptions.subCount.get(hash), 1, 'sub count should be 1 after first unsubscribe')
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

    // Subscribe second time using querySubscriptions API
    await querySubscriptions.subscribe($activeGames)

    assert.equal(querySubscriptions.subCount.get(hash), 2, 'sub count should be 2')
    assert.ok(querySubscriptions.queries.get(hash).subscribed, 'query should be subscribed')

    // Unsubscribe first time
    await querySubscriptions.unsubscribe($activeGames)
    assert.equal(querySubscriptions.subCount.get(hash), 1, 'sub count should be 1')
    assert.ok(querySubscriptions.queries.get(hash).subscribed, 'query should still be subscribed')

    // Unsubscribe second time - should fully unsubscribe
    await querySubscriptions.unsubscribe($activeGames)
    assert.equal(querySubscriptions.subCount.get(hash), undefined, 'sub count should be removed')
    assert.equal(querySubscriptions.queries.get(hash), undefined, 'query should be removed from queries map')
  })

  it('excessive unsubscribe for queries - should not throw', async () => {
    const params = { active: false }

    // Subscribe once
    const $inactiveGames = await sub($.gamesQuery, params)
    const hash = $inactiveGames[QUERY_HASH]

    // Unsubscribe once (valid)
    await querySubscriptions.unsubscribe($inactiveGames)
    assert.equal(querySubscriptions.subCount.get(hash), undefined, 'sub count should be removed')

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

    assert.ok(querySubscriptions.queries.get(hash), 'query should exist before destroy')
    assert.ok(querySubscriptions.queries.get(hash).subscribed, 'query should be subscribed before destroy')

    // Destroy
    await querySubscriptions.destroy('gamesQuery', params)

    assert.equal(querySubscriptions.subCount.get(hash), undefined, 'sub count should be removed after destroy')
    assert.equal(querySubscriptions.queries.get(hash), undefined, 'query should be removed from queries map after destroy')
  })
})

describe('sub() function - error handling and edge cases', () => {
  afterEachTestGc()

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
    if (doc.data) await cbPromise(cb => doc.del(cb))
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
    if (doc.data) await cbPromise(cb => doc.del(cb))
  })
})

describe('Rapid subscribe/unsubscribe integration tests', () => {
  afterEachTestGc()

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
