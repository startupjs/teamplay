import { afterEach, describe, it } from 'mocha'
import { strict as assert } from 'node:assert'
import RootContext, {
  getRootContext,
  registerRootOwnedView,
  unregisterRootOwnedView,
  getRootOwnedViewHashes,
  __getRootContextForTests,
  __resetRootContextsForTests
} from '../orm/rootContext.js'

describe('RootContext runtime owner', () => {
  afterEach(() => {
    __resetRootContextsForTests()
  })

  it('returns a stable context per root and isolates runtime stores', () => {
    const rootA1 = getRootContext('root-A')
    const rootA2 = getRootContext('root-A')
    const rootB = getRootContext('root-B')

    assert.ok(rootA1 instanceof RootContext)
    assert.strictEqual(rootA1, rootA2)
    assert.notStrictEqual(rootA1, rootB)

    rootA1.refLinks.set('_session.user', { toPath: 'users.a' })
    rootA1.getModelEventStore('change', true).set('_session.user', { handlers: new Set() })

    assert.equal(rootA2.refLinks.size, 1)
    assert.equal(rootA2.getModelEventStore('change').size, 1)
    assert.equal(rootB.refLinks.size, 0)
    assert.equal(rootB.getModelEventStore('change').size, 0)
  })

  it('tracks query and aggregation view ownership per root', () => {
    registerRootOwnedView('root-A', 'query', 'query-view-a')
    registerRootOwnedView('root-A', 'aggregation', 'agg-view-a')
    registerRootOwnedView('root-B', 'query', 'query-view-b')

    assert.deepEqual(
      Array.from(getRootOwnedViewHashes('root-A', 'query')),
      ['query-view-a']
    )
    assert.deepEqual(
      Array.from(getRootOwnedViewHashes('root-A', 'aggregation')),
      ['agg-view-a']
    )
    assert.deepEqual(
      Array.from(getRootOwnedViewHashes('root-B', 'query')),
      ['query-view-b']
    )

    unregisterRootOwnedView('root-A', 'query', 'query-view-a')
    assert.deepEqual(Array.from(getRootOwnedViewHashes('root-A', 'query')), [])
    assert.deepEqual(Array.from(getRootOwnedViewHashes('root-A', 'aggregation')), ['agg-view-a'])
  })

  it('exposes contexts for future cleanup and test reset', () => {
    getRootContext('root-A').refLinks.set('_session.user', { toPath: 'users.a' })
    registerRootOwnedView('root-A', 'query', 'query-view-a')

    assert.ok(__getRootContextForTests('root-A'))
    __resetRootContextsForTests()
    assert.equal(__getRootContextForTests('root-A'), undefined)
  })
})
