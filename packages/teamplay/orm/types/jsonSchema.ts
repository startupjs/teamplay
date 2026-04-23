export interface JsonSchemaObject {
  readonly type?: string | readonly string[]
  readonly properties?: Record<string, JsonSchema>
  readonly items?: JsonSchema | readonly JsonSchema[]
  readonly required?: readonly string[] | boolean
  readonly enum?: readonly unknown[]
  readonly const?: unknown
  readonly additionalProperties?: boolean | JsonSchema
  readonly patternProperties?: Record<string, JsonSchema>
  readonly [keyword: string]: unknown
}

export type JsonSchema = boolean | JsonSchemaObject

export interface ZodLikeSchema {
  readonly _output?: unknown
  readonly _zod?: {
    readonly output?: unknown
  }
}

export type InferZodSchema<TSchema> =
  TSchema extends { readonly _output?: infer Output }
    ? NonNullable<Output>
    : TSchema extends { readonly _zod?: { readonly output?: infer Output } }
      ? NonNullable<Output>
      : unknown

type Prettify<TValue> = {
  [K in keyof TValue]: TValue[K]
}

type PrimitiveFromJsonType<TType> =
  TType extends readonly unknown[] ? PrimitiveFromJsonType<TType[number]>
    : TType extends 'string' ? string
      : TType extends 'number' ? number
        : TType extends 'integer' ? number
          : TType extends 'boolean' ? boolean
            : TType extends 'null' ? null
              : TType extends 'object' | 'array' ? never
                : unknown

type JsonTypeIncludes<TType, TExpected extends string> =
  TType extends TExpected
    ? true
    : TType extends readonly unknown[]
      ? TExpected extends TType[number] ? true : false
      : false

type IsJsonSchemaKeyword<TKey extends string> =
  TKey extends
  | '$id'
  | '$schema'
  | 'type'
  | 'properties'
  | 'items'
  | 'required'
  | 'enum'
  | 'const'
  | 'additionalProperties'
  | 'patternProperties'
  | 'description'
  | 'title'
  | 'default'
  | 'errorMessage'
  | 'validators'
  | 'collection'
  | 'format'
  | 'minimum'
  | 'maximum'
  | 'minLength'
  | 'maxLength'
  | 'minItems'
  | 'maxItems'
  | 'uniqueItems'
    ? true
    : false

type SimplifiedProperties<TSchema> = {
  [K in keyof TSchema as K extends string
    ? IsJsonSchemaKeyword<K> extends true ? never : K
    : never]: TSchema[K]
}

type HasSimplifiedProperties<TSchema> =
  keyof SimplifiedProperties<TSchema> extends never ? false : true

type SchemaProperties<TSchema> =
  TSchema extends { readonly properties?: infer Properties }
    ? Properties extends Record<string, JsonSchema>
      ? Properties
      : Record<string, never>
    : HasSimplifiedProperties<TSchema> extends true
      ? SimplifiedProperties<TSchema>
      : Record<string, never>

type ExplicitRequiredKeys<TSchema, TProperties> =
  TSchema extends { readonly required?: infer Required }
    ? Required extends readonly string[]
      ? Extract<Required[number], keyof TProperties & string>
      : never
    : never

type SimplifiedRequiredKeys<TProperties> = {
  [K in keyof TProperties & string]: TProperties[K] extends { readonly required?: true } ? K : never
}[keyof TProperties & string]

type RequiredKeys<TSchema, TProperties> =
  ExplicitRequiredKeys<TSchema, TProperties> | SimplifiedRequiredKeys<TProperties>

type ObjectFromJsonSchema<TSchema> =
  SchemaProperties<TSchema> extends infer Properties
    ? Properties extends Record<string, unknown>
      ? Prettify<{
        [K in RequiredKeys<TSchema, Properties>]-?: FromJsonSchema<Properties[K]>
      } & {
        [K in Exclude<keyof Properties & string, RequiredKeys<TSchema, Properties>>]?: FromJsonSchema<Properties[K]>
      }>
      : Record<string, unknown>
    : Record<string, unknown>

type ArrayFromJsonSchema<TSchema> =
  TSchema extends { readonly items?: infer Items }
    ? Items extends readonly [infer First, ...infer Rest]
      ? readonly [FromJsonSchema<First>, ...{ [K in keyof Rest]: FromJsonSchema<Rest[K]> }]
      : Items extends JsonSchema
        ? Array<FromJsonSchema<Items>>
        : unknown[]
    : unknown[]

type TypeValueFromJsonSchema<TSchema, TType> =
  PrimitiveFromJsonType<TType> |
  (JsonTypeIncludes<TType, 'object'> extends true ? ObjectFromJsonSchema<TSchema> : never) |
  (JsonTypeIncludes<TType, 'array'> extends true ? ArrayFromJsonSchema<TSchema> : never)

export type FromJsonSchema<TSchema> =
  TSchema extends false
    ? never
    : TSchema extends true
      ? unknown
      : TSchema extends { readonly const?: infer Const }
        ? Const
        : TSchema extends { readonly enum?: ReadonlyArray<infer EnumValue> }
          ? EnumValue
          : TSchema extends { readonly type?: infer Type }
            ? TypeValueFromJsonSchema<TSchema, Type>
            : HasSimplifiedProperties<TSchema> extends true
              ? ObjectFromJsonSchema<TSchema>
              : unknown
