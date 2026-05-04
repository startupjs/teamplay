import { describe, it } from 'mocha'
import { strict as assert } from 'node:assert'
import { $, addModel } from '../src/index.ts'
import Signal from '../src/orm/Signal.ts'

describe('Signal.getCollection() compatibility', () => {
  it('prefers static collection over path collection for compat-mounted model', () => {
    class VirtualFieldModel extends Signal {
      static collection = 'fields'
    }

    addModel('_virtualFields.*', VirtualFieldModel)

    const $field = $._virtualFields.someFieldId
    assert.equal($field.getCollection(), 'fields')
  })
})
