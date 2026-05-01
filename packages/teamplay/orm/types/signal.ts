import type { TeamplayCollections, TeamplayModels, TeamplaySignalFields } from '../../index.ts'
import type { Signal, GETTERS } from '../SignalBase.ts'
import type {
  FromJsonSchema,
  InferZodSchema,
  JsonSchema,
  ZodLikeSchema
} from './jsonSchema.ts'
import type {
  AppendPath,
  JoinPath,
  PathSegment,
  WildcardSignalPath
} from './path.ts'
import type { AggregationFunction, ClientAggregationFunction } from '@teamplay/utils/aggregation'
import type {
  SignalArrayMutatorMethods,
  SignalArrayReaderMethods,
  SignalCollectionMethods
} from './baseMethods.ts'

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

type SignalArrayReaderMethodKeys = keyof SignalArrayReaderMethods<any>
type SignalArrayMutatorMethodKeys = keyof SignalArrayMutatorMethods<any>
type SignalCollectionMethodKeys = keyof SignalCollectionMethods<any>
type SignalQueryMethodKeys = SignalArrayReaderMethodKeys | SignalArrayMutatorMethodKeys

type BlockedArrayMutators = {
  readonly [K in SignalArrayMutatorMethodKeys]?: never
}

type SignalArrayLike<TItem> = SignalArrayReaderMethods<TItem>

type PathModel<
  TValue,
  TDefaultModel extends SignalClass<any>,
  TPath extends WildcardSignalPath
> =
  JoinPath<TPath> extends keyof TeamplayModels
    ? TeamplayModels[JoinPath<TPath>] extends SignalClass<TValue>
      ? TeamplayModels[JoinPath<TPath>]
      : TeamplayModels[JoinPath<TPath>] extends SignalClass<any>
        ? TeamplayModels[JoinPath<TPath>]
        : TDefaultModel
    : TDefaultModel

type ArrayItemSignal<Item, TPath extends WildcardSignalPath> =
  DocumentSignal<Item, typeof Signal, AppendPath<TPath, '*'>>

type SignalArrayMethods<TValue, TPath extends WildcardSignalPath> =
  NonNullable<TValue> extends ReadonlyArray<infer Item>
    ? SignalArrayLike<ArrayItemSignal<Item, TPath>>
    : Pick<Signal<TValue>, SignalArrayReaderMethodKeys>

type SignalFieldsForPath<TPath extends WildcardSignalPath> =
  JoinPath<TPath> extends keyof TeamplaySignalFields
    ? TeamplaySignalFields[JoinPath<TPath>]
    : {}

export type AnySignal = Signal<any>

type IsAny<TValue> = 0 extends (1 & TValue) ? true : false

type IsUnknown<TValue> =
  IsAny<TValue> extends true
    ? false
    : unknown extends TValue
      ? true
      : false

type IsEqual<TValue, TOther> =
  (<T>() => T extends TValue ? 1 : 2) extends
  (<T>() => T extends TOther ? 1 : 2)
    ? (<T>() => T extends TOther ? 1 : 2) extends
      (<T>() => T extends TValue ? 1 : 2)
        ? true
        : false
    : false

type IsUnion<TValue, TUnion = TValue> =
  [TValue] extends [never]
    ? false
    : TValue extends unknown
      ? [TUnion] extends [TValue] ? false : true
      : false

type SingleKey<TKey> = IsUnion<TKey> extends true ? never : TKey

export type SignalKind =
  | 'root'
  | 'document'
  | 'collection'
  | 'nestedValue'
  | 'localArray'
  | 'array'
  | 'query'
  | 'aggregation'
  | 'collectionQuery'

type DocumentSignalForKind<
  TValue,
  TModel extends SignalClass<any>,
  TPath extends WildcardSignalPath
> =
  Omit<SignalModelInstance<TValue, PathModel<TValue, TModel, TPath>>, SignalArrayReaderMethodKeys> &
  SignalArrayMethods<TValue, TPath> &
  SignalChildren<TValue, TPath> &
  SignalFieldsForPath<TPath>

type CollectionSignalForKind<
  TDocument,
  TCollectionModel extends SignalClass<any>,
  TDocumentModel extends SignalClass<any>,
  TPath extends WildcardSignalPath
> =
  Omit<
    SignalModelInstance<TDocument[], PathModel<TDocument[], TCollectionModel, TPath>>,
    SignalCollectionMethodKeys
  > &
  SignalArrayLike<CollectionDocumentSignal<TDocument, TDocumentModel, TPath>> &
  BlockedArrayMutators &
  { add: (value: TDocument) => Promise<string> } &
  CollectionDocumentIndex<CollectionDocumentSignal<TDocument, TDocumentModel, TPath>>

type CollectionDocumentIndex<TDocumentSignal> =
  Readonly<Record<string, TDocumentSignal>> &
  Readonly<Record<number, TDocumentSignal>>

type ArraySignalForKind<
  TDocument,
  TDocumentModel extends SignalClass<any>,
  TDocumentPath extends WildcardSignalPath
> = Omit<Signal<TDocument[]>, SignalQueryMethodKeys> &
SignalArrayLike<DocumentSignal<TDocument, TDocumentModel, TDocumentPath>> & {
  readonly [index: number]: DocumentSignal<TDocument, TDocumentModel, TDocumentPath>
} &
BlockedArrayMutators

type QuerySignalForKind<
  TDocument,
  TDocumentModel extends SignalClass<any>,
  TDocumentPath extends WildcardSignalPath
> = ArraySignalForKind<TDocument, TDocumentModel, TDocumentPath> & {
  readonly ids: Signal<Array<string | number>>
}

export type SignalForKind<
  TKind extends SignalKind,
  TValue = unknown,
  TCollectionModel extends SignalClass<any> = typeof Signal,
  TDocumentModel extends SignalClass<any> = typeof Signal,
  TPath extends WildcardSignalPath = readonly []
> =
  TKind extends 'root'
    ? Signal<Record<string, unknown>>
    : TKind extends 'document' | 'nestedValue' | 'localArray'
      ? DocumentSignalForKind<TValue, TDocumentModel, TPath>
      : TKind extends 'collection'
        ? CollectionSignalForKind<TValue, TCollectionModel, TDocumentModel, TPath>
        : TKind extends 'array'
          ? ArraySignalForKind<TValue, TDocumentModel, TPath>
          : TKind extends 'query' | 'aggregation'
            ? QuerySignalForKind<TValue, TDocumentModel, TPath>
            : TKind extends 'collectionQuery'
              ? CollectionSignalForKind<TValue, TCollectionModel, TDocumentModel, TPath> & {
                readonly ids: Signal<Array<string | number>>
              }
              : never

export type TypedSignal<
  TValue = unknown,
  TModel extends SignalClass<any> = typeof Signal,
  TPath extends WildcardSignalPath = readonly []
> = DocumentSignalForKind<TValue, TModel, TPath>

export type DocumentSignal<
  TValue = unknown,
  TModel extends SignalClass<any> = typeof Signal,
  TPath extends WildcardSignalPath = readonly []
> = TypedSignal<TValue, TModel, TPath>

type CollectionDocumentSignal<
  TDocument,
  TDocumentModel extends SignalClass<any>,
  TPath extends WildcardSignalPath
> = DocumentSignal<TDocument, TDocumentModel, AppendPath<TPath, '*'>>

export type CollectionSignal<
  TDocument = unknown,
  TCollectionModel extends SignalClass<any> = typeof Signal,
  TDocumentModel extends SignalClass<any> = typeof Signal,
  TPath extends WildcardSignalPath = readonly []
> =
  CollectionSignalForKind<TDocument, TCollectionModel, TDocumentModel, TPath>

export type ArraySignal<
  TDocument = unknown,
  TDocumentModel extends SignalClass<any> = typeof Signal,
  TDocumentPath extends WildcardSignalPath = readonly []
> = ArraySignalForKind<TDocument, TDocumentModel, TDocumentPath>

export type QuerySignal<
  TDocument = unknown,
  TDocumentModel extends SignalClass<any> = typeof Signal,
  TDocumentPath extends WildcardSignalPath = readonly []
> = QuerySignalForKind<TDocument, TDocumentModel, TDocumentPath>

export type AggregationSignal<
  TDocument = unknown,
  TDocumentModel extends SignalClass<any> = typeof Signal,
  TDocumentPath extends WildcardSignalPath = readonly []
> = QuerySignalForKind<TDocument, TDocumentModel, TDocumentPath>

export type CollectionDocument<TSpec> =
  TSpec extends CollectionSpec<infer Document, any, any> ? Document
    : TSpec extends JsonSchema ? FromJsonSchema<TSpec>
      : unknown

export type CollectionDocumentModel<TSpec> =
  TSpec extends CollectionSpec<any, any, infer DocumentModel> ? DocumentModel
    : typeof Signal

export type CollectionQuerySignal<
  TDocument,
  TCollectionModel extends SignalClass<any>,
  TDocumentModel extends SignalClass<any>,
  TCollectionPath extends WildcardSignalPath
> = CollectionSignalForKind<TDocument, TCollectionModel, TDocumentModel, TCollectionPath> & {
  readonly ids: Signal<Array<string | number>>
}

type MatchingDocumentCollectionKeys<TValue> =
  IsAny<TValue> extends true
    ? never
    : {
        [K in keyof TeamplayCollections & string]:
        IsEqual<
          NonNullable<TValue>,
          NonNullable<CollectionDocument<TeamplayCollections[K]>>
        > extends true ? K : never
      }[keyof TeamplayCollections & string]

type MatchingCollectionKeys<TValue> =
  IsAny<TValue> extends true
    ? never
    : NonNullable<TValue> extends ReadonlyArray<infer TDocument>
      ? MatchingDocumentCollectionKeys<TDocument>
      : never

type SingleDocumentCollectionKey<TValue> = SingleKey<MatchingDocumentCollectionKeys<TValue>>
type SingleCollectionKey<TValue> = SingleKey<MatchingCollectionKeys<TValue>>

type DocumentSignalModelForValue<TValue> =
  [SingleDocumentCollectionKey<TValue>] extends [never]
    ? typeof Signal
    : SingleDocumentCollectionKey<TValue> extends keyof TeamplayCollections & string
      ? CollectionDocumentModel<TeamplayCollections[SingleDocumentCollectionKey<TValue>]>
      : typeof Signal

type DocumentSignalPathForValue<TValue> =
  [SingleDocumentCollectionKey<TValue>] extends [never]
    ? readonly []
    : SingleDocumentCollectionKey<TValue> extends keyof TeamplayCollections & string
      ? readonly [SingleDocumentCollectionKey<TValue>, '*']
      : readonly []

type SignalForDocumentValue<TValue> =
  TypedSignal<TValue, DocumentSignalModelForValue<TValue>, DocumentSignalPathForValue<TValue>>

type SignalForCollectionArrayValue<TCollection extends keyof TeamplayCollections & string> =
  CollectionSignal<
    CollectionDocument<TeamplayCollections[TCollection]>,
    TeamplayCollections[TCollection] extends CollectionSpec<any, infer CollectionModel, any>
      ? CollectionModel
      : typeof Signal,
    CollectionDocumentModel<TeamplayCollections[TCollection]>,
    readonly [TCollection]
  >

type SignalForArrayValue<TValue> =
  [SingleCollectionKey<TValue>] extends [never]
    ? SignalForDocumentValue<TValue>
    : SingleCollectionKey<TValue> extends keyof TeamplayCollections & string
      ? SignalForCollectionArrayValue<SingleCollectionKey<TValue>>
      : SignalForDocumentValue<TValue>

export type PublicSignal<TValue = unknown> =
  IsAny<TValue> extends true
    ? TypedSignal<TValue>
    : NonNullable<TValue> extends ReadonlyArray<any>
      ? SignalForArrayValue<TValue>
      : SignalForDocumentValue<TValue>

export interface LocalSignalFactory {
  (): any
  <TValue>(): TypedSignal<TValue>
  <TValue>(factory: () => TValue): TypedSignal<TValue>
  <TValue>(value: TValue): TypedSignal<TValue>
}

export type RootCollections<TCollections extends Record<string, any> = TeamplayCollections> = {
  readonly [K in keyof TCollections & string]: CollectionSignalFromSpec<TCollections[K], readonly [K]>
} & {
  readonly [K in keyof TCollections & string as `$${K}`]: CollectionSignalFromSpec<TCollections[K], readonly [K]>
}

export type RootSignal<TCollections extends Record<string, any> = TeamplayCollections> =
  Signal<Record<string, unknown>> & LocalSignalFactory & RootCollections<TCollections>

export interface RegisteredAggregationInput<
  TCollection extends string = string,
  TOutput = unknown
> {
  readonly __isAggregation: true
  readonly collection: TCollection
  readonly __teamplayAggregationOutput?: TOutput
}

export interface TypedAggregationInput<
  TDocument = unknown,
  TDocumentModel extends SignalClass<any> = typeof Signal
> extends RegisteredAggregationInput {
  readonly __teamplayTypedAggregationInput: true
  readonly __teamplayDocument?: TDocument
  readonly __teamplayDocumentModel?: TDocumentModel
}

export type CollectionAggregationSignal<TCollection extends keyof TeamplayCollections & string> =
  AggregationSignal<
  CollectionDocument<TeamplayCollections[TCollection]>,
  CollectionDocumentModel<TeamplayCollections[TCollection]>,
  readonly [TCollection, '*']
  >

export type TypedAggregationSignal<TDocument, TDocumentModel extends SignalClass<any>> =
  AggregationSignal<TDocument, TDocumentModel>

export type AggregationOutputSignal<TOutput> =
  IsAny<TOutput> extends true
    ? QuerySignal
    : NonNullable<TOutput> extends ReadonlyArray<infer TDocument>
      ? AggregationSignal<TDocument, DocumentSignalModelForValue<TDocument>, DocumentSignalPathForValue<TDocument>>
      : SignalForDocumentValue<TOutput>

type RegisteredAggregationSignal<TCollection extends string, TOutput> =
  IsUnknown<TOutput> extends true
    ? TCollection extends keyof TeamplayCollections & string
      ? CollectionAggregationSignal<TCollection>
      : QuerySignal
    : AggregationOutputSignal<TOutput>

export type MaybePromise<TValue> = TValue | Promise<TValue>

export type SubResult<TSignal, TParams = undefined> =
  TSignal extends ClientAggregationFunction<infer TOutput, infer TCollection>
    ? RegisteredAggregationSignal<TCollection, TOutput>
    : TSignal extends AggregationFunction<infer TOutput, any>
      ? IsUnknown<TOutput> extends true ? QuerySignal : AggregationOutputSignal<TOutput>
      : TSignal extends TypedAggregationInput<infer TDocument, infer TDocumentModel>
        ? TypedAggregationSignal<TDocument, TDocumentModel>
        : TSignal extends RegisteredAggregationInput<infer TCollection, infer TOutput>
          ? RegisteredAggregationSignal<TCollection, TOutput>
          : [TParams] extends [undefined]
              ? TSignal extends DocumentSignal<any, any, any>
                ? TSignal
                : QuerySignal
              : TSignal extends CollectionSignal<infer TDocument, infer TCollectionModel, infer TDocumentModel, infer TCollectionPath>
                ? CollectionQuerySignal<TDocument, TCollectionModel, TDocumentModel, TCollectionPath>
                : QuerySignal

export type MaybePromiseSubResult<TSignal, TParams = undefined> =
  MaybePromise<SubResult<TSignal, TParams>>

export type SignalChild<TValue, TPath extends WildcardSignalPath> =
  DocumentSignal<TValue, typeof Signal, TPath>

type ObjectSignalChildren<TValue, TPath extends WildcardSignalPath> = {
  readonly [K in keyof NonNullable<TValue> & string]-?: SignalChild<NonNullable<TValue>[K], AppendPath<TPath, K>>
}

type DollarObjectSignalChildren<TValue, TPath extends WildcardSignalPath> = {
  readonly [K in keyof NonNullable<TValue> & string as `$${K}`]-?: SignalChild<NonNullable<TValue>[K], AppendPath<TPath, K>>
}

export type SignalChildren<TValue, TPath extends WildcardSignalPath = readonly []> =
  NonNullable<TValue> extends ReadonlyArray<infer Item>
    ? Readonly<Record<number, DocumentSignal<Item, typeof Signal, AppendPath<TPath, '*'>>>>
    : NonNullable<TValue> extends object
      ? ObjectSignalChildren<TValue, TPath> & DollarObjectSignalChildren<TValue, TPath>
      : {}

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

export type CollectionSignalFromSpec<
  TSpec,
  TPath extends WildcardSignalPath = readonly []
> =
  TSpec extends CollectionSpec<infer Document, infer CollectionModel, infer DocumentModel>
    ? CollectionSignal<Document, CollectionModel, DocumentModel, TPath>
    : TSpec extends JsonSchema
      ? CollectionSignal<FromJsonSchema<TSpec>, typeof Signal, typeof Signal, TPath>
      : CollectionSignal

export interface SignalConstructor {
  new <TValue = unknown>(segments: PathSegment[]): TypedSignal<TValue>
  readonly ID_FIELDS: typeof Signal.ID_FIELDS
  readonly associations: typeof Signal.associations
  readonly [GETTERS]: typeof Signal[typeof GETTERS]
  addAssociation: typeof Signal.addAssociation
}
