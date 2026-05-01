import { strict as assert } from 'assert'
import {
  getSchemaPropertiesObject,
  isJsonSchemaKeyword,
  transformSchema
} from '@teamplay/schema'

describe('schema introspection helpers', () => {
  it('normalizes full object and shorthand object schemas consistently', () => {
    const fullObjectSchema = {
      type: 'object',
      required: ['title', 'meta'],
      properties: {
        title: { type: 'string' },
        score: { type: 'integer' },
        meta: {
          type: 'object',
          required: ['createdAt'],
          properties: {
            createdAt: { type: 'number' },
            flags: {
              type: 'array',
              items: { type: 'string' }
            }
          }
        }
      }
    }
    const shorthandSchema = {
      title: { type: 'string', required: true },
      score: { type: 'integer' }
    }

    const transformedFull = transformSchema(fullObjectSchema)
    const transformedShorthand = transformSchema(shorthandSchema)

    assert.deepEqual(transformedFull.required, ['title', 'meta'])
    assert.deepEqual(Object.keys(getSchemaPropertiesObject(transformedFull)), ['title', 'score', 'meta'])
    assert.deepEqual(transformedFull.properties.meta.required, ['createdAt'])
    assert.equal(transformedFull.properties.meta.properties.flags.type, 'array')
    assert.deepEqual(transformedShorthand.required, ['title'])
    assert.deepEqual(Object.keys(getSchemaPropertiesObject(transformedShorthand)), ['title', 'score'])
    assert.equal(transformedShorthand.properties.title.required, undefined)
  })

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

  it('keeps nested objects, arrays, tuples, nullable values, enum, and const schema metadata intact', () => {
    const schema = {
      team: {
        type: 'object',
        required: true,
        properties: {
          name: { type: 'string', required: true },
          players: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id'],
              properties: {
                id: { type: 'string' },
                active: { type: 'boolean' }
              }
            }
          },
          tuple: {
            type: 'array',
            items: [
              { type: 'string' },
              { type: 'integer' },
              { type: 'boolean' }
            ]
          },
          nullableScore: { type: ['integer', 'null'] },
          status: { type: 'string', enum: ['draft', 'published'] },
          source: { const: 'system' }
        }
      }
    }

    const transformed = transformSchema(schema)
    const team = transformed.properties.team

    assert.deepEqual(transformed.required, ['team'])
    assert.equal(team.required, undefined)
    assert.equal(team.properties.name.required, undefined)
    assert.deepEqual(team.properties.players.items.required, ['id'])
    assert.equal(team.properties.players.items.properties.id.type, 'string')
    assert.equal(Array.isArray(team.properties.tuple.items), true)
    assert.deepEqual(team.properties.nullableScore.type, ['integer', 'null'])
    assert.deepEqual(team.properties.status.enum, ['draft', 'published'])
    assert.equal(team.properties.source.const, 'system')
  })

  it('returns no static properties for unsupported dynamic schemas', () => {
    assert.deepEqual(getSchemaPropertiesObject(undefined), {})
    assert.deepEqual(Object.keys(getSchemaPropertiesObject(() => ({ title: { type: 'string' } }))), [])
  })
})
