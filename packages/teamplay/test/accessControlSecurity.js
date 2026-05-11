import assert from 'node:assert/strict'
import initAccessControl, { hasForcedAccessControls } from '../../backend/features/accessControl.js'
import { accessControl } from '@teamplay/utils/accessControl'

describe('access control security modes', () => {
  it('keeps full access control deny-by-default for collections without rules', async () => {
    const access = initAccessControl(createBackend(), {
      models: {},
      openByDefault: false
    })

    assert.equal(await access.check('Read', 'public', { session: {}, docId: 'doc' }), false)
    assert.equal(await access.check('Create', 'public', { session: {}, docId: 'doc' }), false)
  })

  it('protects only forced and server-only collections in force-only mode', async () => {
    const models = {
      auths: {
        access: accessControl({
          read: ({ session, docId }) => session.userId === docId
        }, { force: true })
      },
      public: {
        access: accessControl({
          read: false
        })
      }
    }
    const access = initAccessControl(createBackend(), {
      models,
      forceOnly: true,
      openByDefault: true,
      serverOnlyCollections: ['service']
    })

    assert.equal(await access.check('Read', 'public', { session: {}, docId: 'doc' }), true)
    assert.equal(await access.check('Read', 'auths', { session: { userId: 'u1' }, docId: 'u1' }), true)
    assert.equal(await access.check('Read', 'auths', { session: { userId: 'u2' }, docId: 'u1' }), false)
    assert.equal(await access.check('Create', 'auths', { session: { userId: 'u1' }, docId: 'u1' }), false)
    assert.equal(await access.check('Read', 'service', { session: { userId: 'u1' }, docId: 'token' }), false)
    assert.equal(await access.check('Create', 'service', { session: { userId: 'u1' }, docId: 'token' }), false)
  })

  it('detects forced model access rules', () => {
    assert.equal(hasForcedAccessControls({
      auths: {
        access: accessControl({ read: true }, { force: true })
      }
    }), true)
    assert.equal(hasForcedAccessControls({
      public: {
        access: accessControl({ read: true })
      }
    }), false)
  })
})

function createBackend () {
  return {
    use () {}
  }
}
