import assert from 'assert'
import ShareDbAccess from '../lib/index.js'

describe('OPEN BY DEFAULT', function () {
  it('allows unprotected collections and denies protected collections without allow rules', async () => {
    const backend = createBackend()
    const shareDBAccess = new ShareDbAccess(backend, { openByDefault: true })

    backend.protectAccessCollection('service')

    assert.equal(await shareDBAccess.check('Read', 'public', {}), true)
    assert.equal(await shareDBAccess.check('Read', 'service', {}), false)
    assert.equal(await shareDBAccess.check('Create', 'service', {}), false)
    assert.equal(await shareDBAccess.check('Update', 'service', {}), false)
    assert.equal(await shareDBAccess.check('Delete', 'service', {}), false)
  })

  it('uses normal allow rules for protected collections', async () => {
    const backend = createBackend()
    const shareDBAccess = new ShareDbAccess(backend, { openByDefault: true })

    backend.protectAccessCollection('auths')
    backend.allowRead('auths', ({ session, docId }) => session.userId === docId)

    assert.equal(await shareDBAccess.check('Read', 'public', {}), true)
    assert.equal(await shareDBAccess.check('Read', 'auths', { session: { userId: 'u1' }, docId: 'u1' }), true)
    assert.equal(await shareDBAccess.check('Read', 'auths', { session: { userId: 'u2' }, docId: 'u1' }), false)
    assert.equal(await shareDBAccess.check('Create', 'auths', { session: { userId: 'u1' }, docId: 'u1' }), false)
  })

  it('keeps the original deny-by-default behavior when openByDefault is off', async () => {
    const backend = createBackend()
    const shareDBAccess = new ShareDbAccess(backend)

    assert.equal(await shareDBAccess.check('Read', 'public', {}), false)
  })
})

function createBackend () {
  return {
    use () {}
  }
}
