import { useRef } from 'react'
import $ from '../orm/$.js'
import executionContextTracker from './executionContextTracker.js'

// universal versions of $() which work as a plain function or as a react hook
export default function universal$ ($root, value) {
  if (executionContextTracker.isActive()) {
    // within react component
    const id = executionContextTracker.newHookId()
    const $signal = $($root, value, id)
    // save signal into ref to make sure it's not garbage collected while component exists
    const $signalRef = useRef() // eslint-disable-line react-hooks/rules-of-hooks
    if ($signalRef.current !== $signal) $signalRef.current = $signal
    return $signal
  } else {
    return $($root, value)
  }
}
