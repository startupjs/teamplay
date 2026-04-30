import { strict as assert } from 'assert'
import {
  getSchemaPropertiesObject,
  isJsonSchemaKeyword,
  transformSchema
} from '@teamplay/schema'

describe('schema introspection helpers', () => {
  it('matches simplified keyword-field schema rules used by type inference', () => {
    const schema = {
      title: { type: 'string', required: true },
      description: { type: 'string' },
      type: { type: 'string' },
      required: { type: 'boolean' },
      properties: {
        type: 'object',
        properties: {
          color: { type: 'string', required: true }
        }
      }
    }

    const transformed = transformSchema(schema)

    assert.equal(isJsonSchemaKeyword('properties'), true)
    assert.equal(transformed.type, 'object')
    assert.deepEqual(transformed.required, ['title'])
    assert.deepEqual(Object.keys(getSchemaPropertiesObject(transformed)), [
      'title',
      'description',
      'type',
      'required',
      'properties'
    ])
    assert.equal(transformed.properties.title.required, undefined)
    assert.equal(transformed.properties.properties.properties.color.required, undefined)
  })
})
