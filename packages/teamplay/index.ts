// @ts-nocheck
// NOTE:
//   $() and sub() are currently set to be universal ones which work in both
//   plain JS and React environments. In React they are tied to the observer() HOC.
//   This is done to simplify the API.
//   In future, we might want to separate the plain JS and React APIs
import type * as React from 'react'
import { getRootSignal as _getRootSignal, GLOBAL_ROOT_ID } from './orm/Root.ts'
import universal$ from './react/universal$.js'
import useApi from './react/useApi.js'
import type {
  CollectionSignalFromSpec,
  CollectionSpec,
  DocumentSignal,
  FromJsonSchema,
  JsonSchema,
  JsonSchemaSpec,
  QuerySignal,
  Signal,
  SignalClass,
  TypedSignal,
  ZodLikeSchema,
  ZodSchemaSpec
} from './orm/Signal.ts'

export interface TeamplayCollections {}

export interface LocalSignalFactory {
  <TValue>(factory: () => TValue): TypedSignal<TValue>
  <TValue>(value: TValue): TypedSignal<TValue>
}

export type RootCollections<TCollections extends Record<string, any> = TeamplayCollections> = {
  readonly [K in keyof TCollections & string]: CollectionSignalFromSpec<TCollections[K]>
}

export type RootSignal<TCollections extends Record<string, any> = TeamplayCollections> =
  Signal<Record<string, unknown>> & LocalSignalFactory & RootCollections<TCollections>

export type {
  CollectionSpec,
  DocumentSignal,
  FromJsonSchema,
  JsonSchema,
  JsonSchemaSpec,
  QuerySignal,
  SignalClass,
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

export { default as Signal, SEGMENTS } from './orm/Signal.ts'
export { __DEBUG_SIGNALS_CACHE__, rawSignal, getSignalClass } from './orm/getSignal.ts'
export { default as addModel } from './orm/addModel.ts'
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
export { default as observer } from './react/observer.js'
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
