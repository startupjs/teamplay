import { useRef, useDeferredValue } from 'react'
import sub from '../orm/sub.js'
import { useScheduleUpdate } from './helpers.js'

let TEST_THROTTLING = false

// experimental feature to leverage useDeferredValue() to handle re-subscriptions.
// Currently it does lead to issues with extra rerenders and requires further investigation
let USE_DEFERRED_VALUE = false

export default function useSub (signal, params) {
  if (USE_DEFERRED_VALUE) {
    return useSubDeferred(signal, params) // eslint-disable-line react-hooks/rules-of-hooks
  } else {
    return useSubClassic(signal, params) // eslint-disable-line react-hooks/rules-of-hooks
  }
}

// version of sub() which works as a react hook and throws promise for Suspense
export function useSubDeferred (signal, params) {
  signal = useDeferredValue(signal)
  params = useDeferredValue(params ? JSON.stringify(params) : undefined)
  params = params != null ? JSON.parse(params) : undefined
  const promiseOrSignal = params != null ? sub(signal, params) : sub(signal)
  // 1. if it's a promise, throw it so that Suspense can catch it and wait for subscription to finish
  if (promiseOrSignal.then) {
    if (TEST_THROTTLING) {
      // simulate slow network
      throw new Promise((resolve, reject) => {
        setTimeout(() => {
          promiseOrSignal.then(resolve, reject)
        }, TEST_THROTTLING)
      })
    }
    throw promiseOrSignal
  }
  // 2. if it's a signal, we save it into ref to make sure it's not garbage collected while component exists
  const $signalRef = useRef() // eslint-disable-line react-hooks/rules-of-hooks
  if ($signalRef.current !== promiseOrSignal) $signalRef.current = promiseOrSignal
  return promiseOrSignal
}

// classic version which initially throws promise for Suspense
// but if we get a promise second time, we return the last signal and wait for promise to resolve
export function useSubClassic (signal, params) {
  const $signalRef = useRef()
  const activePromiseRef = useRef()
  const scheduleUpdate = useScheduleUpdate()
  const promiseOrSignal = params != null ? sub(signal, params) : sub(signal)
  // 1. if it's a promise, throw it so that Suspense can catch it and wait for subscription to finish
  if (promiseOrSignal.then) {
    let promise
    if (TEST_THROTTLING) {
      // simulate slow network
      promise = new Promise((resolve, reject) => {
        setTimeout(() => {
          promiseOrSignal.then(resolve, reject)
        }, TEST_THROTTLING)
      })
    } else {
      promise = promiseOrSignal
    }
    // first time we just throw the promise to be caught by Suspense
    if (!$signalRef.current) throw promise
    // if we already have a previous signal, we return it and wait for new promise to resolve
    scheduleUpdate(promise)
    return $signalRef.current
  }
  // 2. if it's a signal, we save it into ref to make sure it's not garbage collected while component exists
  if ($signalRef.current !== promiseOrSignal) {
    activePromiseRef.current = undefined
    $signalRef.current = promiseOrSignal
  }
  return promiseOrSignal
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
