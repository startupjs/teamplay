// @ts-nocheck
import { Signal } from './SignalBase.ts'
import SignalCompat from './Compat/SignalCompat.js'
import { isCompatEnv } from './compatEnv.js'
import type { TeamplayModels } from '../index.ts'
import type {
  FromJsonSchema,
  InferZodSchema,
  JsonSchema,
  ZodLikeSchema
} from './types/jsonSchema.ts'
import type {
  AppendPath,
  JoinPath,
  PathSegment,
  WildcardSignalPath
} from './types/path.ts'

export type {
  FromJsonSchema,
  InferZodSchema,
  JsonSchema,
  JsonSchemaObject,
  ZodLikeSchema
} from './types/jsonSchema.ts'
export type { QueryParams } from './types/query.ts'
export type {
  AppendPath,
  PathSegment,
  SignalPath,
  WildcardPathSegment,
  WildcardSignalPath
} from './types/path.ts'

export type SignalClass<TValue = unknown> = new (segments: PathSegment[]) => any & { readonly __valueType?: TValue }

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

type SignalArrayMethodKeys = 'map' | 'reduce' | 'find' | typeof Symbol.iterator

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
    ? {
        [Symbol.iterator]: () => IterableIterator<ArrayItemSignal<Item, TPath>>
        map: <TResult>(
          callback: (
            value: ArrayItemSignal<Item, TPath>,
            index: number,
            array: Array<ArrayItemSignal<Item, TPath>>
          ) => TResult
        ) => TResult[]
        reduce: <TResult>(
          callback: (
            previousValue: TResult,
            currentValue: ArrayItemSignal<Item, TPath>,
            currentIndex: number,
            array: Array<ArrayItemSignal<Item, TPath>>
          ) => TResult,
          initialValue: TResult
        ) => TResult
        find: (
          predicate: (
            value: ArrayItemSignal<Item, TPath>,
            index: number,
            obj: Array<ArrayItemSignal<Item, TPath>>
          ) => unknown
        ) => ArrayItemSignal<Item, TPath> | undefined
      }
    : Pick<Signal<TValue>, SignalArrayMethodKeys>

export type AnySignal = Signal<any>

export type TypedSignal<
  TValue = unknown,
  TModel extends SignalClass<any> = typeof Signal,
  TPath extends WildcardSignalPath = readonly []
> =
  Omit<SignalModelInstance<TValue, PathModel<TValue, TModel, TPath>>, SignalArrayMethodKeys> &
  SignalArrayMethods<TValue, TPath> &
  SignalChildren<TValue, TPath>

export type DocumentSignal<
  TValue = unknown,
  TModel extends SignalClass<any> = typeof Signal,
  TPath extends WildcardSignalPath = readonly []
> = TypedSignal<TValue, TModel, TPath>

export type CollectionSignal<
  TDocument = unknown,
  TCollectionModel extends SignalClass<any> = typeof Signal,
  TDocumentModel extends SignalClass<any> = typeof Signal,
  TPath extends WildcardSignalPath = readonly []
> = SignalModelInstance<TDocument[], PathModel<TDocument[], TCollectionModel, TPath>> & {
  readonly [documentId: string]: DocumentSignal<TDocument, TDocumentModel, AppendPath<TPath, '*'>>
  add: (value: TDocument) => Promise<string>
}

export type QuerySignal<
  TDocument = unknown,
  TDocumentModel extends SignalClass<any> = typeof Signal,
  TDocumentPath extends WildcardSignalPath = readonly []
> = Omit<Signal<TDocument[]>, SignalArrayMethodKeys> & {
  readonly [index: number]: DocumentSignal<TDocument, TDocumentModel, TDocumentPath>
  [Symbol.iterator]: () => IterableIterator<DocumentSignal<TDocument, TDocumentModel, TDocumentPath>>
  map: <TResult>(
    callback: (
      value: DocumentSignal<TDocument, TDocumentModel, TDocumentPath>,
      index: number,
      array: Array<DocumentSignal<TDocument, TDocumentModel, TDocumentPath>>
    ) => TResult
  ) => TResult[]
  reduce: <TResult>(
    callback: (
      previousValue: TResult,
      currentValue: DocumentSignal<TDocument, TDocumentModel, TDocumentPath>,
      currentIndex: number,
      array: Array<DocumentSignal<TDocument, TDocumentModel, TDocumentPath>>
    ) => TResult,
    initialValue: TResult
  ) => TResult
  find: (
    predicate: (
      value: DocumentSignal<TDocument, TDocumentModel, TDocumentPath>,
      index: number,
      obj: Array<DocumentSignal<TDocument, TDocumentModel, TDocumentPath>>
    ) => unknown
  ) => DocumentSignal<TDocument, TDocumentModel, TDocumentPath> | undefined
}

export type AggregationSignal<
  TDocument = unknown,
  TDocumentModel extends SignalClass<any> = typeof Signal,
  TDocumentPath extends WildcardSignalPath = readonly []
> = QuerySignal<TDocument, TDocumentModel, TDocumentPath>

export type CollectionDocument<TSpec> =
  TSpec extends CollectionSpec<infer Document, any, any> ? Document
    : TSpec extends JsonSchema ? FromJsonSchema<TSpec>
      : unknown

export type CollectionDocumentModel<TSpec> =
  TSpec extends CollectionSpec<any, any, infer DocumentModel> ? DocumentModel
    : typeof Signal

export type SignalChild<TValue, TPath extends WildcardSignalPath> =
  DocumentSignal<TValue, typeof Signal, TPath>

export type SignalChildren<TValue, TPath extends WildcardSignalPath = readonly []> =
  NonNullable<TValue> extends ReadonlyArray<infer Item>
    ? Readonly<Record<number, DocumentSignal<Item, typeof Signal, AppendPath<TPath, '*'>>>>
    : NonNullable<TValue> extends object
      ? {
          readonly [K in keyof NonNullable<TValue> & string]-?: SignalChild<NonNullable<TValue>[K], AppendPath<TPath, K>>
        }
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

export {
  Signal,
  SEGMENTS,
  ARRAY_METHOD,
  GET,
  GETTERS,
  DEFAULT_GETTERS,
  regularBindings,
  extremelyLateBindings,
  isPublicCollectionSignal,
  isPublicDocumentSignal,
  isPublicCollection,
  isPrivateCollection
} from './SignalBase.ts'

export { SignalCompat }

const DefaultSignal = (isCompatEnv() ? SignalCompat : Signal) as unknown as SignalConstructor

export default DefaultSignal
