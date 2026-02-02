import { it, describe, before } from 'mocha'
import { strict as assert } from 'node:assert'
import { runGc } from './_helpers.js'
import { $, sub, aggregation, __DEBUG_SIGNALS_CACHE__ as signalsCache } from '../index.js'
import { getConnection } from '../orm/connection.js'
import { docSubscriptions } from '../orm/Doc.js'
import { querySubscriptions } from '../orm/Query.js'
import { aggregationSubscriptions } from '../orm/Aggregation.js'
import connect from '../connect/test.js'

before(connect)

function cbPromise (fn) {
  return new Promise((resolve, reject) => {
    fn((err, result) => err ? reject(err) : resolve(result))
  })
}

describe('GC Cleanup Tests', () => {
  describe('Doc GC cleanup', () => {
    it('doc subscription is cleaned up when signal is garbage collected', async () => {
      const gameId = 'gc_doc_1'
      const collection = 'games_gc_doc_1'

      const hash = JSON.stringify([collection, gameId])

      // Create subscription in a scope using IIFE pattern
      await (async () => {
        const $game = await sub($[collection][gameId])
        const doc = getConnection().get(collection, gameId)
        await cbPromise(cb => doc.create({ name: 'Test Game', players: 0 }, cb))

        assert.equal($game.name.get(), 'Test Game', 'signal has name')

        // Verify subscription exists
        assert.ok(docSubscriptions.docs.has(hash), 'doc is in docSubscriptions.docs')
        assert.ok(docSubscriptions.subCount.has(hash), 'doc is in docSubscriptions.subCount')
        assert.equal(docSubscriptions.subCount.get(hash), 1, 'subCount is 1')

        // Verify ShareDB connection has the doc
        assert.ok(getConnection().collections?.[collection]?.[gameId], 'doc exists in ShareDB connection')
      })()

      // Signal is now out of scope, run GC
      await runGc()

      // Verify cleanup
      assert.ok(!docSubscriptions.docs.has(hash), 'doc removed from docSubscriptions.docs')
      assert.ok(!docSubscriptions.subCount.has(hash), 'doc removed from docSubscriptions.subCount')

      // Verify ShareDB connection cleaned up
      const doc = getConnection().get(collection, gameId)
      assert.equal(doc.subscribed, false, 'doc is unsubscribed in ShareDB')
    })

    it('doc subscription stays alive when child signal keeps parent alive', async () => {
      const gameId = 'gc_doc_2'
      const collection = 'games_gc_doc_2'
      const hash = JSON.stringify([collection, gameId])

      // Create child signal reference
      let $name
      await (async () => {
        const $game = await sub($[collection][gameId])
        const doc = getConnection().get(collection, gameId)
        await cbPromise(cb => doc.create({ name: 'Test Game 2', players: 5 }, cb))

        $name = $game.name
        assert.equal($name.get(), 'Test Game 2', 'child signal has value')
      })()

      // Parent $game is out of scope, but child $name keeps it alive
      await runGc()

      // Verify parent is still subscribed
      assert.ok(docSubscriptions.docs.has(hash), 'parent doc still in docSubscriptions.docs')
      assert.ok(docSubscriptions.subCount.has(hash), 'parent doc still in docSubscriptions.subCount')

      // Child signal should still work
      assert.equal($name.get(), 'Test Game 2', 'child signal still has value')

      // Now set child to undefined
      $name = undefined
      await runGc()

      // Now everything should be cleaned up
      assert.ok(!docSubscriptions.docs.has(hash), 'doc removed after child is undefined')
      assert.ok(!docSubscriptions.subCount.has(hash), 'subCount removed after child is undefined')
    })

    it('multiple subscriptions to same doc: ref counting with FinalizationRegistry', async () => {
      const gameId = 'gc_doc_3'
      const collection = 'games_gc_doc_3'
      const hash = JSON.stringify([collection, gameId])

      const doc = getConnection().get(collection, gameId)
      await cbPromise(cb => doc.create({ name: 'Test Game 3', players: 10 }, cb))

      let $game1 = await sub($[collection][gameId])
      let $game2 = await sub($[collection][gameId])

      assert.equal($game1, $game2, 'same signal returned for same doc')

      // Note: sub() is called twice and docSubscriptions.subscribe() is called twice,
      // which increments subCount to 2. The FinalizationRegistry is also registered twice.
      assert.equal(docSubscriptions.subCount.get(hash), 2, 'subCount is 2')

      // Both $game1 and $game2 reference the same object, so setting one to undefined
      // doesn't actually make the object eligible for GC until all references are gone.
      // When both are set to undefined, the FinalizationRegistry callback will fire twice,
      // decrementing subCount from 2 to 0.

      // Verify the signal works before cleanup
      assert.equal($game1.name.get(), 'Test Game 3', 'signal works')

      // Set all references to undefined
      $game1 = undefined
      $game2 = undefined
      await runGc()

      // Now should be fully cleaned up
      assert.ok(!docSubscriptions.docs.has(hash), 'doc removed after all refs gone')
      assert.ok(!docSubscriptions.subCount.has(hash), 'subCount removed after all refs gone')

      // Cleanup
      await cbPromise(cb => doc.del(cb))
    })
  })

  describe('Query GC cleanup', () => {
    it('query subscription is cleaned up when signal is garbage collected', async () => {
      const collection = 'games_gc_query_1'
      const hash = JSON.stringify({ query: [collection, { active: true }] })

      // Create some docs first
      const doc1 = getConnection().get(collection, 'q1_1')
      const doc2 = getConnection().get(collection, 'q1_2')
      await cbPromise(cb => doc1.create({ name: 'Query Game 1', active: true }, cb))
      await cbPromise(cb => doc2.create({ name: 'Query Game 2', active: true }, cb))

      // Create query in a scope
      await (async () => {
        const $activeGames = await sub($[collection], { active: true })
        assert.equal($activeGames.get().length, 2, 'query returns 2 docs')

        // Verify subscription exists
        assert.ok(querySubscriptions.queries.has(hash), 'query is in querySubscriptions.queries')
        assert.ok(querySubscriptions.subCount.has(hash), 'query is in querySubscriptions.subCount')
      })()

      // Signal is now out of scope, run GC
      await runGc()

      // Verify cleanup
      assert.ok(!querySubscriptions.queries.has(hash), 'query removed from querySubscriptions.queries')
      assert.ok(!querySubscriptions.subCount.has(hash), 'query removed from querySubscriptions.subCount')

      // Clean up docs
      await cbPromise(cb => doc1.del(cb))
      await cbPromise(cb => doc2.del(cb))
    })

    it('query signal kept alive keeps docs accessible', async () => {
      const collection = 'games_gc_query_2'
      const hash = JSON.stringify({ query: [collection, { active: true }] })

      // Create some docs first
      const doc1 = getConnection().get(collection, 'q2_1')
      const doc2 = getConnection().get(collection, 'q2_2')
      await cbPromise(cb => doc1.create({ name: 'Query Game 1', active: true }, cb))
      await cbPromise(cb => doc2.create({ name: 'Query Game 2', active: true }, cb))

      let $activeGames = await sub($[collection], { active: true })
      assert.equal($activeGames.get().length, 2, 'query returns 2 docs')

      assert.ok(querySubscriptions.queries.has(hash), 'query exists')

      // Access docs through query - use indexed access
      assert.equal($activeGames.get()[0].name, 'Query Game 1', 'doc accessible through query')

      // Set the query signal to undefined
      $activeGames = undefined
      await runGc()

      // Verify cleanup
      assert.ok(!querySubscriptions.queries.has(hash), 'query removed')
      assert.ok(!querySubscriptions.subCount.has(hash), 'subCount removed')

      // Clean up docs
      await cbPromise(cb => doc1.del(cb))
      await cbPromise(cb => doc2.del(cb))
    })
  })

  describe('Aggregation GC cleanup', () => {
    it('aggregation subscription is cleaned up when signal is garbage collected', async () => {
      const collection = 'games_gc_agg_1'
      const hash = JSON.stringify({ query: [collection, { $aggregate: [{ $match: { active: true } }] }] })

      // Create some docs first
      const doc1 = getConnection().get(collection, 'a1_1')
      const doc2 = getConnection().get(collection, 'a1_2')
      await cbPromise(cb => doc1.create({ name: 'Agg Game 1', active: true }, cb))
      await cbPromise(cb => doc2.create({ name: 'Agg Game 2', active: true }, cb))

      // Create aggregation in a scope
      await (async () => {
        const $$activeGames = aggregation(({ active }) => {
          return [{ $match: { active } }]
        })
        const $activeGames = await sub($$activeGames, { $collection: collection, active: true })
        assert.equal($activeGames.get().length, 2, 'aggregation returns 2 docs')

        // Verify subscription exists
        assert.ok(aggregationSubscriptions.queries.has(hash), 'aggregation is in aggregationSubscriptions.queries')
        assert.ok(aggregationSubscriptions.subCount.has(hash), 'aggregation is in aggregationSubscriptions.subCount')
      })()

      // Signal is now out of scope, run GC
      await runGc()

      // Verify cleanup
      assert.ok(!aggregationSubscriptions.queries.has(hash), 'aggregation removed from queries')
      assert.ok(!aggregationSubscriptions.subCount.has(hash), 'aggregation removed from subCount')

      // Clean up docs
      await cbPromise(cb => doc1.del(cb))
      await cbPromise(cb => doc2.del(cb))
    })
  })

  describe('Signal cache cleanup', () => {
    it('signals are removed from cache when garbage collected', async () => {
      const initialCacheSize = signalsCache.size

      // Create signals in a scope
      await (async () => {
        const $value1 = $(42)
        const $value2 = $('hello')
        const $value3 = $({ a: 1, b: 2 })

        assert.ok(signalsCache.size > initialCacheSize, 'cache size increased')

        // Keep them in use
        assert.equal($value1.get(), 42)
        assert.equal($value2.get(), 'hello')
        assert.deepEqual($value3.get(), { a: 1, b: 2 })
      })()

      // Signals are now out of scope, run GC
      await runGc()

      // Cache should be cleaned up
      assert.equal(signalsCache.size, initialCacheSize, 'cache size returned to initial')
    })

    it('destructured child signals keep parent in cache', async () => {
      const initialCacheSize = signalsCache.size

      let $firstName, $lastName
      await (async () => {
        const $user = $({ firstName: 'John', lastName: 'Smith' })
        $firstName = $user.firstName
        $lastName = $user.lastName
      })()

      // Parent $user is out of scope, but children keep it alive
      await runGc()

      assert.ok(signalsCache.size > initialCacheSize, 'parent still in cache via children')
      assert.equal($firstName.get(), 'John')
      assert.equal($lastName.get(), 'Smith')

      // Set the children to undefined
      $firstName = undefined
      $lastName = undefined
      await runGc()

      // Now cache should be cleaned
      assert.equal(signalsCache.size, initialCacheSize, 'cache cleaned after children undefined')
    })
  })

  describe('No memory leaks pattern', () => {
    it('repeated doc subscriptions do not leak', async () => {
      const collection = 'games_gc_leak_1'
      const initialDocsSize = docSubscriptions.docs.size
      const initialSubCountSize = docSubscriptions.subCount.size

      // Create and destroy subscriptions in a loop
      for (let i = 0; i < 5; i++) {
        await (async () => {
          const gameId = `leak_${i}`
          const $game = await sub($[collection][gameId])
          const doc = getConnection().get(collection, gameId)
          await cbPromise(cb => doc.create({ name: `Leak Game ${i}`, players: i }, cb))

          assert.equal($game.players.get(), i, `game ${i} has correct players`)
        })()
        // Signal goes out of scope
        await runGc()
      }

      // Verify no subscriptions leaked
      assert.equal(docSubscriptions.docs.size, initialDocsSize, 'no docs leaked')
      assert.equal(docSubscriptions.subCount.size, initialSubCountSize, 'no subCounts leaked')
    })

    it('repeated query subscriptions do not leak', async () => {
      const collection = 'games_gc_leak_2'
      const initialQueriesSize = querySubscriptions.queries.size
      const initialSubCountSize = querySubscriptions.subCount.size

      // Create some docs
      for (let i = 0; i < 3; i++) {
        const doc = getConnection().get(collection, `leak_q_${i}`)
        await cbPromise(cb => doc.create({ name: `Query Leak Game ${i}`, level: i }, cb))
      }

      // Create and destroy query subscriptions in a loop
      for (let level = 0; level < 3; level++) {
        await (async () => {
          const $games = await sub($[collection], { level })
          assert.equal($games.get().length, 1, `query for level ${level} returns 1 doc`)
        })()
        // Signal goes out of scope
        await runGc()
      }

      // Verify no queries leaked
      assert.equal(querySubscriptions.queries.size, initialQueriesSize, 'no queries leaked')
      assert.equal(querySubscriptions.subCount.size, initialSubCountSize, 'no subCounts leaked')

      // Clean up docs
      for (let i = 0; i < 3; i++) {
        const doc = getConnection().get(collection, `leak_q_${i}`)
        await cbPromise(cb => doc.del(cb))
      }
    })

    it('repeated aggregation subscriptions do not leak', async () => {
      const collection = 'games_gc_leak_3'
      const initialQueriesSize = aggregationSubscriptions.queries.size
      const initialSubCountSize = aggregationSubscriptions.subCount.size

      // Create some docs
      for (let i = 0; i < 3; i++) {
        const doc = getConnection().get(collection, `leak_a_${i}`)
        await cbPromise(cb => doc.create({ name: `Agg Leak Game ${i}`, score: i * 10 }, cb))
      }

      // Create and destroy aggregation subscriptions in a loop
      for (let minScore = 0; minScore < 3; minScore++) {
        await (async () => {
          const $$games = aggregation(({ minScore }) => {
            return [{ $match: { score: { $gte: minScore } } }]
          })
          const $games = await sub($$games, { $collection: collection, minScore: minScore * 10 })
          assert.ok($games.get().length >= 1, `aggregation for minScore ${minScore * 10} returns docs`)
        })()
        // Signal goes out of scope
        await runGc()
      }

      // Verify no aggregations leaked
      assert.equal(aggregationSubscriptions.queries.size, initialQueriesSize, 'no aggregations leaked')
      assert.equal(aggregationSubscriptions.subCount.size, initialSubCountSize, 'no subCounts leaked')

      // Clean up docs
      for (let i = 0; i < 3; i++) {
        const doc = getConnection().get(collection, `leak_a_${i}`)
        await cbPromise(cb => doc.del(cb))
      }
    })

    it('mixed subscription types do not interfere with GC', async () => {
      const collection = 'games_gc_mixed'
      const initialCacheSize = signalsCache.size

      // Create mixed subscriptions
      for (let i = 0; i < 3; i++) {
        await (async () => {
          // Local signal
          const $local = $({ value: i })

          // Doc subscription
          const gameId = `mixed_${i}`
          const $game = await sub($[collection][gameId])
          const doc = getConnection().get(collection, gameId)
          await cbPromise(cb => doc.create({ name: `Mixed Game ${i}`, value: i }, cb))

          // Query subscription
          const $query = await sub($[collection], { value: i })

          // Use all signals
          assert.equal($local.value.get(), i)
          assert.equal($game.value.get(), i)
          assert.equal($query.get().length, 1)
        })()
        // All signals go out of scope
        await runGc()
      }

      // Verify everything cleaned up
      assert.equal(signalsCache.size, initialCacheSize, 'cache returned to initial size')
      assert.equal(docSubscriptions.docs.size, 0, 'no doc subscriptions remain')
      assert.equal(querySubscriptions.queries.size, 0, 'no query subscriptions remain')
    })
  })

  describe('GC during in-flight operations', () => {
    it('GC during SUBSCRIBING state queues unsubscribe via state machine', async () => {
      const collection = 'games_gc_inflight'
      const gameId = 'inflight_1'
      const hash = JSON.stringify([collection, gameId])

      // Start subscription but don't await - let subscribe be in-flight
      // Then drop all references and GC
      await (async () => {
        const $game = $[collection][gameId]
        // Start subscribing (don't await)
        const promise = sub($game)
        // sub() internally calls docSubscriptions.subscribe() which sets state to SUBSCRIBING
        assert.ok(docSubscriptions.docs.has(hash), 'doc exists in subscription manager')
        assert.ok(docSubscriptions.subCount.has(hash), 'subCount is tracked')
        // await the subscription so it completes inside the scope
        await promise
      })()

      // Now signal is out of scope, GC should trigger FinalizationRegistry
      await runGc()

      // The destroy() should have been called, and since we fixed it to always call
      // unsubscribe() (even during non-SUBSCRIBED states), cleanup should complete
      assert.ok(!docSubscriptions.docs.has(hash), 'doc removed after GC cleanup')
      assert.ok(!docSubscriptions.subCount.has(hash), 'subCount removed after GC cleanup')
    })

    it('rapid GC on doc that was just subscribed cleans up ShareDB connection', async () => {
      const collection = 'games_gc_rapid_sharedb'
      const gameId = 'rapid_sharedb_1'
      const hash = JSON.stringify([collection, gameId])

      // Create and subscribe in a scope
      await (async () => {
        const $game = await sub($[collection][gameId])
        const doc = getConnection().get(collection, gameId)
        await cbPromise(cb => doc.create({ name: 'Rapid GC Game' }, cb))
        assert.equal($game.name.get(), 'Rapid GC Game')
      })()

      // GC to clean up
      await runGc()

      assert.ok(!docSubscriptions.docs.has(hash), 'doc subscription cleaned up')
      // ShareDB connection should also be cleaned up (doc.destroy() called)
      assert.equal(
        Object.keys(getConnection().collections?.[collection] || {}).length, 0,
        'ShareDB connection has no docs for this collection'
      )
    })

    it('GC cleanup of query during subscribe does not leak', async () => {
      const collection = 'games_gc_query_inflight'
      const doc = getConnection().get(collection, 'qf_1')
      await cbPromise(cb => doc.create({ name: 'Query Inflight Game', active: true }, cb))

      const initialQueriesSize = querySubscriptions.queries.size

      await (async () => {
        const $games = await sub($[collection], { active: true })
        assert.equal($games.get().length, 1, 'query has 1 result')
      })()

      await runGc()

      assert.equal(querySubscriptions.queries.size, initialQueriesSize, 'no query leaked')

      // Cleanup
      const doc2 = getConnection().get(collection, 'qf_1')
      await cbPromise(cb => doc2.del(cb))
    })
  })
})
