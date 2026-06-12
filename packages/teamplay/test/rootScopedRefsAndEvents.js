import { describe, it, afterEach } from 'mocha'
import { strict as assert } from 'node:assert'
import { getRootSignal } from '../src/index.ts'
import { del as _del, set as _set } from '../src/orm/dataTree.js'
import { __resetModelEventsForTests } from '../src/orm/Compat/modelEvents.js'
import { __resetRefLinksForTests } from '../src/orm/Compat/refRegistry.js'
import { __resetSilentContextForTests } from '../src/orm/Compat/silentContext.js'
import { __resetRootContextsForTests } from '../src/orm/rootContext.ts'

const describeCompat = process.env.TEAMPLAY_COMPAT === '1' ? describe : describe.skip

describeCompat('root-scoped refs without public model events', () => {
  afterEach(() => {
    __resetModelEventsForTests()
    __resetRefLinksForTests()
    __resetSilentContextForTests()
    __resetRootContextsForTests()
    _del(['users'])
  })

  it('isolates refs with the same logical fromPath across roots', async () => {
    const $rootA = getRootSignal({ rootId: '_compat_ref_root_A' })
    const $rootB = getRootSignal({ rootId: '_compat_ref_root_B' })

    _set(['users', 'a'], { name: 'Alice' })
    _set(['users', 'b'], { name: 'Bob' })

    $rootA._session.user.ref('users.a')
    $rootB._session.user.ref('users.b')

    assert.equal($rootA._session.user.name.get(), 'Alice')
    assert.equal($rootB._session.user.name.get(), 'Bob')
  })

  it('removeRef only affects the owning root', async () => {
    const $rootA = getRootSignal({ rootId: '_compat_remove_ref_A' })
    const $rootB = getRootSignal({ rootId: '_compat_remove_ref_B' })

    _set(['users', 'a'], { name: 'Alice' })
    _set(['users', 'b'], { name: 'Bob' })

    $rootA._session.user.ref('users.a')
    $rootB._session.user.ref('users.b')

    $rootA._session.user.removeRef()
    _set(['users', 'a', 'name'], 'Alice 2')
    _set(['users', 'b', 'name'], 'Bob 2')

    assert.equal($rootA._session.user.name.get(), 'Alice')
    assert.equal($rootB._session.user.name.get(), 'Bob 2')
  })

  it('does not expose private model events by root', async () => {
    const $rootA = getRootSignal({ rootId: '_compat_events_private_A' })
    const $rootB = getRootSignal({ rootId: '_compat_events_private_B' })

    assert.throws(
      () => $rootA.on('change', '_session.userId', () => {}),
      /model events are not supported/
    )
    assert.throws(
      () => $rootB.on('change', '_session.userId', () => {}),
      /model events are not supported/
    )

    await $rootA._session.userId.set('a')
    await $rootB._session.userId.set('b')

    assert.equal($rootA._session.userId.get(), 'a')
    assert.equal($rootB._session.userId.get(), 'b')
  })

  it('does not expose public model events by root', async () => {
    const $rootA = getRootSignal({ rootId: '_compat_events_public_A' })
    const $rootB = getRootSignal({ rootId: '_compat_events_public_B' })

    assert.throws(
      () => $rootA.on('change', 'users.a.name', () => {}),
      /model events are not supported/
    )
    assert.throws(
      () => $rootB.on('change', 'users.a.name', () => {}),
      /model events are not supported/
    )

    _set(['users', 'a', 'name'], 'Alice')

    assert.equal($rootA.users.a.name.get(), 'Alice')
    assert.equal($rootB.users.a.name.get(), 'Alice')
  })

  it('syncs refs through internal model changes without exposing events', async () => {
    const $rootA = getRootSignal({ rootId: '_compat_ref_events_A' })
    const $rootB = getRootSignal({ rootId: '_compat_ref_events_B' })

    _set(['users', 'a'], { name: 'Alice' })
    _set(['users', 'b'], { name: 'Bob' })

    $rootA._session.user.ref('users.a')
    $rootB._session.user.ref('users.b')

    assert.throws(
      () => $rootA.on('change', '_session.user.name', () => {}),
      /model events are not supported/
    )
    assert.throws(
      () => $rootB.on('change', '_session.user.name', () => {}),
      /model events are not supported/
    )

    _set(['users', 'a', 'name'], 'Alice 2')
    _set(['users', 'b', 'name'], 'Bob 2')

    assert.equal($rootA._session.user.name.get(), 'Alice 2')
    assert.equal($rootB._session.user.name.get(), 'Bob 2')
  })
})
