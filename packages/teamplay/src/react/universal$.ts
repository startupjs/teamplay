import $ from '../orm/$.js'
import useSignal from './useSignal.ts'
import executionContextTracker from './executionContextTracker.ts'

// universal versions of $() which work as a plain function or as a react hook
// (useSignal(), within an observer() component)
export default function universal$ ($root?: unknown, value?: unknown): unknown {
  if (executionContextTracker.isActive()) {
    // within react component
    return useSignal($root, value) // eslint-disable-line react-hooks/rules-of-hooks
  } else {
    return $($root, value)
  }
}
