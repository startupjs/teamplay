import assert from 'node:assert/strict'
import Signal from '../orm/Signal.ts'
import initModels, { getModels, resetModelsForTests } from '../orm/initModels.ts'
import { findModel } from '../orm/addModel.ts'
import { defineSchema } from '@teamplay/schema'

describe('initModels', () => {
  let originalWarn
  let originalWarningEnv

  beforeEach(() => {
    originalWarn = console.warn
    originalWarningEnv = process.env.TEAMPLAY_WARN_UNWRAPPED_SCHEMAS
  })

  afterEach(() => {
    console.warn = originalWarn
    if (originalWarningEnv == null) {
      delete process.env.TEAMPLAY_WARN_UNWRAPPED_SCHEMAS
    } else {
      process.env.TEAMPLAY_WARN_UNWRAPPED_SCHEMAS = originalWarningEnv
    }
    resetModelsForTests()
  })

  it('registers model classes and stores the full models object', () => {
    class UsersModel extends Signal {}
    const models = { users: { default: UsersModel, schema: {} } }

    initModels(models)

    assert.equal(getModels(), models)
    assert.equal(findModel(['users']), UsersModel)
  })

  it('allows repeated registration of the same class', () => {
    class UsersModel extends Signal {}
    const models = { users: { default: UsersModel } }

    initModels(models)
    assert.doesNotThrow(() => initModels(models))
  })

  it('throws when the same pattern is registered with a different class', () => {
    class UsersModel extends Signal {}
    class OtherUsersModel extends Signal {}

    initModels({ users: { default: UsersModel } })

    assert.throws(
      () => initModels({ users: { default: OtherUsersModel } }),
      /Model for pattern "users" already exists/
    )
    assert.equal(getModels().users.default, UsersModel)
  })

  it('warns once for plain schemas when schema warnings are enabled', () => {
    const warnings = []
    process.env.TEAMPLAY_WARN_UNWRAPPED_SCHEMAS = '1'
    console.warn = message => warnings.push(message)
    class UsersModel extends Signal {}
    const models = { users: { default: UsersModel, schema: { name: { type: 'string' } } } }

    initModels(models)
    initModels(models)

    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /Schema for model "users" was loaded as a plain object/)
  })

  it('does not warn for schemas wrapped with defineSchema()', () => {
    const warnings = []
    process.env.TEAMPLAY_WARN_UNWRAPPED_SCHEMAS = '1'
    console.warn = message => warnings.push(message)
    class UsersModel extends Signal {}
    const models = {
      users: {
        default: UsersModel,
        schema: defineSchema({ name: { type: 'string' } })
      }
    }

    initModels(models)

    assert.deepEqual(warnings, [])
  })
})
