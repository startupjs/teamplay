import { afterEach, beforeEach, describe, it } from 'mocha'
import { strict as assert } from 'node:assert'
import { $, GLOBAL_ROOT_ID, getRootSignal } from '../src/index.ts'
import {
  __resetPrivateDataWarningsForTests,
  delPrivateData
} from '../src/orm/privateData.js'
import { __resetRootContextsForTests } from '../src/orm/rootContext.ts'

describe('private data warnings', () => {
  beforeEach(() => {
    __resetPrivateDataWarningsForTests()
  })

  afterEach(async () => {
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
