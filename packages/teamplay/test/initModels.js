import assert from 'node:assert/strict'
import Signal from '../orm/Signal.ts'
import initModels, { getModels, resetModelsForTests } from '../orm/initModels.ts'
import { findModel } from '../orm/addModel.ts'

describe('initModels', () => {
  afterEach(() => {
    resetModelsForTests()
  })

  it('registers model classes and stores the full models object', () => {
    class Users extends Signal {}
    const models = { users: { default: Users, schema: {} } }

    initModels(models)

    assert.equal(getModels(), models)
    assert.equal(findModel(['users']), Users)
  })

  it('allows repeated registration of the same class', () => {
    class Users extends Signal {}
    const models = { users: { default: Users } }

    initModels(models)
    assert.doesNotThrow(() => initModels(models))
  })

  it('throws when the same pattern is registered with a different class', () => {
    class Users extends Signal {}
    class OtherUsers extends Signal {}

    initModels({ users: { default: Users } })

    assert.throws(
      () => initModels({ users: { default: OtherUsers } }),
      /Model for pattern "users" already exists/
    )
    assert.equal(getModels().users.default, Users)
  })
})
