import { afterEach, describe, it } from 'mocha'
import { strict as assert } from 'node:assert'
import RootContext, {
  getRootContext,
  registerRootOwnedRuntime,
  unregisterRootOwnedRuntime,
  getRootOwnedRuntimeHashes,
  __getRootContextForTests,
  __resetRootContextsForTests
} from '../src/orm/rootContext.ts'

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

  it('tracks query and aggregation runtime ownership per root', () => {
    registerRootOwnedRuntime('root-A', 'query', 'query-runtime-a')
    registerRootOwnedRuntime('root-A', 'aggregation', 'agg-runtime-a')
    registerRootOwnedRuntime('root-B', 'query', 'query-runtime-b')

    assert.deepEqual(
      Array.from(getRootOwnedRuntimeHashes('root-A', 'query')),
      ['query-runtime-a']
    )
    assert.deepEqual(
      Array.from(getRootOwnedRuntimeHashes('root-A', 'aggregation')),
      ['agg-runtime-a']
    )
    assert.deepEqual(
      Array.from(getRootOwnedRuntimeHashes('root-B', 'query')),
      ['query-runtime-b']
    )

    unregisterRootOwnedRuntime('root-A', 'query', 'query-runtime-a')
    assert.deepEqual(Array.from(getRootOwnedRuntimeHashes('root-A', 'query')), [])
    assert.deepEqual(Array.from(getRootOwnedRuntimeHashes('root-A', 'aggregation')), ['agg-runtime-a'])
  })

  it('exposes contexts for future cleanup and test reset', () => {
    getRootContext('root-A').refLinks.set('_session.user', { toPath: 'users.a' })
    registerRootOwnedRuntime('root-A', 'query', 'query-runtime-a')

    assert.ok(__getRootContextForTests('root-A'))
    __resetRootContextsForTests()
    assert.equal(__getRootContextForTests('root-A'), undefined)
  })
})
