import { afterEach, describe, it } from 'mocha'
import { strict as assert } from 'node:assert'
import { getRootContext, __resetRootContextsForTests } from '../orm/rootContext.js'
import {
  getPrivateDataRoot,
  getPrivateData,
  setPrivateData,
  delPrivateData,
  getPrivateDataSnapshot
} from '../orm/privateData.js'

afterEach(() => {
  __resetRootContextsForTests()
})

describe('privateData infrastructure', () => {
  it('stores private data independently per root context', () => {
    setPrivateData('rootA', ['_session', 'userId'], 'a')
    setPrivateData('rootB', ['_session', 'userId'], 'b')
    setPrivateData('rootA', ['_page', 'tab'], 'home')

    assert.equal(getPrivateData('rootA', ['_session', 'userId']), 'a')
    assert.equal(getPrivateData('rootB', ['_session', 'userId']), 'b')
    assert.equal(getPrivateData('rootA', ['_page', 'tab']), 'home')
    assert.equal(getPrivateData('rootB', ['_page', 'tab']), undefined)
  })

  it('exposes per-root private data root and deep snapshot', () => {
    setPrivateData('rootA', ['_session', 'user'], { id: 'u1', settings: { lang: 'en' } })

    const rootData = getPrivateDataRoot('rootA')
    const snapshot = getPrivateDataSnapshot('rootA')

    assert.deepEqual(rootData, {
      _session: {
        user: { id: 'u1', settings: { lang: 'en' } }
      }
    })
    assert.deepEqual(snapshot, rootData)

    snapshot._session.user.settings.lang = 'tr'
    assert.equal(getPrivateData('rootA', ['_session', 'user', 'settings', 'lang']), 'en')
  })

  it('deletes private data paths and prunes empty parent objects', () => {
    setPrivateData('rootA', ['_session', 'userId'], 'a')
    setPrivateData('rootA', ['_session', 'flags', 'enabled'], true)

    delPrivateData('rootA', ['_session', 'userId'])
    assert.equal(getPrivateData('rootA', ['_session', 'userId']), undefined)
    assert.deepEqual(getPrivateDataRoot('rootA'), {
      _session: {
        flags: { enabled: true }
      }
    })

    delPrivateData('rootA', ['_session', 'flags', 'enabled'])
    assert.deepEqual(getPrivateDataRoot('rootA'), {})
    assert.equal(getRootContext('rootA', false).isRuntimeEmpty(), true)
  })

  it('tracks private data inside root context runtime emptiness', () => {
    const context = getRootContext('rootA')
    assert.equal(context.isRuntimeEmpty(), true)

    setPrivateData('rootA', ['_page', 'tab'], 'summary')
    assert.equal(context.isRuntimeEmpty(), false)

    context.resetPrivateData()
    assert.equal(context.isRuntimeEmpty(), true)
  })
})
