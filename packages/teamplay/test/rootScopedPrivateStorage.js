import { describe, it, afterEach } from 'mocha'
import { strict as assert } from 'node:assert'
import { getRootSignal } from '../index.js'
import {
  ROOTS_BUCKET,
  del as _del,
  getRaw as _getRaw,
  set as _set
} from '../orm/dataTree.js'

describe('root-scoped private storage', () => {
  afterEach(() => {
    _del([ROOTS_BUCKET])
    _del(['users'])
  })

  it('isolates _session values by root', async () => {
    const $rootA = getRootSignal({ rootId: '_private_root_A' })
    const $rootB = getRootSignal({ rootId: '_private_root_B' })

    await $rootA._session.userId.set('a')
    await $rootB._session.userId.set('b')

    assert.equal($rootA._session.userId.get(), 'a')
    assert.equal($rootB._session.userId.get(), 'b')
    assert.equal(_getRaw([ROOTS_BUCKET, '_private_root_A', '_session', 'userId']), 'a')
    assert.equal(_getRaw([ROOTS_BUCKET, '_private_root_B', '_session', 'userId']), 'b')
    assert.equal(_getRaw(['_session', 'userId']), undefined)
  })

  it('isolates _page values by root', async () => {
    const $rootA = getRootSignal({ rootId: '_private_page_A' })
    const $rootB = getRootSignal({ rootId: '_private_page_B' })

    await $rootA._page.lang.set('en')
    await $rootB._page.lang.set('tr')

    assert.equal($rootA._page.lang.get(), 'en')
    assert.equal($rootB._page.lang.get(), 'tr')
  })

  it('keeps public data shared while private data stays isolated', async () => {
    const $rootA = getRootSignal({ rootId: '_private_shared_A' })
    const $rootB = getRootSignal({ rootId: '_private_shared_B' })

    _set(['users', 'u1'], { name: 'John' })
    await $rootA._session.lang.set('en')
    await $rootB._session.lang.set('tr')

    assert.equal($rootA.users.u1.name.get(), 'John')
    assert.equal($rootB.users.u1.name.get(), 'John')
    assert.equal($rootA._session.lang.get(), 'en')
    assert.equal($rootB._session.lang.get(), 'tr')
  })

  it('root.get and root.peek expose logical snapshot without __roots bucket', async () => {
    const $rootA = getRootSignal({ rootId: '_private_snapshot_A' })
    const $rootB = getRootSignal({ rootId: '_private_snapshot_B' })

    _set(['users', 'u1'], { name: 'John' })
    await $rootA._session.userId.set('a')
    await $rootB._session.userId.set('b')
    await $rootA._page.lang.set('en')

    const snapshot = $rootA.get()
    const rawSnapshot = $rootA.peek()

    assert.equal(snapshot.__roots, undefined)
    assert.equal(rawSnapshot.__roots, undefined)
    assert.equal(snapshot.users.u1.name, 'John')
    assert.equal(rawSnapshot.users.u1.name, 'John')
    assert.equal(snapshot._session.userId, 'a')
    assert.equal(rawSnapshot._session.userId, 'a')
    assert.equal(snapshot._page.lang, 'en')
    assert.equal(rawSnapshot._page.lang, 'en')
    assert.equal(snapshot._session.userId === 'b', false)
    assert.equal(rawSnapshot._session.userId === 'b', false)
  })

  it('deletes private data only inside owning root namespace', async () => {
    const $rootA = getRootSignal({ rootId: '_private_delete_A' })
    const $rootB = getRootSignal({ rootId: '_private_delete_B' })

    await $rootA._session.userId.set('a')
    await $rootB._session.userId.set('b')
    await $rootA._session.userId.del()

    assert.equal($rootA._session.userId.get(), undefined)
    assert.equal($rootB._session.userId.get(), 'b')
    assert.equal(_getRaw([ROOTS_BUCKET, '_private_delete_A', '_session', 'userId']), undefined)
    assert.equal(_getRaw([ROOTS_BUCKET, '_private_delete_B', '_session', 'userId']), 'b')
  })

  it('scopes increment and array/string mutators to the owning root', async () => {
    const $rootA = getRootSignal({ rootId: '_private_mutators_A' })
    const $rootB = getRootSignal({ rootId: '_private_mutators_B' })

    await $rootA._session.count.increment()
    await $rootB._session.count.increment(2)
    await $rootA._session.items.set([])
    await $rootB._session.items.set([])
    await $rootA._session.items.push('a1')
    await $rootB._session.items.push('b1')
    await $rootA._session.title.set('foo')
    await $rootB._session.title.set('bar')
    await $rootA._session.title.stringInsert(3, 'A')
    await $rootB._session.title.stringInsert(3, 'B')

    assert.equal($rootA._session.count.get(), 1)
    assert.equal($rootB._session.count.get(), 2)
    assert.deepEqual($rootA._session.items.get(), ['a1'])
    assert.deepEqual($rootB._session.items.get(), ['b1'])
    assert.equal($rootA._session.title.get(), 'fooA')
    assert.equal($rootB._session.title.get(), 'barB')
  })
})
