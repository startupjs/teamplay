import { it, describe, before } from 'mocha'
import { strict as assert } from 'node:assert'
import { afterEachTestGc, runGc } from './_helpers.js'
import { $, sub } from '../index.js'
import { getConnection } from '../orm/connection.js'
import { querySubscriptions } from '../orm/Query.js'
import { docSubscriptions } from '../orm/Doc.js'
import connect from '../connect/test.js'

before(connect)

function cbPromise (fn) {
  return new Promise((resolve, reject) => {
    fn((err, result) => err ? reject(err) : resolve(result))
  })
}

describe('Query event handling', () => {
  afterEachTestGc()

  describe('Insert event', () => {
    it('new document matching query appears in results', async () => {
      const collectionName = 'queryEvtGames'

      // Subscribe to query for active games
      const $activeGames = await sub($[collectionName], { active: true })

      // Initially no results
      assert.equal($activeGames.get().length, 0, 'query initially has no results')
      assert.deepEqual($activeGames.getIds(), [], 'getIds() initially empty')

      // Create a document that matches the query
      const doc = getConnection().get(collectionName, 'game1')
      await cbPromise(cb => doc.create({ name: 'Game 1', active: true }, cb))

      // Verify the document appears in query results
      assert.equal($activeGames.get().length, 1, 'query now has one result')
      assert.deepEqual($activeGames.getIds(), ['game1'], 'getIds() shows new doc')
      assert.equal($activeGames.game1.name.get(), 'Game 1', 'can access doc via query')
      assert.equal($activeGames.game1.active.get(), true, 'doc data is correct')

      // Create another matching document
      const doc2 = getConnection().get(collectionName, 'game2')
      await cbPromise(cb => doc2.create({ name: 'Game 2', active: true }, cb))

      // Verify both documents are in results
      assert.equal($activeGames.get().length, 2, 'query now has two results')
      assert.deepEqual($activeGames.getIds(), ['game1', 'game2'], 'getIds() shows both docs')

      // Cleanup
      await cbPromise(cb => doc.del(cb))
      await cbPromise(cb => doc2.del(cb))
    })

    it('document not matching query does not appear', async () => {
      const collectionName = 'queryEvtGames2'

      const $activeGames = await sub($[collectionName], { active: true })

      assert.equal($activeGames.get().length, 0)

      // Create a document that does NOT match
      const doc = getConnection().get(collectionName, 'game1')
      await cbPromise(cb => doc.create({ name: 'Game 1', active: false }, cb))

      // Should still have no results
      assert.equal($activeGames.get().length, 0, 'query still has no results')
      assert.deepEqual($activeGames.getIds(), [], 'getIds() still empty')

      // Cleanup
      await cbPromise(cb => doc.del(cb))
    })
  })

  describe('Remove event', () => {
    it('document no longer matching query is removed from results', async () => {
      const collectionName = 'queryEvtGames3'

      // Create two documents that match
      const doc1 = getConnection().get(collectionName, 'game1')
      const doc2 = getConnection().get(collectionName, 'game2')
      await cbPromise(cb => doc1.create({ name: 'Game 1', active: true }, cb))
      await cbPromise(cb => doc2.create({ name: 'Game 2', active: true }, cb))

      // Subscribe to query
      const $activeGames = await sub($[collectionName], { active: true })

      assert.equal($activeGames.get().length, 2, 'initially two results')
      assert.deepEqual($activeGames.getIds(), ['game1', 'game2'])

      // Modify doc1 so it no longer matches
      await cbPromise(cb => doc1.submitOp([{ p: ['active'], oi: false, od: true }], cb))

      // Verify it's removed from query results
      assert.equal($activeGames.get().length, 1, 'now only one result')
      assert.deepEqual($activeGames.getIds(), ['game2'], 'only game2 remains')
      assert.equal($activeGames.game2.name.get(), 'Game 2')

      // Cleanup
      await cbPromise(cb => doc1.del(cb))
      await cbPromise(cb => doc2.del(cb))
    })
  })

  describe('Delete event', () => {
    it('deleted document is removed from query results', async () => {
      const collectionName = 'queryEvtGames4'

      // Create two documents
      const doc1 = getConnection().get(collectionName, 'game1')
      const doc2 = getConnection().get(collectionName, 'game2')
      await cbPromise(cb => doc1.create({ name: 'Game 1', active: true }, cb))
      await cbPromise(cb => doc2.create({ name: 'Game 2', active: true }, cb))

      // Subscribe to query
      const $activeGames = await sub($[collectionName], { active: true })

      assert.equal($activeGames.get().length, 2)
      assert.deepEqual($activeGames.getIds(), ['game1', 'game2'])

      // Delete doc1
      await cbPromise(cb => doc1.del(cb))

      // Verify it's removed from query results
      assert.equal($activeGames.get().length, 1, 'now only one result')
      assert.deepEqual($activeGames.getIds(), ['game2'], 'only game2 remains')

      // Delete doc2
      await cbPromise(cb => doc2.del(cb))

      // Verify query is now empty
      assert.equal($activeGames.get().length, 0, 'query is empty')
      assert.deepEqual($activeGames.getIds(), [], 'getIds() is empty')
    })
  })

  describe('Move event', () => {
    it('modifying sort field reorders query results', async () => {
      const collectionName = 'queryEvtGames5'

      // Create three documents with different scores
      const doc1 = getConnection().get(collectionName, 'game1')
      const doc2 = getConnection().get(collectionName, 'game2')
      const doc3 = getConnection().get(collectionName, 'game3')
      await cbPromise(cb => doc1.create({ name: 'Game 1', score: 10 }, cb))
      await cbPromise(cb => doc2.create({ name: 'Game 2', score: 20 }, cb))
      await cbPromise(cb => doc3.create({ name: 'Game 3', score: 30 }, cb))

      // Subscribe to query with sort by score ascending
      const $games = await sub($[collectionName], { $sort: { score: 1 } })

      // Verify initial order
      assert.equal($games.get().length, 3)
      const initialIds = $games.getIds()
      assert.deepEqual(initialIds, ['game1', 'game2', 'game3'], 'initially sorted by score asc')
      assert.equal($games.game1.score.get(), 10)
      assert.equal($games.game2.score.get(), 20)
      assert.equal($games.game3.score.get(), 30)

      // Change game1's score to be highest
      await cbPromise(cb => doc1.submitOp([{ p: ['score'], oi: 40, od: 10 }], cb))

      // Verify order changed
      const newIds = $games.getIds()
      assert.deepEqual(newIds, ['game2', 'game3', 'game1'], 'game1 moved to end')
      assert.equal($games.game1.score.get(), 40, 'game1 score updated')

      // Verify the actual results array is ordered correctly
      const results = $games.get()
      assert.equal(results[0].score, 20, 'first result has score 20')
      assert.equal(results[1].score, 30, 'second result has score 30')
      assert.equal(results[2].score, 40, 'third result has score 40')

      // Cleanup
      await cbPromise(cb => doc1.del(cb))
      await cbPromise(cb => doc2.del(cb))
      await cbPromise(cb => doc3.del(cb))
    })

    it('handles sort descending', async () => {
      const collectionName = 'queryEvtGames6'

      const doc1 = getConnection().get(collectionName, 'game1')
      const doc2 = getConnection().get(collectionName, 'game2')
      await cbPromise(cb => doc1.create({ name: 'Game 1', score: 10 }, cb))
      await cbPromise(cb => doc2.create({ name: 'Game 2', score: 20 }, cb))

      // Subscribe with descending sort
      const $games = await sub($[collectionName], { $sort: { score: -1 } })

      assert.deepEqual($games.getIds(), ['game2', 'game1'], 'sorted descending initially')

      // Change game1 to have higher score
      await cbPromise(cb => doc1.submitOp([{ p: ['score'], oi: 30, od: 10 }], cb))

      assert.deepEqual($games.getIds(), ['game1', 'game2'], 'game1 moved to front')

      // Cleanup
      await cbPromise(cb => doc1.del(cb))
      await cbPromise(cb => doc2.del(cb))
    })
  })

  describe('Query with no initial results', () => {
    it('initially empty query gets populated when matching docs are created', async () => {
      const collectionName = 'queryEvtGames7'

      // Subscribe to query that matches nothing initially
      const $premiumGames = await sub($[collectionName], { premium: true })

      assert.equal($premiumGames.get().length, 0, 'initially empty')
      assert.deepEqual($premiumGames.getIds(), [])

      // Create a non-matching document
      const doc1 = getConnection().get(collectionName, 'game1')
      await cbPromise(cb => doc1.create({ name: 'Game 1', premium: false }, cb))

      assert.equal($premiumGames.get().length, 0, 'still empty after non-matching doc')

      // Create a matching document
      const doc2 = getConnection().get(collectionName, 'game2')
      await cbPromise(cb => doc2.create({ name: 'Game 2', premium: true }, cb))

      assert.equal($premiumGames.get().length, 1, 'now has one result')
      assert.deepEqual($premiumGames.getIds(), ['game2'])
      assert.equal($premiumGames.game2.name.get(), 'Game 2')

      // Create another matching document
      const doc3 = getConnection().get(collectionName, 'game3')
      await cbPromise(cb => doc3.create({ name: 'Game 3', premium: true }, cb))

      assert.equal($premiumGames.get().length, 2, 'now has two results')
      assert.deepEqual($premiumGames.getIds(), ['game2', 'game3'])

      // Cleanup
      await cbPromise(cb => doc1.del(cb))
      await cbPromise(cb => doc2.del(cb))
      await cbPromise(cb => doc3.del(cb))
    })
  })

  describe('Query lifecycle and GC cleanup', () => {
    it('query subscription is cleaned up after GC when no references remain', async () => {
      const collectionName = 'queryEvtGames8'

      // Create a document
      const doc = getConnection().get(collectionName, 'game1')
      await cbPromise(cb => doc.create({ name: 'Game 1', active: true }, cb))

      // Check initial state
      const initialQueryCount = querySubscriptions.queries.size
      const initialSubCount = querySubscriptions.subCount.size

      // Subscribe in a block scope
      await (async () => {
        const $activeGames = await sub($[collectionName], { active: true })
        assert.equal($activeGames.get().length, 1, 'query has results')

        // Verify subscription was created
        assert.equal(querySubscriptions.queries.size, initialQueryCount + 1, 'query created')
        assert.equal(querySubscriptions.subCount.size, initialSubCount + 1, 'sub count incremented')
      })()

      // Query signal is now out of scope, run GC
      await runGc()

      // Verify cleanup happened
      assert.equal(querySubscriptions.queries.size, initialQueryCount, 'query removed after GC')
      assert.equal(querySubscriptions.subCount.size, initialSubCount, 'sub count cleaned up')

      // Cleanup
      await cbPromise(cb => doc.del(cb))
    })

    it('query with multiple references stays alive until all are gone', async () => {
      const collectionName = 'queryEvtGames9'

      const doc = getConnection().get(collectionName, 'game1')
      await cbPromise(cb => doc.create({ name: 'Game 1', active: true }, cb))

      const initialQueryCount = querySubscriptions.queries.size

      // Create first reference
      const $activeGames1 = await sub($[collectionName], { active: true })
      assert.equal($activeGames1.get().length, 1)

      const afterFirstSub = querySubscriptions.queries.size
      assert.equal(afterFirstSub, initialQueryCount + 1, 'query created')

      // Create second reference to same query
      const $activeGames2 = await sub($[collectionName], { active: true })

      // Should reuse the same query
      assert.equal(querySubscriptions.queries.size, afterFirstSub, 'query reused, not duplicated')

      // Both references should point to same results
      assert.equal($activeGames1, $activeGames2, 'same signal returned')

      // Run GC - query should still exist because we have references
      await runGc()
      assert.equal(querySubscriptions.queries.size, afterFirstSub, 'query still exists')

      // Cleanup
      await cbPromise(cb => doc.del(cb))
    })

    it('doc signals created by query are tracked in docSubscriptions', async () => {
      const collectionName = 'queryEvtGames10'

      // Create documents
      const doc1 = getConnection().get(collectionName, 'game1')
      const doc2 = getConnection().get(collectionName, 'game2')
      await cbPromise(cb => doc1.create({ name: 'Game 1', active: true }, cb))
      await cbPromise(cb => doc2.create({ name: 'Game 2', active: true }, cb))

      const initialDocCount = docSubscriptions.docs.size

      // Subscribe to query
      const $activeGames = await sub($[collectionName], { active: true })

      assert.equal($activeGames.get().length, 2)

      // Verify doc signals were initialized (but not subscribed, just tracked)
      // The query creates doc signals via docSubscriptions.init()
      const afterQueryDocCount = docSubscriptions.docs.size
      assert.equal(afterQueryDocCount, initialDocCount + 2, 'two doc signals initialized')

      // Access the docs through the query
      assert.equal($activeGames.game1.name.get(), 'Game 1')
      assert.equal($activeGames.game2.name.get(), 'Game 2')

      // Cleanup
      await cbPromise(cb => doc1.del(cb))
      await cbPromise(cb => doc2.del(cb))
    })

    it('query stays alive when accessing destructured doc signals', async () => {
      const collectionName = 'queryEvtGames11'

      const doc = getConnection().get(collectionName, 'game1')
      await cbPromise(cb => doc.create({ name: 'Game 1', active: true, score: 100 }, cb))

      const initialQueryCount = querySubscriptions.queries.size

      // Subscribe and destructure
      const $activeGames = await sub($[collectionName], { active: true })
      const { $name, $score } = $activeGames.game1

      assert.equal($name.get(), 'Game 1')
      assert.equal($score.get(), 100)

      // Verify query exists
      assert.equal(querySubscriptions.queries.size, initialQueryCount + 1)

      // Run GC - query should still exist because $activeGames is in scope
      await runGc()
      assert.equal(querySubscriptions.queries.size, initialQueryCount + 1, 'query still exists')

      // Update the doc via ShareDB
      await cbPromise(cb => doc.submitOp([{ p: ['score'], oi: 200, od: 100 }], cb))

      // Destructured signal should still get updates
      assert.equal($score.get(), 200, 'destructured signal gets updates')

      // Cleanup
      await cbPromise(cb => doc.del(cb))
    })

    it('removing all query references triggers cleanup', async () => {
      const collectionName = 'queryEvtGames12'

      const doc = getConnection().get(collectionName, 'game1')
      await cbPromise(cb => doc.create({ name: 'Game 1', active: true }, cb))

      const initialQueryCount = querySubscriptions.queries.size
      const initialDocCount = docSubscriptions.docs.size

      await (async () => {
        // Create query in async scope
        const $activeGames = await sub($[collectionName], { active: true })
        assert.equal($activeGames.get().length, 1)

        // Verify resources allocated
        assert.equal(querySubscriptions.queries.size, initialQueryCount + 1)
        assert.equal(docSubscriptions.docs.size, initialDocCount + 1)

        // Access the doc
        assert.equal($activeGames.game1.name.get(), 'Game 1')
      })()
      // Query signal out of scope

      await runGc()

      // Everything should be cleaned up
      assert.equal(querySubscriptions.queries.size, initialQueryCount, 'query cleaned up')
      // Note: doc signals might still be tracked since they're initialized but not necessarily GC'd

      // Cleanup
      await cbPromise(cb => doc.del(cb))
    })
  })

  describe('Complex query scenarios', () => {
    it('handles multiple queries on same collection', async () => {
      const collectionName = 'queryEvtGames13'

      // Create various documents
      const doc1 = getConnection().get(collectionName, 'game1')
      const doc2 = getConnection().get(collectionName, 'game2')
      const doc3 = getConnection().get(collectionName, 'game3')
      await cbPromise(cb => doc1.create({ name: 'Game 1', active: true, premium: true }, cb))
      await cbPromise(cb => doc2.create({ name: 'Game 2', active: true, premium: false }, cb))
      await cbPromise(cb => doc3.create({ name: 'Game 3', active: false, premium: true }, cb))

      // Subscribe to different queries
      const $activeGames = await sub($[collectionName], { active: true })
      const $premiumGames = await sub($[collectionName], { premium: true })

      assert.equal($activeGames.get().length, 2, 'active games query')
      assert.equal($premiumGames.get().length, 2, 'premium games query')

      assert.deepEqual($activeGames.getIds().sort(), ['game1', 'game2'])
      assert.deepEqual($premiumGames.getIds().sort(), ['game1', 'game3'])

      // Create a new doc matching both
      const doc4 = getConnection().get(collectionName, 'game4')
      await cbPromise(cb => doc4.create({ name: 'Game 4', active: true, premium: true }, cb))

      // Both queries should update
      assert.equal($activeGames.get().length, 3)
      assert.equal($premiumGames.get().length, 3)

      assert.deepEqual($activeGames.getIds().sort(), ['game1', 'game2', 'game4'])
      assert.deepEqual($premiumGames.getIds().sort(), ['game1', 'game3', 'game4'])

      // Cleanup
      await cbPromise(cb => doc1.del(cb))
      await cbPromise(cb => doc2.del(cb))
      await cbPromise(cb => doc3.del(cb))
      await cbPromise(cb => doc4.del(cb))
    })

    it('handles query with multiple field conditions', async () => {
      const collectionName = 'queryEvtGames14'

      // Create documents
      const doc1 = getConnection().get(collectionName, 'game1')
      const doc2 = getConnection().get(collectionName, 'game2')
      const doc3 = getConnection().get(collectionName, 'game3')
      await cbPromise(cb => doc1.create({ name: 'Game 1', active: true, score: 100 }, cb))
      await cbPromise(cb => doc2.create({ name: 'Game 2', active: true, score: 50 }, cb))
      await cbPromise(cb => doc3.create({ name: 'Game 3', active: false, score: 100 }, cb))

      // Query with multiple conditions
      const $highScoreActiveGames = await sub($[collectionName], { active: true, score: { $gte: 100 } })

      assert.equal($highScoreActiveGames.get().length, 1)
      assert.deepEqual($highScoreActiveGames.getIds(), ['game1'])

      // Update doc2 to match
      await cbPromise(cb => doc2.submitOp([{ p: ['score'], oi: 150, od: 50 }], cb))

      assert.equal($highScoreActiveGames.get().length, 2)
      assert.deepEqual($highScoreActiveGames.getIds().sort(), ['game1', 'game2'])

      // Update doc1 to not match (change active to false)
      await cbPromise(cb => doc1.submitOp([{ p: ['active'], oi: false, od: true }], cb))

      assert.equal($highScoreActiveGames.get().length, 1)
      assert.deepEqual($highScoreActiveGames.getIds(), ['game2'])

      // Cleanup
      await cbPromise(cb => doc1.del(cb))
      await cbPromise(cb => doc2.del(cb))
      await cbPromise(cb => doc3.del(cb))
    })
  })
})
