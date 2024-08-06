import { useRef, useDeferredValue } from 'react'
import sub from '../orm/sub.js'

let TEST_THROTTLING = false

// version of sub() which works as a react hook and throws promise for Suspense
export default function useSub (signal, params) {
  signal = useDeferredValue(signal)
  params = useDeferredValue(params ? JSON.stringify(params) : undefined)
  params = params ? JSON.parse(params) : undefined
  const promiseOrSignal = params ? sub(signal, params) : sub(signal)
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

export function setTestThrottling (ms) {
  if (typeof ms !== 'number') throw Error('setTestThrottling() accepts only a number in ms')
  if (ms === 0) throw Error('setTestThrottling(0) is not allowed, use resetTestThrottling() instead')
  if (ms < 0) throw Error('setTestThrottling() accepts only a positive number in ms')
  TEST_THROTTLING = ms
}
export function resetTestThrottling () {
  TEST_THROTTLING = false
}
