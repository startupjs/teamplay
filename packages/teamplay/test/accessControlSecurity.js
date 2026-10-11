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

  it('looks rules up by the collection name only: Object.prototype names are plain names', async () => {
    const access = initAccessControl(createBackend(), { models: {}, openByDefault: false })
    const props = { session: { userId: 'u1' }, docId: 'doc' }
    for (const collection of ['constructor', 'hasOwnProperty', 'toString', '__proto__', 'valueOf']) {
      assert.equal(await access.check('Read', collection, props), false, collection)
    }
    access.backend.allowRead('toString', ({ session }) => session.userId === 'u1')
    access.backend.allowRead('constructor', true)
    access.backend.denyRead('constructor', ({ session }) => session.userId === 'u2')
    assert.equal(await access.check('Read', 'toString', props), true)
    assert.equal(await access.check('Read', 'toString', { ...props, session: { userId: 'u2' } }), false)
    assert.equal(await access.check('Read', 'constructor', props), true)
    assert.equal(await access.check('Read', 'constructor', { ...props, session: { userId: 'u2' } }), false)
    assert.equal(await access.check('Read', 'hasOwnProperty', props), false)
  })

  it('remembers nothing about the collections it is asked about', async () => {
    const access = initAccessControl(createBackend(), { models: {}, openByDefault: false })
    const before = rulesSnapshot(access)
    for (let i = 0; i < 100; i++) {
      for (const operation of ['Read', 'Create', 'Update', 'Delete']) {
        await access.check(operation, 'unknown' + i, { session: {}, docId: 'doc' })
      }
    }
    assert.deepEqual(rulesSnapshot(access), before)
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

function rulesSnapshot (access) {
  const snapshot = {}
  for (const rules of [access.allow, access.deny]) {
    for (const operation in rules) snapshot[operation] = (snapshot[operation] || 0) + Object.keys(rules[operation]).length
  }
  return snapshot
}
