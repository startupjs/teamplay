import { afterEach, beforeEach, describe, it } from 'mocha'
import { strict as assert } from 'node:assert'
import { setDefaultFetchOnly, getDefaultFetchOnly } from '../orm/connection.ts'
import { getRootFetchOnly, getRootSignal } from '../orm/Root.ts'
import { __getRootContextForTests, __resetRootContextsForTests } from '../orm/rootContext.js'

let previousDefaultFetchOnly

describe('root-level fetchOnly config', () => {
  beforeEach(() => {
    previousDefaultFetchOnly = getDefaultFetchOnly()
  })

  afterEach(() => {
    setDefaultFetchOnly(previousDefaultFetchOnly)
    __resetRootContextsForTests()
  })

  it('stores explicit fetchOnly in RootContext', () => {
    const $root = getRootSignal({ rootId: 'fetch-root-explicit', fetchOnly: true })

    assert.equal(getRootFetchOnly($root), true)
    assert.equal(__getRootContextForTests('fetch-root-explicit')?.getFetchOnly(), true)
  })

  it('uses connection default fetchOnly for new roots', () => {
    setDefaultFetchOnly(true)
    const $root = getRootSignal({ rootId: 'fetch-root-default' })

    assert.equal(getRootFetchOnly($root), true)
    assert.equal(__getRootContextForTests('fetch-root-default')?.getFetchOnly(), true)
  })

  it('allows roots to differ in fetchOnly', () => {
    setDefaultFetchOnly(false)

    const $rootA = getRootSignal({ rootId: 'fetch-root-a', fetchOnly: true })
    const $rootB = getRootSignal({ rootId: 'fetch-root-b', fetchOnly: false })

    assert.equal(getRootFetchOnly($rootA), true)
    assert.equal(getRootFetchOnly($rootB), false)
  })

  it('does not let later default changes affect existing roots', () => {
    setDefaultFetchOnly(false)
    const $root = getRootSignal({ rootId: 'fetch-root-stable' })

    setDefaultFetchOnly(true)

    assert.equal(getRootFetchOnly($root), false)
    assert.equal(__getRootContextForTests('fetch-root-stable')?.getFetchOnly(), false)
  })
})
