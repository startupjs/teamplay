export const SEGMENTS: unique symbol
export const ARRAY_METHOD: unique symbol
export const GET: unique symbol
export const GETTERS: unique symbol
export const DEFAULT_GETTERS: readonly string[]

export type PathSegment = string | number
export type SignalPath = readonly PathSegment[]

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
  TType extends 'string' ? string
    : TType extends 'number' ? number
      : TType extends 'integer' ? number
        : TType extends 'boolean' ? boolean
          : TType extends 'null' ? null
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
            ? JsonTypeIncludes<Type, 'object'> extends true
              ? ObjectFromJsonSchema<TSchema>
              : JsonTypeIncludes<Type, 'array'> extends true
                ? ArrayFromJsonSchema<TSchema>
                : PrimitiveFromJsonType<Type>
            : HasSimplifiedProperties<TSchema> extends true
              ? ObjectFromJsonSchema<TSchema>
              : unknown

export type SignalClass<TValue = unknown> = new (segments: PathSegment[]) => Signal<TValue>

export type SignalInstance<TModel> =
  TModel extends new (...args: any[]) => infer Instance ? Instance : Signal

type IsExactlyBaseSignalClass<TModel> =
  [TModel] extends [typeof Signal]
    ? [typeof Signal] extends [TModel]
        ? true
        : false
    : false

type SignalModelInstance<TValue, TModel> =
  IsExactlyBaseSignalClass<TModel> extends true
    ? Signal<TValue>
    : Signal<TValue> & SignalInstance<TModel>

export type AnySignal = Signal<any>

export type TypedSignal<
  TValue = unknown,
  TModel extends SignalClass<any> = typeof Signal
> = SignalModelInstance<TValue, TModel> & SignalChildren<TValue>

export type DocumentSignal<
  TValue = unknown,
  TModel extends SignalClass<any> = typeof Signal
> = TypedSignal<TValue, TModel>

export type CollectionSignal<
  TDocument = unknown,
  TCollectionModel extends SignalClass<any> = typeof Signal,
  TDocumentModel extends SignalClass<any> = typeof Signal
> = SignalModelInstance<TDocument[], TCollectionModel> & {
  readonly [documentId: string]: DocumentSignal<TDocument, TDocumentModel>
  add: (value: TDocument) => Promise<string>
}

export type QuerySignal<
  TDocument = unknown,
  TDocumentModel extends SignalClass<any> = typeof Signal
> = Signal<TDocument[]> & {
  readonly [index: number]: DocumentSignal<TDocument, TDocumentModel>
  [Symbol.iterator]: () => IterableIterator<DocumentSignal<TDocument, TDocumentModel>>
  map: <TResult>(
    callback: (
      value: DocumentSignal<TDocument, TDocumentModel>,
      index: number,
      array: Array<DocumentSignal<TDocument, TDocumentModel>>
    ) => TResult
  ) => TResult[]
  reduce: <TResult>(
    callback: (
      previousValue: TResult,
      currentValue: DocumentSignal<TDocument, TDocumentModel>,
      currentIndex: number,
      array: Array<DocumentSignal<TDocument, TDocumentModel>>
    ) => TResult,
    initialValue: TResult
  ) => TResult
  find: (
    predicate: (
      value: DocumentSignal<TDocument, TDocumentModel>,
      index: number,
      obj: Array<DocumentSignal<TDocument, TDocumentModel>>
    ) => unknown
  ) => DocumentSignal<TDocument, TDocumentModel> | undefined
}

export type AggregationSignal<
  TDocument = unknown,
  TDocumentModel extends SignalClass<any> = typeof Signal
> = QuerySignal<TDocument, TDocumentModel>

export type CollectionDocument<TSpec> =
  TSpec extends CollectionSpec<infer Document, any, any> ? Document
    : TSpec extends JsonSchema ? FromJsonSchema<TSpec>
      : unknown

export type CollectionDocumentModel<TSpec> =
  TSpec extends CollectionSpec<any, any, infer DocumentModel> ? DocumentModel
    : typeof Signal

export type SignalChild<TValue> =
  DocumentSignal<TValue>

export type SignalChildren<TValue> =
  NonNullable<TValue> extends ReadonlyArray<infer Item>
    ? Readonly<Record<number, DocumentSignal<Item>>>
    : NonNullable<TValue> extends object
      ? {
          readonly [K in keyof NonNullable<TValue> & string]-?: SignalChild<NonNullable<TValue>[K]>
        }
      : Record<string, never>

export interface CollectionSpec<
  TDocument = unknown,
  TCollectionModel extends SignalClass<any> = typeof Signal,
  TDocumentModel extends SignalClass<any> = typeof Signal
> {
  readonly document: TDocument
  readonly collectionModel: TCollectionModel
  readonly documentModel: TDocumentModel
}

export type JsonSchemaSpec<
  TSchema,
  TCollectionModel extends SignalClass<any> = typeof Signal,
  TDocumentModel extends SignalClass<any> = typeof Signal
> = CollectionSpec<FromJsonSchema<TSchema>, TCollectionModel, TDocumentModel>

export type ZodSchemaSpec<
  TSchema extends ZodLikeSchema,
  TCollectionModel extends SignalClass<any> = typeof Signal,
  TDocumentModel extends SignalClass<any> = typeof Signal
> = CollectionSpec<InferZodSchema<TSchema>, TCollectionModel, TDocumentModel>

export type CollectionSignalFromSpec<TSpec> =
  TSpec extends CollectionSpec<infer Document, infer CollectionModel, infer DocumentModel>
    ? CollectionSignal<Document, CollectionModel, DocumentModel>
    : TSpec extends JsonSchema
      ? CollectionSignal<FromJsonSchema<TSpec>>
      : CollectionSignal

export interface Signal<TValue = unknown> {
  (...args: never[]): unknown
  readonly __valueType?: TValue
  readonly [SEGMENTS]: PathSegment[]
}

export class Signal<TValue = unknown> extends Function {
  static ID_FIELDS: readonly string[]
  static associations: readonly unknown[]
  static addAssociation (association: object): void
  static [GETTERS]: readonly string[]

  constructor (segments: PathSegment[])

  path (): string
  leaf (): string
  parent (levels?: number): AnySignal
  id (): string
  batch<TResult>(fn?: () => TResult): TResult | undefined
  get (): TValue
  getIds (): Array<string | number>
  peek (): TValue
  getId (): string | number
  getCollection (): string
  getAssociations (): readonly unknown[]
  map<TResult>(callback: (value: AnySignal, index: number, array: AnySignal[]) => TResult): TResult[]
  reduce<TResult>(
    callback: (previousValue: TResult, currentValue: AnySignal, currentIndex: number, array: AnySignal[]) => TResult,
    initialValue: TResult
  ): TResult
  find (predicate: (value: AnySignal, index: number, obj: AnySignal[]) => unknown): AnySignal | undefined
  set (value: TValue): Promise<void>
  assign (value: NonNullable<TValue> extends object ? Partial<NonNullable<TValue>> : never): Promise<void>
  push (value: NonNullable<TValue> extends ReadonlyArray<infer Item> ? Item : unknown): Promise<unknown>
  pop (): Promise<NonNullable<TValue> extends ReadonlyArray<infer Item> ? Item | undefined : unknown>
  unshift (value: NonNullable<TValue> extends ReadonlyArray<infer Item> ? Item : unknown): Promise<unknown>
  shift (): Promise<NonNullable<TValue> extends ReadonlyArray<infer Item> ? Item | undefined : unknown>
  insert (index: number, values: NonNullable<TValue> extends ReadonlyArray<infer Item> ? Item | Item[] : unknown): Promise<unknown>
  remove (index: number, howMany?: number): Promise<unknown>
  move (from: number, to: number, howMany?: number): Promise<unknown>
  stringInsert (index: number, text: string): Promise<unknown>
  stringRemove (index: number, howMany?: number): Promise<unknown>
  increment (value?: number): Promise<number>
  add (value: unknown): Promise<string>
  del (): Promise<void>
}

export const regularBindings: ProxyHandler<Signal>
export const extremelyLateBindings: ProxyHandler<Signal>
export function isPublicCollectionSignal ($signal: unknown): boolean
export function isPublicDocumentSignal ($signal: unknown): boolean
export function isPublicCollection (collectionName: unknown): boolean
export function isPrivateCollection (collectionName: unknown): boolean

export { Signal as default }
