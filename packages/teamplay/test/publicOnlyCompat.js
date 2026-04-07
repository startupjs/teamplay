import { afterEach, describe, it } from 'mocha'
import { strict as assert } from 'node:assert'
import { getRootSignal, setPublicOnly } from '../index.js'
import { __resetRootContextsForTests } from '../orm/rootContext.js'

describe('publicOnly', () => {
  const initialCompatFlag = globalThis.teamplayCompatibilityMode

  afterEach(async () => {
    setPublicOnly(false)
    globalThis.teamplayCompatibilityMode = initialCompatFlag
    __resetRootContextsForTests()
  })

  it('blocks private mutations in noncompat mode', async () => {
    globalThis.teamplayCompatibilityMode = false
    setPublicOnly(true)

    const $root = getRootSignal({ rootId: 'public-only-noncompat' })

    await assert.rejects(
      () => $root._session.userId.set('u1'),
      /Can't modify private collections data when 'publicOnly' is enabled/
    )
  })

  it('allows private mutations in compat mode even when publicOnly is enabled', async () => {
    globalThis.teamplayCompatibilityMode = true
    setPublicOnly(true)

    const $root = getRootSignal({ rootId: 'public-only-compat' })

    await $root._session.userId.set('u1')
    await $root._session.roles.set(['admin'])
    await $root._session.roles.push('editor')

    assert.equal($root._session.userId.get(), 'u1')
    assert.deepEqual($root._session.roles.get(), ['admin', 'editor'])
  })
})
