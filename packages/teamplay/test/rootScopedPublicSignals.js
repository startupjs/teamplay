import assert from 'assert'
import { before, beforeEach, afterEach, describe, it } from 'mocha'
import { addModel, getRootSignal } from '../index.js'
import { docSubscriptions } from '../orm/Doc.js'
import { getConnection } from '../orm/connection.js'
import { del as _del, set as _set } from '../orm/dataTree.js'
import { __resetRefLinksForTests } from '../orm/Compat/refRegistry.js'
import { __resetModelEventsForTests } from '../orm/Compat/modelEvents.js'
import { getPrivateData } from '../orm/privateData.js'
import { querySubscriptions, QUERIES, HASH as QUERY_HASH } from '../orm/Query.js'
import { setSubscriptionGcDelay, getSubscriptionGcDelay } from '../orm/subscriptionGcDelay.js'
import { getRootOwnedViewHashes } from '../orm/rootContext.js'
import connect from '../connect/test.js'

before(connect)

const describeCompat = process.env.TEAMPLAY_COMPAT === '1' ? describe : describe.skip
const PUBLIC_COLLECTION = 'rootScopedGamesPublic'
const PUBLIC_MODEL_COLLECTION = 'rootScopedUsersPublic'
const PUBLIC_VIEW_COLLECTION = 'rootScopedGamesPublicViews'

describeCompat('root-scoped public signals', () => {
  let prevSubscriptionGcDelay

  beforeEach(() => {
    prevSubscriptionGcDelay = getSubscriptionGcDelay()
    setSubscriptionGcDelay(0)
  })

  beforeEach(() => {
    __resetRefLinksForTests()
    __resetModelEventsForTests()
  })

  afterEach(async () => {
    _del([PUBLIC_COLLECTION])
    _del([PUBLIC_VIEW_COLLECTION])
    _del([PUBLIC_MODEL_COLLECTION])
    await destroyConnectionCollection(PUBLIC_COLLECTION)
    await destroyConnectionCollection(PUBLIC_VIEW_COLLECTION)
    await destroyConnectionCollection(PUBLIC_MODEL_COLLECTION)
    await docSubscriptions.flushPendingDestroys()
    await querySubscriptions.flushPendingDestroys()
    setSubscriptionGcDelay(prevSubscriptionGcDelay)
  })

  function createRoot (rootId) {
    return getRootSignal({ rootId })
  }

  it('creates distinct public doc and child signals per root while reusing them within a root', () => {
    const rootA = createRoot('public-root-A')
    const rootB = createRoot('public-root-B')

    const $docA1 = rootA[PUBLIC_COLLECTION]._1
    const $docA2 = rootA[PUBLIC_COLLECTION]._1
    const $docB = rootB[PUBLIC_COLLECTION]._1
    const $childA1 = rootA[PUBLIC_COLLECTION]._1.name
    const $childA2 = rootA[PUBLIC_COLLECTION]._1.name
    const $childB = rootB[PUBLIC_COLLECTION]._1.name

    assert.strictEqual($docA1, $docA2)
    assert.strictEqual($childA1, $childA2)
    assert.notStrictEqual($docA1, $docB)
    assert.notStrictEqual($childA1, $childB)
  })

  it('creates distinct public query signals per root while keeping query views separated', async () => {
    const rootA = createRoot('query-public-root-A')
    const rootB = createRoot('query-public-root-B')

    await rootA[PUBLIC_COLLECTION]._1.set({ name: 'Game 1', active: true })
    await rootA[PUBLIC_COLLECTION]._2.set({ name: 'Game 2', active: true })

    const $queryA = rootA.query(PUBLIC_COLLECTION, { active: true })
    const $queryB = rootB.query(PUBLIC_COLLECTION, { active: true })

    await $queryA.subscribe()
    await $queryB.subscribe()

    assert.notStrictEqual($queryA, $queryB)
    assert.equal($queryA[QUERY_HASH], $queryB[QUERY_HASH])
    assert.deepEqual($queryA.getIds().slice().sort(), ['_1', '_2'])
    assert.deepEqual($queryB.getIds().slice().sort(), ['_1', '_2'])
    assert.ok(getPrivateData('query-public-root-A', [QUERIES, $queryA[QUERY_HASH], 'ids']))
    assert.ok(getPrivateData('query-public-root-B', [QUERIES, $queryB[QUERY_HASH], 'ids']))

    await $queryA.unsubscribe()
    await $queryB.unsubscribe()
  })

  it('tracks query view ownership inside root contexts while transport stays shared', async () => {
    const rootA = createRoot('query-view-root-A')
    const rootB = createRoot('query-view-root-B')

    await rootA[PUBLIC_VIEW_COLLECTION]._1.set({ name: 'Game 1', active: true })

    const $queryA = rootA.query(PUBLIC_VIEW_COLLECTION, { active: true })
    const $queryB = rootB.query(PUBLIC_VIEW_COLLECTION, { active: true })

    await $queryA.subscribe()
    await $queryB.subscribe()

    assert.deepEqual(
      Array.from(getRootOwnedViewHashes('query-view-root-A', 'query')),
      [$queryA[QUERY_HASH]]
    )
    assert.deepEqual(
      Array.from(getRootOwnedViewHashes('query-view-root-B', 'query')),
      [$queryB[QUERY_HASH]]
    )

    await $queryA.unsubscribe()
    assert.deepEqual(Array.from(getRootOwnedViewHashes('query-view-root-A', 'query')), [])
    assert.deepEqual(
      Array.from(getRootOwnedViewHashes('query-view-root-B', 'query')),
      [$queryB[QUERY_HASH]]
    )

    await $queryB.unsubscribe()
    assert.deepEqual(Array.from(getRootOwnedViewHashes('query-view-root-B', 'query')), [])
  })

  it('shares doc transport across root-scoped public signals and keeps it alive until both roots unsubscribe', async () => {
    const rootA = createRoot('transport-root-A')
    const rootB = createRoot('transport-root-B')
    const $docA = rootA[PUBLIC_COLLECTION]._1
    const $docB = rootB[PUBLIC_COLLECTION]._1
    const hash = `["${PUBLIC_COLLECTION}","_1"]`

    await docSubscriptions.subscribe($docA)
    assert.equal(docSubscriptions.subCount.get(hash), 1)
    assert.ok(docSubscriptions.docs.has(hash))

    await docSubscriptions.subscribe($docB)
    assert.equal(docSubscriptions.subCount.get(hash), 2)
    assert.ok(docSubscriptions.docs.has(hash))

    await docSubscriptions.unsubscribe($docA)
    assert.equal(docSubscriptions.subCount.get(hash), 1)
    assert.ok(docSubscriptions.docs.has(hash))

    await docSubscriptions.unsubscribe($docB)
    assert.equal(docSubscriptions.subCount.get(hash), undefined)
    assert.ok(!docSubscriptions.docs.has(hash))
  })

  it('public model methods use owning root when touching private state', async () => {
    class RootScopedUserModel extends getRootSignal({ rootId: 'temp-root-for-model-class' }).constructor {
      static collection = PUBLIC_MODEL_COLLECTION
      markCurrentViaScope () {
        return this.scope('_session.currentUserId').set(this.getId())
      }

      markCurrentViaRoot () {
        return this.root.scope('_session.currentUserIdViaRoot').set(this.getId())
      }
    }
    try { addModel(`${PUBLIC_MODEL_COLLECTION}.*`, RootScopedUserModel) } catch {}

    const rootA = createRoot('method-root-A')
    const rootB = createRoot('method-root-B')

    await rootA[PUBLIC_MODEL_COLLECTION].a.set({ name: 'Alice' })
    await rootB[PUBLIC_MODEL_COLLECTION].b.set({ name: 'Bob' })

    await rootA[PUBLIC_MODEL_COLLECTION].a.markCurrentViaScope()
    await rootB[PUBLIC_MODEL_COLLECTION].b.markCurrentViaScope()
    await rootA[PUBLIC_MODEL_COLLECTION].a.markCurrentViaRoot()
    await rootB[PUBLIC_MODEL_COLLECTION].b.markCurrentViaRoot()

    assert.equal(rootA._session.currentUserId.get(), 'a')
    assert.equal(rootB._session.currentUserId.get(), 'b')
    assert.equal(rootA._session.currentUserIdViaRoot.get(), 'a')
    assert.equal(rootB._session.currentUserIdViaRoot.get(), 'b')
  })

  it('public model events are root-scoped even though public data is shared', async () => {
    const rootA = createRoot('events-root-A')
    const rootB = createRoot('events-root-B')
    const eventsA = []
    const eventsB = []

    const handlerA = (...args) => eventsA.push(args)
    const handlerB = (...args) => eventsB.push(args)

    rootA.on('change', `${PUBLIC_COLLECTION}.*.name`, handlerA)
    rootB.on('change', `${PUBLIC_COLLECTION}.*.name`, handlerB)

    _set([PUBLIC_COLLECTION, '_1', 'name'], 'before')
    eventsA.length = 0
    eventsB.length = 0

    _set([PUBLIC_COLLECTION, '_1', 'name'], 'after')
    assert.equal(eventsA.length, 1)
    assert.equal(eventsB.length, 1)

    rootA.removeListener('change', handlerA)
    eventsA.length = 0
    eventsB.length = 0

    _set([PUBLIC_COLLECTION, '_1', 'name'], 'final')
    assert.equal(eventsA.length, 0)
    assert.equal(eventsB.length, 1)
  })
})

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
