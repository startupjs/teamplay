import { afterEach, before, describe, it } from 'mocha'
import { strict as assert } from 'node:assert'
import { getRootSignal, sub, unsub } from '../src/index.ts'
import connect from '../src/connect/test.js'
import { getConnection } from '../src/orm/connection.ts'
import { getRaw } from '../src/orm/dataTree.js'
import { docSubscriptions } from '../src/orm/Doc.js'
import { HASH, querySubscriptions } from '../src/orm/Query.js'
import { getSubscriptionGcDelay, setSubscriptionGcDelay } from '../src/orm/subscriptionGcDelay.ts'
import { assertDocSubscriptionsConsistent, assertQuerySubscriptionsConsistent } from './_subscriptionAssertions.js'

before(connect)

// Where in a destroy the doc is taken again (onDestroy())
const DESTROY_POINTS = {
  // the runtime's destroy started, ShareDB's has not
  before: 'before ShareDB destroys it',
  // in the tick ShareDB's destroy starts, just before it (teamplay sees
  // the doc taken only once ShareDB's destroy started)
  with: 'in the tick ShareDB\'s destroy starts',
  // a reply ShareDB handles right after its destroy started
  inside: 'while ShareDB destroys it',
  // ShareDB removed the doc, the runtime is not disposed yet
  after: 'once ShareDB removed it'
}

// A doc nothing holds is destroyed after the subscription GC delay: its
// transport is closed, then ShareDB destroys the doc (asynchronously: after a
// tick, and after the doc's pending ops), then the runtime is disposed and the
// doc leaves the data tree. The doc can be taken again while ShareDB destroys
// it: a query lists it, an owner subscribes to it. On a server connection
// (backend.connect()) the replies arrive in ticks too, so a query's results
// can land in the very tick of the destroy. A doc taken that way must keep its
// data and stay usable: readable, writable, live.
describe('a doc taken again while it is destroyed', () => {
  const collection = 'docDestroyRaceGames'
  const roots = []
  const restores = []
  let writer
  let prevGcDelay

  before(() => {
    writer = getConnection().agent.backend.connect()
  })

  afterEach(async () => {
    for (const restore of restores.splice(0).reverse()) restore()
    for (const $root of roots.splice(0)) await $root.close()
    if (prevGcDelay !== undefined) setSubscriptionGcDelay(prevGcDelay)
    prevGcDelay = undefined
    await querySubscriptions.flushPendingDestroys()
    await docSubscriptions.flushPendingDestroys()
    assertDocSubscriptionsConsistent(docSubscriptions)
    assertQuerySubscriptionsConsistent(querySubscriptions)
  })

  let counter = 0
  function nextId (name) {
    return `${name}_${Date.now()}_${++counter}`
  }

  function root () {
    const $root = getRootSignal({ rootId: nextId('root') })
    roots.push($root)
    return $root
  }

  function useGcDelay (delay) {
    prevGcDelay ??= getSubscriptionGcDelay()
    setSubscriptionGcDelay(delay)
  }

  function hashOf (id) {
    return JSON.stringify([collection, id])
  }

  async function remoteCreate (id, data) {
    await callback(done => writer.get(collection, id).create(data, done))
  }

  async function remoteOp (id, op) {
    const doc = writer.get(collection, id)
    await callback(done => doc.fetch(done))
    await callback(done => doc.submitOp(op, done))
    return doc.version
  }

  async function remoteData (id) {
    const doc = writer.get(collection, id)
    await callback(done => doc.fetch(done))
    return doc.data
  }

  // A query that read the doc and was closed: nothing holds the doc but its
  // pending GC destroy
  async function readAndRelease (query) {
    const $root = getRootSignal({ rootId: nextId('reader') })
    await sub($root[collection], query)
    await $root.close()
  }

  // Holds the replies of this connection's queries of the collection (they
  // reached the client, ShareDB has not handled them) until deliver()
  function holdQueryReplies () {
    const connection = getConnection()
    const handleMessage = connection.handleMessage
    const held = []
    let holding = true
    let reached
    const holder = {
      reached: new Promise(resolve => { reached = resolve }),
      deliver () {
        if (!holding) return
        holding = false
        if (connection.handleMessage !== handleMessage) delete connection.handleMessage
        for (const message of held.splice(0)) connection.handleMessage(message)
      }
    }
    connection.handleMessage = function (message) {
      // query replies and diffs name the query, not the collection
      const query = (message?.a === 'qs' || message?.a === 'q') && connection.queries[message.id]
      if (holding && query?.collection === collection) {
        held.push(message)
        reached()
        return
      }
      return handleMessage.call(this, message)
    }
    restores.push(() => holder.deliver())
    return holder
  }

  // When the doc's runtime is destroyed, runs `fn` at one point of the
  // destroy (see DESTROY_POINTS)
  function onDestroy (id, at, fn) {
    const runtime = docSubscriptions.docs.get(hashOf(id))
    assert.ok(runtime, 'the doc has a runtime')
    let done
    const ran = new Promise(resolve => { done = resolve })
    const run = () => Promise.resolve(fn()).then(done)
    const destroy = runtime.destroy
    runtime.destroy = async function () {
      runtime.destroy = destroy
      if (at === 'before') {
        await run()
        return await destroy.call(this)
      }
      const shareDoc = getConnection().get(collection, id)
      const shareDestroy = shareDoc.destroy
      shareDoc.destroy = function (cb) {
        delete shareDoc.destroy
        if (at === 'with') {
          run()
          return shareDestroy.call(this, cb)
        }
        if (at === 'inside') {
          shareDestroy.call(this, cb)
          return run()
        }
        return shareDestroy.call(this, (...args) => {
          run()
          cb(...args)
        })
      }
      return await destroy.call(this)
    }
    restores.push(() => { if (runtime.destroy !== destroy) runtime.destroy = destroy })
    return ran
  }

  function assertNoRuntimeLeft (id) {
    assert.equal(docSubscriptions.entries.get(hashOf(id)), undefined, 'no entry')
    assert.equal(getConnection().collections[collection]?.[id], undefined, 'ShareDB destroyed the doc')
    assert.equal(getRaw([collection, id]), undefined, 'the doc left the data tree')
  }

  for (const [at, when] of Object.entries(DESTROY_POINTS)) {
    describe(`a query listing it ${when}`, () => {
      it('keeps the doc readable and writable', async () => {
        useGcDelay(20)
        const id = nextId(`query_${at}`)
        const kind = `kind_${id}`
        await remoteCreate(id, { kind, name: 'Ann' })
        await readAndRelease({ kind })
        assert.ok(docSubscriptions.pendingDestroyTimers.has(hashOf(id)), 'the GC destroy is pending')

        const $job = root()
        const replies = holdQueryReplies()
        const listing = sub($job[collection], { kind })
        await replies.reached
        const taken = onDestroy(id, at, async () => {
          replies.deliver()
          if (at === 'before') await listing
        })
        await docSubscriptions.flushPendingDestroys()
        await taken
        const $query = await listing

        assert.deepEqual($query.getIds(), [id])
        assert.equal(getQueryResultDocs($query)[0], getConnection().collections[collection][id], 'ShareDB keeps the doc the query lists')
        assert.equal($job[collection][id].name.get(), 'Ann', 'readable')
        await $job[collection][id].marked.set(true)
        assert.deepEqual($query.get().map(({ name, marked }) => ({ name, marked })), [{ name: 'Ann', marked: true }])
        assert.deepEqual(await remoteData(id), { kind, name: 'Ann', marked: true }, 'written')
        const version = await remoteOp(id, [{ p: ['name'], od: 'Ann', oi: 'Bob' }])
        await waitFor(() => getConnection().get(collection, id).version >= version)
        assert.equal($job[collection][id].name.get(), 'Bob', 'live')

        await $job.close()
        roots.splice(roots.indexOf($job), 1)
        await querySubscriptions.flushPendingDestroys()
        await docSubscriptions.flushPendingDestroys()
        assertNoRuntimeLeft(id)
      })
    })
  }

  it('a query that starts to list it (a diff) while ShareDB destroys it keeps it', async () => {
    useGcDelay(20)
    const id = nextId('diff')
    const kind = `kind_${id}`
    await remoteCreate(id, { kind, name: 'Ann', ready: false })
    await readAndRelease({ kind })
    const $job = root()
    const $ready = await sub($job[collection], { kind, ready: true })
    assert.deepEqual($ready.getIds(), [])
    const replies = holdQueryReplies()
    await remoteOp(id, [{ p: ['ready'], od: false, oi: true }])
    await replies.reached
    const taken = onDestroy(id, 'inside', () => replies.deliver())
    await docSubscriptions.flushPendingDestroys()
    await taken
    await waitFor(() => $ready.getIds().length === 1, 'the query lists the doc')
    assert.equal($job[collection][id].name.get(), 'Ann')
    await $job[collection][id].name.set('Bob')
    assert.equal((await remoteData(id)).name, 'Bob')
  })

  for (const at of ['before', 'with', 'inside']) {
    it(`an owner subscribing to it ${DESTROY_POINTS[at]} gets a live subscription`, async () => {
      useGcDelay(20)
      const id = nextId(`owner_${at}`)
      const kind = `kind_${id}`
      await remoteCreate(id, { kind, name: 'Ann' })
      await readAndRelease({ kind })
      const $owner = root()
      let subscribed
      // started, not awaited: the subscribe waits for the destroy to end
      const taken = onDestroy(id, at, () => {
        subscribed = sub($owner[collection][id])
      })
      await docSubscriptions.flushPendingDestroys()
      await taken
      const $doc = await subscribed
      assert.equal($doc.name.get(), 'Ann')
      const shareDoc = getConnection().get(collection, id)
      assert.equal(shareDoc.subscribed, true, 'ShareDB keeps the subscription')
      const version = await remoteOp(id, [{ p: ['name'], od: 'Ann', oi: 'Bob' }])
      await waitFor(() => shareDoc.version >= version)
      assert.equal($doc.name.get(), 'Bob', 'live')
      await $doc.score.set(1)
      assert.equal((await remoteData(id)).score, 1)
    })
  }

  it('an owner that takes it while ShareDB destroys it and leaves at once: destroyed after its own grace, nothing left', async () => {
    useGcDelay(20)
    const id = nextId('take_and_leave')
    const kind = `kind_${id}`
    await remoteCreate(id, { kind, name: 'Ann' })
    await readAndRelease({ kind })
    const $owner = root()
    let read
    const taken = onDestroy(id, 'inside', async () => {
      const $doc = await sub($owner[collection][id])
      read = $doc.name.get()
      await unsub($doc)
    })
    await docSubscriptions.flushPendingDestroys()
    await taken
    assert.equal(read, 'Ann')
    const shareDoc = getConnection().get(collection, id)
    await docSubscriptions.flushPendingDestroys()
    assertNoRuntimeLeft(id)
    assert.equal(countRuntimeListeners(shareDoc), 0, 'no listener left on the ShareDB doc')
  })

  for (const gcDelay of [0, 20]) {
    it(`a query that takes it and lets it go before ShareDB's destroy ends: destroyed after, nothing left (GC delay ${gcDelay} ms)`, async () => {
      useGcDelay(20)
      const id = nextId(`take_release_${gcDelay}`)
      const kind = `kind_${id}`
      await remoteCreate(id, { kind, name: 'Ann' })
      await readAndRelease({ kind })
      useGcDelay(gcDelay)
      const shareDestroy = holdShareDbDestroy(id)
      const $job = getRootSignal({ rootId: nextId('job') })
      const flushed = docSubscriptions.flushPendingDestroys()
      await shareDestroy.started
      const $query = await sub($job[collection], { kind })
      assert.equal($job[collection][id].name.get(), 'Ann')
      assert.deepEqual($query.getIds(), [id])
      // the job ends while ShareDB still destroys the doc
      await $job.close()
      shareDestroy.finish()
      await flushed
      await new Promise(resolve => setTimeout(resolve, gcDelay + 10))
      await docSubscriptions.flushPendingDestroys()
      assertNoRuntimeLeft(id)
    })
  }

  // ShareDB's destroy of the doc calls back only on finish(), as when it
  // waits for the doc's pending ops or its unsubscribe
  function holdShareDbDestroy (id) {
    let started
    let finish
    const finished = new Promise(resolve => { finish = resolve })
    const holder = { started: new Promise(resolve => { started = resolve }), finish }
    const shareDoc = getConnection().get(collection, id)
    const destroy = shareDoc.destroy
    shareDoc.destroy = function (cb) {
      delete shareDoc.destroy
      started()
      destroy.call(this, (...args) => finished.then(() => cb(...args)))
    }
    restores.push(() => {
      finish()
      if (shareDoc.destroy !== destroy) delete shareDoc.destroy
    })
    return holder
  }

  it('a query of another root takes it while a closing root destroys its subscription', async () => {
    // root close: releaseRootOwnedSubscriptions() destroys the direct
    // subscriptions of the root without a GC grace (destroyByOwnerKey(force))
    useGcDelay(20)
    const id = nextId('root_close')
    const kind = `kind_${id}`
    await remoteCreate(id, { kind, name: 'Ann' })
    const $closing = getRootSignal({ rootId: nextId('closing') })
    await sub($closing[collection][id])
    const $job = root()
    const replies = holdQueryReplies()
    const listing = sub($job[collection], { kind })
    await replies.reached
    const taken = onDestroy(id, 'inside', () => replies.deliver())
    await $closing.close()
    await taken
    const $query = await listing
    assert.deepEqual($query.getIds(), [id])
    assert.equal($job[collection][id].name.get(), 'Ann')
    await $job[collection][id].marked.set(true)
    assert.equal((await remoteData(id)).marked, true)
  })

  it('a forced destroy waiting for the doc\'s pending ops leaves it to an owner that subscribed meanwhile', async () => {
    // A root released the doc with an op in flight and is closed: the close
    // ends the GC grace of what it released (destroyByHash(force)), and that
    // destroy waits for the op
    useGcDelay(1000)
    const id = nextId('forced_pending')
    await remoteCreate(id, { name: 'Ann', score: 0 })
    const $closing = getRootSignal({ rootId: nextId('closing') })
    const $released = await sub($closing[collection][id])
    const acks = holdOpAcks(id)
    const written = $released.score.set(1)
    await unsub($released)
    await $closing.close()
    assert.ok(getConnection().get(collection, id).hasPending(), 'the destroy waits for the op')
    const $owner = root()
    const $doc = await sub($owner[collection][id])
    acks.deliver()
    await written
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.ok(docSubscriptions.docs.get(hashOf(id)), 'the runtime stays')
    assert.equal($doc.score.get(), 1)
    const shareDoc = getConnection().get(collection, id)
    assert.equal(shareDoc.subscribed, true)
    const version = await remoteOp(id, [{ p: ['name'], od: 'Ann', oi: 'Bob' }])
    await waitFor(() => shareDoc.version >= version)
    assert.equal($doc.name.get(), 'Bob', 'live')
  })

  it('a query of another root takes it while a closing root\'s destroy waits for the doc\'s pending ops', async () => {
    useGcDelay(20)
    const id = nextId('root_close_pending')
    const kind = `kind_${id}`
    await remoteCreate(id, { kind, name: 'Ann', score: 0 })
    const $closing = getRootSignal({ rootId: nextId('closing') })
    const $released = await sub($closing[collection][id])
    const acks = holdOpAcks(id)
    const written = $released.score.set(1)
    const closed = $closing.close()
    await waitFor(() => !getConnection().get(collection, id).subscribed, 'the closing root unsubscribed')
    assert.ok(getConnection().get(collection, id).hasPending(), 'the destroy waits for the op')
    const $job = root()
    const $query = await sub($job[collection], { kind })
    acks.deliver()
    await written
    await closed
    assert.deepEqual($query.getIds(), [id])
    assert.equal($job[collection][id].name.get(), 'Ann')
    assert.equal($job[collection][id].score.get(), 1)
    await $job[collection][id].marked.set(true)
    assert.equal((await remoteData(id)).marked, true)
  })

  it('an explicit destroy() waiting for the doc\'s pending ops leaves it to an owner that subscribed meanwhile', async () => {
    useGcDelay(20)
    const id = nextId('explicit_pending')
    await remoteCreate(id, { name: 'Ann', score: 0 })
    const $first = root()
    const $released = await sub($first[collection][id])
    const acks = holdOpAcks(id)
    const written = $released.score.set(1)
    await docSubscriptions.destroy([collection, id])
    assert.ok(getConnection().get(collection, id).hasPending(), 'the destroy waits for the op')
    const $owner = root()
    const $doc = await sub($owner[collection][id])
    acks.deliver()
    await written
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.ok(docSubscriptions.docs.get(hashOf(id)), 'the runtime stays')
    assert.equal($doc.score.get(), 1)
    const shareDoc = getConnection().get(collection, id)
    assert.equal(shareDoc.subscribed, true)
    const version = await remoteOp(id, [{ p: ['name'], od: 'Ann', oi: 'Bob' }])
    await waitFor(() => shareDoc.version >= version)
    assert.equal($doc.name.get(), 'Bob', 'live')
  })

  // Holds the server's acknowledgements of this connection's ops on the doc
  function holdOpAcks (id) {
    const connection = getConnection()
    const handleMessage = connection.handleMessage
    const held = []
    let holding = true
    const holder = {
      deliver () {
        if (!holding) return
        holding = false
        if (connection.handleMessage !== handleMessage) delete connection.handleMessage
        for (const message of held.splice(0)) connection.handleMessage(message)
      }
    }
    connection.handleMessage = function (message) {
      if (holding && message?.a === 'op' && message.c === collection && message.d === id && message.src === connection.id) {
        held.push(message)
        return
      }
      return handleMessage.call(this, message)
    }
    restores.push(() => holder.deliver())
    return holder
  }
})

// the ShareDB docs of the query's results
function getQueryResultDocs ($query) {
  return querySubscriptions.entries.get($query[HASH]).runtime.shareQuery.results
}

function countRuntimeListeners (shareDoc) {
  return ['load', 'create', 'del', 'op', 'error'].reduce((sum, event) => sum + shareDoc.listenerCount(event), 0)
}

function callback (run) {
  return new Promise((resolve, reject) => run(err => err ? reject(err) : resolve()))
}

async function waitFor (check, message = 'condition') {
  for (let i = 0; i < 400; i++) {
    if (check()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.fail(`timed out waiting for: ${message}`)
}
