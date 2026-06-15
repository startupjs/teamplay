// NOTE:
//   $() and sub() are currently set to be universal ones which work in both
//   plain JS and React environments. In React they are tied to the observer() HOC.
//   This is done to simplify the API.
//   In future, we might want to separate the plain JS and React APIs
import type * as React from 'react'
import RuntimeSignal, { SEGMENTS } from './orm/Signal.ts'
import { getRootSignal as _getRootSignal, GLOBAL_ROOT_ID } from './orm/Root.ts'
import universal$ from './react/universal$.ts'
import useApi from './react/useApi.ts'
import runtimeObserver from './react/observer.ts'
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
  CollectionsFromManifest,
  DocumentSignal,
  FromJsonSchema,
  JsonSchema,
  JsonSchemaSpec,
  MaybePromise,
  MaybePromiseSubResult,
  ModelEntry,
  ModelManifest,
  PathModelsFromManifest,
  PrivateCollectionsFromManifest,
  PrivateSignalFromSpec,
  PublicSignal,
  LocalSignalFactory,
  RuntimeSignalConstructor,
  RuntimeSignalInstance,
  RootCollections,
  RootPrivateCollections,
  RootSignal,
  WildcardPathSegment,
  WildcardSignalPath,
  AppendPath,
  ComputedQueryParamsInput,
  JoinPath,
  QueryParams,
  QueryParamsInput,
  QuerySignal,
  RegisteredAggregationInput,
  SignalChild,
  SignalBaseInstance,
  SignalArrayMutatorMethods,
  SignalArrayReaderMethods,
  SignalClass,
  SignalCollectionMethods,
  SignalConstructor,
  SignalForKind,
  SignalKind,
  SignalMetadataMethods,
  SignalModelConstructor,
  SignalStringMutatorMethods,
  SignalValueMethods,
  SubResult,
  TypedAggregationInput,
  TypedAggregationSignal,
  TypedSignal,
  ZodLikeSchema,
  ZodSchemaSpec
} from './orm/Signal.ts'

export interface TeamplayCollections {}
export interface TeamplayPrivateCollections {}
export interface TeamplayModels {}
export interface TeamplaySignalFields {}
export interface TeamplayPluginCollections {}
export interface TeamplayPluginPrivateCollections {}
export interface TeamplayPluginModels {}
export interface TeamplayPluginSignalFields {}
export interface TeamplayPluginOptions {}
export interface TeamplayFeatures {}

export type TeamplayPluginOption<TName extends string> =
  TName extends keyof TeamplayPluginOptions ? TeamplayPluginOptions[TName] : {}

export type TeamplayFeature<TName extends string> =
  TName extends keyof TeamplayFeatures ? TeamplayFeatures[TName] : unknown

export type Signal<TValue = unknown> = PublicSignal<TValue>

export type {
  AnySignal,
  ArraySignal,
  CollectionDocument,
  CollectionDocumentModel,
  CollectionSignal,
  CollectionSpec,
  CollectionSignalFromSpec,
  CollectionAggregationSignal,
  CollectionQuerySignal,
  DocumentSignal,
  FromJsonSchema,
  JsonSchema,
  JsonSchemaSpec,
  MaybePromise,
  MaybePromiseSubResult,
  ModelEntry,
  ModelManifest,
  CollectionsFromManifest,
  PrivateCollectionsFromManifest,
  LocalSignalFactory,
  PathModelsFromManifest,
  PrivateSignalFromSpec,
  PublicSignal,
  RuntimeSignalConstructor,
  RuntimeSignalInstance,
  RootCollections,
  RootSignal,
  WildcardPathSegment,
  WildcardSignalPath,
  AppendPath,
  ComputedQueryParamsInput,
  JoinPath,
  QueryParams,
  QueryParamsInput,
  QuerySignal,
  RegisteredAggregationInput,
  RootPrivateCollections,
  SignalArrayMutatorMethods,
  SignalArrayReaderMethods,
  SignalBaseInstance,
  SignalClass,
  SignalChild,
  SignalConstructor,
  SignalCollectionMethods,
  SignalForKind,
  SignalKind,
  SignalMetadataMethods,
  SignalModelConstructor,
  SignalStringMutatorMethods,
  SignalValueMethods,
  SubResult,
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
  defineModels,
  default as initModels,
  getModels,
  resetModelsForTests
} from './orm/initModels.ts'
export { default as signal } from './orm/getSignal.ts'
export { GLOBAL_ROOT_ID } from './orm/Root.ts'
const getRuntimeRootSignal = _getRootSignal as (options: Record<string, any>) => unknown
export const $: RootSignal = getRuntimeRootSignal({ rootId: GLOBAL_ROOT_ID, rootFunction: universal$ }) as RootSignal
export default $
export {
  default as sub,
  unsub
} from './orm/sub.ts'
export type { SubMode, SubOptions } from './orm/sub.ts'
export {
  default as useSub,
  useAsyncSub,
  useBatchSub,
  setUseDeferredValue as __setUseDeferredValue,
  setDefaultDefer as __setDefaultDefer
} from './react/useSub.ts'
export {
  default as useSuspendMemo,
  useSuspendMemoByKey
} from './react/useSuspendMemo.ts'
export const observer = runtimeObserver as unknown as ObserverFunction
export { emit, useOn, useEmit } from './orm/events.js'
export {
  default as reaction
} from './orm/reaction.ts'
export type {
  ReactionHandle,
  ReactionOptions
} from './orm/reaction.ts'
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
export type { TeamplayConnection, TeamplayShareDoc } from './orm/connection.ts'
export {
  TEAMPLAY_RUNTIME_CONFIG_SYMBOL,
  configureTeamplay,
  getTeamplayConfig,
  getDefaultIdFields,
  setDefaultIdFields
} from './config.ts'
export type {
  IdField,
  IdFields,
  TeamplayRuntimeConfig
} from './config.ts'
export { getSubscriptionGcDelay, setSubscriptionGcDelay } from './orm/subscriptionGcDelay.ts'
export { useId, useNow, useScheduleUpdate, useTriggerUpdate } from './react/helpers.ts'
export { GUID_PATTERN, defineSchema, hasMany, hasOne, hasManyFlags, belongsTo, pickFormFields } from '@teamplay/schema'
export { aggregation, aggregationHeader as __aggregationHeader } from '@teamplay/utils/aggregation'
export { accessControl } from '@teamplay/utils/accessControl'
export type {
  AggregationCallback,
  AggregationContext,
  AggregationFunction,
  AggregationMeta,
  AggregationParams,
  AggregationQuery,
  ClientAggregationFunction,
  DefaultAggregationSession
} from '@teamplay/utils/aggregation'
export type {
  AccessControl,
  AccessControlOptions,
  AccessControlRules,
  AccessCreateContext,
  AccessDecision,
  AccessDeleteContext,
  AccessOperation,
  AccessReadContext,
  AccessRule,
  AccessUpdateContext,
  AccessValidator,
  AccessValidatorObject,
  DefaultAccessSession
} from '@teamplay/utils/accessControl'

export function batch (): undefined
export function batch<TResult> (fn: () => TResult): TResult
export function batch<TResult> (fn?: () => TResult): TResult | undefined {
  return fn == null ? $.batch() : $.batch(fn)
}

export function batchModel (): undefined
export function batchModel<TResult> (fn: () => TResult): TResult
export function batchModel<TResult> (fn?: () => TResult): TResult | undefined {
  return fn == null ? $.batch() : $.batch(fn)
}

export function serverOnly<TValue> (value: TValue): TValue {
  return value
}

export function clone<TValue> (value: TValue): TValue {
  if (typeof globalThis.structuredClone === 'function') {
    try {
      return globalThis.structuredClone(value)
    } catch {}
  }
  if (value == null) return value
  return JSON.parse(JSON.stringify(value))
}

export function initLocalCollection (name: string): any {
  if (typeof name !== 'string') throw Error('initLocalCollection() expects a collection name')
  if (!name) return
  const segments = name.split('.').filter(Boolean)
  if (!segments.length) return
  let $cursor: any = $
  for (const segment of segments) {
    $cursor = $cursor[segment]
  }
  if ($cursor.get() == null) $cursor.set({})
  return $cursor
}

export { useApi }

export function getRootSignal (options?: Record<string, any>): RootSignal
export function getRootSignal<TCollections extends Record<string, any>> (options?: Record<string, any>): RootSignal<TCollections>
export function getRootSignal (options?: Record<string, any>): any {
  return getRuntimeRootSignal({
    rootFunction: universal$,
    ...options
  })
}
