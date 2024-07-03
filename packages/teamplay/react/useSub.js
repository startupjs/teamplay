import { useRef } from 'react'
import sub from '../orm/sub.js'

// version of sub() which works as a react hook and throws promise for Suspense
export default function useSub (...args) {
  const promiseOrSignal = sub(...args)
  // 1. if it's a promise, throw it so that Suspense can catch it and wait for subscription to finish
  if (promiseOrSignal.then) throw promiseOrSignal
  // 2. if it's a signal, we save it into ref to make sure it's not garbage collected while component exists
  const $signalRef = useRef() // eslint-disable-line react-hooks/rules-of-hooks
  if ($signalRef.current !== promiseOrSignal) $signalRef.current = promiseOrSignal
  return promiseOrSignal
}
