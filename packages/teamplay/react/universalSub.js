import { useRef } from 'react'
import sub from '../orm/sub.js'
import executionContextTracker from './executionContextTracker.js'

// universal versions of sub() which work as a plain function or as a react hook
export default function universalSub (...args) {
  const promiseOrSignal = sub(...args)
  if (executionContextTracker.isActive()) {
    // within react component
    // 1. if it's a promise, throw it so that Suspense can catch it and wait for subscription to finish
    if (promiseOrSignal.then) throw promiseOrSignal
    // 2. if it's a signal, we save it into ref to make sure it's not garbage collected while component exists
    useRef(promiseOrSignal) // eslint-disable-line react-hooks/rules-of-hooks
  }
  return promiseOrSignal
}
