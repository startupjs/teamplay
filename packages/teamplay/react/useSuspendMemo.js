import executionContextTracker from './executionContextTracker.js'
import { useCache, useId } from './helpers.js'
import { markCompatComponent } from './compatComponentRegistry.js'

const IN_FLIGHT_BY_KEY = new Map()

export default function useSuspendMemo (factory, deps) {
  if (typeof factory !== 'function') throw Error('useSuspendMemo() expects a factory function')
  deps = normalizeDeps(deps)

  const componentId = useId()
  const cache = useCache()
  const hookId = executionContextTracker.newHookId()
  const cacheKey = `suspendMemo:${hookId}`

  let entry = cache.get(cacheKey)
  if (!entry || !shallowEqualArrays(entry.deps, deps)) {
    entry = {
      deps: [...deps],
      status: 'cold',
      value: undefined,
      promise: undefined
    }
    cache.set(cacheKey, entry)
  }

  if (entry.status === 'done') return entry.value
  if (entry.status === 'pending') {
    markCompatComponent(componentId)
    throw entry.promise
  }

  try {
    const value = factory()
    entry.status = 'done'
    entry.value = value
    return value
  } catch (err) {
    if (!isThenable(err)) throw err
    const promise = Promise.resolve(err).finally(() => {
      if (entry.promise !== promise) return
      entry.status = 'cold'
      entry.promise = undefined
    })
    entry.status = 'pending'
    entry.promise = promise
    markCompatComponent(componentId)
    throw promise
  }
}

export function useSuspendMemoByKey (key, factory, deps) {
  if (key == null) throw Error('useSuspendMemoByKey() expects a non-null key')
  return useSuspendMemo(() => {
    const inFlight = IN_FLIGHT_BY_KEY.get(key)
    if (inFlight) throw inFlight

    try {
      return factory()
    } catch (err) {
      if (!isThenable(err)) throw err
      const promise = Promise.resolve(err).finally(() => {
        if (IN_FLIGHT_BY_KEY.get(key) === promise) IN_FLIGHT_BY_KEY.delete(key)
      })
      IN_FLIGHT_BY_KEY.set(key, promise)
      throw promise
    }
  }, [key, ...normalizeDeps(deps)])
}

export function __resetSuspendMemoForTests () {
  IN_FLIGHT_BY_KEY.clear()
}

function normalizeDeps (deps) {
  if (deps == null) return []
  if (!Array.isArray(deps)) throw Error('useSuspendMemo() expects deps to be an array')
  return deps
}

function shallowEqualArrays (a, b) {
  if (a === b) return true
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return false
  }
  return true
}

function isThenable (value) {
  return !!value && typeof value.then === 'function'
}
