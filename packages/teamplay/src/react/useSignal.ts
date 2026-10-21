import { useRef } from 'react'
import $ from '../orm/$.js'
import { useCache } from './helpers.ts'
import executionContextTracker from './executionContextTracker.ts'

// useSignal(): a local signal (or a computed one) that a component keeps
// across its renders. In an observer() component the signal belongs to the
// component (as $() called there); in any other component it is kept in a ref.
export default function useSignal ($root: unknown, value?: unknown): unknown {
  if (executionContextTracker.isActive()) {
    const id = executionContextTracker.newHookId()
    const cache = useCache(undefined) // eslint-disable-line react-hooks/rules-of-hooks
    const $signal = $($root, value, id)
    // save signal into the component's cache to make sure it's not garbage collected while component exists
    cache.set(id, $signal)
    return $signal
  }
  // a component is rendered either always or never by observer(), so each
  // component calls the same hooks on every render
  const ref = useRef<unknown>(undefined) // eslint-disable-line react-hooks/rules-of-hooks
  ref.current ??= $($root, value)
  return ref.current
}
