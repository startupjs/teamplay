import { afterEach, before, describe, it } from 'mocha'
import { strict as assert } from 'node:assert'
import { $, getRootSignal, reaction, sub, unsub } from '../src/index.ts'
import connect from '../src/connect/test.js'
import { getConnection } from '../src/orm/connection.ts'
import { getRaw } from '../src/orm/dataTree.js'
import { docSubscriptions } from '../src/orm/Doc.js'
import { HASH, querySubscriptions } from '../src/orm/Query.js'
import { getSubscriptionGcDelay, setSubscriptionGcDelay } from '../src/orm/subscriptionGcDelay.ts'
import {
  clearSubscriptionFailure,
  getSubscriptionFailure,
  getSubscriptionFailureKey,
  setSubscriptionFailure
} from '../src/orm/subscriptionFailures.js'
import { assertDocSubscriptionsConsistent, assertQuerySubscriptionsConsistent } from './_subscriptionAssertions.js'

before(connect)

// Where in a destroy the doc is taken again (onDestroy())
const DESTROY_POINTS = {
  // the runtime's destroy started, ShareDB's has not (as when ShareDB's
  // destroy of the doc waits behind the one before it; onDestroy() inserts
  // an await there)
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
// transport is closed, its runtime stops following ShareDB's doc, then
// ShareDB destroys the doc (asynchronously: after a tick, and after the doc's
// pending ops), then the doc leaves the data tree. The doc can be taken again
// while ShareDB destroys it: a query lists it, an owner subscribes to it. On a
// server connection (backend.connect()) the replies arrive in ticks too, so a
// query's results can land in the very tick of the destroy. A doc taken that
// way gets a new runtime; it must keep its data and stay usable: readable,
// writable, live.
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

  // Holds the messages this connection receives that match(message) (they
  // reached the client, ShareDB has not handled them) until deliver()
  function holdReplies (match) {
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
      if (holding && match(message)) {
        held.push(message)
        reached()
        return
      }
      return handleMessage.call(this, message)
    }
    restores.push(() => holder.deliver())
    return holder
  }

  // Holds the replies of this connection's queries of the collection
  function holdQueryReplies () {
    const connection = getConnection()
    // query replies and diffs name the query, not the collection
    return holdReplies(message => {
      const query = (message?.a === 'qs' || message?.a === 'q') && connection.queries[message.id]
      return query?.collection === collection
    })
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

  // No await inserted into the runtime's destroy: the first destroy's ShareDB
  // callback is held (ShareDB has removed the doc), a query takes the doc (a
  // new ShareDB doc) and releases it (a second destroy, which waits for the
  // first), and a third root's query takes the doc meanwhile. The doc must
  // stay live for that query.
  it('a query taking it while a second destroy waits for the first one keeps it live', async () => {
    useGcDelay(20)
    const id = nextId('chained')
    const kind = `kind_${id}`
    await remoteCreate(id, { kind, name: 'Ann' })
    await readAndRelease({ kind })
    useGcDelay(0)
    const shareDestroy = holdShareDbDestroy(id)
    const flushed = docSubscriptions.flushPendingDestroys()
    await shareDestroy.started
    const $first = getRootSignal({ rootId: nextId('first') })
    await sub($first[collection], { kind })
    const closed = $first.close()
    await new Promise(resolve => setTimeout(resolve, 5))
    const $job = root()
    const $query = await sub($job[collection], { kind })
    shareDestroy.finish()
    await flushed
    await closed
    await new Promise(resolve => setTimeout(resolve, 5))
    assert.deepEqual($query.getIds(), [id])
    assert.equal(getQueryResultDocs($query)[0], getConnection().collections[collection]?.[id], 'ShareDB keeps the doc the query lists')
    const version = await remoteOp(id, [{ p: ['name'], od: 'Ann', oi: 'Bob' }])
    await waitFor(() => $job[collection][id].name.get() === 'Bob', 'the query\'s doc is live')
    assert.ok(getConnection().get(collection, id).version >= version)
    await $job.close()
    roots.splice(roots.indexOf($job), 1)
    await querySubscriptions.flushPendingDestroys()
    await docSubscriptions.flushPendingDestroys()
    assertNoRuntimeLeft(id)
  })

  // ShareDB destroys the doc (it leaves the connection) but calls back only on
  // finish(): teamplay's destroy of the doc is still in flight until then
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

  it('the entry stays while ShareDB destroys the doc, so a query that takes the doc then keeps its data', async () => {
    // A path that drops an empty entry (a pending destroy taken, a closing
    // root's destroy of an entry with no runtime) runs while ShareDB destroys
    // the doc: the entry stays, so the runtime a query creates meanwhile is
    // the one the destroy finds when it ends, and the doc stays in the tree
    useGcDelay(20)
    const id = nextId('kept_entry')
    const kind = `kind_${id}`
    await remoteCreate(id, { kind, name: 'Ann' })
    await readAndRelease({ kind })
    const shareDestroy = holdShareDbDestroy(id)
    const flushed = docSubscriptions.flushPendingDestroys()
    await shareDestroy.started
    docSubscriptions.deleteEntryIfEmpty(hashOf(id))
    assert.ok(docSubscriptions.entries.has(hashOf(id)), 'the entry stays')
    const $job = root()
    const $query = await sub($job[collection], { kind })
    shareDestroy.finish()
    await flushed
    assert.deepEqual($query.getIds(), [id])
    assert.equal($job[collection][id].name.get(), 'Ann')
    const version = await remoteOp(id, [{ p: ['name'], od: 'Ann', oi: 'Bob' }])
    await waitFor(() => $job[collection][id].name.get() === 'Bob', 'the query\'s doc is live')
    assert.ok(getConnection().get(collection, id).version >= version)
  })

  // Public API only, the GC timer destroys the doc: a screen's query is
  // released, and a returning screen lists the same doc with another query
  // while ShareDB destroys it. The doc keeps its data and follows the server,
  // in its signal and in the query's list.
  it('a doc a returning screen\'s query lists while its GC destroy is in ShareDB keeps its data and stays live', async () => {
    useGcDelay(20)
    const id = nextId('returning')
    const kind = `kind_${id}`
    await remoteCreate(id, { kind, n: 1 })
    const $screen = root()
    const $first = await sub($screen[collection], { kind })
    assert.equal($screen[collection][id].n.get(), 1)
    const shareDestroy = holdShareDbDestroy(id)
    await unsub($first)
    await shareDestroy.started
    const $job = root()
    const $returning = await sub($job[collection], { _id: { $in: [id] } })
    shareDestroy.finish()
    await waitFor(() => !docSubscriptions.entries.get(hashOf(id))?.destroying, 'the destroy ends')
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.deepEqual($returning.getIds(), [id])
    assert.equal($job[collection][id].n.get(), 1, 'the listed doc keeps its data')
    assert.equal(getQueryResultDocs($returning)[0], getConnection().collections[collection]?.[id], 'ShareDB keeps the doc the query lists')
    await remoteOp(id, [{ p: ['n'], od: 1, oi: 2 }])
    await waitFor(() => $job[collection][id].n.get() === 2, 'the doc follows the server')
    assert.deepEqual($returning.get().map(({ n }) => n), [2], 'the query\'s list follows the server')
  })

  it('an owner that subscribes while a closing root\'s destroy is in ShareDB gets a live subscription', async () => {
    useGcDelay(20)
    const id = nextId('root_close_owner')
    await remoteCreate(id, { name: 'Ann' })
    const $closing = getRootSignal({ rootId: nextId('closing') })
    await sub($closing[collection][id])
    const shareDestroy = holdShareDbDestroy(id)
    const closed = $closing.close()
    await shareDestroy.started
    const $owner = root()
    const subscribing = sub($owner[collection][id])
    shareDestroy.finish()
    await closed
    const $doc = await subscribing
    assert.equal($doc.name.get(), 'Ann')
    const shareDoc = getConnection().collections[collection]?.[id]
    assert.ok(shareDoc?.subscribed, 'ShareDB keeps the owner\'s subscription')
    const version = await remoteOp(id, [{ p: ['name'], od: 'Ann', oi: 'Bob' }])
    await waitFor(() => $doc.name.get() === 'Bob', 'the owner sees the server\'s op')
    assert.ok(shareDoc.version >= version)
    await $doc.score.set(1)
    assert.equal((await remoteData(id)).score, 1)
  })

  it('a destroy of the doc while ShareDB destroys it settles once ShareDB is done', async () => {
    useGcDelay(20)
    const id = nextId('settles_after')
    const kind = `kind_${id}`
    await remoteCreate(id, { kind, name: 'Ann' })
    await readAndRelease({ kind })
    const shareDestroy = holdShareDbDestroy(id)
    const flushed = docSubscriptions.flushPendingDestroys()
    await shareDestroy.started
    let settled = false
    const destroyed = docSubscriptions.destroy([collection, id]).then(() => { settled = true })
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(settled, false, 'it waits for ShareDB\'s destroy')
    shareDestroy.finish()
    await destroyed
    await flushed
    assertNoRuntimeLeft(id)
  })

  it('a destroy that finds the runtime detached by another one leaves no ShareDB doc behind', async () => {
    // A closing root's destroy and a GC destroy overlap: the closing root's
    // finds the runtime the GC destroy detached (ShareDB removed the doc, its
    // destroy has not called back yet). Asking that runtime about the doc
    // must not get a ShareDB doc of this id back into the connection.
    useGcDelay(20)
    const id = nextId('detached')
    const kind = `kind_${id}`
    await remoteCreate(id, { kind, name: 'Ann' })
    await readAndRelease({ kind })
    const runtime = docSubscriptions.docs.get(hashOf(id))
    const shareDestroy = holdShareDbDestroy(id)
    const flushed = docSubscriptions.flushPendingDestroys()
    await shareDestroy.started
    const closed = docSubscriptions.destroyTransportEntry(hashOf(id), runtime)
    shareDestroy.finish()
    await closed
    await flushed
    assertNoRuntimeLeft(id)
  })

  it('a destroy of a runtime another destroy already ended changes nothing of the doc\'s new runtime', async () => {
    useGcDelay(20)
    const id = nextId('stale')
    const kind = `kind_${id}`
    await remoteCreate(id, { kind, name: 'Ann' })
    await readAndRelease({ kind })
    const stale = docSubscriptions.docs.get(hashOf(id))
    await docSubscriptions.flushPendingDestroys()
    assertNoRuntimeLeft(id)
    // taken again: a new runtime, with a subscription failure of its own
    const $job = root()
    await sub($job[collection], { kind })
    const fresh = docSubscriptions.docs.get(hashOf(id))
    const failureKey = getSubscriptionFailureKey('doc', hashOf(id))
    const failure = Error('refused')
    setSubscriptionFailure(failureKey, failure)
    restores.push(() => clearSubscriptionFailure(failureKey))
    await docSubscriptions.destroyRuntime(hashOf(id), stale)
    assert.equal(docSubscriptions.docs.get(hashOf(id)), fresh)
    assert.equal(getSubscriptionFailure(failureKey), failure, 'the new runtime\'s failure stays')
    assert.equal($job[collection][id].name.get(), 'Ann')
  })

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

  it('a closing root\'s destroy that waits for an op, while an owner subscribes and leaves, leaves the doc live for the next owner', async () => {
    // The closing root's destroy waits for the doc's op in flight. An owner
    // subscribes and leaves before the subscribe reply (as a React lease
    // can), and the op's ack arrives before that reply: the destroy finds
    // the subscribe in flight and leaves the doc to it, so no runtime it
    // ended comes back as the entry's, subscribed while ShareDB is not.
    useGcDelay(1000)
    const id = nextId('subscribe_in_flight')
    await remoteCreate(id, { name: 'Ann', score: 0 })
    const $closing = getRootSignal({ rootId: nextId('closing') })
    const $doc = await sub($closing[collection][id])
    const runtime = docSubscriptions.docs.get(hashOf(id))
    let waiting
    const waits = new Promise(resolve => { waiting = resolve })
    const whenNothingPending = runtime.whenNothingPending
    runtime.whenNothingPending = function (fn) {
      waiting()
      return whenNothingPending.call(this, fn)
    }
    restores.push(() => { runtime.whenNothingPending = whenNothingPending })
    const acks = holdOpAcks(id)
    const written = $doc.score.set(1)
    const closed = $closing.close()
    await waits
    const subscribeReply = holdReplies(message => message?.a === 's' && message.c === collection && message.d === id)
    const $passing = root()
    const subscribing = sub($passing[collection][id])
    await subscribeReply.reached
    const left = unsub($passing[collection][id])
    await new Promise(resolve => setTimeout(resolve, 5))
    acks.deliver()
    subscribeReply.deliver()
    await written
    await subscribing
    await left
    await closed
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(runtime.detached, false, 'the destroy left the doc to the subscribe in flight')
    const entry = docSubscriptions.entries.get(hashOf(id))
    const shareDoc = getConnection().collections[collection]?.[id]
    if (entry?.runtime && entry.runtime.activeTransportMode === 'subscribe') {
      assert.ok(shareDoc?.subscribed, 'a runtime in subscribe mode has its ShareDB subscription')
    }
    const $owner = root()
    const $live = await sub($owner[collection][id])
    const version = await remoteOp(id, [{ p: ['name'], od: 'Ann', oi: 'Bob' }])
    await waitFor(() => $live.name.get() === 'Bob', 'the next owner sees the server\'s op')
    assert.ok(getConnection().collections[collection][id].version >= version)
  })

  it('a reaction that throws as a destroyed doc leaves the tree does not leave the doc stuck in its destroy', async () => {
    // The destroy's error reaches its caller (here unsub()); the entry is
    // done with the destroy all the same, and the next owner subscribes.
    // (A doc stuck in its destroy would keep the next subscribe waiting for
    // it in a loop that never yields: the state is checked first.)
    useGcDelay(0)
    const id = nextId('throwing_reaction')
    await remoteCreate(id, { name: 'Ann' })
    const $doc = await sub(root()[collection][id])
    // throws once the doc is gone from the tree
    const handle = reaction(() => $doc.name.get().length)
    try {
      await assert.rejects(unsub($doc))
    } finally {
      handle.dispose()
    }
    assert.equal(docSubscriptions.entries.get(hashOf(id))?.destroying ?? null, null, 'the destroy is over')
    const $next = await sub(root()[collection][id])
    assert.equal($next.name.get(), 'Ann')
  })

  it('an explicit destroy() of a doc a query lists: the query reads the doc as gone, as its signal does', async () => {
    // force ignores the query results holding the doc; once the doc leaves
    // the data tree, the query's results leave it out too
    const id = nextId('forced_listed')
    const kind = `kind_${id}`
    await remoteCreate(id, { kind, name: 'Ann' })
    const $job = root()
    const $query = await sub($job[collection], { kind })
    assert.deepEqual($query.get().map(({ name }) => name), ['Ann'])
    await docSubscriptions.destroy([collection, id])
    assert.equal($job[collection][id].get(), undefined)
    assert.deepEqual($query.get(), [])
  })

  it('a forced destroy leaves the doc to an owner that subscribed while it closed the transport', async () => {
    // Force removes the owners there when the destroy was called, not one
    // that takes the doc while the destroy awaits (here: as soon as the
    // transport is closed, its subscribe still in flight when the destroy
    // goes on)
    useGcDelay(20)
    const id = nextId('forced_subscribe')
    const kind = `kind_${id}`
    await remoteCreate(id, { kind, name: 'Ann' })
    await readAndRelease({ kind })
    const $owner = root()
    let subscribing
    let armed = true
    const reconcileTransport = docSubscriptions.reconcileTransport
    docSubscriptions.reconcileTransport = function (hash) {
      const reconciled = reconcileTransport.call(this, hash)
      if (hash !== hashOf(id) || !armed) return reconciled
      armed = false
      return reconciled.then(() => { subscribing = sub($owner[collection][id]) })
    }
    restores.push(() => { docSubscriptions.reconcileTransport = reconcileTransport })
    await docSubscriptions.destroy([collection, id])
    docSubscriptions.reconcileTransport = reconcileTransport
    const $doc = await subscribing
    const shareDoc = getConnection().collections[collection][id]
    assert.ok(shareDoc?.subscribed, 'the owner\'s subscription stays')
    assert.equal(countRuntimeListeners(shareDoc), 5, 'one runtime follows the doc')
    const version = await remoteOp(id, [{ p: ['name'], od: 'Ann', oi: 'Bob' }])
    await waitFor(() => $doc.name.get() === 'Bob', 'the owner sees the server\'s op')
    assert.ok(getConnection().collections[collection][id].version >= version)
  })

  it('a runtime destroyed while an owner\'s subscribe on it is in flight never comes back: the owner gets a new one', async () => {
    // No destroy path ends a runtime an owner is subscribing on (a destroy
    // stops for an owner that took the doc since it was called, and one that
    // finds a transition in flight leaves the doc to it); a runtime that is
    // destroyed all the same must stay ended
    useGcDelay(20)
    const id = nextId('destroyed_subscribing')
    const kind = `kind_${id}`
    await remoteCreate(id, { kind, name: 'Ann' })
    await readAndRelease({ kind })
    const runtime = docSubscriptions.docs.get(hashOf(id))
    const subscribeReply = holdReplies(message => message?.a === 's' && message.c === collection && message.d === id)
    const subscribing = sub(root()[collection][id])
    await subscribeReply.reached
    const destroyed = docSubscriptions.destroyRuntime(hashOf(id), runtime)
    // ShareDB's destroy waits for the subscribe reply, then unsubscribes the
    // doc; a query takes the doc before that unsubscribe is answered (the
    // holders don't nest: the second one starts once the first delivered)
    subscribeReply.deliver()
    const unsubscribeReply = holdReplies(message => message?.a === 'u' && message.c === collection && message.d === id)
    await unsubscribeReply.reached
    const $query = await sub(root()[collection], { kind })
    assert.deepEqual($query.getIds(), [id])
    unsubscribeReply.deliver()
    const $doc = await subscribing
    await destroyed
    await waitFor(() => docSubscriptions.entries.get(hashOf(id))?.mode === 'subscribe', 'the owner is subscribed')
    assert.ok(runtime.detached)
    assert.equal(runtime._shareDoc, undefined, 'the ended runtime follows no ShareDB doc')
    assert.notEqual(docSubscriptions.docs.get(hashOf(id)), runtime)
    const shareDoc = getConnection().collections[collection][id]
    assert.ok(shareDoc?.subscribed)
    assert.equal(countRuntimeListeners(shareDoc), 5, 'one runtime follows the doc')
    const version = await remoteOp(id, [{ p: ['name'], od: 'Ann', oi: 'Bob' }])
    await waitFor(() => $doc.name.get() === 'Bob', 'the owner sees the server\'s op')
    assert.ok(getConnection().collections[collection][id].version >= version)
  })

  for (const at of ['with', 'inside']) {
    it(`a doc deleted ${DESTROY_POINTS[at]} reads as deleted for an owner that takes it then`, async () => {
      // the runtime the destroy detached hears no `del`: the new runtime finds
      // ShareDB's doc deleted, and the tree must not show its old data
      useGcDelay(20)
      const id = nextId(`deleted_${at}`)
      const kind = `kind_${id}`
      await remoteCreate(id, { kind, name: 'Ann' })
      await readAndRelease({ kind })
      const $owner = root()
      let deleted
      let subscribed
      const taken = onDestroy(id, at, () => {
        deleted = $[collection][id].del()
        subscribed = sub($owner[collection][id])
      })
      await docSubscriptions.flushPendingDestroys()
      await taken
      await deleted
      const $doc = await subscribed
      assert.equal($doc.get(), undefined)
      assert.equal(getRaw([collection, id]), undefined)
      assert.equal(await remoteData(id), undefined, 'deleted on the server')
    })
  }

  it('a doc whose data became null while nothing followed it reads as without data for an owner that takes it', async () => {
    useGcDelay(20)
    const id = nextId('null_load')
    const kind = `kind_${id}`
    await remoteCreate(id, { kind, name: 'Ann' })
    await readAndRelease({ kind })
    await remoteOp(id, [{ p: [], od: await remoteData(id), oi: null }])
    const $owner = root()
    let subscribed
    const taken = onDestroy(id, 'after', () => { subscribed = sub($owner[collection][id]) })
    await docSubscriptions.flushPendingDestroys()
    await taken
    const $doc = await subscribed
    assert.equal($doc.get(), undefined)
    assert.equal(getRaw([collection, id]), undefined)
  })

  it('a destroy waiting for the doc\'s pending ops hands over to the destroy a release scheduled meanwhile', async () => {
    // The GC destroy closes the transport (it awaits the unsubscribe), finds
    // the doc's op in flight and would wait for it as a pending destroy. A
    // query took the doc and let it go meanwhile, which scheduled a pending
    // destroy of its own: that one goes on for both, and the release settles
    useGcDelay(100)
    const id = nextId('handover')
    await remoteCreate(id, { name: 'Ann', score: 0 })
    const $doc = await sub(root()[collection][id])
    const acks = holdOpAcks(id)
    const written = $doc.score.set(1)
    await unsub($doc)
    const unsubscribed = holdReplies(message => message?.a === 'u' && message.c === collection && message.d === id)
    const flushed = docSubscriptions.flushPendingDestroys()
    await unsubscribed.reached
    docSubscriptions.retainSegments([collection, id])
    let released = false
    const release = docSubscriptions.release($doc).then(() => { released = true })
    unsubscribed.deliver()
    await flushed
    acks.deliver()
    await written
    await waitFor(() => released, 'the release settles')
    await release
    await waitFor(() => !docSubscriptions.entries.has(hashOf(id)), 'the doc is destroyed')
    assertNoRuntimeLeft(id)
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
