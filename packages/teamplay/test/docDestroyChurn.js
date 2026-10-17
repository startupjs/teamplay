import { afterEach, before, describe, it } from 'mocha'
import { strict as assert } from 'node:assert'
import { getRootSignal, sub, unsub } from '../src/index.ts'
import connect from '../src/connect/test.js'
import { getConnection } from '../src/orm/connection.ts'
import { getRaw } from '../src/orm/dataTree.js'
import { docSubscriptions } from '../src/orm/Doc.js'
import { querySubscriptions } from '../src/orm/Query.js'
import { getSubscriptionGcDelay, setSubscriptionGcDelay } from '../src/orm/subscriptionGcDelay.ts'
import { assertDocSubscriptionsConsistent, assertQuerySubscriptionsConsistent } from './_subscriptionAssertions.js'

before(connect)

// Many roots on one connection over the same docs, as a server's jobs and
// requests: queries and doc subscriptions taken and released all the time, at
// the pace of the subscription GC delay, while another connection replaces
// the docs as a whole and changes their fields. Every job must read every doc
// it lists and write to it; at the end everything is released, and nothing is
// left behind (runtimes, ShareDB docs, listeners).
describe('roots taking and releasing the same docs', () => {
  const collection = 'docDestroyChurnGames'
  let writer
  let prevGcDelay
  let counter = 0

  before(() => {
    writer = getConnection().agent.backend.connect()
    prevGcDelay = getSubscriptionGcDelay()
  })

  afterEach(async () => {
    setSubscriptionGcDelay(prevGcDelay)
    await querySubscriptions.flushPendingDestroys()
    await docSubscriptions.flushPendingDestroys()
    assertDocSubscriptionsConsistent(docSubscriptions)
    assertQuerySubscriptionsConsistent(querySubscriptions)
  })

  for (const gcDelay of [0, 2, 10, 30]) {
    it(`jobs, owners and remote replaces at a GC delay of ${gcDelay} ms`, async function () {
      this.timeout(20000)
      setSubscriptionGcDelay(gcDelay)
      const random = seededRandom(1000 + gcDelay)
      const kind = `kind_${Date.now()}_${++counter}`
      const ids = Array.from({ length: 6 }, (_, i) => `${kind}_${i}`)
      for (const id of ids) await create(id, { kind, name: `doc ${id}`, version: 0 })
      const errors = []
      const jobs = []
      let replaces = 0

      // the version of each doc the server had acknowledged (what a job
      // starting now must read at least)
      const committed = new Map(ids.map(id => [id, 0]))
      // a job: a query listing the docs, a read of each, a write to one
      const job = async n => {
        const expected = new Map(committed)
        const $root = getRootSignal({ rootId: `${kind}_job_${n}` })
        try {
          const $query = await sub($root[collection], { kind })
          assert.deepEqual([...$query.getIds()].sort(), [...ids].sort(), `job ${n} lists every doc`)
          for (const id of ids) {
            const $doc = $root[collection][id]
            assert.ok($doc.name.get(), `job ${n} reads ${id}`)
            await waitFor(() => $doc.version.get() >= expected.get(id), `job ${n} reads ${id} at v${expected.get(id)} or later`)
            assertListenersBounded(id)
          }
          await sleep(random() * gcDelay)
          const id = ids[Math.floor(random() * ids.length)]
          await $root[collection][id][`job${n}`].set(true)
          assert.equal($root[collection][id][`job${n}`].get(), true, `job ${n} reads its write`)
        } finally {
          $root.close()
        }
      }
      // an owner: a doc subscription, held for a while
      const owner = async n => {
        const $root = getRootSignal({ rootId: `${kind}_owner_${n}` })
        const id = ids[Math.floor(random() * ids.length)]
        try {
          const $doc = await sub($root[collection][id])
          assert.ok($doc.name.get(), `owner ${n} reads ${id}`)
          await sleep(random() * gcDelay * 2)
          assert.ok($doc.name.get(), `owner ${n} still reads ${id}`)
          await unsub($doc)
        } finally {
          await $root.close()
        }
      }
      // another process replaces a doc as a whole, keeping the jobs' marks
      const replace = async () => {
        const id = ids[Math.floor(random() * ids.length)]
        const doc = writer.get(collection, id)
        await callback(done => doc.fetch(done))
        const next = { ...doc.data, version: doc.data.version + 1 }
        await callback(done => doc.submitOp([{ p: [], od: doc.data, oi: next }], done))
        committed.set(id, Math.max(committed.get(id), next.version))
        replaces++
      }

      const step = Math.max(gcDelay, 1)
      for (let n = 0; n < 120; n++) {
        const roll = random()
        const task = roll < 0.6 ? job(n) : roll < 0.85 ? owner(n) : replace()
        jobs.push(task.catch(err => errors.push(err)))
        await sleep(random() * step * 1.5)
      }
      await Promise.all(jobs)
      assert.deepEqual(errors.map(err => err.message), [])
      assert.ok(replaces > 0)

      // every root sees what the server has
      const $reader = getRootSignal({ rootId: `${kind}_reader` })
      const $all = await sub($reader[collection], { kind })
      for (const id of ids) {
        const doc = writer.get(collection, id)
        await callback(done => doc.fetch(done))
        await waitFor(() => getConnection().get(collection, id).version >= doc.version, `${id} is up to date`)
        const { _id, ...data } = $reader[collection][id].get()
        assert.deepEqual(data, doc.data, `${id} reads as on the server`)
      }
      assert.equal($all.getIds().length, ids.length)
      await $reader.close()

      // nothing is left once everything is released
      await querySubscriptions.flushPendingDestroys()
      await docSubscriptions.flushPendingDestroys()
      for (const id of ids) {
        assert.equal(docSubscriptions.entries.get(JSON.stringify([collection, id])), undefined, `${id}: no entry`)
        assert.equal(getConnection().collections[collection]?.[id], undefined, `${id}: ShareDB destroyed the doc`)
        assert.equal(getRaw([collection, id]), undefined, `${id}: not in the data tree`)
      }
    })
  }

  // one runtime's listeners at most on the connection's ShareDB doc
  function assertListenersBounded (id) {
    const shareDoc = getConnection().collections[collection]?.[id]
    if (!shareDoc) return
    for (const event of ['load', 'create', 'del', 'op', 'error']) {
      assert.ok(shareDoc.listenerCount(event) <= 1, `${id}: ${shareDoc.listenerCount(event)} '${event}' listeners`)
    }
  }

  async function create (id, data) {
    await callback(done => writer.get(collection, id).create(data, done))
  }
})

// mulberry32
function seededRandom (seed) {
  return () => {
    seed |= 0
    seed = seed + 0x6D2B79F5 | 0
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
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
