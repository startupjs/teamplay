import { defineSchema } from '@teamplay/schema'

export const fullObjectSchema = defineSchema({
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
} as const)

export const shorthandSchema = defineSchema({
  title: { type: 'string', required: true },
  score: { type: 'integer' }
})

export const keywordNamedFieldsSchema = defineSchema({
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
})

export const nestedObjectsAndArraysSchema = defineSchema({
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
      }
    }
  }
})

export const tupleSchema = defineSchema({
  type: 'array',
  items: [
    { type: 'string' },
    { type: 'integer' },
    { type: 'boolean' }
  ]
} as const)

export const nullableSchema = defineSchema({
  type: ['object', 'null'],
  required: ['name'],
  properties: {
    name: { type: 'string' },
    score: { type: ['integer', 'null'] }
  }
} as const)

export const enumSchema = defineSchema({
  type: 'string',
  enum: ['draft', 'published'] as const
})

export const constSchema = defineSchema({
  const: 'system' as const
})

export const unsupportedDynamicSchema: unknown = undefined

export const schemaRuntimeFixtureMatrix = [
  {
    name: 'full object schema',
    schema: fullObjectSchema,
    transform: true,
    expectedPropertyKeys: ['title', 'score', 'meta'],
    expectedRequired: ['title', 'meta']
  },
  {
    name: 'shorthand schema',
    schema: shorthandSchema,
    transform: true,
    expectedPropertyKeys: ['title', 'score'],
    expectedRequired: ['title']
  },
  {
    name: 'keyword-named fields schema',
    schema: keywordNamedFieldsSchema,
    transform: true,
    expectedPropertyKeys: ['title', 'description', 'type', 'required', 'properties'],
    expectedRequired: ['title']
  },
  {
    name: 'nested object and array schema',
    schema: nestedObjectsAndArraysSchema,
    transform: true,
    expectedPropertyKeys: ['team'],
    expectedRequired: ['team']
  },
  {
    name: 'unsupported dynamic schema',
    schema: unsupportedDynamicSchema,
    transform: false,
    expectedPropertyKeys: [],
    expectedRequired: []
  }
] as const
