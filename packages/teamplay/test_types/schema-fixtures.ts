import { defineSchema, type FromJsonSchema } from 'teamplay'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false

type Expect<T extends true> = T

const fullObjectSchema = defineSchema({
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

const shorthandSchema = defineSchema({
  title: { type: 'string', required: true },
  score: { type: 'integer' }
})

const keywordNamedFieldsSchema = defineSchema({
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

const nestedObjectsAndArraysSchema = defineSchema({
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

const tupleSchema = defineSchema({
  type: 'array',
  items: [
    { type: 'string' },
    { type: 'integer' },
    { type: 'boolean' }
  ]
} as const)

const nullableSchema = defineSchema({
  type: ['object', 'null'],
  required: ['name'],
  properties: {
    name: { type: 'string' },
    score: { type: ['integer', 'null'] }
  }
} as const)

const enumSchema = defineSchema({
  type: 'string',
  enum: ['draft', 'published'] as const
})

const constSchema = defineSchema({
  const: 'system' as const
})

declare const dynamicSchema: unknown

type SchemaFixtureAssertions = [
  Expect<Equal<FromJsonSchema<typeof fullObjectSchema>, {
    title: string
    meta: {
      createdAt: number
      flags?: string[]
    }
    score?: number
  }>>,
  Expect<Equal<FromJsonSchema<typeof shorthandSchema>, {
    title: string
    score?: number
  }>>,
  Expect<Equal<FromJsonSchema<typeof keywordNamedFieldsSchema>, {
    title: string
    description?: string
    type?: string
    required?: boolean
    properties?: {
      color: string
    }
  }>>,
  Expect<Equal<FromJsonSchema<typeof nestedObjectsAndArraysSchema>, {
    team: {
      name: string
      players?: Array<{
        id: string
        active?: boolean
      }>
    }
  }>>,
  Expect<Equal<FromJsonSchema<typeof tupleSchema>, readonly [string, number, boolean]>>,
  Expect<Equal<FromJsonSchema<typeof nullableSchema>, {
    name: string
    score?: number | null
  } | null>>,
  Expect<Equal<FromJsonSchema<typeof enumSchema>, 'draft' | 'published'>>,
  Expect<Equal<FromJsonSchema<typeof constSchema>, 'system'>>,
  Expect<Equal<FromJsonSchema<typeof dynamicSchema>, unknown>>
]

declare const schemaFixtureAssertions: SchemaFixtureAssertions
void schemaFixtureAssertions
