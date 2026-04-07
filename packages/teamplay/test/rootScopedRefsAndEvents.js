import { describe, it, afterEach } from 'mocha'
import { strict as assert } from 'node:assert'
import { getRootSignal } from '../index.js'
import { del as _del, set as _set, ROOTS_BUCKET } from '../orm/dataTree.js'
import { __resetModelEventsForTests } from '../orm/Compat/modelEvents.js'
import { __resetRefLinksForTests } from '../orm/Compat/refRegistry.js'
import { __resetSilentContextForTests } from '../orm/Compat/silentContext.js'

const describeCompat = process.env.TEAMPLAY_COMPAT === '1' ? describe : describe.skip

describeCompat('root-scoped refs and model events', () => {
  afterEach(() => {
    __resetModelEventsForTests()
    __resetRefLinksForTests()
    __resetSilentContextForTests()
    _del([ROOTS_BUCKET])
    _del(['users'])
  })

  it('isolates refs with the same logical fromPath across roots', async () => {
    const $rootA = getRootSignal({ rootId: '_compat_ref_root_A' })
    const $rootB = getRootSignal({ rootId: '_compat_ref_root_B' })

    _set(['users', 'a'], { name: 'Alice' })
    _set(['users', 'b'], { name: 'Bob' })

    $rootA._session.ref('user', 'users.a')
    $rootB._session.ref('user', 'users.b')

    assert.equal($rootA._session.user.name.get(), 'Alice')
    assert.equal($rootB._session.user.name.get(), 'Bob')
  })

  it('removeRef only affects the owning root', async () => {
    const $rootA = getRootSignal({ rootId: '_compat_remove_ref_A' })
    const $rootB = getRootSignal({ rootId: '_compat_remove_ref_B' })

    _set(['users', 'a'], { name: 'Alice' })
    _set(['users', 'b'], { name: 'Bob' })

    $rootA._session.ref('user', 'users.a')
    $rootB._session.ref('user', 'users.b')

    $rootA._session.removeRef('user')
    _set(['users', 'a', 'name'], 'Alice 2')
    _set(['users', 'b', 'name'], 'Bob 2')

    assert.equal($rootA._session.user.name.get(), 'Alice')
    assert.equal($rootB._session.get('user.name'), 'Bob 2')
  })

  it('isolates private model events by root', async () => {
    const $rootA = getRootSignal({ rootId: '_compat_events_private_A' })
    const $rootB = getRootSignal({ rootId: '_compat_events_private_B' })
    const eventsA = []
    const eventsB = []

    $rootA.on('change', '_session.userId', value => eventsA.push(value))
    $rootB.on('change', '_session.userId', value => eventsB.push(value))

    await $rootA._session.userId.set('a')
    await $rootB._session.userId.set('b')

    assert.deepEqual(eventsA, ['a'])
    assert.deepEqual(eventsB, ['b'])
  })

  it('dispatches public model events only to roots that subscribed', async () => {
    const $rootA = getRootSignal({ rootId: '_compat_events_public_A' })
    const $rootB = getRootSignal({ rootId: '_compat_events_public_B' })
    const eventsA = []
    const eventsB = []

    $rootA.on('change', 'users.a.name', value => eventsA.push(value))
    $rootB.on('change', 'users.a.name', value => eventsB.push(value))

    _set(['users', 'a', 'name'], 'Alice')

    assert.deepEqual(eventsA, ['Alice'])
    assert.deepEqual(eventsB, ['Alice'])
  })

  it('propagates events through refs without crossing roots', async () => {
    const $rootA = getRootSignal({ rootId: '_compat_ref_events_A' })
    const $rootB = getRootSignal({ rootId: '_compat_ref_events_B' })
    const eventsA = []
    const eventsB = []

    _set(['users', 'a'], { name: 'Alice' })
    _set(['users', 'b'], { name: 'Bob' })

    $rootA._session.ref('user', 'users.a')
    $rootB._session.ref('user', 'users.b')

    $rootA.on('change', '_session.user.name', value => eventsA.push(value))
    $rootB.on('change', '_session.user.name', value => eventsB.push(value))

    _set(['users', 'a', 'name'], 'Alice 2')
    _set(['users', 'b', 'name'], 'Bob 2')

    assert.deepEqual(eventsA, ['Alice 2'])
    assert.deepEqual(eventsB, ['Bob 2'])
  })
})
