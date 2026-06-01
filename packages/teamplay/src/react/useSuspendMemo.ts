import executionContextTracker from './executionContextTracker.ts'
import { useCache } from './helpers.ts'
import renderAttemptDestroyer from './renderAttemptDestroyer.ts'

const IN_FLIGHT_BY_KEY = new Map<unknown, Promise<unknown>>()

type CacheEntry<TValue> = {
  deps: unknown[]
  status: 'cold' | 'pending' | 'done'
  value?: TValue
  promise?: Promise<unknown>
}

export default function useSuspendMemo<TValue> (
  factory: () => TValue,
  deps?: readonly unknown[]
): TValue {
  if (typeof factory !== 'function') throw Error('useSuspendMemo() expects a factory function')
  deps = normalizeDeps(deps)

  const cache = useCache(undefined)
  const hookId = executionContextTracker.newHookId()
  const cacheKey = `suspendMemo:${hookId}`

  let entry = cache.get(cacheKey) as CacheEntry<TValue> | undefined
  if (!entry || !shallowEqualArrays(entry.deps, deps)) {
    entry = {
      deps: [...deps],
      status: 'cold',
      value: undefined,
      promise: undefined
    }
    cache.set(cacheKey, entry)
  }

  if (entry.status === 'done') return entry.value as TValue
  if (entry.status === 'pending') {
    renderAttemptDestroyer.armSuspenseGate()
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
    renderAttemptDestroyer.armSuspenseGate()
    throw promise
  }
}

export function useSuspendMemoByKey<TValue> (
  key: unknown,
  factory: () => TValue,
  deps?: readonly unknown[]
): TValue {
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

export function __resetSuspendMemoForTests (): void {
  IN_FLIGHT_BY_KEY.clear()
}

function normalizeDeps (deps: readonly unknown[] | undefined): readonly unknown[] {
  if (deps == null) return []
  if (!Array.isArray(deps)) throw Error('useSuspendMemo() expects deps to be an array')
  return deps
}

function shallowEqualArrays (a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a === b) return true
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return false
  }
  return true
}

function isThenable (value: unknown): value is PromiseLike<unknown> {
  return !!value &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
}
