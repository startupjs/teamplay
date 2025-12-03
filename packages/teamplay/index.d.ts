// teamplay/index.d.ts
import type React from 'react'

export interface ObserverOptions {
  /** Wrap the resulting component with forwardRef */
  forwardRef?: boolean
  /** Enable/disable the internal cache (default: true) */
  cache?: boolean
  /** Milliseconds or boolean to throttle reactive updates */
  throttle?: number | boolean
  /** Pass-through flag consumed by wrapIntoSuspense */
  defer?: boolean | number
  /** Props forwarded to React.Suspense (fallback required internally) */
  suspenseProps?: React.ComponentProps<typeof React.Suspense>
}

/**
 * Makes any React component reactive and Suspense-aware.
 * Props are passed through unchanged; the returned component
 * preserves the original type so consumers keep full typings.
 */
export function observer<P, C extends React.ComponentType<P>> (
  component: C,
  options?: ObserverOptions
): C

// Keep existing public surface available even if typed loosely for now.
export const $: any
export { default as Signal, SEGMENTS } from './orm/Signal.js'
export { __DEBUG_SIGNALS_CACHE__, rawSignal, getSignalClass } from './orm/getSignal.js'
export { default as addModel } from './orm/addModel.js'
export { default as signal } from './orm/getSignal.js'
export { GLOBAL_ROOT_ID } from './orm/Root.js'
export { default as sub } from './orm/sub.js'
export {
  default as useSub,
  useAsyncSub,
  setUseDeferredValue as __setUseDeferredValue,
  setDefaultDefer as __setDefaultDefer
} from './react/useSub.js'
export { connection, setConnection, getConnection, fetchOnly, setFetchOnly, publicOnly, setPublicOnly } from './orm/connection.js'
export { useId, useNow, useScheduleUpdate, useTriggerUpdate } from './react/helpers.js'
export { GUID_PATTERN, hasMany, hasOne, hasManyFlags, belongsTo, pickFormFields } from '@teamplay/schema'
export { aggregation, aggregationHeader as __aggregationHeader } from '@teamplay/utils/aggregation'
export { accessControl } from '@teamplay/utils/accessControl'
export function getRootSignal (options?: Record<string, any>): any
export default $
