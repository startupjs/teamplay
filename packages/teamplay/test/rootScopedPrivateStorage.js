import { describe, it, afterEach } from 'mocha'
import { strict as assert } from 'node:assert'
import { getRootSignal } from '../index.ts'
import { del as _del, set as _set } from '../orm/dataTree.js'
import { getPrivateData, getPrivateDataRawRoot } from '../orm/privateData.js'
import { __resetRootContextsForTests } from '../orm/rootContext.js'

describe('root-scoped private storage', () => {
  afterEach(() => {
    _del(['users'])
    __resetRootContextsForTests()
  })

  it('isolates _session values by root', async () => {
    const $rootA = getRootSignal({ rootId: '_private_root_A' })
    const $rootB = getRootSignal({ rootId: '_private_root_B' })

    await $rootA._session.userId.set('a')
    await $rootB._session.userId.set('b')

    assert.equal($rootA._session.userId.get(), 'a')
    assert.equal($rootB._session.userId.get(), 'b')
    assert.equal(getPrivateData('_private_root_A', ['_session', 'userId'], true), 'a')
    assert.equal(getPrivateData('_private_root_B', ['_session', 'userId'], true), 'b')
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
    assert.equal(getPrivateData('_private_delete_A', ['_session', 'userId'], true), undefined)
    assert.equal(getPrivateData('_private_delete_B', ['_session', 'userId'], true), 'b')
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

  it('stores private collections outside the shared data tree', async () => {
    const $rootA = getRootSignal({ rootId: '_private_storage_A' })
    const $rootB = getRootSignal({ rootId: '_private_storage_B' })

    await $rootA._session.userId.set('a')
    await $rootB._page.lang.set('tr')

    assert.deepEqual(getPrivateDataRawRoot('_private_storage_A'), {
      _session: { userId: 'a' }
    })
    assert.deepEqual(getPrivateDataRawRoot('_private_storage_B'), {
      _page: { lang: 'tr' }
    })
  })
})
