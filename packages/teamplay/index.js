// NOTE:
//   $() and sub() are currently set to be universal ones which work in both
//   plain JS and React environments. In React they are tied to the observer() HOC.
//   This is done to simplify the API.
//   In future, we might want to separate the plain JS and React APIs
import { getRootSignal as _getRootSignal, GLOBAL_ROOT_ID } from './orm/Root.js'
import universal$ from './react/universal$.js'
import useApi from './react/useApi.js'

export { default as Signal, SEGMENTS } from './orm/Signal.js'
export { __DEBUG_SIGNALS_CACHE__, rawSignal, getSignalClass } from './orm/getSignal.js'
export { default as addModel } from './orm/addModel.js'
export { default as signal } from './orm/getSignal.js'
export { GLOBAL_ROOT_ID } from './orm/Root.js'
export const $ = _getRootSignal({ rootId: GLOBAL_ROOT_ID, rootFunction: universal$ })
export const $root = $
export const model = $
export default $
export { default as sub } from './orm/sub.js'
export {
  default as useSub,
  useAsyncSub,
  setUseDeferredValue as __setUseDeferredValue,
  setDefaultDefer as __setDefaultDefer
} from './react/useSub.js'
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
} from './react/helpers.js'
export { connection, setConnection, getConnection, fetchOnly, setFetchOnly, publicOnly, setPublicOnly } from './orm/connection.js'
export { useId, useNow, useScheduleUpdate, useTriggerUpdate } from './react/helpers.js'
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

export function getRootSignal (options) {
  return _getRootSignal({
    rootFunction: universal$,
    ...options
  })
}
