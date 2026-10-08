import { useEffect, useRef, useDeferredValue } from 'react'
import type { AggregationFunction, AggregationParams, ClientAggregationFunction } from '@teamplay/utils/aggregation'
import { acquireSub, type SubReleaseOptions } from '../orm/sub.ts'
import { useScheduleUpdate, useCache, useDefer, useTriggerUpdate } from './helpers.ts'
import { useSuspenseGroupScheduleUpdate } from './wrapIntoSuspense.js'
import executionContextTracker from './executionContextTracker.ts'
import * as promiseBatcher from './promiseBatcher.ts'
import { getPrivateData } from '../orm/privateData.js'
import { isDocReady } from '../orm/queryReadiness.js'
import { getRoot, ROOT_ID } from '../orm/Root.ts'
import {
  COLLECTION_NAME,
  HASH,
  IS_QUERY,
  PARAMS,
  QUERIES,
  querySubscriptions,
  materializeQueryDataDocsToCollection
} from '../orm/Query.js'
import { AGGREGATIONS, IS_AGGREGATION, aggregationSubscriptions } from '../orm/Aggregation.js'
import { SEGMENTS } from '../orm/signalSymbols.ts'
import { getSubscriptionGcDelay } from '../orm/subscriptionGcDelay.ts'
import unrefTimer from '../utils/unrefTimer.ts'
import { diag } from '../diagnostics/hooks.ts'
import {
  isPublicDocumentSignal,
  type CollectionSignal,
  type ComputedQueryParamsInput,
  type DocumentSignal,
  type QueryParams,
  type RegisteredAggregationInput,
  type SignalBaseInstance,
  type SignalModelConstructor,
  type SubResult,
  type TypedAggregationInput,
  type TypedAggregationSignal,
  type WildcardSignalPath
} from '../orm/Signal.ts'

export interface UseSubOptions {
  /** Return `undefined` while loading instead of throwing a Suspense promise. */
  async?: boolean
  /** Defer re-subscriptions. Pass a number to use a custom delay. */
  defer?: boolean | number
  /** Batch Suspense promises across multiple subscriptions in one render attempt. */
  batch?: boolean
}

const USE_SUB_OPTION_KEYS = new Set<string>(['async', 'defer', 'batch'] satisfies Array<keyof UseSubOptions>)
// React cannot tell us that it abandoned a render attempt, and it may hold a
// finished one before committing it (React 19 holds a Suspense retry for up to
// 300 ms after the last fallback). An uncommitted lease is therefore kept for
// MAX_UNCOMMITTED_LEASE_GRACE_MS after its subscription is ready or its last
// render (0 when the subscription GC delay is 0), so a retry or a held commit
// finds the lease itself and nothing is re-subscribed. Its release then gives the transport at
// least the same grace, so a later re-acquire still joins synchronously; this
// is what keeps setSubscriptionGcDelay(0) working, where the lease is released
// on the next task. A render that commits a released lease re-acquires it.
const MAX_UNCOMMITTED_LEASE_GRACE_MS = 1000
// Livelock guard: a hook that re-acquires the same target this many times in a
// row from uncommitted leases stops releasing its uncommitted lease (it is
// released on commit/unmount or when the observer is destroyed).
const UNCOMMITTED_REACQUIRE_LIMIT = 10

let TEST_THROTTLING: false | number = false

// by default we want to defer stuff if possible instead of throwing promises
let DEFAULT_DEFER: boolean = true

/**
 * Subscribe to a document signal in React async mode.
 * @param signal Document signal to subscribe to.
 * @param params Must be omitted for document subscriptions.
 * @param options Subscription behavior options.
 */
export function useAsyncSub<TSignal extends DocumentSignal<any, any, any>> (
  signal: TSignal,
  options?: UseSubOptions
): SubResult<TSignal>

/**
 * Subscribe to a document signal in React async mode.
 * @param signal Document signal to subscribe to.
 * @param params Must be omitted for document subscriptions.
 * @param options Subscription behavior options.
 */
export function useAsyncSub<TSignal extends DocumentSignal<any, any, any>> (
  signal: TSignal,
  params?: undefined,
  options?: UseSubOptions
): SubResult<TSignal>

/**
 * Subscribe to a collection query in React async mode.
 * @param signal Collection signal to query.
 * @param params Mongo-style query params, including filters and `$sort`.
 * @param options Subscription behavior options.
 */
export function useAsyncSub<
  TDocument,
  TCollectionModel extends SignalModelConstructor<TDocument[]>,
  TDocumentModel extends SignalModelConstructor<TDocument>,
  TCollectionPath extends WildcardSignalPath
> (
  signal: CollectionSignal<TDocument, TCollectionModel, TDocumentModel, TCollectionPath>,
  params: QueryParams<TDocument>,
  options?: UseSubOptions
): SubResult<CollectionSignal<TDocument, TCollectionModel, TDocumentModel, TCollectionPath>, QueryParams<TDocument>>

/**
 * Subscribe to a collection query with computed string keys in React async mode.
 * This fallback preserves Mongo-style computed paths such as `{ [`likes.${id}`]: true }`.
 * Literal query objects should use the stricter overload above.
 * @param signal Collection signal to query.
 * @param params Mongo-style query params with a widened computed key.
 * @param options Subscription behavior options.
 */
export function useAsyncSub<
  TDocument,
  TCollectionModel extends SignalModelConstructor<TDocument[]>,
  TDocumentModel extends SignalModelConstructor<TDocument>,
  TCollectionPath extends WildcardSignalPath,
  TParams extends object
> (
  signal: CollectionSignal<TDocument, TCollectionModel, TDocumentModel, TCollectionPath>,
  params: TParams & ComputedQueryParamsInput<TParams>,
  options?: UseSubOptions
): SubResult<CollectionSignal<TDocument, TCollectionModel, TDocumentModel, TCollectionPath>, TParams>

/**
 * Subscribe to a registered collection aggregation in React async mode.
 * @param signal Aggregation header generated by StartupJS model loading.
 * @param params Parameters passed to the aggregation.
 * @param options Subscription behavior options.
 */
export function useAsyncSub<TCollection extends string, TOutput = unknown> (
  signal: RegisteredAggregationInput<TCollection, TOutput>,
  params?: AggregationParams,
  options?: UseSubOptions
): SubResult<RegisteredAggregationInput<TCollection, TOutput>>

/**
 * Subscribe to a client aggregation in React async mode.
 * @param signal Aggregation function created with `aggregation(collection, fn)`.
 * @param params Parameters passed to the aggregation.
 * @param options Subscription behavior options.
 */
export function useAsyncSub<TOutput, TCollection extends string> (
  signal: ClientAggregationFunction<TOutput, TCollection>,
  params?: AggregationParams,
  options?: UseSubOptions
): SubResult<ClientAggregationFunction<TOutput, TCollection>>

/**
 * Subscribe to an aggregation with explicit output typing in React async mode.
 * @param signal Typed aggregation input.
 * @param params Parameters passed to the aggregation.
 * @param options Subscription behavior options.
 */
export function useAsyncSub<
  TDocument,
  TDocumentModel extends SignalModelConstructor<TDocument>
> (
  signal: TypedAggregationInput<TDocument, TDocumentModel>,
  params?: AggregationParams,
  options?: UseSubOptions
): TypedAggregationSignal<TDocument, TDocumentModel>

/**
 * Subscribe to an unregistered aggregation in React async mode.
 * @param signal Aggregation function.
 * @param params Parameters passed to the aggregation.
 * @param options Subscription behavior options.
 */
export function useAsyncSub<TOutput = unknown, TCollection extends string = string> (
  signal: AggregationFunction<TOutput, TCollection>,
  params?: AggregationParams,
  options?: UseSubOptions
): SubResult<AggregationFunction<TOutput, TCollection>, AggregationParams | undefined>

export function useAsyncSub (signal: unknown, params?: unknown, options?: UseSubOptions): unknown {
  const normalized = normalizeUseSubArgs(signal, params, options)
  return useNormalizedSub(normalized.signal, normalized.params, { ...normalized.options, async: true })
}

/**
 * Close a batch subscription barrier opened by previous `useBatchSub()` calls in this render.
 */
export function useBatchSub (): void

/**
 * Subscribe to a document signal in React batch mode.
 * @param signal Document signal to subscribe to.
 * @param params Must be omitted for document subscriptions.
 * @param options Subscription behavior options.
 */
export function useBatchSub<TSignal extends DocumentSignal<any, any, any>> (
  signal: TSignal,
  options?: UseSubOptions
): SubResult<TSignal>

/**
 * Subscribe to a document signal in React batch mode.
 * @param signal Document signal to subscribe to.
 * @param params Must be omitted for document subscriptions.
 * @param options Subscription behavior options.
 */
export function useBatchSub<TSignal extends DocumentSignal<any, any, any>> (
  signal: TSignal,
  params?: undefined,
  options?: UseSubOptions
): SubResult<TSignal>

/**
 * Subscribe to a collection query in React batch mode.
 * @param signal Collection signal to query.
 * @param params Mongo-style query params, including filters and `$sort`.
 * @param options Subscription behavior options.
 */
export function useBatchSub<
  TDocument,
  TCollectionModel extends SignalModelConstructor<TDocument[]>,
  TDocumentModel extends SignalModelConstructor<TDocument>,
  TCollectionPath extends WildcardSignalPath
> (
  signal: CollectionSignal<TDocument, TCollectionModel, TDocumentModel, TCollectionPath>,
  params: QueryParams<TDocument>,
  options?: UseSubOptions
): SubResult<CollectionSignal<TDocument, TCollectionModel, TDocumentModel, TCollectionPath>, QueryParams<TDocument>>

/**
 * Subscribe to a collection query with computed string keys in React batch mode.
 * This fallback preserves Mongo-style computed paths such as `{ [`likes.${id}`]: true }`.
 * Literal query objects should use the stricter overload above.
 * @param signal Collection signal to query.
 * @param params Mongo-style query params with a widened computed key.
 * @param options Subscription behavior options.
 */
export function useBatchSub<
  TDocument,
  TCollectionModel extends SignalModelConstructor<TDocument[]>,
  TDocumentModel extends SignalModelConstructor<TDocument>,
  TCollectionPath extends WildcardSignalPath,
  TParams extends object
> (
  signal: CollectionSignal<TDocument, TCollectionModel, TDocumentModel, TCollectionPath>,
  params: TParams & ComputedQueryParamsInput<TParams>,
  options?: UseSubOptions
): SubResult<CollectionSignal<TDocument, TCollectionModel, TDocumentModel, TCollectionPath>, TParams>

/**
 * Subscribe to a registered collection aggregation in React batch mode.
 * @param signal Aggregation header generated by StartupJS model loading.
 * @param params Parameters passed to the aggregation.
 * @param options Subscription behavior options.
 */
export function useBatchSub<TCollection extends string, TOutput = unknown> (
  signal: RegisteredAggregationInput<TCollection, TOutput>,
  params?: AggregationParams,
  options?: UseSubOptions
): SubResult<RegisteredAggregationInput<TCollection, TOutput>>

/**
 * Subscribe to a client aggregation in React batch mode.
 * @param signal Aggregation function created with `aggregation(collection, fn)`.
 * @param params Parameters passed to the aggregation.
 * @param options Subscription behavior options.
 */
export function useBatchSub<TOutput, TCollection extends string> (
  signal: ClientAggregationFunction<TOutput, TCollection>,
  params?: AggregationParams,
  options?: UseSubOptions
): SubResult<ClientAggregationFunction<TOutput, TCollection>>

/**
 * Subscribe to an aggregation with explicit output typing in React batch mode.
 * @param signal Typed aggregation input.
 * @param params Parameters passed to the aggregation.
 * @param options Subscription behavior options.
 */
export function useBatchSub<
  TDocument,
  TDocumentModel extends SignalModelConstructor<TDocument>
> (
  signal: TypedAggregationInput<TDocument, TDocumentModel>,
  params?: AggregationParams,
  options?: UseSubOptions
): TypedAggregationSignal<TDocument, TDocumentModel>

/**
 * Subscribe to an unregistered aggregation in React batch mode.
 * @param signal Aggregation function.
 * @param params Parameters passed to the aggregation.
 * @param options Subscription behavior options.
 */
export function useBatchSub<TOutput = unknown, TCollection extends string = string> (
  signal: AggregationFunction<TOutput, TCollection>,
  params?: AggregationParams,
  options?: UseSubOptions
): SubResult<AggregationFunction<TOutput, TCollection>, AggregationParams | undefined>

export function useBatchSub (signal?: unknown, params?: unknown, options?: UseSubOptions): unknown {
  const callUseSub = useSub as (signal: unknown, params?: unknown, options?: UseSubOptions) => unknown
  if (arguments.length === 0) {
    return callUseSub(undefined, undefined, { batch: true })
  }
  const normalized = normalizeUseSubArgs(signal, params, options)
  return callUseSub(normalized.signal, normalized.params, { ...normalized.options, async: false, batch: true })
}

/**
 * Close a batch subscription barrier opened by previous `useSub(..., { batch: true })`
 * calls in this render.
 */
export default function useSub (
  signal: undefined,
  params: undefined,
  options: UseSubOptions & { batch: true }
): void

/**
 * Subscribe to a document signal in React.
 * @param signal Document signal to subscribe to.
 * @param params Must be omitted for document subscriptions.
 * @param options Subscription behavior options.
 */
export default function useSub<TSignal extends DocumentSignal<any, any, any>> (
  signal: TSignal,
  options?: UseSubOptions
): SubResult<TSignal>

/**
 * Subscribe to a document signal in React.
 * @param signal Document signal to subscribe to.
 * @param params Must be omitted for document subscriptions.
 * @param options Subscription behavior options.
 */
export default function useSub<TSignal extends DocumentSignal<any, any, any>> (
  signal: TSignal,
  params?: undefined,
  options?: UseSubOptions
): SubResult<TSignal>

/**
 * Subscribe to a collection query in React.
 * @param signal Collection signal to query.
 * @param params Mongo-style query params, including filters and `$sort`.
 * @param options Subscription behavior options.
 */
export default function useSub<
  TDocument,
  TCollectionModel extends SignalModelConstructor<TDocument[]>,
  TDocumentModel extends SignalModelConstructor<TDocument>,
  TCollectionPath extends WildcardSignalPath
> (
  signal: CollectionSignal<TDocument, TCollectionModel, TDocumentModel, TCollectionPath>,
  params: QueryParams<TDocument>,
  options?: UseSubOptions
): SubResult<CollectionSignal<TDocument, TCollectionModel, TDocumentModel, TCollectionPath>, QueryParams<TDocument>>

/**
 * Subscribe to a collection query with computed string keys in React.
 * This fallback preserves Mongo-style computed paths such as `{ [`likes.${id}`]: true }`.
 * Literal query objects should use the stricter overload above.
 * @param signal Collection signal to query.
 * @param params Mongo-style query params with a widened computed key.
 * @param options Subscription behavior options.
 */
export default function useSub<
  TDocument,
  TCollectionModel extends SignalModelConstructor<TDocument[]>,
  TDocumentModel extends SignalModelConstructor<TDocument>,
  TCollectionPath extends WildcardSignalPath,
  TParams extends object
> (
  signal: CollectionSignal<TDocument, TCollectionModel, TDocumentModel, TCollectionPath>,
  params: TParams & ComputedQueryParamsInput<TParams>,
  options?: UseSubOptions
): SubResult<CollectionSignal<TDocument, TCollectionModel, TDocumentModel, TCollectionPath>, TParams>

/**
 * Subscribe to a registered collection aggregation in React.
 * @param signal Aggregation header generated by StartupJS model loading.
 * @param params Parameters passed to the aggregation.
 * @param options Subscription behavior options.
 */
export default function useSub<TCollection extends string, TOutput = unknown> (
  signal: RegisteredAggregationInput<TCollection, TOutput>,
  params?: AggregationParams,
  options?: UseSubOptions
): SubResult<RegisteredAggregationInput<TCollection, TOutput>>

/**
 * Subscribe to a client aggregation in React.
 * @param signal Aggregation function created with `aggregation(collection, fn)`.
 * @param params Parameters passed to the aggregation.
 * @param options Subscription behavior options.
 */
export default function useSub<TOutput, TCollection extends string> (
  signal: ClientAggregationFunction<TOutput, TCollection>,
  params?: AggregationParams,
  options?: UseSubOptions
): SubResult<ClientAggregationFunction<TOutput, TCollection>>

/**
 * Subscribe to an aggregation with explicit output typing in React.
 * @param signal Typed aggregation input.
 * @param params Parameters passed to the aggregation.
 * @param options Subscription behavior options.
 */
export default function useSub<
  TDocument,
  TDocumentModel extends SignalModelConstructor<TDocument>
> (
  signal: TypedAggregationInput<TDocument, TDocumentModel>,
  params?: AggregationParams,
  options?: UseSubOptions
): TypedAggregationSignal<TDocument, TDocumentModel>

/**
 * Subscribe to an unregistered aggregation in React.
 * @param signal Aggregation function.
 * @param params Parameters passed to the aggregation.
 * @param options Subscription behavior options.
 */
export default function useSub<TOutput = unknown, TCollection extends string = string> (
  signal: AggregationFunction<TOutput, TCollection>,
  params?: AggregationParams,
  options?: UseSubOptions
): SubResult<AggregationFunction<TOutput, TCollection>, AggregationParams | undefined>

export default function useSub (signal: unknown, params?: unknown, options?: UseSubOptions): unknown {
  const normalized = normalizeUseSubArgs(signal, params, options)
  return useNormalizedSub(normalized.signal, normalized.params, normalized.options)
}

function normalizeUseSubArgs (
  signal: unknown,
  params?: unknown,
  options?: UseSubOptions
): { signal: unknown, params?: unknown, options?: UseSubOptions } {
  if (options === undefined && params !== undefined && isPublicDocumentSignal(signal) && isUseSubOptions(params)) {
    return {
      signal,
      params: undefined,
      options: params
    }
  }
  return { signal, params, options }
}

function isUseSubOptions (value: unknown): value is UseSubOptions {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.keys(value).every(key => USE_SUB_OPTION_KEYS.has(key))
}

function useNormalizedSub (signal: unknown, params?: unknown, options?: UseSubOptions): unknown {
  const scheduleGroupUpdate = useSuspenseGroupScheduleUpdate()
  if (isBatchBarrierCall(signal, params, options)) return closeBatchBarrier(scheduleGroupUpdate)
  return useSubDeferred(signal, params, options) // eslint-disable-line react-hooks/rules-of-hooks
}

function isBatchBarrierCall (signal: unknown, params: unknown, options?: UseSubOptions): boolean {
  return signal === undefined && params === undefined && !!options?.batch
}

function closeBatchBarrier (
  scheduleGroupUpdate: ((promise: PromiseLike<unknown>) => void) | undefined
): void {
  const promise = promiseBatcher.getPromiseAll()
  if (promise) {
    scheduleGroupUpdate?.(promise)
    throw promise
  }
}

// version of sub() which works as a react hook and throws promise for Suspense
export function useSubDeferred (
  signal: unknown,
  params?: unknown,
  { async = false, defer, batch = false }: UseSubOptions = {}
): unknown {
  const $signalRef = useRef<unknown>(undefined)
  const scheduleUpdate = useScheduleUpdate()
  const scheduleGroupUpdate = useSuspenseGroupScheduleUpdate()
  const observerDefer = useDefer()
  if (batch) promiseBatcher.activate()
  defer ??= observerDefer ?? DEFAULT_DEFER
  if (defer) {
    signal = useDeferredValue(signal) // eslint-disable-line react-hooks/rules-of-hooks
    const serializedParams = useDeferredValue(params ? JSON.stringify(params) : undefined) // eslint-disable-line react-hooks/rules-of-hooks
    params = serializedParams != null ? JSON.parse(serializedParams) : undefined
  }
  const subscriptionLease = useSubscriptionLease(signal, params)
  const promiseOrSignal = subscriptionLease.value
  // 1. if it's a promise, throw it so that Suspense can catch it and wait for subscription to finish
  if (isThenable(promiseOrSignal)) {
    const promise = maybeThrottle(promiseOrSignal)
    const readyPromise = getSubscriptionReadyPromise(promise, subscriptionLease)
    scheduleRenderAttemptLeaseCleanup(subscriptionLease, readyPromise, batch)
    const hasPreviousSignal = !!$signalRef.current
    if (batch) {
      // Batch suspense must block only on initial load.
      // On resubscribe we keep rendering previous signal and refresh in background.
      if (!hasPreviousSignal) {
        promiseBatcher.add(promise)
        addBatchReadinessCheck(promise, subscriptionLease)
      } else {
        scheduleUpdate(readyPromise)
      }
      if (async) scheduleUpdate(readyPromise)
      return $signalRef.current
    }
    if (async) {
      scheduleUpdate(readyPromise)
      return
    }
    // Keep previous snapshot during update re-subscribe and refresh in background.
    if (hasPreviousSignal) {
      scheduleUpdate(readyPromise)
      return $signalRef.current
    }
    scheduleGroupUpdate?.(readyPromise)
    throw readyPromise
  // 2. if it's a signal, we save it into ref to make sure it's not garbage collected while component exists
  } else {
    const $signal = promiseOrSignal
    if (batch && !$signalRef.current) addBatchReadinessCheckForSignal($signal, subscriptionLease)
    if ($signalRef.current !== $signal) $signalRef.current = $signal
    return $signal
  }
}

export function setTestThrottling (ms: number): void {
  if (typeof ms !== 'number') throw Error('setTestThrottling() accepts only a number in ms')
  if (ms === 0) throw Error('setTestThrottling(0) is not allowed, use resetTestThrottling() instead')
  if (ms < 0) throw Error('setTestThrottling() accepts only a positive number in ms')
  TEST_THROTTLING = ms
}
export function resetTestThrottling (): void {
  TEST_THROTTLING = false
}
export function setDefaultDefer (value: boolean): void {
  DEFAULT_DEFER = value
}

interface SubscriptionLease {
  value: unknown
  signal?: unknown
  // releases exactly this lease's acquisition (not another sub() of the signal)
  release?: (options?: SubReleaseOptions) => Promise<void> | void
  signalDisposed: boolean
  // target identity kept after release, to detect re-acquire loops
  target: unknown
  targetParams?: string
  releasedUncommitted: boolean
  uncommittedReacquires: number
  sticky: boolean
  inputSignal?: unknown
  serializedParams?: string
  previousLease?: SubscriptionLease
  committed: boolean
  released: boolean
  cleanupTimer?: ReturnType<typeof setTimeout>
  releaseTimer?: ReturnType<typeof setTimeout>
  unregisterCacheDestroy?: () => void
}

function useSubscriptionLease (signal: unknown, params?: unknown): SubscriptionLease {
  const cache = useCache(undefined)
  const triggerUpdate = useTriggerUpdate()
  const hookId = executionContextTracker.newHookId()
  const cacheKey = `subscriptionLease:${hookId}`
  const serializedParams = params != null ? JSON.stringify(params) : undefined
  let lease = cache.get(cacheKey) as SubscriptionLease | undefined
  if (
    !lease ||
    lease.released ||
    lease.inputSignal !== signal ||
    lease.serializedParams !== serializedParams
  ) {
    const nextLease = createSubscriptionLease(signal, params, serializedParams, lease)
    nextLease.unregisterCacheDestroy = cache.onDestroy(() => releaseSubscriptionLease(nextLease))
    if (lease?.releasedUncommitted && lease.target === signal && lease.targetParams === serializedParams) {
      nextLease.uncommittedReacquires = lease.uncommittedReacquires + 1
      if (nextLease.uncommittedReacquires >= UNCOMMITTED_REACQUIRE_LIMIT) {
        nextLease.sticky = true
        if (diag.on) {
          diag.addIncident('react.lease.reacquireLoop', diag.describeSubTarget(signal, serializedParams), {
            hook: cacheKey,
            reacquires: nextLease.uncommittedReacquires
          })
        }
      }
    }
    if (diag.on) diag.noteLeaseCreated(nextLease, diag.describeSubTarget(signal, serializedParams), cacheKey, executionContextTracker.getComponentId())
    lease = nextLease
    cache.set(cacheKey, nextLease)
  } else {
    clearTimeout(lease.cleanupTimer)
    lease.cleanupTimer = undefined
  }
  // Every render that uses a lease React has not committed yet (re)arms its
  // release: a render can be discarded before commit whether its subscription
  // was ready (sync) or not. A pending lease is armed once it is ready.
  if (!lease.committed && !isThenable(lease.value)) scheduleUncommittedLeaseCleanup(lease)

  useEffect(() => {
    // Released while React held this render's commit: re-render to re-acquire.
    if (lease.released) {
      triggerUpdate?.()
      return
    }
    lease.committed = true
    lease.uncommittedReacquires = 0
    if (diag.on) diag.noteLeaseCommitted(lease)
    clearTimeout(lease.cleanupTimer)
    lease.cleanupTimer = undefined
    clearTimeout(lease.releaseTimer)
    lease.releaseTimer = undefined
    if (lease.previousLease) {
      clearTimeout(lease.previousLease.releaseTimer)
      lease.previousLease.releaseTimer = undefined
    }
    return () => scheduleSubscriptionLeaseRelease(lease)
  }, [lease, triggerUpdate])

  useEffect(() => {
    if (isThenable(lease.value)) return
    releasePreviousSubscriptionLease(lease)
  })

  return lease
}

function createSubscriptionLease (
  signal: unknown,
  params: unknown,
  serializedParams?: string,
  previousLease?: SubscriptionLease
): SubscriptionLease {
  const acquisition = params != null ? acquireSub(signal, params) : acquireSub(signal)
  const value = acquisition.value
  const lease: SubscriptionLease = {
    value,
    signal: acquisition.signal,
    release: acquisition.release,
    inputSignal: signal,
    serializedParams,
    previousLease: previousLease?.released ? undefined : previousLease,
    committed: false,
    released: false,
    signalDisposed: false,
    target: signal,
    targetParams: serializedParams,
    releasedUncommitted: false,
    uncommittedReacquires: 0,
    sticky: false
  }

  if (isThenable(value)) {
    Promise.resolve(value).then($signal => {
      lease.signal = $signal
      lease.value = $signal
      if (lease.released) {
        disposeSubscriptionLeaseSignal(lease)
      }
    }, ignoreSubscriptionCleanupError)
  }

  return lease
}

function scheduleUncommittedLeaseCleanupAfter (
  lease: SubscriptionLease,
  promise: PromiseLike<unknown>
): void {
  Promise.resolve(promise).then(
    () => scheduleUncommittedLeaseCleanup(lease),
    () => scheduleUncommittedLeaseCleanup(lease)
  )
}

function scheduleRenderAttemptLeaseCleanup (
  lease: SubscriptionLease,
  readyPromise: PromiseLike<unknown>,
  batch: boolean
): void {
  if (!batch) {
    scheduleUncommittedLeaseCleanupAfter(lease, readyPromise)
    return
  }
  promiseBatcher.addRenderAttemptCleanup(barrier => {
    scheduleUncommittedLeaseCleanupAfter(lease, barrier ?? readyPromise)
  })
}

function scheduleUncommittedLeaseCleanup (lease: SubscriptionLease): void {
  if (lease.committed || lease.released || lease.cleanupTimer || lease.sticky) return
  // Not capped by a lower GC delay: the release gives the transport this much
  // grace anyway, and a shorter hold makes a commit React 19 holds (300 ms
  // Suspense throttle) re-acquire. A GC delay of 0 releases on the next task.
  const holdMs = getSubscriptionGcDelay() > 0 ? MAX_UNCOMMITTED_LEASE_GRACE_MS : 0
  lease.cleanupTimer = unrefTimer(setTimeout(() => {
    lease.cleanupTimer = undefined
    if (lease.committed) return
    lease.releasedUncommitted = true
    releaseSubscriptionLease(lease, { minGraceMs: MAX_UNCOMMITTED_LEASE_GRACE_MS })
  }, holdMs))
}

function releaseSubscriptionLease (lease: SubscriptionLease, options?: SubReleaseOptions): void {
  if (lease.released) return
  const previousLease = lease.previousLease
  lease.previousLease = undefined
  lease.released = true
  if (diag.on) diag.noteLeaseReleased(lease, lease.committed)
  lease.unregisterCacheDestroy?.()
  lease.unregisterCacheDestroy = undefined
  clearTimeout(lease.cleanupTimer)
  lease.cleanupTimer = undefined
  clearTimeout(lease.releaseTimer)
  lease.releaseTimer = undefined
  disposeSubscriptionLeaseSignal(lease, options)
  if (lease.committed && previousLease) releaseSubscriptionLease(previousLease)
}

function releasePreviousSubscriptionLease (lease: SubscriptionLease): void {
  const previousLease = lease.previousLease
  if (!previousLease) return
  lease.previousLease = undefined
  releaseSubscriptionLease(previousLease)
}

function scheduleSubscriptionLeaseRelease (lease: SubscriptionLease): void {
  if (lease.released || lease.releaseTimer) return
  lease.releaseTimer = setTimeout(() => {
    lease.releaseTimer = undefined
    releaseSubscriptionLease(lease)
  })
}

function disposeSubscriptionLeaseSignal (lease: SubscriptionLease, options?: SubReleaseOptions): void {
  const release = lease.release
  lease.release = undefined
  lease.signal = undefined
  lease.inputSignal = undefined
  lease.serializedParams = undefined
  lease.value = undefined
  // A lease released while its sub result was pending is disposed again when
  // the result settles; the acquisition is released once.
  if (!release || lease.signalDisposed) return
  lease.signalDisposed = true
  Promise.resolve(release(options)).catch(ignoreSubscriptionCleanupError)
}

function ignoreSubscriptionCleanupError (): void {}

// throttle to simulate slow network
function maybeThrottle<TValue> (promise: Promise<TValue>): Promise<TValue> {
  const delay = TEST_THROTTLING
  if (delay === false) return promise
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      promise.then(resolve, reject)
    }, delay)
  })
}

function addBatchReadinessCheck (
  promise: PromiseLike<unknown>,
  lease?: SubscriptionLease
): void {
  let resolvedSignal: unknown
  let resolved = false
  promise.then(signal => {
    resolvedSignal = signal
    resolved = true
  }, () => {
    resolved = true
  })
  promiseBatcher.addCheck({
    key: promise,
    type: 'subscription',
    isReady: () => !!lease?.released || (resolved && isSubscriptionSignalReady(resolvedSignal)),
    getState: () => getBatchSignalState(resolvedSignal)
  })
}

function getSubscriptionReadyPromise (
  promise: PromiseLike<unknown>,
  lease?: SubscriptionLease
): Promise<unknown> {
  return Promise.resolve(promise).then(async signal => {
    await waitForSubscriptionSignalReady(signal, lease)
    return signal
  })
}

async function waitForSubscriptionSignalReady (
  signal: unknown,
  lease?: SubscriptionLease
): Promise<void> {
  let poller: number | undefined
  while (!lease?.released && !isSubscriptionSignalReady(signal)) {
    if (diag.on && poller == null) poller = diag.pollerStart('react.readinessPoll', diag.describeSubTarget(signal))
    await new Promise(resolve => setTimeout(resolve, 16))
  }
  if (poller != null) diag.pollerEnd(poller)
}

function addBatchReadinessCheckForSignal (
  signal: unknown,
  lease?: SubscriptionLease
): void {
  if (isSubscriptionSignalReady(signal)) return
  const promise = Promise.resolve(signal)
  promiseBatcher.add(promise)
  addBatchReadinessCheck(promise, lease)
}

function isSubscriptionSignalReady (signal: unknown): boolean {
  if (isPublicDocumentSignal(signal)) {
    const $doc = signal as SignalBaseInstance
    return isDocReady($doc[SEGMENTS])
  }
  if (isQuerySignal(signal)) return isSubscriptionQueryReady(signal)
  return true
}

function isSubscriptionQueryReady (signal: BatchQuerySignal): boolean {
  const collection = signal[COLLECTION_NAME]
  const params = signal[PARAMS]
  if (!isBatchQueryTransportStable(signal)) return false
  const hasExtraResult = isExtraQuery(params)
  if (hasExtraResult) return readQueryExtra(signal) !== undefined

  const isAggregate = !!signal[IS_AGGREGATION] || isAggregationQuery(params)
  const docs = signal.get()
  if (isAggregate) {
    if (Array.isArray(docs)) return true
    return readQueryExtra(signal) !== undefined
  }

  if (!Array.isArray(docs)) return false
  materializeQueryDataDocsToCollection(collection, docs)
  const ids = signal.getIds()
  for (const id of ids) {
    if (id == null) continue
    if (!isDocReady([collection, id])) return false
  }
  return true
}

function isBatchQueryTransportStable (signal: BatchQuerySignal): boolean {
  const subscriptions = signal[IS_AGGREGATION] ? aggregationSubscriptions : querySubscriptions
  const entry = subscriptions.entries.get(signal[HASH])
  if (!entry) return false
  return entry.phase === 'stable' && entry.mode === entry.targetMode
}

function getBatchSignalState (signal: unknown): unknown {
  if (isPublicDocumentSignal(signal)) {
    const $doc = signal as SignalBaseInstance
    return {
      kind: 'doc',
      path: $doc[SEGMENTS],
      ready: isDocReady($doc[SEGMENTS])
    }
  }
  if (!isQuerySignal(signal)) return { kind: 'unknown', resolved: !!signal }

  const rootId = getRoot(signal as SignalBaseInstance)?.[ROOT_ID]
  const hash = signal[HASH]
  const collection = signal[COLLECTION_NAME]
  return {
    kind: signal[IS_AGGREGATION] ? 'aggregation' : 'query',
    collection,
    hash,
    ids: getPrivateData(rootId, [QUERIES, hash, 'ids'], true),
    hasDocs: Array.isArray(getPrivateData(rootId, [QUERIES, hash, 'docs'], true)),
    hasExtra: getPrivateData(rootId, [QUERIES, hash, 'extra'], true) !== undefined,
    hasAggregation: getPrivateData(rootId, [AGGREGATIONS, hash], true) !== undefined
  }
}

function readQueryExtra (signal: BatchQuerySignal): unknown {
  try {
    return signal.extra.get()
  } catch (err) {
    if (isThenable(err)) return undefined
    throw err
  }
}

interface BatchQuerySignal extends SignalBaseInstance {
  readonly [COLLECTION_NAME]: string
  readonly [HASH]: string
  readonly [PARAMS]?: unknown
  readonly [IS_QUERY]?: unknown
  readonly [IS_AGGREGATION]?: unknown
  readonly extra: SignalBaseInstance
}

function isQuerySignal (signal: unknown): signal is BatchQuerySignal {
  return !!signal &&
    (typeof signal === 'object' || typeof signal === 'function') &&
    !!(signal as BatchQuerySignal)[IS_QUERY] &&
    typeof (signal as BatchQuerySignal)[COLLECTION_NAME] === 'string' &&
    typeof (signal as BatchQuerySignal)[HASH] === 'string'
}

function isExtraQuery (query: unknown): boolean {
  if (!query || typeof query !== 'object') return false
  return !!(
    (query as Record<string, unknown>).$count ||
    (query as Record<string, unknown>).$queryName ||
    (query as Record<string, unknown>).$aggregationName
  )
}

function isAggregationQuery (query: unknown): boolean {
  if (!query || typeof query !== 'object') return false
  return !!(
    (query as Record<string, unknown>).$aggregate ||
    (query as Record<string, unknown>).$aggregationName
  )
}

function isThenable<TValue = unknown> (value: unknown): value is Promise<TValue> {
  return !!value &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
}
