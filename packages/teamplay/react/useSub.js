import { useRef, useDeferredValue } from 'react'
import sub from '../orm/sub.js'
import { useScheduleUpdate, useCache } from './helpers.js'
import executionContextTracker from './executionContextTracker.js'

let TEST_THROTTLING = false

// experimental feature to leverage useDeferredValue() to handle re-subscriptions.
// Currently it does lead to issues with extra rerenders and requires further investigation
let USE_DEFERRED_VALUE = false

export function useAsyncSub (signal, params, options) {
  return useSub(signal, params, { ...options, async: true })
}

export default function useSub (signal, params, options) {
  if (USE_DEFERRED_VALUE) {
    return useSubDeferred(signal, params, options) // eslint-disable-line react-hooks/rules-of-hooks
  } else {
    return useSubClassic(signal, params, options) // eslint-disable-line react-hooks/rules-of-hooks
  }
}

// version of sub() which works as a react hook and throws promise for Suspense
export function useSubDeferred (signal, params, { async = false } = {}) {
  const $signalRef = useRef() // eslint-disable-line react-hooks/rules-of-hooks
  const scheduleUpdate = useScheduleUpdate()
  signal = useDeferredValue(signal)
  params = useDeferredValue(params ? JSON.stringify(params) : undefined)
  params = params != null ? JSON.parse(params) : undefined
  const promiseOrSignal = params != null ? sub(signal, params) : sub(signal)
  // 1. if it's a promise, throw it so that Suspense can catch it and wait for subscription to finish
  if (promiseOrSignal.then) {
    const promise = maybeThrottle(promiseOrSignal)
    if (async) {
      scheduleUpdate(promise)
      return
    }
    throw promise
  // 2. if it's a signal, we save it into ref to make sure it's not garbage collected while component exists
  } else {
    const $signal = promiseOrSignal
    if ($signalRef.current !== $signal) $signalRef.current = $signal
    return $signal
  }
}

// classic version which initially throws promise for Suspense
// but if we get a promise second time, we return the last signal and wait for promise to resolve
export function useSubClassic (signal, params, { async = false } = {}) {
  const id = executionContextTracker.newHookId()
  const cache = useCache()
  const activePromiseRef = useRef()
  const scheduleUpdate = useScheduleUpdate()
  const promiseOrSignal = params != null ? sub(signal, params) : sub(signal)
  // 1. if it's a promise, throw it so that Suspense can catch it and wait for subscription to finish
  if (promiseOrSignal.then) {
    const promise = maybeThrottle(promiseOrSignal)
    // first time we just throw the promise to be caught by Suspense
    if (!cache.has(id)) {
      // if we are in async mode, we just return nothing and let the user
      // handle appearance of signal on their own.
      // We manually schedule an update when promise resolves since we can't
      // rely on Suspense in this case to automatically trigger component's re-render
      if (async) {
        scheduleUpdate(promise)
        return
      }
      // in regular mode we throw the promise to be caught by Suspense
      // this way we guarantee that the signal with all the data
      // will always be there when component is rendered
      throw promise
    }
    // if we already have a previous signal, we return it and wait for new promise to resolve
    scheduleUpdate(promise)
    return cache.get(id)
  // 2. if it's a signal, we save it into ref to make sure it's not garbage collected while component exists
  } else {
    const $signal = promiseOrSignal
    if (cache.get(id) !== $signal) {
      activePromiseRef.current = undefined
      cache.set(id, $signal)
    }
    return $signal
  }
}

export function setTestThrottling (ms) {
  if (typeof ms !== 'number') throw Error('setTestThrottling() accepts only a number in ms')
  if (ms === 0) throw Error('setTestThrottling(0) is not allowed, use resetTestThrottling() instead')
  if (ms < 0) throw Error('setTestThrottling() accepts only a positive number in ms')
  TEST_THROTTLING = ms
}
export function resetTestThrottling () {
  TEST_THROTTLING = false
}
export function setUseDeferredValue (value) {
  USE_DEFERRED_VALUE = value
}

// throttle to simulate slow network
function maybeThrottle (promise) {
  if (!TEST_THROTTLING) return promise
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      promise.then(resolve, reject)
    }, TEST_THROTTLING)
  })
}
