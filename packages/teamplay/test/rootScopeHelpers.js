import { describe, it } from 'mocha'
import { strict as assert } from 'node:assert'
import { GLOBAL_ROOT_ID } from '../orm/Root.js'
import {
  ROOTS_BUCKET,
  normalizeRootId,
  isGlobalRootId,
  isPrivateCollectionSegments,
  scopeStorageSegments,
  descopeStorageSegments,
  getLogicalRootSnapshot,
  getSignalIdentityHash,
  getScopedSignalHash,
  getRootScopedRegistryKey
} from '../orm/rootScope.js'

describe('rootScope helpers', () => {
  it('normalizes and classifies root ids consistently', () => {
    assert.equal(normalizeRootId(undefined), GLOBAL_ROOT_ID)
    assert.equal(normalizeRootId(null), GLOBAL_ROOT_ID)
    assert.equal(normalizeRootId('_root_A'), '_root_A')
    assert.equal(isGlobalRootId(undefined), true)
    assert.equal(isGlobalRootId(GLOBAL_ROOT_ID), true)
    assert.equal(isGlobalRootId('_root_A'), false)
  })

  it('recognizes scoped and unscoped private collections', () => {
    assert.equal(isPrivateCollectionSegments(['_session', 'userId']), true)
    assert.equal(isPrivateCollectionSegments(['_page', 'tab']), true)
    assert.equal(isPrivateCollectionSegments(['$render', 'foo']), true)
    assert.equal(isPrivateCollectionSegments(['$queries', 'hash']), false)
    assert.equal(isPrivateCollectionSegments(['$aggregations', 'hash']), false)
    assert.equal(isPrivateCollectionSegments(['users', 'u1']), false)
  })

  it('scopes and descopes private storage paths', () => {
    assert.deepEqual(
      scopeStorageSegments('_root_A', ['_session', 'userId']),
      [ROOTS_BUCKET, '_root_A', '_session', 'userId']
    )
    assert.deepEqual(
      scopeStorageSegments(undefined, ['_session', 'userId']),
      ['_session', 'userId']
    )
    assert.deepEqual(
      scopeStorageSegments(GLOBAL_ROOT_ID, ['_session', 'userId']),
      ['_session', 'userId']
    )
    assert.deepEqual(
      scopeStorageSegments('_root_A', ['users', 'u1']),
      ['users', 'u1']
    )
    assert.deepEqual(
      descopeStorageSegments([ROOTS_BUCKET, '_root_A', '_session', 'userId']),
      ['_session', 'userId']
    )
    assert.deepEqual(
      descopeStorageSegments(['users', 'u1']),
      ['users', 'u1']
    )
  })

  it('builds logical root snapshots without exposing __roots', () => {
    const tree = {
      users: { u1: { name: 'John' } },
      [ROOTS_BUCKET]: {
        _root_A: { _session: { userId: 'a' }, _page: { tab: 'home' } },
        _root_B: { _session: { userId: 'b' } }
      }
    }

    assert.deepEqual(getLogicalRootSnapshot('_root_A', tree), {
      users: { u1: { name: 'John' } },
      _session: { userId: 'a' },
      _page: { tab: 'home' }
    })
    assert.deepEqual(getLogicalRootSnapshot('_root_B', tree), {
      users: { u1: { name: 'John' } },
      _session: { userId: 'b' }
    })
    assert.deepEqual(getLogicalRootSnapshot(undefined, tree), {
      users: { u1: { name: 'John' } }
    })
  })

  it('builds stable scoped keys for identity and registries', () => {
    assert.equal(
      getSignalIdentityHash('_root_A', []),
      JSON.stringify({ root: '_root_A' })
    )
    assert.equal(
      getSignalIdentityHash('_root_A', ['_session', 'userId']),
      JSON.stringify({ private: ['_root_A', ['_session', 'userId']] })
    )
    assert.equal(
      getSignalIdentityHash('_root_A', ['users', 'u1']),
      JSON.stringify({ public: ['_root_A', ['users', 'u1']] })
    )
    assert.equal(
      getScopedSignalHash('_root_A', '{"query":["users",{}]}'),
      JSON.stringify({ querySignal: ['_root_A', '{"query":["users",{}]}'] })
    )
    assert.equal(
      getScopedSignalHash('_root_A', '{"aggregate":["users",{}]}', 'aggregationSignal'),
      JSON.stringify({ aggregationSignal: ['_root_A', '{"aggregate":["users",{}]}'] })
    )
    assert.equal(
      getRootScopedRegistryKey('_root_A', '_session.user'),
      JSON.stringify(['_root_A', '_session.user'])
    )
  })
})
