import { describe, it, before, afterEach } from 'mocha'
import { strict as assert } from 'node:assert'
import { $, sub, unsub } from '../src/index.ts'
import connect from '../src/connect/test.js'
import { getConnection } from '../src/orm/connection.ts'
import { get as _get } from '../src/orm/dataTree.js'
import { materializeQueryDataDocsToCollection } from '../src/orm/Query.js'

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

        assert.deepEqual($query.getIds(), [id], 'the query results still list the deleted doc')
        assert.equal($doc.get(), undefined, 'the doc stays deleted after the query results arrive')
        assert.equal(_get([collection, id]), undefined, 'nothing is materialized in the data tree')
        const shareDoc = getConnection().get(collection, id)
        assert.equal(shareDoc.type, null)
        assert.deepEqual(Object.keys(shareDoc.data), [], 'the missing-doc placeholder stays empty')
        assert.deepEqual($query.get(), [undefined], 'the query lists the deleted doc as undefined')
        assert.deepEqual($query.map($item => $item.get()), [undefined])

        diffs.release()
        if (mode === 'subscribe') await waitFor(() => $query.getIds().length === 0)
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

async function waitFor (check, timeout = 2000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeout) throw Error('waitFor timed out')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}
