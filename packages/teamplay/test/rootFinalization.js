import { before, beforeEach, afterEach, describe, it } from 'mocha'
import { strict as assert } from 'node:assert'
import { getRootSignal } from '../index.js'
import connect from '../connect/test.js'
import { aggregationSubscriptions } from '../orm/Aggregation.js'
import { docSubscriptions } from '../orm/Doc.js'
import { getConnection } from '../orm/connection.js'
import { del as _del } from '../orm/dataTree.js'
import { __resetModelEventsForTests } from '../orm/Compat/modelEvents.js'
import { __resetRefLinksForTests } from '../orm/Compat/refRegistry.js'
import { getPrivateDataRawRoot } from '../orm/privateData.js'
import { HASH as QUERY_HASH, querySubscriptions } from '../orm/Query.js'
import { __resetPendingRootDisposesForTests } from '../orm/disposeRootContext.js'
import {
  __getRootContextForTests,
  __resetRootContextsForTests
} from '../orm/rootContext.js'
import { getSubscriptionGcDelay, setSubscriptionGcDelay } from '../orm/subscriptionGcDelay.js'
import { runGc } from './_helpers.js'

before(connect)

const describeCompat = process.env.TEAMPLAY_COMPAT === '1' ? describe : describe.skip
const QUERY_COLLECTION = 'rootFinalizationQueries'

describe('root finalization', () => {
  let prevSubscriptionGcDelay

  beforeEach(() => {
    prevSubscriptionGcDelay = getSubscriptionGcDelay()
    setSubscriptionGcDelay(0)
  })

  afterEach(async () => {
    await docSubscriptions.clear()
    await querySubscriptions.clear()
    await aggregationSubscriptions.clear()
    _del([QUERY_COLLECTION])
    await destroyConnectionCollection(QUERY_COLLECTION)
    __resetRefLinksForTests()
    __resetModelEventsForTests()
    __resetPendingRootDisposesForTests()
    __resetRootContextsForTests()
    setSubscriptionGcDelay(prevSubscriptionGcDelay)
  })

  it('disposes forgotten root private data after GC', async () => {
    const rootId = 'fr-forgotten-root'

    await (async () => {
      const $root = getRootSignal({ rootId })
      await $root._session.userId.set('user-a')
      assert.equal($root._session.userId.get(), 'user-a')
      assert.ok(__getRootContextForTests(rootId))
      assert.ok(getPrivateDataRawRoot(rootId))
    })()

    await waitForDisposed(rootId)

    assert.equal(__getRootContextForTests(rootId), undefined)
    assert.equal(getPrivateDataRawRoot(rootId), undefined)
  })

  it('keeps root alive while a child signal is still strongly referenced', async () => {
    const rootId = 'fr-child-root'
    let $child

    await (async () => {
      const $root = getRootSignal({ rootId })
      await $root._session.userId.set('user-a')
      $child = $root._session.userId
    })()

    await runGc()
    assert.ok(__getRootContextForTests(rootId))
    assert.equal($child.get(), 'user-a')

    $child = undefined
    await waitForDisposed(rootId)

    assert.equal(__getRootContextForTests(rootId), undefined)
    assert.equal(getPrivateDataRawRoot(rootId), undefined)
  })

  it('disposes only the collected root and keeps sibling root alive', async () => {
    const rootIdA = 'fr-sibling-root-A'
    const rootIdB = 'fr-sibling-root-B'
    let $rootB = getRootSignal({ rootId: rootIdB })

    await (async () => {
      const $rootA = getRootSignal({ rootId: rootIdA })
      await $rootA._session.userId.set('user-a')
      await $rootB._session.userId.set('user-b')
      assert.equal($rootB._session.userId.get(), 'user-b')
    })()

    await waitForDisposed(rootIdA)

    const contextB = __getRootContextForTests(rootIdB)
    assert.equal(__getRootContextForTests(rootIdA), undefined)
    assert.ok(contextB)
    assert.equal(contextB.getPrivateDataAt(['_session', 'userId']), 'user-b')

    $rootB = undefined
    await waitForDisposed(rootIdB)
  })

  describeCompat('compat finalization', () => {
    it('keeps explicit close idempotent even if GC runs afterwards', async () => {
      const rootId = 'fr-explicit-close-root'
      let $root = getRootSignal({ rootId })

      await $root._session.userId.set('user-a')
      await closeSignal($root)

      assert.equal(__getRootContextForTests(rootId), undefined)

      $root = undefined
      await runGc()

      assert.equal(__getRootContextForTests(rootId), undefined)
      assert.equal(getPrivateDataRawRoot(rootId), undefined)
    })

    it('keeps shared query transport alive for sibling root when one root is GC cleaned', async () => {
      const rootIdA = 'fr-query-root-A'
      const rootIdB = 'fr-query-root-B'
      let $rootA = getRootSignal({ rootId: rootIdA })
      const $rootB = getRootSignal({ rootId: rootIdB })

      await $rootA[QUERY_COLLECTION]._1.set({ name: 'One', active: true })
      await $rootA._session.marker.set('root-a')

      let $queryA = $rootA.query(QUERY_COLLECTION, { active: true })
      const $queryB = $rootB.query(QUERY_COLLECTION, { active: true })

      await $queryA.subscribe()
      await $queryB.subscribe()

      const transportHash = $queryA[QUERY_HASH]
      assert.equal(querySubscriptions.transportSubCount.get(transportHash), 2)

      $queryA = undefined
      $rootA = undefined

      await waitForDisposed(rootIdA)

      assert.equal(__getRootContextForTests(rootIdA), undefined)
      assert.equal(getPrivateDataRawRoot(rootIdA), undefined)
      assert.equal(querySubscriptions.transportSubCount.get(transportHash), 1)
      assert.deepEqual($queryB.getIds(), ['_1'])
      assert.ok(__getRootContextForTests(rootIdB))

      await closeSignal($rootB)
    })
  })
})

function closeSignal ($signal) {
  return new Promise((resolve, reject) => {
    const result = $signal.close(err => (err ? reject(err) : resolve()))
    assert.equal(result, undefined)
  })
}

async function waitForDisposed (rootId, iterations = 8) {
  for (let i = 0; i < iterations; i++) {
    await runGc()
    if (!__getRootContextForTests(rootId)) return
  }
  assert.fail(`Expected root context ${rootId} to be disposed`)
}

async function destroyConnectionCollection (collectionName) {
  const docs = getConnection().collections?.[collectionName] || {}
  for (const docId of Object.keys(docs)) {
    const doc = docs[docId]
    if (!doc) continue
    await new Promise((resolve, reject) => {
      doc.destroy(err => (err ? reject(err) : resolve()))
    })
  }
}
