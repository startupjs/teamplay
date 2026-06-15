import { describe, it, afterEach } from 'mocha'
import { strict as assert } from 'node:assert'
import { getRootSignal } from '../src/index.ts'
import { del as _del, set as _set } from '../src/orm/dataTree.js'
import { __resetRootContextsForTests } from '../src/orm/rootContext.ts'

const describeCompat = process.env.TEAMPLAY_COMPAT === '1' ? describe : describe.skip

describeCompat('root-scoped signals without public model events', () => {
  afterEach(() => {
    __resetRootContextsForTests()
    _del(['users'])
  })

  it('isolates private data with the same logical path across roots', async () => {
    const $rootA = getRootSignal({ rootId: '_compat_private_root_A' })
    const $rootB = getRootSignal({ rootId: '_compat_private_root_B' })

    await $rootA._session.user.name.set('Alice')
    await $rootB._session.user.name.set('Bob')

    assert.equal($rootA._session.user.name.get(), 'Alice')
    assert.equal($rootB._session.user.name.get(), 'Bob')
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
})
