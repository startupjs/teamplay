// @ts-nocheck
// NOTE:
//   $() and sub() are currently set to be universal ones which work in both
//   plain JS and React environments. In React they are tied to the observer() HOC.
//   This is done to simplify the API.
//   In future, we might want to separate the plain JS and React APIs
import type * as React from 'react'
import RuntimeSignal, { SEGMENTS, Signal as BaseSignalClass } from './orm/Signal.ts'
import { getRootSignal as _getRootSignal, GLOBAL_ROOT_ID } from './orm/Root.ts'
import universal$ from './react/universal$.js'
import useApi from './react/useApi.js'
import runtimeObserver from './react/observer.js'
import type {
  AnySignal,
  ArraySignal,
  CollectionDocument,
  CollectionDocumentModel,
  CollectionSignal,
  CollectionSignalFromSpec,
  CollectionAggregationSignal,
  CollectionQuerySignal,
  CollectionSpec,
  DocumentSignal,
  FromJsonSchema,
  JsonSchema,
  JsonSchemaSpec,
  WildcardPathSegment,
  WildcardSignalPath,
  AppendPath,
  QueryParams,
  QuerySignal,
  RegisteredAggregationInput,
  Signal as BaseSignalInstance,
  SignalChild,
  SignalClass,
  SignalConstructor,
  TypedAggregationInput,
  TypedAggregationSignal,
  TypedSignal,
  ZodLikeSchema,
  ZodSchemaSpec
} from './orm/Signal.ts'

export interface TeamplayCollections {}
export interface TeamplayModels {}
export interface TeamplaySignalFields {}

type IsAny<TValue> = 0 extends (1 & TValue) ? true : false

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
    ? typeof BaseSignalClass
    : SingleDocumentCollectionKey<TValue> extends keyof TeamplayCollections & string
      ? CollectionDocumentModel<TeamplayCollections[SingleDocumentCollectionKey<TValue>]>
      : typeof BaseSignalClass

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
      : typeof BaseSignalClass,
    CollectionDocumentModel<TeamplayCollections[TCollection]>,
    readonly [TCollection]
  >

type SignalForArrayValue<TValue> =
  [SingleCollectionKey<TValue>] extends [never]
    ? SignalForDocumentValue<TValue>
    : SingleCollectionKey<TValue> extends keyof TeamplayCollections & string
      ? SignalForCollectionArrayValue<SingleCollectionKey<TValue>>
      : SignalForDocumentValue<TValue>

export type Signal<TValue = unknown> =
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
  BaseSignalInstance<Record<string, unknown>> & LocalSignalFactory & RootCollections<TCollections>

export type {
  AnySignal,
  ArraySignal,
  CollectionDocument,
  CollectionDocumentModel,
  CollectionSignal,
  CollectionSpec,
  CollectionAggregationSignal,
  CollectionQuerySignal,
  DocumentSignal,
  FromJsonSchema,
  JsonSchema,
  JsonSchemaSpec,
  WildcardPathSegment,
  WildcardSignalPath,
  AppendPath,
  QueryParams,
  QuerySignal,
  RegisteredAggregationInput,
  SignalClass,
  SignalChild,
  SignalConstructor,
  TypedAggregationInput,
  TypedAggregationSignal,
  TypedSignal,
  ZodLikeSchema,
  ZodSchemaSpec
}

export interface ObserverOptions {
  forwardRef?: boolean
  cache?: boolean
  throttle?: number | boolean
  defer?: boolean | number
  suspenseProps?: React.ComponentProps<typeof React.Suspense>
}

export type ObserverComponent<TProps extends object> =
  (props: TProps) => React.ReactNode

export type ObserverForwardRefComponent<TProps extends object, TRef> =
  (props: TProps, ref: React.ForwardedRef<TRef>) => React.ReactNode

export type ObserverForwardRefOptions =
  Omit<ObserverOptions, 'forwardRef'> & { forwardRef: true }

export interface ObserverFunction {
  <TProps extends object, TRef = unknown>(
    Component: ObserverForwardRefComponent<TProps, TRef>,
    options: ObserverForwardRefOptions
  ): React.NamedExoticComponent<React.PropsWithoutRef<TProps> & React.RefAttributes<TRef>>

  <TProps extends object>(
    Component: ObserverComponent<TProps>,
    options?: ObserverOptions
  ): React.NamedExoticComponent<TProps>

  __wrapObserverMeta: unknown
  __makeObserver: unknown
}

// eslint-disable-next-line @typescript-eslint/no-redeclare
export const Signal = RuntimeSignal
export { SEGMENTS }
export { __DEBUG_SIGNALS_CACHE__, rawSignal, getSignalClass } from './orm/getSignal.ts'
export { default as addModel } from './orm/addModel.ts'
export {
  default as initModels,
  getModels,
  resetModelsForTests
} from './orm/initModels.ts'
export { default as signal } from './orm/getSignal.ts'
export { GLOBAL_ROOT_ID } from './orm/Root.ts'
export const $: RootSignal = _getRootSignal({ rootId: GLOBAL_ROOT_ID, rootFunction: universal$ }) as RootSignal
export const $root: RootSignal = $
export const model: RootSignal = $
export default $
export { default as sub } from './orm/sub.ts'
export {
  default as useSub,
  useAsyncSub,
  setUseDeferredValue as __setUseDeferredValue,
  setDefaultDefer as __setDefaultDefer
} from './react/useSub.ts'
export {
  default as useSuspendMemo,
  useSuspendMemoByKey
} from './react/useSuspendMemo.js'
export const observer = runtimeObserver as ObserverFunction
export {
  useValue,
  useValue$,
  useModel,
  useLocal,
  useLocal$,
  useLocalDoc,
  useLocalDoc$,
  useSession,
  useSession$,
  usePage,
  usePage$,
  useBatch,
  useDoc,
  useDoc$,
  useBatchDoc,
  useBatchDoc$,
  useAsyncDoc,
  useAsyncDoc$,
  useQuery,
  useQuery$,
  useAsyncQuery,
  useAsyncQuery$,
  useBatchQuery,
  useBatchQuery$,
  useQueryIds,
  useBatchQueryIds,
  useAsyncQueryIds,
  useQueryDoc,
  useQueryDoc$,
  useBatchQueryDoc,
  useBatchQueryDoc$,
  useAsyncQueryDoc,
  useAsyncQueryDoc$
} from './orm/Compat/hooksCompat.js'
export { emit, useOn, useEmit } from './orm/Compat/eventsCompat.js'
export {
  useDidUpdate,
  useOnce,
  useSyncEffect
} from './react/helpers.ts'
export {
  connection,
  setConnection,
  getConnection,
  getDefaultFetchOnly,
  setDefaultFetchOnly,
  publicOnly,
  setPublicOnly
} from './orm/connection.ts'
export { getSubscriptionGcDelay, setSubscriptionGcDelay } from './orm/subscriptionGcDelay.js'
export { useId, useNow, useScheduleUpdate, useTriggerUpdate } from './react/helpers.ts'
export { GUID_PATTERN, hasMany, hasOne, hasManyFlags, belongsTo, pickFormFields } from '@teamplay/schema'
export { aggregation, aggregationHeader as __aggregationHeader } from '@teamplay/utils/aggregation'
export { accessControl } from '@teamplay/utils/accessControl'

export function batch (fn) {
  return $.batch(fn)
}

export function batchModel (fn) {
  return $.batch(fn)
}

export function serverOnly (value) {
  return value
}

export function clone (value) {
  if (typeof globalThis.structuredClone === 'function') {
    try {
      return globalThis.structuredClone(value)
    } catch {}
  }
  if (value == null) return value
  return JSON.parse(JSON.stringify(value))
}

export function initLocalCollection (name) {
  if (typeof name !== 'string') throw Error('initLocalCollection() expects a collection name')
  if (!name) return
  const segments = name.split('.').filter(Boolean)
  if (!segments.length) return
  let $cursor = $
  for (const segment of segments) {
    $cursor = $cursor[segment]
  }
  if ($cursor.get() == null) $cursor.set({})
  return $cursor
}

export { useApi }

export function getRootSignal<TCollections extends Record<string, any> = TeamplayCollections> (options?: Record<string, any>): RootSignal<TCollections> {
  return _getRootSignal({
    rootFunction: universal$,
    ...options
  }) as RootSignal<TCollections>
}
