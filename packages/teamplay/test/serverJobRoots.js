import { afterEach, before, describe, it } from 'mocha'
import { strict as assert } from 'node:assert'
import { getRootSignal, sub } from '../src/index.ts'
import connect from '../src/connect/test.js'
import { getConnection } from '../src/orm/connection.ts'
import { docSubscriptions } from '../src/orm/Doc.js'
import { querySubscriptions } from '../src/orm/Query.js'
import { getSubscriptionGcDelay, setSubscriptionGcDelay } from '../src/orm/subscriptionGcDelay.ts'
import { assertDocSubscriptionsConsistent, assertQuerySubscriptionsConsistent } from './_subscriptionAssertions.js'

before(connect)

// A server process that runs jobs on its one connection, a new root per job
// closed (not awaited) when the job ends, as a worker does. The docs a job's
// query read stay for the subscription GC delay without a subscription of
// their own: the next job's query takes them and gets the ops they missed.
// Writes come from another connection (the web server). Regression tests from
// an app (a report job read 6 students out of 126 after a lesson's roster was
// replaced; a job's write failed on a doc dropped as its query listed it).
describe('jobs on a server connection, one root per job', () => {
  const collection = 'serverJobRootsStores'
  let web
  let prevGcDelay
  let counter = 0

  before(() => {
    web = getConnection().agent.backend.connect()
  })

  afterEach(async () => {
    setSubscriptionGcDelay(prevGcDelay)
    await querySubscriptions.flushPendingDestroys()
    await docSubscriptions.flushPendingDestroys()
    assertDocSubscriptionsConsistent(docSubscriptions)
    assertQuerySubscriptionsConsistent(querySubscriptions)
  })

  function useGcDelay (delay) {
    prevGcDelay = getSubscriptionGcDelay()
    setSubscriptionGcDelay(delay)
  }

  function newRoot () {
    return getRootSignal({ rootId: `serverJobRoots_${Date.now()}_${++counter}` })
  }

  async function runJob (read) {
    const $root = newRoot()
    try {
      return await read($root)
    } finally {
      $root.close()
    }
  }

  const create = data => callback(done => web.get(collection, data.id).create(data, done))

  // another process writes. A process subscribed to the doc gets the op
  // (`received` waits for it); one that only keeps the doc from an earlier
  // job gets it when the next job subscribes: the ops since its version
  async function write (id, op, received) {
    const doc = web.get(collection, id)
    await callback(done => doc.fetch(done))
    await callback(done => doc.submitOp(op, done))
    if (received) await waitFor(() => received(getConnection().collections[collection]?.[id]?.data), 'the op reaches this process')
  }

  // a lesson's roster (its `_none` store)
  function lessonStore (lessonId, fields) {
    return { id: `${lessonId}_none`, scope: 'lesson', entity: 'none', entityId: 'none', scopeId: lessonId, ...fields }
  }

  function rosterQuery (lessonId) {
    return { scope: 'lesson', entity: 'none', scopeId: { $in: [lessonId] }, entityId: 'none', userIds: { $exists: true } }
  }

  function readRosters (lessonId) {
    return async $root => (await sub($root[collection], rosterQuery(lessonId))).get()
      .map(({ userIds, startedAt }) => ({ userIds, startedAt }))
  }

  // the whole doc replaced, as setReplace() on the doc signal sends it
  function replaceOp (previous, next) {
    return [{ p: [], od: previous, oi: next }]
  }

  describe('reads stay fresh', () => {
    it('a job right after a student joins the lesson reads them', async () => {
      useGcDelay(3000)
      await create(lessonStore('fresh-reads-join', { userIds: ['ana', 'ben'] }))
      const read = readRosters('fresh-reads-join')
      assert.deepEqual(await runJob(read), [{ userIds: ['ana', 'ben'], startedAt: undefined }])
      await write('fresh-reads-join_none', [{ p: ['userIds', 2], li: 'chen' }])
      assert.deepEqual(await runJob(read), [{ userIds: ['ana', 'ben', 'chen'], startedAt: undefined }])
    })

    it('a job right after another process replaced the whole doc reads it, and the writes after it', async () => {
      useGcDelay(3000)
      const before = lessonStore('fresh-reads-replace', { userIds: ['ana', 'ben'], startedAt: 1 })
      await create(before)
      const read = readRosters('fresh-reads-replace')
      assert.deepEqual(await runJob(read), [{ userIds: ['ana', 'ben'], startedAt: 1 }])
      // a reseed: one more student, and no startedAt
      const after = lessonStore('fresh-reads-replace', { userIds: ['ana', 'ben', 'chen'] })
      await write('fresh-reads-replace_none', replaceOp(before, after))
      assert.deepEqual(await runJob(read), [{ userIds: ['ana', 'ben', 'chen'], startedAt: undefined }])
      // the next job, joining the query this one left, after one more write
      await write('fresh-reads-replace_none', [{ p: ['userIds', 3], li: 'dee' }])
      assert.deepEqual(await runJob(read), [{ userIds: ['ana', 'ben', 'chen', 'dee'], startedAt: undefined }])
    })

    it('a job reads a replaced doc while another job still holds the query', async () => {
      useGcDelay(3000)
      const before = lessonStore('fresh-reads-held', { userIds: ['ana'] })
      await create(before)
      // a long job (or a hook) holds the query all along
      const $holder = newRoot()
      try {
        const $held = await sub($holder[collection], rosterQuery('fresh-reads-held'))
        const after = lessonStore('fresh-reads-held', { userIds: ['ana', 'ben'] })
        await write('fresh-reads-held_none', replaceOp(before, after), data => data.userIds.length === 2)
        assert.deepEqual(await runJob(readRosters('fresh-reads-held')), [{ userIds: ['ana', 'ben'], startedAt: undefined }])
        assert.deepEqual($held.get().map(store => store.userIds), [['ana', 'ben']])
      } finally {
        await $holder.close()
      }
    })

    it('a root subscribed all along sees the replace and the writes after it, through the doc and the query', async () => {
      useGcDelay(3000)
      const before = lessonStore('fresh-reads-live', { userIds: ['ana'], startedAt: 1 })
      await create(before)
      const $root = newRoot()
      try {
        const $store = await sub($root[collection]['fresh-reads-live_none'])
        const $stores = await sub($root[collection], rosterQuery('fresh-reads-live'))
        const after = lessonStore('fresh-reads-live', { userIds: ['ana', 'ben'] })
        await write('fresh-reads-live_none', replaceOp(before, after), data => data.userIds.length === 2)
        assert.deepEqual($store.userIds.get(), ['ana', 'ben'])
        assert.equal($store.startedAt.get(), undefined)
        await write('fresh-reads-live_none', [{ p: ['startedAt'], oi: 2 }], data => data.startedAt === 2)
        assert.equal($store.startedAt.get(), 2)
        assert.deepEqual($stores.get().map(({ userIds, startedAt }) => ({ userIds, startedAt })), [{ userIds: ['ana', 'ben'], startedAt: 2 }])
      } finally {
        await $root.close()
      }
    })

    it('a job right after this process replaced the whole doc reads it', async () => {
      useGcDelay(3000)
      await create(lessonStore('fresh-reads-local', { userIds: ['ana'], startedAt: 1 }))
      const read = readRosters('fresh-reads-local')
      assert.deepEqual(await runJob(read), [{ userIds: ['ana'], startedAt: 1 }])
      await runJob(async $root => {
        const $store = await sub($root[collection]['fresh-reads-local_none'])
        await $store.setReplace(lessonStore('fresh-reads-local', { userIds: ['ana', 'ben'] }))
      })
      assert.deepEqual(await runJob(read), [{ userIds: ['ana', 'ben'], startedAt: undefined }])
    })
  })

  // A job that runs when another job's docs are being dropped (its trailing
  // run starts after a throttle as long as the GC delay): its query lists a
  // doc while teamplay destroys it. `duringDrop(id, run)` starts `run({ listed })`
  // as the doc's runtime is destroyed, and lets the destroy go on once the
  // run's query listed the doc: the run's query takes the doc before
  // ShareDB's destroy starts, as when that destroy waits behind the one
  // before it.
  describe('a doc dropped while a job lists it', () => {
    function duringDrop (id, run) {
      const DocClass = docSubscriptions.DocClass
      const destroy = DocClass.prototype.destroy
      let started
      return new Promise((resolve, reject) => {
        DocClass.prototype.destroy = async function () {
          if (this.collection === collection && this.docId === id && !started) {
            DocClass.prototype.destroy = destroy
            let listed
            const isListed = new Promise(resolve => { listed = resolve })
            started = run({ listed })
            started.then(resolve, reject)
            await isListed
          }
          return await destroy.call(this)
        }
      }).finally(() => {
        DocClass.prototype.destroy = destroy
      })
    }

    const STORE_ID = 'dropped-doc-survey_none'
    const STAGE_STORES_QUERY = { scope: 'stage', entity: 'none', scopeId: { $in: ['dropped-doc-roles', 'dropped-doc-survey'] }, entityId: 'none' }

    it('a job that lists a store while teamplay drops it writes to it', async () => {
      useGcDelay(50)
      // a job: a new root, the stages' stores queried, then (after the job's
      // other reads) the survey marked
      const run = ({ listed } = {}) => runJob(async $root => {
        await sub($root[collection], STAGE_STORES_QUERY)
        listed?.()
        await new Promise(resolve => setTimeout(resolve, 10))
        await $root[collection][STORE_ID].demoUserAnswersEntered.setReplace(true)
      })
      const $webStore = web.get(collection, STORE_ID)
      await callback(done => $webStore.create({ scope: 'stage', entity: 'none', scopeId: 'dropped-doc-survey', entityId: 'none' }, done))
      await run()
      // the mark is cleared
      await callback(done => $webStore.submitOp([{ p: ['demoUserAnswersEntered'], od: true }], done))

      // the next job's query lists the store as teamplay drops it
      await duringDrop(STORE_ID, run)
      await callback(done => $webStore.fetch(done))
      assert.equal($webStore.data.demoUserAnswersEntered, true)
    })

    it('a user dropped as a job queries it is listed and readable', async () => {
      useGcDelay(50)
      const userId = 'dropped-doc-robot'
      const query = { _id: { $in: [userId, 'dropped-doc-student'] }, robot: true }
      const run = ({ listed } = {}) => runJob(async $root => {
        const $robots = await sub($root[collection], query)
        listed?.()
        await new Promise(resolve => setTimeout(resolve, 10))
        return { listed: $robots.getIds(), readable: Boolean($root[collection][userId].robot.get()) }
      })
      await callback(done => web.get(collection, userId).create({ robot: true, name: 'demo1' }, done))
      assert.deepEqual(await run(), { listed: [userId], readable: true })
      assert.deepEqual(await duringDrop(userId, run), { listed: [userId], readable: true })
      assert.deepEqual(await run(), { listed: [userId], readable: true })
    })
  })
})

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
