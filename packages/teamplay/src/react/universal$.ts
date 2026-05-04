import $ from '../orm/$.js'
import { useCache } from './helpers.ts'
import executionContextTracker from './executionContextTracker.ts'

// universal versions of $() which work as a plain function or as a react hook
export default function universal$ ($root?: unknown, value?: unknown): unknown {
  if (executionContextTracker.isActive()) {
    // within react component
    const id = executionContextTracker.newHookId()
    const cache = useCache(undefined) // eslint-disable-line react-hooks/rules-of-hooks
    const $signal = $($root, value, id)
    cache.set(id, $signal)
    // save signal into ref to make sure it's not garbage collected while component exists
    return $signal
  } else {
    return $($root, value)
  }
}
