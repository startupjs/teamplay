import { describe, it, before, afterEach } from 'mocha'
import { strict as assert } from 'node:assert'
import { raw } from '@nx-js/observer-util'
import { $, sub, unsub, reaction } from '../src/index.ts'
import connect from '../src/connect/test.js'
import { getConnection } from '../src/orm/connection.ts'
import { get as _get } from '../src/orm/dataTree.js'
import { HASH, materializeQueryDataDocsToCollection, querySubscriptions } from '../src/orm/Query.js'
import { getQueryDocIndexSize } from '../src/orm/queryDocIndex.js'

before(connect)

// A doc deleted while a query that includes it is in flight: the query
// results were read on the server before the delete and reach the client
// after it. The client ShareDB doc stays deleted (it ignores the older
// snapshot) but is still one of the query's results.
describe('a doc deleted while a query including it is in flight', () => {
  const collection = 'deletedDocQueryRaceGames'
  const holders = []
  const owned = []

  afterEach(async () => {
    for (const holder of holders.splice(0)) holder.dispose()
    for (const $signal of owned.splice(0).reverse()) await unsub($signal)
    await querySubscriptions.flushPendingDestroys()
    assert.equal(getQueryDocIndexSize(collection), 0, 'destroyed queries no longer list their docs')
  })

  for (const mode of ['subscribe', 'fetch']) {
    describe(`${mode} query`, () => {
      it('reads the doc as undefined, not as `{ _id }`', async () => {
        const id = `race_${mode}_${Date.now()}`
        const kind = `kind_${id}`
        const $doc = await own(sub($[collection][id]))
        await $doc.set({ kind, name: 'Deleted while queried' })

        const holder = holdQueryResults(collection, id)
        // the removal diff of a subscribe query arrives later on a real network
        const diffs = holdQueryDiffs()
        const queryPromise = own(sub($[collection], { kind }, { mode }))
        await holder.reached
        await $doc.del()
        assert.equal($doc.get(), undefined, 'deleted before the query results arrive')
        holder.release()
        const $query = await queryPromise

        assert.deepEqual(getQueryResultIds($query), [id], 'ShareDB still lists the deleted doc')
        assert.deepEqual($query.getIds(), [], 'the query leaves the deleted doc out')
        assert.equal($doc.get(), undefined, 'the doc stays deleted after the query results arrive')
        assert.equal(_get([collection, id]), undefined, 'nothing is materialized in the data tree')
        const shareDoc = getConnection().get(collection, id)
        assert.equal(shareDoc.type, null)
        assert.deepEqual(Object.keys(shareDoc.data), [], 'the missing-doc placeholder stays empty')
        assert.deepEqual($query.get(), [], 'never a hole for the deleted doc')
        assert.deepEqual($query.map($item => $item.get()), [])

        diffs.release()
        if (mode === 'subscribe') await waitFor(() => getQueryResultIds($query).length === 0)
        assert.deepEqual($query.getIds(), [])
        assert.equal($doc.get(), undefined, 'still undefined once the query settles')
        assert.equal(_get([collection, id]), undefined)
      })

      it('lets a later create of the same id show the new data', async () => {
        const id = `race_recreate_${mode}_${Date.now()}`
        const kind = `kind_${id}`
        const $doc = await own(sub($[collection][id]))
        await $doc.set({ kind, name: 'First' })

        const holder = holdQueryResults(collection, id)
        const diffs = holdQueryDiffs()
        const queryPromise = own(sub($[collection], { kind }, { mode }))
        await holder.reached
        await $doc.del()
        holder.release()
        await queryPromise
        diffs.release()

        await $doc.set({ kind, name: 'Second' })
        assert.deepEqual($doc.get(), { _id: id, kind, name: 'Second' })
        await $doc.del()
        assert.equal($doc.get(), undefined)
      })
    })
  }

  it('does not resurrect a deleted doc from a query result list that still lists it', async () => {
    // a subscribe query keeps a deleted doc in its results until the server
    // sends the removal; materializing the result list (batch readiness check)
    // must not bring the deleted doc back into the data tree
    const id = `race_stale_list_${Date.now()}`
    const kind = `kind_${id}`
    const $doc = await own(sub($[collection][id]))
    await $doc.set({ kind, name: 'Listed' })
    const $query = await own(sub($[collection], { kind }))
    const listed = [...$query.get()]
    assert.deepEqual(listed.map(doc => doc?._id), [id])

    // the local delete applies at once; the server removal comes later
    const deleted = $doc.del()
    assert.equal($doc.get(), undefined)
    materializeQueryDataDocsToCollection(collection, listed)
    assert.equal($doc.get(), undefined, 'the stale result list does not resurrect the doc')
    assert.equal(_get([collection, id]), undefined)
    await deleted
    assert.equal($doc.get(), undefined)
  })

  // $query.get(), $query.getIds() and the doc signals of the query list the
  // results whose docs exist, with their current data: a doc deleted after
  // the server read the results is left out (until the server removes it
  // from a subscribe query, for good in a fetch query), never listed as a
  // hole or as its old object, and a doc created again comes back. The list
  // and the objects of unchanged results keep their identity.
  describe('$query.get() after a doc of the results is deleted', () => {
    for (const mode of ['subscribe', 'fetch']) {
      it(`leaves out a doc deleted on this client (${mode} query)`, async () => {
        const { $a, $b, $query, idA, idB } = await subscribeTwoDocs(`local_${mode}`, mode)
        const docs = raw($query.get())
        const docB = docs[1]
        const seen = []
        const handle = reaction(() => { seen.push($query.get().map(doc => doc?.name)) })
        const diffs = holdQueryDiffs()
        try {
          await $a.del()
          await tick()
          assert.deepEqual(getQueryResultIds($query), [idA, idB], 'the server has not removed it yet')
          assert.deepEqual($query.getIds(), [idB])
          assert.equal(raw($query.get()), docs, 'the same list')
          assert.equal($query.get().length, 1, 'neither a hole nor the old object of the deleted doc')
          assert.equal(raw($query.get()[0]), docB, 'an unchanged result keeps its object')
          assert.deepEqual(seen.at(-1), ['B'], 'readers of $query.get() re-run')
        } finally {
          handle.dispose()
          diffs.release()
        }
        if (mode === 'subscribe') await waitFor(() => getQueryResultIds($query).length === 1)
        assert.deepEqual($query.getIds(), [idB])
        assert.equal(raw($query.get()), docs)
        assert.deepEqual($query.get().map(doc => doc.name), ['B'])
        assert.equal(raw($query.get()[0]), docB)
        assert.equal(raw($b.get()), docB)
      })
    }

    it('lists a doc created again, at its place, with its new data (fetch query)', async () => {
      const { $a, $b, $query, idA, idB } = await subscribeTwoDocs('recreate', 'fetch')
      const kind = $a.kind.get()
      await $a.del()
      assert.deepEqual($query.getIds(), [idB])
      await $a.set({ kind, name: 'A again', n: 1 })
      assert.deepEqual($query.getIds(), [idA, idB])
      assert.equal(raw($query.get()[0]), raw($a.get()), 'the current object of the doc')
      assert.equal($query.get()[0].name, 'A again')
      assert.equal(raw($query.get()[1]), raw($b.get()))
    })

    it('leaves out a doc deleted by another client (fetch query)', async () => {
      const { $a, $b, $query, idA, idB } = await subscribeTwoDocs('remote', 'fetch')
      const writer = getConnection().agent.backend.connect()
      try {
        const doc = writer.get(collection, idA)
        await new Promise((resolve, reject) => doc.fetch(err => err ? reject(err) : resolve()))
        await new Promise((resolve, reject) => doc.del(err => err ? reject(err) : resolve()))
      } finally {
        writer.close()
      }
      await waitFor(() => $a.get() === undefined)
      assert.deepEqual($query.getIds(), [idB])
      assert.equal($query.get().length, 1)
      assert.equal(raw($query.get()[0]), raw($b.get()))
    })

    async function subscribeTwoDocs (name, mode) {
      const idA = `get_${name}_a_${Date.now()}`
      const idB = `get_${name}_b_${Date.now()}`
      const kind = `kind_get_${name}_${Date.now()}`
      const [$a, $b] = await Promise.all([own(sub($[collection][idA])), own(sub($[collection][idB]))])
      await Promise.all([$a.set({ kind, name: 'A', n: 1 }), $b.set({ kind, name: 'B', n: 2 })])
      const $query = await own(sub($[collection], { kind, $sort: { n: 1 } }, { mode }))
      assert.deepEqual($query.getIds(), [idA, idB])
      assert.equal(raw($query.get()[0]), raw($a.get()))
      return { $a, $b, $query, idA, idB }
    }
  })

  function own (promise) {
    return promise.then($signal => {
      owned.push($signal)
      return $signal
    })
  }

  function holdQueryResults (collectionName, docId) {
    const backend = getConnection().agent.backend
    let release
    let reached
    const released = new Promise(resolve => { release = resolve })
    const reachedPromise = new Promise(resolve => { reached = resolve })
    let held = false
    const middleware = (request, next) => {
      if (held || request.collection !== collectionName) return next()
      if (!request.snapshots.some(snapshot => snapshot.id === docId && snapshot.type != null)) return next()
      held = true
      reached()
      released.then(() => next())
    }
    backend.use('readSnapshots', middleware)
    const holder = {
      reached: reachedPromise,
      release,
      dispose () {
        release()
        const list = backend.middleware.readSnapshots
        const index = list.indexOf(middleware)
        if (index !== -1) list.splice(index, 1)
      }
    }
    holders.push(holder)
    return holder
  }

  // Delays query diffs (removals, inserts) on the client connection until
  // released, the way network latency does.
  function holdQueryDiffs () {
    const connection = getConnection()
    const handleMessage = connection.handleMessage
    const queued = []
    let holding = true
    connection.handleMessage = function (message) {
      if (holding && message?.a === 'q') return queued.push(message)
      return handleMessage.call(this, message)
    }
    const holder = {
      release () {
        if (!holding) return
        holding = false
        delete connection.handleMessage
        for (const message of queued.splice(0)) connection.handleMessage(message)
      },
      dispose () {
        holder.release()
      }
    }
    holders.push(holder)
    return holder
  }
})

// the ids ShareDB lists in the query results (deleted docs included)
function getQueryResultIds ($query) {
  const entry = querySubscriptions.entries.get($query[HASH])
  return entry.runtime.shareQuery.results.map(doc => doc.id)
}

function tick () {
  return new Promise(resolve => setTimeout(resolve, 0))
}

async function waitFor (check, timeout = 2000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeout) throw Error('waitFor timed out')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}
