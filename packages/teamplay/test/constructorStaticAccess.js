import { describe, it } from 'mocha'
import { strict as assert } from 'node:assert'
import { $, addModel } from '../src/index.ts'
import Signal from '../src/orm/Signal.ts'

describe('Signal method this.constructor static access', () => {
  it('resolves constructor to model class inside method body', () => {
    class ConstructorAccessModel extends Signal {
      static collection = 'constructorAccessModels'
      static textIdSearchRegExp = /textId$/

      hasTextIdKey (key) {
        return this.constructor.textIdSearchRegExp.test(key)
      }
    }

    addModel('constructorAccessModels.*', ConstructorAccessModel)

    const $doc = $.constructorAccessModels.testDoc
    assert.equal($doc.hasTextIdKey('maintextId'), true)
    assert.equal($doc.hasTextIdKey('otherKey'), false)
  })
})
