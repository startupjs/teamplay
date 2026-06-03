import { afterEach, describe, it } from 'mocha'
import { strict as assert } from 'node:assert'
import { $, GLOBAL_ROOT_ID, getRootSignal, setPublicOnly } from '../src/index.ts'
import {
  __resetPrivateDataWarningsForTests,
  delPrivateData
} from '../src/orm/privateData.js'
import { __resetRootContextsForTests } from '../src/orm/rootContext.ts'

describe('publicOnly', () => {
  const initialCompatFlag = globalThis.teamplayCompatibilityMode

  afterEach(async () => {
    setPublicOnly(false)
    globalThis.teamplayCompatibilityMode = initialCompatFlag
    const originalWarn = console.warn
    console.warn = () => {}
    try {
      delPrivateData(GLOBAL_ROOT_ID, ['_session'])
    } finally {
      console.warn = originalWarn
      __resetPrivateDataWarningsForTests()
    }
    __resetRootContextsForTests()
  })

  it('is a no-op in noncompat mode', async () => {
    globalThis.teamplayCompatibilityMode = false
    setPublicOnly(true)

    const $root = getRootSignal({ rootId: 'public-only-noncompat' })

    await $root._session.userId.set('u1')
    await $root._session.roles.set(['admin'])
    await $root._session.roles.push('editor')

    assert.equal($root._session.userId.get(), 'u1')
    assert.deepEqual($root._session.roles.get(), ['admin', 'editor'])
  })

  it('is a no-op in compat mode', async () => {
    globalThis.teamplayCompatibilityMode = true
    setPublicOnly(true)

    const $root = getRootSignal({ rootId: 'public-only-compat' })

    await $root._session.userId.set('u1')
    await $root._session.roles.set(['admin'])
    await $root._session.roles.push('editor')

    assert.equal($root._session.userId.get(), 'u1')
    assert.deepEqual($root._session.roles.get(), ['admin', 'editor'])
  })

  it('warns once for private writes through the global server root', async () => {
    const originalWarn = console.warn
    const warnings = []
    console.warn = (...args) => warnings.push(args)

    try {
      await $._session.userId.set('u1')
      await $._session.roles.set(['admin'])
      await $._session.roles.push('editor')
    } finally {
      console.warn = originalWarn
    }

    assert.equal(warnings.length, 1)
    assert.match(warnings[0][0], /Writing to private collection "_session" on the global server root/)
  })

  it('does not warn for private writes through an explicit root', async () => {
    const originalWarn = console.warn
    const warnings = []
    console.warn = (...args) => warnings.push(args)

    try {
      const $root = getRootSignal({ rootId: 'request-private-root' })
      await $root._session.userId.set('u1')
      await $root._session.roles.set(['admin'])
      await $root._session.roles.push('editor')
    } finally {
      console.warn = originalWarn
    }

    assert.deepEqual(warnings, [])
  })
})
