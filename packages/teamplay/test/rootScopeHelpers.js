import { describe, it } from 'mocha'
import { strict as assert } from 'node:assert'
import { GLOBAL_ROOT_ID } from '../src/orm/Root.ts'
import {
  normalizeRootId,
  isGlobalRootId,
  isPrivateCollectionSegments,
  getPrivateDataSegments,
  getLogicalRootSnapshot,
  getSignalIdentityHash,
  getScopedSignalHash,
  getRootScopedRegistryKey
} from '../src/orm/rootScope.ts'

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
    assert.equal(isPrivateCollectionSegments(['$queries', 'hash']), true)
    assert.equal(isPrivateCollectionSegments(['$aggregations', 'hash']), true)
    assert.equal(isPrivateCollectionSegments(['users', 'u1']), false)
  })

  it('builds private data segments for private collections only', () => {
    assert.deepEqual(
      getPrivateDataSegments(['_session', 'userId']),
      ['_session', 'userId']
    )
    assert.deepEqual(
      getPrivateDataSegments(['$queries', 'hash']),
      ['$queries', 'hash']
    )
    const publicSegments = ['users', 'u1']
    assert.equal(getPrivateDataSegments(publicSegments), publicSegments)
  })

  it('builds logical root snapshots by merging root-owned private data', () => {
    const tree = {
      users: { u1: { name: 'John' } }
    }
    const privateDataA = { _session: { userId: 'a' }, _page: { tab: 'home' } }
    const privateDataB = { _session: { userId: 'b' } }
    const globalPrivateData = { _session: { userId: 'global' }, $local: { _0: 'draft' } }

    assert.deepEqual(getLogicalRootSnapshot('_root_A', tree, privateDataA), {
      users: { u1: { name: 'John' } },
      _session: { userId: 'a' },
      _page: { tab: 'home' }
    })
    assert.deepEqual(getLogicalRootSnapshot('_root_B', tree, privateDataB), {
      users: { u1: { name: 'John' } },
      _session: { userId: 'b' }
    })
    assert.deepEqual(getLogicalRootSnapshot(undefined, tree, globalPrivateData), {
      users: { u1: { name: 'John' } },
      _session: { userId: 'global' },
      $local: { _0: 'draft' }
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
