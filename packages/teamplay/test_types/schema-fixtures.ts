import type { FromJsonSchema } from 'teamplay'
import {
  constSchema,
  enumSchema,
  fullObjectSchema,
  keywordNamedFieldsSchema,
  nestedObjectsAndArraysSchema,
  nullableSchema,
  shorthandSchema,
  tupleSchema,
  unsupportedDynamicSchema
} from '../test/schemaFixtureMatrix.ts'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false

type Expect<T extends true> = T

const patternPropertiesBooleanSchema = {
  type: 'object',
  additionalProperties: false,
  patternProperties: {
    '^flag-[a-z]+$': { type: 'boolean' }
  }
} as const

const additionalPropertiesFalseSchema = {
  type: 'object',
  required: ['title'],
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    score: { type: 'integer' }
  }
} as const

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
  Expect<Equal<FromJsonSchema<typeof patternPropertiesBooleanSchema>, Record<string, boolean>>>,
  Expect<Equal<FromJsonSchema<typeof additionalPropertiesFalseSchema>, {
    title: string
    score?: number
  }>>,
  Expect<Equal<FromJsonSchema<typeof unsupportedDynamicSchema>, unknown>>
]

declare const schemaFixtureAssertions: SchemaFixtureAssertions
void schemaFixtureAssertions
