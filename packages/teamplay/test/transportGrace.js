// Transport grace for doc, query and aggregation subscriptions, through the
// public sub()/unsub() API against a real (in-process) ShareDB backend.
//
// When the last owner releases a live subscription, the ShareDB transport
// (not only the local data) stays subscribed for the subscription GC delay.
// A re-subscribe inside that window adopts it: sub() returns the signal
// synchronously and nothing is sent over the wire.
import { it, describe, before, afterEach } from 'mocha'
import { strict as assert } from 'node:assert'
import { $, sub, unsub } from '../src/index.ts'
import { getConnection } from '../src/orm/connection.ts'
import { docSubscriptions } from '../src/orm/Doc.js'
import { querySubscriptions, hashQuery } from '../src/orm/Query.js'
import { aggregationSubscriptions } from '../src/orm/Aggregation.js'
import { getRootSignal } from '../src/orm/Root.ts'
import { setSubscriptionGcDelay } from '../src/orm/subscriptionGcDelay.ts'
import { assertDocSubscriptionsConsistent, assertQuerySubscriptionsConsistent } from './_subscriptionAssertions.js'
import connect from '../src/connect/test.js'

before(connect)

const WIRE_ACTIONS = new Set(['s', 'u', 'f', 'bs', 'bu', 'bf', 'qs', 'qu', 'qf'])
let remoteConnection
let keyCounter = 0

function getRemoteConnection () {
  remoteConnection ??= getConnection().agent.backend.connect()
  return remoteConnection
}

function cbPromise (fn) {
  return new Promise((resolve, reject) => {
    fn((err, result) => err ? reject(err) : resolve(result))
  })
}

function wait (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitUntil (predicate, message, timeoutMs = 1000) {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) assert.fail(message)
    await wait(5)
  }
}

async function flushAllPendingDestroys () {
  await docSubscriptions.flushPendingDestroys()
  await querySubscriptions.flushPendingDestroys()
  await aggregationSubscriptions.flushPendingDestroys()
}

function isThenable (value) {
  return !!value && typeof value.then === 'function'
}

// Records subscription traffic the local client sends to the server.
function recordWire () {
  const connection = getConnection()
  const messages = []
  const listener = message => {
    if (WIRE_ACTIONS.has(message.a)) messages.push(message.a)
  }
  connection.on('send', listener)
  return {
    messages,
    stop () { connection.off('send', listener) }
  }
}

async function createRemoteDoc (collection, id, data) {
  const doc = getRemoteConnection().get(collection, id)
  await cbPromise(cb => doc.fetch(cb))
  if (doc.type) await cbPromise(cb => doc.del(cb))
  await cbPromise(cb => doc.create(data, cb))
}

async function setRemoteField (collection, id, field, value) {
  const doc = getRemoteConnection().get(collection, id)
  await cbPromise(cb => doc.fetch(cb))
  await cbPromise(cb => doc.submitOp([{ p: [field], od: doc.data[field], oi: value }], cb))
}

const KINDS = [
  {
    kind: 'doc',
    collection: 'transportGraceDocs',
    manager: docSubscriptions,
    subscribeAction: 's',
    unsubscribeAction: 'u',
    fetchAction: 'f',
    async setup (key) {
      await createRemoteDoc(this.collection, key, { name: 'initial', grp: key })
      return { key }
    },
    sub ($root, ctx, options) {
      const $doc = $root[this.collection][ctx.key]
      return options ? sub($doc, options) : sub($doc)
    },
    read ($doc) { return $doc.name.get() },
    expected () { return 'initial' },
    async remoteChange (ctx) { await setRemoteField(this.collection, ctx.key, 'name', 'changed') },
    sawRemoteChange (ctx) { return getConnection().get(this.collection, ctx.key).data?.name === 'changed' },
    runtime (ctx) { return docSubscriptions.docs.get(JSON.stringify([this.collection, ctx.key])) },
    isLive (ctx) { return !!getConnection().get(this.collection, ctx.key).subscribed },
    destroy (ctx) { return docSubscriptions.destroy([this.collection, ctx.key]) }
  },
  {
    kind: 'query',
    collection: 'transportGraceQueries',
    manager: querySubscriptions,
    subscribeAction: 'qs',
    unsubscribeAction: 'qu',
    fetchAction: 'qf',
    params (ctx) { return { grp: ctx.key } },
    async setup (key) {
      await createRemoteDoc(this.collection, key + '_1', { name: 'first', grp: key })
      return { key }
    },
    sub ($root, ctx, options) { return sub($root[this.collection], this.params(ctx), options) },
    read ($query) { return $query.getIds().slice().sort() },
    expected (ctx) { return [ctx.key + '_1'] },
    async remoteChange (ctx) { await createRemoteDoc(this.collection, ctx.key + '_2', { name: 'second', grp: ctx.key }) },
    sawRemoteChange (ctx) { return this.runtime(ctx)?.shareQuery?.results?.length === 2 },
    runtime (ctx) { return querySubscriptions.queries.get(hashQuery(this.collection, this.params(ctx))) },
    isLive (ctx) {
      const runtime = this.runtime(ctx)
      return !!runtime?.shareQuery && runtime.activeTransportMode === 'subscribe'
    },
    destroy (ctx) { return querySubscriptions.destroy(this.collection, this.params(ctx)) }
  },
  {
    kind: 'aggregation',
    collection: 'transportGraceAggregations',
    manager: aggregationSubscriptions,
    subscribeAction: 'qs',
    unsubscribeAction: 'qu',
    fetchAction: 'qf',
    params (ctx) { return { $aggregate: [{ $match: { grp: ctx.key } }] } },
    async setup (key) {
      await createRemoteDoc(this.collection, key + '_1', { name: 'first', grp: key })
      return { key }
    },
    sub ($root, ctx, options) { return sub($root[this.collection], this.params(ctx), options) },
    read ($aggregation) { return $aggregation.get().map(row => row._id).sort() },
    expected (ctx) { return [ctx.key + '_1'] },
    async remoteChange (ctx) { await createRemoteDoc(this.collection, ctx.key + '_2', { name: 'second', grp: ctx.key }) },
    sawRemoteChange (ctx) { return this.runtime(ctx)?.shareQuery?.extra?.length === 2 },
    runtime (ctx) { return aggregationSubscriptions.queries.get(hashQuery(this.collection, this.params(ctx))) },
    isLive (ctx) {
      const runtime = this.runtime(ctx)
      return !!runtime?.shareQuery && runtime.activeTransportMode === 'subscribe'
    },
    destroy (ctx) { return aggregationSubscriptions.destroy(this.collection, this.params(ctx)) }
  }
]

for (const K of KINDS) {
  describe(`${K.kind}: transport grace through sub()/unsub()`, () => {
    let wire
    const pending = []

    async function setup () {
      keyCounter += 1
      return K.setup(`${K.kind}_grace_${keyCounter}`)
    }

    afterEach(async () => {
      wire?.stop()
      wire = undefined
      setSubscriptionGcDelay(0)
      await flushAllPendingDestroys()
      await Promise.allSettled(pending.splice(0))
      await flushAllPendingDestroys()
      assertDocSubscriptionsConsistent(docSubscriptions)
      assertQuerySubscriptionsConsistent(querySubscriptions)
      assertQuerySubscriptionsConsistent(aggregationSubscriptions)
      // A failed test may leave owners behind; don't let them leak into the next one.
      await docSubscriptions.clear()
      await querySubscriptions.clear()
      await aggregationSubscriptions.clear()
    })

    it('re-subscribe in the same tick after releasing the last owner is synchronous and wire-free', async () => {
      setSubscriptionGcDelay(60_000)
      const ctx = await setup()
      const $first = await K.sub($, ctx)
      const runtime = K.runtime(ctx)
      wire = recordWire()

      pending.push(unsub($first))
      const result = K.sub($, ctx)

      assert.equal(isThenable(result), false, 'sub() must return the signal synchronously during the grace')
      assert.deepEqual(K.read(result), K.expected(ctx), 'data is intact')
      assert.equal(K.runtime(ctx), runtime, 'the runtime is adopted')
      await wait(10)
      assert.deepEqual(wire.messages, [], 'no subscription traffic for the release + re-subscribe')
      assert.equal(K.isLive(ctx), true, 'the transport is still live')

      pending.push(unsub(result))
    })

    it('a release that leaves other owners does not make the next sub() asynchronous (bug A)', async () => {
      setSubscriptionGcDelay(60_000)
      const ctx = await setup()
      const $first = await K.sub($, ctx)
      const $second = await K.sub($, ctx)
      wire = recordWire()

      pending.push(unsub($second))
      const result = K.sub($, ctx)

      assert.equal(isThenable(result), false, 'a no-op reconcile must not put the entry into transition')
      assert.deepEqual(K.read(result), K.expected(ctx))
      await wait(10)
      assert.deepEqual(wire.messages, [])
      pending.push(unsub(result), unsub($first))
    })

    it('unsub() of the last owner resolves at release, not when the GC delay expires (bug C)', async () => {
      setSubscriptionGcDelay(60_000)
      const ctx = await setup()
      const $first = await K.sub($, ctx)

      const releasePromise = unsub($first)
      pending.push(releasePromise)
      const outcome = await Promise.race([
        Promise.resolve(releasePromise).then(() => 'released'),
        wait(200).then(() => 'still pending')
      ])

      assert.equal(outcome, 'released')
      assert.equal(K.isLive(ctx), true, 'resolving unsub() does not tear the lingering transport down')
    })

    it('finalizing a leaked signal does not destroy a newer owner of the same path (bug D)', async () => {
      setSubscriptionGcDelay(50)
      const ctx = await setup()
      let $leaked = await K.sub($, ctx)
      const leakedRef = new WeakRef($leaked)
      $leaked = undefined
      await wait(0)

      // Re-acquire the path in the same tick as the GC that collected the leaked
      // proxy, so its finalizer is still queued when the new owner subscribes.
      let $fresh
      for (let i = 0; i < 20 && !$fresh; i++) {
        global.gc()
        if (!leakedRef.deref()) {
          $fresh = K.sub($, ctx)
          break
        }
        await wait(5)
      }
      if (!$fresh) assert.fail('the leaked signal was not collected; the scenario could not be set up')
      $fresh = await $fresh

      await wait(250) // the leaked signal's finalizer and any delayed cleanup it schedules
      assert.equal(K.isLive(ctx), true, 'the newer owner keeps its live transport')
      assert.deepEqual(K.read($fresh), K.expected(ctx), 'the newer owner keeps its data')
      pending.push(unsub($fresh))
    })

    it('keeps the transport live for the GC delay after the last release, then tears it down once', async () => {
      setSubscriptionGcDelay(150)
      const ctx = await setup()
      const $first = await K.sub($, ctx)
      wire = recordWire()

      pending.push(unsub($first))
      await wait(20)

      assert.deepEqual(wire.messages, [], 'no unsubscribe is sent during the grace')
      assert.equal(K.isLive(ctx), true, 'transport stays subscribed during the grace')

      await K.remoteChange(ctx)
      await waitUntil(() => K.sawRemoteChange(ctx), 'the lingering transport keeps receiving remote ops')

      await waitUntil(() => !K.runtime(ctx), 'runtime is destroyed after the grace', 1000)
      assert.deepEqual(wire.messages, [K.unsubscribeAction], 'exactly one transport teardown after the grace')
      assert.equal(K.isLive(ctx), false)
    })

    it('re-subscribe in the middle of the grace cancels the teardown; the next release starts a fresh delay', async () => {
      setSubscriptionGcDelay(300)
      const ctx = await setup()
      const $first = await K.sub($, ctx)
      const runtime = K.runtime(ctx)
      wire = recordWire()

      pending.push(unsub($first))
      await wait(100)
      const $second = K.sub($, ctx)
      assert.equal(isThenable($second), false, 'adoption in the middle of the grace is synchronous')
      assert.deepEqual(K.read($second), K.expected(ctx))

      await wait(300) // past the first release's deadline
      assert.equal(K.runtime(ctx), runtime, 'the cancelled timer did not destroy the runtime')
      assert.equal(K.isLive(ctx), true)
      assert.deepEqual(wire.messages, [], 'no wire traffic for the adoption')

      pending.push(unsub($second))
      await wait(150) // half of the fresh delay
      assert.equal(K.isLive(ctx), true, 'the second release starts a fresh grace')
      assert.deepEqual(wire.messages, [])

      await waitUntil(() => !K.runtime(ctx), 'runtime is destroyed after the fresh grace', 1000)
      assert.deepEqual(wire.messages, [K.unsubscribeAction])
    })

    it('keeps zero-delay teardown immediate', async () => {
      setSubscriptionGcDelay(0)
      const ctx = await setup()
      const $first = await K.sub($, ctx)
      wire = recordWire()

      await unsub($first)

      assert.deepEqual(wire.messages, [K.unsubscribeAction])
      assert.equal(K.runtime(ctx), undefined)
      assert.equal(K.isLive(ctx), false)
      const result = K.sub($, ctx)
      assert.equal(isThenable(result), true, 'a fresh subscribe is asynchronous')
      pending.push(Promise.resolve(result).then(unsub))
      await result
    })

    it('keeps fetch transports eager and refetches on a quick new owner', async () => {
      setSubscriptionGcDelay(60_000)
      const ctx = await setup()
      const $first = await K.sub($, ctx, { mode: 'fetch' })
      wire = recordWire()

      pending.push(unsub($first))
      await wait(10)
      assert.equal(K.isLive(ctx), false, 'a completed fetch has no live transport to keep')

      const result = K.sub($, ctx, { mode: 'fetch' })
      assert.equal(isThenable(result), true, 'a new fetch owner must fetch again')
      await result
      assert.deepEqual(wire.messages.filter(action => action === K.fetchAction), [K.fetchAction])
      pending.push(unsub(await result))
    })

    it('explicit destroy tears a lingering transport down immediately', async () => {
      setSubscriptionGcDelay(60_000)
      const ctx = await setup()
      const $first = await K.sub($, ctx)
      wire = recordWire()

      pending.push(unsub($first))
      await wait(10)
      await K.destroy(ctx)

      assert.deepEqual(wire.messages, [K.unsubscribeAction])
      assert.equal(K.isLive(ctx), false)
      assert.equal(K.runtime(ctx), undefined)
    })

    it('clear() tears a lingering transport down immediately', async () => {
      setSubscriptionGcDelay(60_000)
      const ctx = await setup()
      const $first = await K.sub($, ctx)
      wire = recordWire()

      pending.push(unsub($first))
      await wait(10)
      await K.manager.clear()

      assert.deepEqual(wire.messages, [K.unsubscribeAction])
      assert.equal(K.isLive(ctx), false)
      assert.equal(K.runtime(ctx), undefined)
    })

    it('root close tears down a transport lingering after that root released it', async () => {
      setSubscriptionGcDelay(60_000)
      const ctx = await setup()
      const $root = getRootSignal({ rootId: `transport-grace-close-${keyCounter}`, fetchOnly: false })
      const $first = await K.sub($root, ctx)
      wire = recordWire()

      pending.push(unsub($first))
      await wait(10)
      await $root.close()

      assert.deepEqual(wire.messages, [K.unsubscribeAction])
      assert.equal(K.isLive(ctx), false)
      assert.equal(K.runtime(ctx), undefined)
    })

    it('root close keeps a transport another root still owns', async () => {
      setSubscriptionGcDelay(60_000)
      const ctx = await setup()
      const $rootA = getRootSignal({ rootId: `transport-grace-shared-a-${keyCounter}`, fetchOnly: false })
      const $rootB = getRootSignal({ rootId: `transport-grace-shared-b-${keyCounter}`, fetchOnly: false })
      const $a = await K.sub($rootA, ctx)
      const $b = await K.sub($rootB, ctx)
      wire = recordWire()

      pending.push(unsub($a))
      await $rootA.close()

      assert.deepEqual(wire.messages, [])
      assert.equal(K.isLive(ctx), true)
      assert.deepEqual(K.read($b), K.expected(ctx))
      await $rootB.close()
      assert.deepEqual(wire.messages, [K.unsubscribeAction])
    })
  })
}
