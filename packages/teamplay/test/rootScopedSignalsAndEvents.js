import { describe, it, afterEach } from 'mocha'
import { strict as assert } from 'node:assert'
import { getRootSignal } from '../src/index.ts'
import { del as _del } from '../src/orm/dataTree.js'
import { __resetRootContextsForTests } from '../src/orm/rootContext.ts'

const describeCompat = process.env.TEAMPLAY_COMPAT === '1' ? describe : describe.skip

describeCompat('root-scoped compat signals', () => {
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

})
