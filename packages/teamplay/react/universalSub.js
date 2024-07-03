// NOTE: this is not used currently since using an explicit useSub()
//       hook is easier to understand in a React context.
//       Having the same sub() function working with either await or without it
//       is confusing. It's better to have a separate function for the hook.
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
    const $signalRef = useRef() // eslint-disable-line react-hooks/rules-of-hooks
    if ($signalRef.current !== promiseOrSignal) $signalRef.current = promiseOrSignal
  }
  return promiseOrSignal
}
