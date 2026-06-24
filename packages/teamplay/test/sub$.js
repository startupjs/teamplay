import { it, describe, afterEach, before } from 'mocha'
import { strict as assert } from 'node:assert'
import { afterEachTestGc, runGc } from './_helpers.js'
import { $, sub, unsub, aggregation } from '../src/index.ts'
import { get as _get, del as _del } from '../src/orm/dataTree.js'
import { getConnection } from '../src/orm/connection.ts'
import { hashQuery, querySubscriptions } from '../src/orm/Query.js'
import { aggregationSubscriptions } from '../src/orm/Aggregation.js'
import { getPrivateData } from '../src/orm/privateData.js'
import { getRoot, getRootSignal, ROOT_ID } from '../src/orm/Root.ts'
import { getSubscriptionGcDelay, setSubscriptionGcDelay } from '../src/orm/subscriptionGcDelay.ts'
import connect from '../src/connect/test.js'

before(connect)

function cbPromise (fn) {
  return new Promise((resolve, reject) => {
    fn((err, result) => err ? reject(err) : resolve(result))
  })
}

function afterEachTestGcShareDb () {
  afterEach(() => {
    assert.deepEqual(_get(['games']) || {}, {}, 'games collection is empty in signal\'s data tree')
    assert.equal(Object.keys(getConnection().collections?.games || {}).length, 0, 'no games in ShareDB\'s connection')
  })
}

describe('$sub() function', () => {
  afterEachTestGc()
  afterEachTestGcShareDb()

  it('signal for doc, subscribes to it, gets updates from direct sharedb data changes on client', async () => {
    const gameId = '_1'
    assert.equal(Object.keys(getConnection().collections?.games || {}).length, 0, 'no games initially in connection')
    const $game = await sub($.games[gameId])
    assert.equal(Object.keys(getConnection().collections?.games || {}).length, 1, 'one game is in connection')
    const doc = getConnection().get('games', gameId)
    await cbPromise(cb => doc.create({ name: 'Game 1', players: 0 }, cb))
    assert.equal(doc.data.name, 'Game 1', 'share doc has name')
    assert.equal(doc.data.players, 0, 'share doc has 0 players')
    assert.equal($game.name.get(), 'Game 1', 'signal has name')
    assert.equal($game.players.get(), 0, 'signal has 0 players')
    assert.deepEqual(
      _get(['games']), { _1: { _id: '_1', name: 'Game 1', players: 0 } },
      'signal data tree has one game in the games collection'
    )
    const promise = cbPromise(cb => doc.submitOp([{ p: ['players'], na: 1 }], cb))
    assert.equal($game.players.get(), 1, 'signal has 1 player. Updated synchronously')
    await promise
    assert.equal($game.players.get(), 1, 'signal still has 1 player. (after submitOp finished on the server)')
    assert.deepEqual($game.get(), { _id: '_1', name: 'Game 1', players: 1 }, 'signal has all data')
    await cbPromise(cb => doc.del(cb))
    assert.equal($game.get(), undefined, 'signal has undefined data after doc is deleted')
  })

  it('destructured signals from doc keep the doc signal referenced to prevent it from being GC\'ed', async () => {
    const gameId = '_2'
    const { $name, $players } = await sub($.games[gameId])
    assert.equal($name.get(), undefined, 'name is undefined')
    await runGc()
    const doc = getConnection().get('games', gameId)
    await cbPromise(cb => doc.create({ name: 'Game 2', players: 0 }, cb))
    await runGc()
    assert.equal($name.get(), 'Game 2', 'name is Game 2')
    assert.equal($players.get(), 0, 'players is 0')
    await cbPromise(cb => doc.submitOp([{ p: ['players'], na: 1 }], cb))
    assert.equal($players.get(), 1, 'players is 1')
    await runGc()
    assert.equal($players.get(), 1, 'players is still 1')
    await cbPromise(cb => doc.del(cb))
    assert.equal($name.get(), undefined, 'name is undefined')
    assert.equal($players.get(), undefined, 'players is undefined')
  })

  it('handles multiple sub() calls for the same doc', async () => {
    const gameId3 = '_3'
    const gameId4 = '_4'
    const $game3 = await sub($.games[gameId3])
    const $game4 = await sub($.games[gameId4])
    const doc3 = getConnection().get('games', gameId3)
    const doc4 = getConnection().get('games', gameId4)
    await cbPromise(cb => doc3.create({ name: 'Game 3', players: 0 }, cb))
    await cbPromise(cb => doc4.create({ name: 'Game 4', players: 0 }, cb))
    assert.equal($game3.name.get(), 'Game 3', 'name is Game 3')
    assert.equal($game4.name.get(), 'Game 4', 'name is Game 4')
    const $game3Duplicate = await sub($.games[gameId3])
    assert.equal($game3Duplicate.name.get(), 'Game 3', 'duplicate signal\'s name is Game 3')
    assert.equal($game3, $game3Duplicate, 'duplicate signal is the same as the original')
    await cbPromise(cb => doc3.del(cb))
    await cbPromise(cb => doc4.del(cb))
  })

  it('supports Promise.all for parallel subscriptions', async () => {
    const gameId1 = '_promise_all_1'
    const gameId2 = '_promise_all_2'
    const doc1 = getConnection().get('games', gameId1)
    const doc2 = getConnection().get('games', gameId2)
    await cbPromise(cb => doc1.create({ name: 'Parallel 1', active: true }, cb))
    await cbPromise(cb => doc2.create({ name: 'Parallel 2', active: true }, cb))

    const [$game1, $game2, $activeGames] = await Promise.all([
      sub($.games[gameId1]),
      sub($.games[gameId2]),
      sub($.games, { active: true })
    ])

    assert.equal($game1.name.get(), 'Parallel 1')
    assert.equal($game2.name.get(), 'Parallel 2')
    assert.deepEqual($activeGames.getIds().filter(id => id === gameId1 || id === gameId2).sort(), [gameId1, gameId2])

    await cbPromise(cb => doc1.del(cb))
    await cbPromise(cb => doc2.del(cb))
    await unsub($activeGames)
    await unsub($game1)
    await unsub($game2)
  })

  it.skip('doc: deep data also observable after .get()', async () => {
    const gameId = '_20'
    const $game = await sub($.games[gameId])
    const game = $game.get()
    assert.equal(game.id, gameId)
    // TODO: When returning data from .get(), it should be wrapped into Proxy too
  })
})

describe('$sub() function. Modifying documents', () => {
  afterEachTestGc()
  afterEachTestGcShareDb()

  it('.set() to create document and modify it', async () => {
    const gameId = '_5'
    const doc = getConnection().get('games', gameId)
    assert.equal(doc.data, undefined, 'doc is initially undefined in sharedb')
    assert.deepEqual($.games.get() || {}, {}, 'games collection is empty')
    const $game = await sub($.games[gameId])
    assert.ok(doc.data, 'subscription materializes an empty missing-doc placeholder in sharedb')
    assert.deepEqual(doc.data, {}, 'missing-doc placeholder is empty')
    assert.equal($game.get(), undefined, 'signal is undefined')
    assert.deepEqual($.games.get() || {}, {}, 'games collection is still empty')
    await $game.set({ name: 'Game 5', players: 0 })
    assert.equal($game.name.get(), 'Game 5')
    assert.equal(doc.data.name, 'Game 5')
    assert.deepEqual($game.get(), { _id: '_5', name: 'Game 5', players: 0 })
    assert.deepEqual(doc.data, { _id: '_5', name: 'Game 5', players: 0 })
    assert.deepEqual($.games.get(), { _5: { _id: '_5', name: 'Game 5', players: 0 } })
    await $game.name.set('Game 5 Magic')
    assert.equal($game.name.get(), 'Game 5 Magic')
    assert.equal(doc.data.name, 'Game 5 Magic')
    assert.deepEqual($game.get(), { _id: '_5', name: 'Game 5 Magic', players: 0 })
    assert.deepEqual(doc.data, { _id: '_5', name: 'Game 5 Magic', players: 0 })
  })

  it('.set() to deep modify document', async () => {
    const gameId = '_6'
    const doc = getConnection().get('games', gameId)
    const $game = await sub($.games[gameId])
    await $game.set({ name: 'Game 6 Alt', players: 0 })
    assert.deepEqual($game.get(), { _id: '_6', name: 'Game 6 Alt', players: 0 })
    assert.deepEqual(doc.data, { _id: '_6', name: 'Game 6 Alt', players: 0 })
    assert.deepEqual($.games.get(), { _6: { _id: '_6', name: 'Game 6 Alt', players: 0 } })
    await $game.set({ title: 'My Game', players: 5 })
    assert.deepEqual($game.get(), { _id: '_6', title: 'My Game', players: 5 })
    assert.deepEqual(doc.data, { _id: '_6', title: 'My Game', players: 5 })
    assert.deepEqual($.games.get(), { _6: { _id: '_6', title: 'My Game', players: 5 } })
  })

  it('.del() to delete document', async () => {
    const gameId = '_7'
    const doc = getConnection().get('games', gameId)
    const $game = await sub($.games[gameId])
    await $game.set({ name: 'Game 7', players: 0 })
    assert.deepEqual($game.get(), { _id: '_7', name: 'Game 7', players: 0 })
    assert.deepEqual(doc.data, { _id: '_7', name: 'Game 7', players: 0 })
    await $game.del()
    assert.equal($game.get(), undefined)
    assert.ok(doc.data, 'subscribed deleted docs must restore the empty missing-doc placeholder')
    assert.deepEqual(doc.data, {})
  })

  it('.del() on non-existing public document is a no-op', async () => {
    const gameId = '_7_missing'
    const $game = await sub($.games[gameId])
    assert.equal($game.get(), undefined)

    await $game.del()
    await $game.name.del()
    assert.equal($game.get(), undefined)
  })

  it('.set(undefined) on document should delete it', async () => {
    const gameId = '_8'
    const doc = getConnection().get('games', gameId)
    const $game = await sub($.games[gameId])
    await $game.set({ name: 'Game 8', players: 0 })
    assert.deepEqual($game.get(), { _id: '_8', name: 'Game 8', players: 0 })
    assert.deepEqual(doc.data, { _id: '_8', name: 'Game 8', players: 0 })
    await $game.set(undefined)
    assert.equal($game.get(), undefined)
    assert.ok(doc.data, 'subscribed deleted docs must restore the empty missing-doc placeholder')
    assert.deepEqual(doc.data, {})
  })

  it('.del() on subpath should delete the subpath', async () => {
    const gameId = '_9'
    const doc = getConnection().get('games', gameId)
    const $game = await sub($.games[gameId])
    await $game.set({ name: 'Game 9', players: 0 })
    assert.deepEqual($game.get(), { _id: '_9', name: 'Game 9', players: 0 })
    assert.deepEqual(doc.data, { _id: '_9', name: 'Game 9', players: 0 })
    await $game.name.del()
    assert.deepEqual($game.get(), { _id: '_9', players: 0 })
    assert.deepEqual(doc.data, { _id: '_9', players: 0 })
  })

  it('.set() on subpath on non-existing document should throw an error', async () => {
    const gameId = '_10'
    const $game = await sub($.games[gameId])
    await assert.rejects(async () => {
      await $game.name.set('Game 10')
    }, { message: /Can't set a value to a subpath of a document which doesn't exist/ })
  })

  it('allows immediate subpath set after add() without subscribe', async () => {
    const gameId = '_add_then_subpath_set'
    await $.games.add({ _id: gameId, name: 'Added' })
    const $game = $.games[gameId]

    await $game.players.set(1)

    assert.deepEqual($game.get(), { _id: gameId, name: 'Added', players: 1 })
    const doc = getConnection().get('games', gameId)
    assert.equal(doc.data.players, 1)

    // Cleanup through normal subscribed path so ShareDB/test GC hooks
    // can release doc references the same way as other tests.
    await sub($game)
    await $game.del()
  })

  it('rejects delayed subpath set after add() without subscribe when doc snapshot is dropped', async () => {
    const gameId = '_add_delayed_subpath_set_after_snapshot_drop'
    await $.games.add({ _id: gameId, name: 'Added' })
    const $game = $.games[gameId]

    await new Promise(resolve => setTimeout(resolve, 10))
    const connection = getConnection()
    delete connection.collections.games[gameId]
    _del(['games', gameId])

    await assert.rejects(async () => {
      await $game.players.set(2)
    }, { message: /Can't set a value to a subpath of a document which doesn't exist/ })
    delete connection.collections.games[gameId]
  })

  it('rejects delayed subpath set after add() without subscribe', async () => {
    const gameId = '_add_delayed_subpath_set'
    await $.games.add({ _id: gameId, name: 'Added' })
    await new Promise(resolve => setTimeout(resolve, 10))
    const $game = $.games[gameId]
    const connection = getConnection()
    delete connection.collections.games[gameId]
    _del(['games', gameId])

    await assert.rejects(async () => {
      await $game.players.set(3)
    }, { message: /Can't set a value to a subpath of a document which doesn't exist/ })
    delete connection.collections.games[gameId]
  })

  it('repopulates data tree when doc exists but raw data is missing', async () => {
    const gameId = '_partial_1'
    const $game = await sub($.games[gameId])
    await $game.set({ providers: {} })
    assert.ok(getConnection().get('games', gameId).data, 'doc data exists')
    _del(['games', gameId])
    assert.equal(_get(['games', gameId]), undefined)

    await $game.providers.google.set({ token: 'x' })
    const rawDoc = _get(['games', gameId])
    assert.deepEqual(rawDoc.providers.google, { token: 'x' })
  })

  it('supports array mutators and increment on public docs', async () => {
    const gameId = '_base_1'
    const $game = await sub($.games[gameId])
    await $game.set({ count: 0, list: [1, 2, 3] })

    const inc = await $game.count.increment(2)
    assert.equal(inc, 2)
    assert.equal($game.count.get(), 2)

    const len1 = await $game.list.push(4)
    assert.equal(len1, 4)
    const len2 = await $game.list.unshift(0)
    assert.equal(len2, 5)
    const len3 = await $game.list.insert(2, ['a', 'b'])
    assert.equal(len3, 7)
    const popped = await $game.list.pop()
    assert.equal(popped, 4)
    const shifted = await $game.list.shift()
    assert.equal(shifted, 0)
    const removed = await $game.list.remove(1, 2)
    assert.deepEqual(removed, ['a', 'b'])
    const moved = await $game.list.move(1, 0)
    assert.deepEqual(moved, [2])
    assert.deepEqual($game.list.get(), [2, 1, 3])

    await $game.del()
  })

  it('treats missing public numeric paths as zero on increment', async () => {
    const gameId = '_increment_missing_public_field'
    const $game = await sub($.games[gameId])
    await $game.set({ title: 'Game' })

    const direct = await $game.count.increment(1)
    assert.equal(direct, 1)
    assert.equal($game.count.get(), 1)

    const nested = await $game.stats.entriesNum.increment(2)
    assert.equal(nested, 2)
    assert.equal($game.stats.entriesNum.get(), 2)
    assert.deepEqual($game.stats.get(), { entriesNum: 2 })

    await $game.del()
  })

  it('materializes missing public array path on push', async () => {
    const gameId = '_base_missing_list_1'
    const $game = await sub($.games[gameId])
    await $game.set({ count: 0 })

    const len = await $game.list.push(1)
    assert.equal(len, 1)
    assert.deepEqual($game.list.get(), [1])

    await $game.del()
  })

  it('keeps missing-path semantics for public string/array mutators', async () => {
    const gameId = '_public_missing_string_array_semantics'
    const $game = await sub($.games[gameId])
    await $game.set({ title: 'Game' })

    const prevString = await $game.text.stringInsert(0, 'abc')
    assert.equal(prevString, undefined)
    assert.equal($game.text.get(), 'abc')

    const removedMissingString = await $game.missingText.stringRemove(0, 1)
    assert.equal(removedMissingString, undefined)

    const popMissingArray = await $game.missingList.pop()
    assert.equal(popMissingArray, undefined)
    const shiftMissingArray = await $game.missingList.shift()
    assert.equal(shiftMissingArray, undefined)

    await $game.del()
  })

  it('supports stringInsert/stringRemove on public docs', async () => {
    const gameId = '_base_2'
    const $game = await sub($.games[gameId])
    await $game.set({ text: 'abc' })

    const prev1 = await $game.text.stringInsert(0, 'X')
    assert.equal(prev1, 'abc')
    assert.equal($game.text.get(), 'Xabc')
    const prev2 = await $game.text.stringRemove(1, 2)
    assert.equal(prev2, 'Xabc')
    assert.equal($game.text.get(), 'Xc')

    await $game.del()
  })
})

describe('$sub() function. Queries', () => {
  // TODO: test garbage collecting sharedb queries, sharedb docs, query signals
  let $game1, $game2, $game3

  before(async () => {
    $game1 = $.games._1
    $game2 = $.games._2
    $game3 = $.games._3
    await $game1.set({ name: 'Game 1', active: true })
    await $game2.set({ name: 'Game 2', active: true })
    await $game3.set({ name: 'Game 3', active: false })
  })

  afterEachTestGc()

  it('subscribe to query, modify it', async () => {
    const $activeGames = await sub($.games, { active: true })
    const rootId = getRoot($activeGames)?.[ROOT_ID]
    assert.equal($activeGames.get().length, 2)
    assert.deepEqual(getPrivateData(rootId, ['$queries']), {
      [hashQuery('games', { active: true })]: {
        docs: [
          { _id: '_1', name: 'Game 1', active: true },
          { _id: '_2', name: 'Game 2', active: true }
        ],
        ids: ['_1', '_2']
      }
    })
    assert.equal($activeGames._1.name.get(), 'Game 1', 'can access document with dot')
    assert.deepEqual($activeGames.ids.get(), ['_1', '_2'], 'special ids signal is available')
    assert.deepEqual($activeGames.getIds(), ['_1', '_2'], '.getIds() is available on the query signal')
    $activeGames._1.players.set(1)
    assert.equal($game1.players.get(), 1, 'modifying the document through the query signal')
    assert.deepEqual($activeGames.get(), [
      { _id: '_1', name: 'Game 1', active: true, players: 1 },
      { _id: '_2', name: 'Game 2', active: true }
    ], 'query signal has updated data')
  })

  it('supports explicit fetch and subscribe modes for queries', async () => {
    const connection = getConnection()
    const originalCreateFetchQuery = connection.createFetchQuery.bind(connection)
    const originalCreateSubscribeQuery = connection.createSubscribeQuery.bind(connection)
    const calls = []

    connection.createFetchQuery = function (...args) {
      calls.push('fetch')
      return originalCreateFetchQuery(...args)
    }
    connection.createSubscribeQuery = function (...args) {
      calls.push('subscribe')
      return originalCreateSubscribeQuery(...args)
    }

    try {
      const $fetchQuery = await sub($.games, { active: true }, { mode: 'fetch' })
      assert.deepEqual($fetchQuery.getIds().slice().sort(), ['_1', '_2'])
      await unsub($fetchQuery)

      const $liveQuery = await sub($.games, { active: false }, { mode: 'subscribe' })
      assert.deepEqual($liveQuery.getIds(), ['_3'])
      await unsub($liveQuery)

      assert.deepEqual(calls, ['fetch', 'subscribe'])
    } finally {
      connection.createFetchQuery = originalCreateFetchQuery
      connection.createSubscribeQuery = originalCreateSubscribeQuery
    }
  })

  it('query should be iterable', async () => {
    const $activeGames = await sub($.games, { active: true })
    assert.equal([...$activeGames].length, 2)
  })

  it('query should support .map()', async () => {
    const $activeGames = await sub($.games, { active: true })
    assert.deepEqual($activeGames.map($game => $game.name.get()).sort(), ['Game 1', 'Game 2'])
  })

  it('query forwards optional array method arguments', async () => {
    const $activeGames = await sub($.games, { active: true })
    const labels = $activeGames.map(function ($game) {
      return `${this.prefix}${$game.name.get()}`
    }, { prefix: '#' })
    const $firstGame = $activeGames.reduce(($firstGame, $secondGame) => $firstGame)
    const found = $activeGames.find(function ($game) {
      return $game.name.get() === this.name
    }, { name: 'Game 2' })

    assert.deepEqual(labels.sort(), ['#Game 1', '#Game 2'])
    assert.equal($firstGame.name.get(), 'Game 1')
    assert.equal(found.name.get(), 'Game 2')
  })

  it('query ids should support .map()', async () => {
    const $activeGames = await sub($.games, { active: true })
    assert.deepEqual($activeGames.ids.map($id => $id.get()).sort(), ['_1', '_2'])
  })
})

describe('$sub() function. Aggregations', () => {
  // TODO: test garbage collecting sharedb queries, sharedb docs, query signals
  let $game1, $game2, $game3
  const gamesCollection = 'gamesAggregations'

  before(async () => {
    $game1 = $[gamesCollection]._1
    $game2 = $[gamesCollection]._2
    $game3 = $[gamesCollection]._3
    await $game1.set({ name: 'Game 1', active: true })
    await $game2.set({ name: 'Game 2', active: true })
    await $game3.set({ name: 'Game 3', active: false })
  })

  afterEachTestGc()

  it('subscribe to aggregation, modify it', async () => {
    const _activeGames = aggregation(({ active }) => {
      return [{ $match: { active } }]
    })
    const $activeGames = await sub(_activeGames, { $collection: gamesCollection, active: true })
    const rootId = getRoot($activeGames)?.[ROOT_ID]
    assert.equal($activeGames.get().length, 2)
    assert.deepEqual(
      sanitizeAggregations(getPrivateData(rootId, ['$aggregations']) || {}),
      {
        [hashQuery(gamesCollection, { $aggregate: [{ $match: { active: true } }] })]: [
          { _id: '_1', name: 'Game 1', active: true },
          { _id: '_2', name: 'Game 2', active: true }
        ]
      }
    )
    assert.equal($activeGames[0].name.get(), 'Game 1', 'can access document with dot')
    // TODO: test that the .getIds() is gonna be reactive when the aggregation is updated
    //       Also need to somehow put it into a signal of its own
    //       since right now it creates a new array each time
    assert.deepEqual($activeGames.getIds(), ['_1', '_2'], '.getIds() is available on aggregation signal')
    await $activeGames[0].players.set(1)
    assert.equal($game1.players.get(), 1, 'modifying the document through the aggregation signal')
    assert.deepEqual(sanitizeAggregationResult($activeGames.get()), [
      { _id: '_1', name: 'Game 1', active: true, players: 1 },
      { _id: '_2', name: 'Game 2', active: true }
    ], 'query signal has updated data')
  })

  it('subscribes to raw collection $aggregate query and exposes rows through getExtra()', async () => {
    const collection = 'gamesRawAggregations'
    const params = { $aggregate: [{ $match: { active: true } }] }
    const $root = getRootSignal({ rootId: 'sub-raw-aggregation' })
    const $game1 = $root[collection].raw_1
    const $game2 = $root[collection].raw_2
    const $game3 = $root[collection].raw_3
    const prevSubscriptionGcDelay = getSubscriptionGcDelay()
    let $activeGames

    await Promise.all([
      $game1.set({ name: 'Raw Game 1', active: true }),
      $game2.set({ name: 'Raw Game 2', active: true }),
      $game3.set({ name: 'Raw Game 3', active: false })
    ])

    setSubscriptionGcDelay(0)
    try {
      $activeGames = await sub($root[collection], params)
      const rootId = getRoot($activeGames)?.[ROOT_ID]
      const expectedRows = [
        { _id: 'raw_1', name: 'Raw Game 1', active: true },
        { _id: 'raw_2', name: 'Raw Game 2', active: true }
      ]

      assert.deepEqual(
        sanitizeAggregationResult($activeGames.get()).sort(sortById),
        expectedRows,
        'raw $aggregate result is available through .get()'
      )
      assert.deepEqual(
        sanitizeAggregationResult($activeGames.getExtra()).sort(sortById),
        expectedRows,
        'raw $aggregate result is available through .getExtra()'
      )
      assert.deepEqual(
        $activeGames.getIds().slice().sort(),
        ['raw_1', 'raw_2'],
        '.getIds() reads ids from raw $aggregate rows'
      )
      assert.deepEqual(
        sanitizeAggregations(getPrivateData(rootId, ['$aggregations']) || {}),
        {
          [hashQuery(collection, params)]: expectedRows
        },
        'raw $aggregate data is stored in aggregation private data'
      )
    } finally {
      if ($activeGames) await unsub($activeGames)
      setSubscriptionGcDelay(prevSubscriptionGcDelay)
      await Promise.all([
        $game1.del(),
        $game2.del(),
        $game3.del()
      ])
    }
  })

  it('unsubscribes raw collection $aggregate queries through aggregation subscriptions', async () => {
    const collection = 'gamesRawAggregationUnsub'
    const params = { $aggregate: [{ $match: { active: true } }] }
    const hash = hashQuery(collection, params)
    const $root = getRootSignal({ rootId: 'sub-raw-aggregation-unsub' })
    const $game = $root[collection].raw_unsub_1
    const prevSubscriptionGcDelay = getSubscriptionGcDelay()
    let $activeGames

    await $game.set({ name: 'Raw Unsub Game', active: true })

    setSubscriptionGcDelay(0)
    try {
      $activeGames = await sub($root[collection], params)

      assert.equal($activeGames.getExtra().length, 1)
      assert.equal(aggregationSubscriptions.queries.has(hash), true, 'aggregation runtime is tracked')
      assert.equal(querySubscriptions.queries.has(hash), false, 'raw $aggregate is not tracked as an ordinary query')

      await unsub($activeGames)
      $activeGames = undefined

      assert.equal(aggregationSubscriptions.queries.has(hash), false, 'aggregation runtime is cleaned up')
      assert.equal(querySubscriptions.queries.has(hash), false, 'ordinary query runtime was never created')
    } finally {
      if ($activeGames) await unsub($activeGames)
      setSubscriptionGcDelay(prevSubscriptionGcDelay)
      await $game.del()
    }
  })

  it('.getId() on a signal from aggregation should return the id of the document', async () => {
    const _activeGames = aggregation(gamesCollection, ({ active }) => {
      return [{ $match: { active } }]
    })
    const $activeGames = await sub(_activeGames, { active: true })
    assert.equal($activeGames[0].getId(), '_1')
    assert.equal($activeGames[1].getId(), '_2')
  })

  it('aggregation should be iterable', async () => {
    const _activeGames = aggregation(gamesCollection, ({ active }) => {
      return [{ $match: { active } }]
    })
    const $activeGames = await sub(_activeGames, { active: true })
    assert.equal([...$activeGames].length, 2)
  })

  it('aggregation should support .map()', async () => {
    const _activeGames = aggregation(gamesCollection, ({ active }) => {
      return [{ $match: { active } }]
    })
    const $activeGames = await sub(_activeGames, { active: true })
    assert.deepEqual($activeGames.map($game => $game.name.get()).sort(), ['Game 1', 'Game 2'])
  })

  it('aggregation forwards optional array method arguments', async () => {
    const _activeGames = aggregation(gamesCollection, ({ active }) => {
      return [{ $match: { active } }]
    })
    const $activeGames = await sub(_activeGames, { active: true })
    const labels = $activeGames.map(function ($game) {
      return `${this.prefix}${$game.name.get()}`
    }, { prefix: '#' })
    const $firstGame = $activeGames.reduce(($firstGame, $secondGame) => $firstGame)
    const found = $activeGames.find(function ($game) {
      return $game.name.get() === this.name
    }, { name: 'Game 2' })

    assert.deepEqual(labels.sort(), ['#Game 1', '#Game 2'])
    assert.equal($firstGame.name.get(), 'Game 1')
    assert.equal(found.name.get(), 'Game 2')
  })
})

describe.skip('$sub() function. Async api functions', () => {
  it('async function', async () => {
    const $value = await sub(async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
      return 42
    })
    assert.equal($value.get(), undefined)
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal($value.get(), 42)
  })
})

function dropSharedbMetaFields (doc) {
  return Object.fromEntries(Object.entries(doc).filter(([key]) => key === '_id' || !key.startsWith('_')))
}

function sanitizeAggregations (aggregations) {
  return Object.fromEntries(Object.entries(aggregations).map(([key, value]) => {
    return [key, sanitizeAggregationResult(value)]
  }))
}

function sanitizeAggregationResult (results) {
  if (Array.isArray(results)) return results.map(dropSharedbMetaFields)
  return dropSharedbMetaFields(results)
}

function sortById (left, right) {
  return String(left._id).localeCompare(String(right._id))
}
