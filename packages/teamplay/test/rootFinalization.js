import { before, beforeEach, afterEach, describe, it } from 'mocha'
import { strict as assert } from 'node:assert'
import { getRootSignal, sub } from '../src/index.ts'
import { assertDocSubscriptionsConsistent, assertQuerySubscriptionsConsistent } from './_subscriptionAssertions.js'
import connect from '../src/connect/test.js'
import { aggregationSubscriptions } from '../src/orm/Aggregation.js'
import { docSubscriptions } from '../src/orm/Doc.js'
import { getConnection } from '../src/orm/connection.ts'
import { del as _del } from '../src/orm/dataTree.js'
import { __resetModelEventsForTests } from '../src/orm/Compat/modelEvents.js'
import { __resetRefLinksForTests } from '../src/orm/Compat/refRegistry.js'
import { getPrivateDataRawRoot } from '../src/orm/privateData.js'
import { HASH as QUERY_HASH, querySubscriptions } from '../src/orm/Query.js'
import { __resetPendingRootDisposesForTests } from '../src/orm/disposeRootContext.ts'
import {
  __getRootContextForTests,
  __resetRootContextsForTests
} from '../src/orm/rootContext.ts'
import { getSubscriptionGcDelay, setSubscriptionGcDelay } from '../src/orm/subscriptionGcDelay.ts'
import { runGc } from './_helpers.js'

before(connect)

const describeCompat = process.env.TEAMPLAY_COMPAT === '1' ? describe : describe.skip
const QUERY_COLLECTION = 'rootFinalizationQueries'
const DOC_COLLECTION = 'rootFinalizationDocs'

function assertGlobalSubscriptionManagersConsistent () {
  assertDocSubscriptionsConsistent(docSubscriptions)
  assertQuerySubscriptionsConsistent(querySubscriptions)
  assertQuerySubscriptionsConsistent(aggregationSubscriptions)
}

describe('root finalization', () => {
  let prevSubscriptionGcDelay

  beforeEach(() => {
    prevSubscriptionGcDelay = getSubscriptionGcDelay()
    setSubscriptionGcDelay(0)
  })

  afterEach(async () => {
    assertGlobalSubscriptionManagersConsistent()
    await docSubscriptions.clear()
    await querySubscriptions.clear()
    await aggregationSubscriptions.clear()
    assertGlobalSubscriptionManagersConsistent()
    _del([QUERY_COLLECTION])
    _del([DOC_COLLECTION])
    await destroyConnectionCollection(QUERY_COLLECTION)
    await destroyConnectionCollection(DOC_COLLECTION)
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

      let $queryA = await sub($rootA[QUERY_COLLECTION], { active: true })
      const $queryB = await sub($rootB[QUERY_COLLECTION], { active: true })

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

    it('keeps live query transport alive when a fetchOnly sibling root is GC cleaned', async () => {
      const rootIdA = 'fr-query-fetch-root-A'
      const rootIdB = 'fr-query-live-root-B'
      const docId = '_fetchOnlySibling'
      const marker = 'fetch-only-finalization'
      let $rootA = getRootSignal({ rootId: rootIdA, fetchOnly: true })
      const $rootB = getRootSignal({ rootId: rootIdB, fetchOnly: false })

      await $rootA[QUERY_COLLECTION][docId].set({ name: 'One', marker })

      let $queryA = await sub($rootA[QUERY_COLLECTION], { marker })
      const $queryB = await sub($rootB[QUERY_COLLECTION], { marker })

      const transportHash = $queryA[QUERY_HASH]
      assert.equal(querySubscriptions.transportSubCount.get(transportHash), 2)
      assert.equal(querySubscriptions.queries.get(transportHash)?.activeTransportMode, 'subscribe')

      $queryA = undefined
      $rootA = undefined

      await waitForDisposed(rootIdA)

      assert.equal(__getRootContextForTests(rootIdA), undefined)
      assert.equal(querySubscriptions.transportSubCount.get(transportHash), 1)
      assert.equal(querySubscriptions.queries.get(transportHash)?.activeTransportMode, 'subscribe')
      assert.deepEqual($queryB.getIds(), [docId])

      await closeSignal($rootB)
    })

    it('keeps direct doc transport alive for sibling root when one root is GC cleaned', async () => {
      const rootIdA = 'fr-doc-root-A'
      const rootIdB = 'fr-doc-root-B'
      const docId = '_doc1'
      const docHash = JSON.stringify([DOC_COLLECTION, docId])
      let $rootA = getRootSignal({ rootId: rootIdA, fetchOnly: true })
      const $rootB = getRootSignal({ rootId: rootIdB, fetchOnly: false })

      await $rootA[DOC_COLLECTION][docId].set({ name: 'One' })

      let $docA = $rootA[DOC_COLLECTION][docId]
      const $docB = $rootB[DOC_COLLECTION][docId]

      await sub($docA)
      await sub($docB)

      assert.equal(docSubscriptions.subCount.get(docHash), 2)
      assert.equal(docSubscriptions.docs.get(docHash)?.activeTransportMode, 'subscribe')

      $docA = undefined
      $rootA = undefined

      await waitForDisposed(rootIdA)

      assert.equal(__getRootContextForTests(rootIdA), undefined)
      assert.equal(docSubscriptions.subCount.get(docHash), 1)
      assert.equal(docSubscriptions.docs.get(docHash)?.activeTransportMode, 'subscribe')
      assert.equal($docB.name.get(), 'One')

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
