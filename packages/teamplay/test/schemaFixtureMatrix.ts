import { defineSchema } from '@teamplay/schema'

export const fullObjectSchema = defineSchema({
  type: 'object',
  required: ['title', 'meta'],
  properties: {
    title: {
      type: 'string',
      label: 'Full object title',
      description: 'Title text shown in generated field docs.'
    },
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
  title: {
    type: 'string',
    required: true,
    label: 'Shorthand title'
  },
  score: { type: 'integer' }
})

export const keywordNamedFieldsSchema = defineSchema({
  title: {
    type: 'string',
    required: true,
    description: 'Keyword fixture title.'
  },
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
      name: {
        type: 'string',
        required: true,
        label: 'Team name'
      },
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
    expectedRequired: ['title', 'meta'],
    generatedEnv: {
      collectionName: 'schemaFullObjects',
      expectedFieldNames: ['title', 'score', 'meta'],
      expectedJsdocSnippets: ['Full object title', 'Title text shown in generated field docs.']
    }
  },
  {
    name: 'shorthand schema',
    schema: shorthandSchema,
    transform: true,
    expectedPropertyKeys: ['title', 'score'],
    expectedRequired: ['title'],
    generatedEnv: {
      collectionName: 'schemaShorthands',
      expectedFieldNames: ['title', 'score'],
      expectedJsdocSnippets: ['Shorthand title']
    }
  },
  {
    name: 'keyword-named fields schema',
    schema: keywordNamedFieldsSchema,
    transform: true,
    expectedPropertyKeys: ['title', 'description', 'type', 'required', 'properties'],
    expectedRequired: ['title'],
    generatedEnv: {
      collectionName: 'schemaKeywordFields',
      expectedFieldNames: ['title', 'description', 'type', 'required', 'properties'],
      expectedJsdocSnippets: ['Keyword fixture title.']
    }
  },
  {
    name: 'nested object and array schema',
    schema: nestedObjectsAndArraysSchema,
    transform: true,
    expectedPropertyKeys: ['team'],
    expectedRequired: ['team'],
    generatedEnv: {
      collectionName: 'schemaNestedObjects',
      expectedFieldNames: ['team', 'name', 'players'],
      expectedJsdocSnippets: ['Team name']
    }
  },
  {
    name: 'unsupported dynamic schema',
    schema: unsupportedDynamicSchema,
    transform: false,
    expectedPropertyKeys: [],
    expectedRequired: [],
    generatedEnv: {
      collectionName: 'schemaDynamic',
      source: [
        "import { defineSchema } from 'teamplay'",
        '',
        "const buildSchema = () => ({ title: { type: 'string' } })",
        '',
        'export default defineSchema(buildSchema())',
        ''
      ].join('\n'),
      expectedFieldNames: []
    }
  }
] as const
