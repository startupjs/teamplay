import { afterEach, before, beforeEach, describe, it } from 'mocha'
import { strict as assert } from 'node:assert'
import {
  __DEBUG_SIGNALS_CACHE__ as signalsCache,
  getRootSignal
} from '../index.js'
import connect from '../connect/test.js'
import { aggregationSubscriptions } from '../orm/Aggregation.js'
import { docSubscriptions } from '../orm/Doc.js'
import { getConnection } from '../orm/connection.js'
import { del as _del } from '../orm/dataTree.js'
import { __resetModelEventsForTests } from '../orm/Compat/modelEvents.js'
import { __resetRefLinksForTests } from '../orm/Compat/refRegistry.js'
import { getPrivateData, getPrivateDataRawRoot } from '../orm/privateData.js'
import { HASH as QUERY_HASH, QUERIES, querySubscriptions } from '../orm/Query.js'
import { __resetPendingRootDisposesForTests } from '../orm/disposeRootContext.js'
import {
  __getRootContextForTests,
  __resetRootContextsForTests,
  getRootOwnedSignalHashes,
  getRootOwnedRuntimeHashes
} from '../orm/rootContext.js'
import { getScopedSignalHash } from '../orm/rootScope.js'
import { getSubscriptionGcDelay, setSubscriptionGcDelay } from '../orm/subscriptionGcDelay.js'

before(connect)

const describeCompat = process.env.TEAMPLAY_COMPAT === '1' ? describe : describe.skip
const DOC_COLLECTION = 'rootCloseDocs'
const QUERY_COLLECTION = 'rootCloseQueries'
const REFS_COLLECTION = 'rootCloseRefs'

describeCompat('root close()', () => {
  let prevSubscriptionGcDelay

  beforeEach(() => {
    prevSubscriptionGcDelay = getSubscriptionGcDelay()
    setSubscriptionGcDelay(0)
  })

  afterEach(async () => {
    await docSubscriptions.clear()
    await querySubscriptions.clear()
    await aggregationSubscriptions.clear()
    _del([DOC_COLLECTION])
    _del([QUERY_COLLECTION])
    _del([REFS_COLLECTION])
    await destroyConnectionCollection(DOC_COLLECTION)
    await destroyConnectionCollection(QUERY_COLLECTION)
    await destroyConnectionCollection(REFS_COLLECTION)
    __resetRefLinksForTests()
    __resetModelEventsForTests()
    __resetPendingRootDisposesForTests()
    __resetRootContextsForTests()
    setSubscriptionGcDelay(prevSubscriptionGcDelay)
  })

  it('cleans private storage for owning root and preserves sibling root data', async () => {
    const $rootA = getRootSignal({ rootId: 'close-private-A' })
    const $rootB = getRootSignal({ rootId: 'close-private-B' })

    await $rootA._session.userId.set('user-a')
    await $rootA._page.lang.set('en')
    await $rootB._session.userId.set('user-b')

    await closeSignal($rootA)

    assert.equal($rootA._session.userId.get(), undefined)
    assert.equal($rootA._page.lang.get(), undefined)
    assert.equal($rootB._session.userId.get(), 'user-b')
    assert.equal(getPrivateDataRawRoot('close-private-A'), undefined)
    assert.ok(getPrivateDataRawRoot('close-private-B'))
  })

  it('does not recreate a private root context when reading stale signals after close', async () => {
    const $root = getRootSignal({ rootId: 'close-stale-read-root' })

    await $root._session.userId.set('user-a')
    await closeSignal($root)

    assert.equal(__getRootContextForTests('close-stale-read-root'), undefined)
    assert.equal($root._session.userId.get(), undefined)
    assert.equal(getPrivateDataRawRoot('close-stale-read-root'), undefined)
    assert.equal(__getRootContextForTests('close-stale-read-root'), undefined)
  })

  it('closes owning root even when called on a child signal', async () => {
    const $root = getRootSignal({ rootId: 'close-child-root' })
    const $child = $root._session.userId

    await $child.set('child-user')
    await closeSignal($child)

    assert.equal(__getRootContextForTests('close-child-root'), undefined)
    assert.equal(getPrivateDataRawRoot('close-child-root'), undefined)
    assert.equal($root._session.userId.get(), undefined)
  })

  it('releases direct public doc subscriptions only for the owning root', async () => {
    const $rootA = getRootSignal({ rootId: 'close-doc-root-A' })
    const $rootB = getRootSignal({ rootId: 'close-doc-root-B' })
    const $docA = $rootA[DOC_COLLECTION]._1
    const $docB = $rootB[DOC_COLLECTION]._1
    const hash = JSON.stringify([DOC_COLLECTION, '_1'])

    await $docA.set({ title: 'Doc 1' })
    await $docA.subscribe()
    await $docB.subscribe()

    assert.equal(docSubscriptions.subCount.get(hash), 2)

    await closeSignal($rootA)
    assert.equal(docSubscriptions.subCount.get(hash), 1)
    assert.ok(docSubscriptions.docs.has(hash))

    await closeSignal($rootB)
    assert.equal(docSubscriptions.subCount.get(hash), undefined)
    assert.ok(!docSubscriptions.docs.has(hash))
  })

  it('close tolerates stale direct doc ownership and preserves sibling transport', async () => {
    const rootIdA = 'close-stale-doc-root-A'
    const rootIdB = 'close-stale-doc-root-B'
    const $rootA = getRootSignal({ rootId: rootIdA })
    const $rootB = getRootSignal({ rootId: rootIdB })
    const $docA = $rootA[DOC_COLLECTION]._stale
    const $docB = $rootB[DOC_COLLECTION]._stale
    const hash = JSON.stringify([DOC_COLLECTION, '_stale'])
    const ownerKeyA = JSON.stringify({ owner: [rootIdA, hash] })

    await $docA.set({ title: 'Doc stale' })
    await $docA.subscribe()
    await $docB.subscribe()

    docSubscriptions.ownerRecords.delete(ownerKeyA)
    docSubscriptions.entries.get(hash)?.owners.delete(ownerKeyA)

    await assert.doesNotReject(async () => closeSignal($rootA))

    assert.equal(__getRootContextForTests(rootIdA), undefined)
    assert.equal(docSubscriptions.subCount.get(hash), 1)
    assert.equal(docSubscriptions.docs.get(hash)?.activeTransportMode, 'subscribe')
    assert.equal($docB.get('title'), 'Doc stale')

    await closeSignal($rootB)
  })

  it('destroys root-owned query and aggregation views while keeping shared transport alive for other roots', async () => {
    const $rootA = getRootSignal({ rootId: 'close-view-root-A' })
    const $rootB = getRootSignal({ rootId: 'close-view-root-B' })

    await $rootA[QUERY_COLLECTION]._1.set({ title: 'One', active: true })
    await $rootA[QUERY_COLLECTION]._2.set({ title: 'Two', active: true })

    const $queryA = $rootA.query(QUERY_COLLECTION, { active: true })
    const $queryB = $rootB.query(QUERY_COLLECTION, { active: true })
    const $aggA = $rootA.query(QUERY_COLLECTION, {
      $aggregate: [{ $match: { active: true } }]
    })
    const $aggB = $rootB.query(QUERY_COLLECTION, {
      $aggregate: [{ $match: { active: true } }]
    })

    await $queryA.subscribe()
    await $queryB.subscribe()
    await $aggA.subscribe()
    await $aggB.subscribe()

    await closeSignal($rootA)

    assert.deepEqual(Array.from(getRootOwnedRuntimeHashes('close-view-root-A', 'query')), [])
    assert.deepEqual(Array.from(getRootOwnedRuntimeHashes('close-view-root-A', 'aggregation')), [])
    assert.deepEqual(Array.from(getRootOwnedRuntimeHashes('close-view-root-B', 'query')), [$queryB[QUERY_HASH]])
    assert.deepEqual(Array.from(getRootOwnedRuntimeHashes('close-view-root-B', 'aggregation')), [$aggB[QUERY_HASH]])
    assert.equal(querySubscriptions.transportSubCount.get($queryA[QUERY_HASH]), 1)
    assert.equal(aggregationSubscriptions.transportSubCount.get($aggA[QUERY_HASH]), 1)
    assert.deepEqual(getPrivateData('close-view-root-B', [QUERIES, $queryB[QUERY_HASH], 'ids']).slice().sort(), ['_1', '_2'])

    await closeSignal($rootB)

    assert.equal(querySubscriptions.transportSubCount.get($queryA[QUERY_HASH]), undefined)
    assert.equal(aggregationSubscriptions.transportSubCount.get($aggA[QUERY_HASH]), undefined)
  })

  it('close tolerates stale query ownership when transport entry is already missing', async () => {
    const rootId = 'close-stale-query-root'
    const $root = getRootSignal({ rootId })

    await $root[QUERY_COLLECTION]._stale1.set({ title: 'One', active: true })
    const $query = $root.query(QUERY_COLLECTION, { active: true })
    await $query.subscribe()

    const transportHash = $query[QUERY_HASH]
    const ownerKey = getScopedSignalHash(rootId, transportHash, 'queryOwner')

    querySubscriptions.entries.get(transportHash).runtime = null
    querySubscriptions.ownerRecords.delete(ownerKey)
    querySubscriptions.entries.get(transportHash)?.owners.delete(ownerKey)

    await assert.doesNotReject(async () => closeSignal($root))

    assert.equal(__getRootContextForTests(rootId), undefined)
    assert.equal(querySubscriptions.transportSubCount.get(transportHash), undefined)
    assert.equal(querySubscriptions.ownerMeta.get(ownerKey), undefined)
  })

  it('stops active refs and removes root-owned runtime state', async () => {
    const $root = getRootSignal({ rootId: 'close-ref-root' })

    await $root[REFS_COLLECTION].u1.set({ name: 'Alice' })
    $root._session.currentUser.ref(`${REFS_COLLECTION}.u1`)
    assert.equal($root._session.currentUser.name.get(), 'Alice')

    await closeSignal($root)

    assert.equal(__getRootContextForTests('close-ref-root'), undefined)
    await $root[REFS_COLLECTION].u1.name.set('Bob')
    assert.equal($root._session.currentUser.get(), undefined)
  })

  it('purges root-owned signal cache entries and is idempotent', async () => {
    const rootId = 'close-cache-root'
    const $root = getRootSignal({ rootId })

    const $doc = $root[DOC_COLLECTION]._1
    const $child = $doc.title
    await $root._session.userId.set('cache-user')

    const ownedSignalHashes = Array.from(getRootOwnedSignalHashes(rootId))
    assert.ok(ownedSignalHashes.length > 0)
    assert.ok(ownedSignalHashes.every(hash => signalsCache.get(hash)))

    const result = $root.close()
    assert.equal(result, undefined)
    await closeSignal($root)

    assert.ok(ownedSignalHashes.every(hash => !signalsCache.get(hash)))
    assert.equal(__getRootContextForTests(rootId), undefined)

    const $rootAgain = getRootSignal({ rootId })
    assert.notStrictEqual($rootAgain, $root)
    assert.notStrictEqual($rootAgain[DOC_COLLECTION]._1, $doc)
    assert.notStrictEqual($rootAgain[DOC_COLLECTION]._1.title, $child)

    await closeSignal($rootAgain)
  })
})

function closeSignal ($signal) {
  return new Promise((resolve, reject) => {
    const result = $signal.close(err => (err ? reject(err) : resolve()))
    assert.equal(result, undefined)
  })
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
