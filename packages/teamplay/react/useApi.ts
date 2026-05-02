import { useEffect, useRef, useState } from 'react'

export interface UseApiOptions {
  debounce?: number
}

export type UseApiResult<TResult> = [
  data: TResult | undefined,
  loading: boolean,
  error: unknown
]

type ApiFunction<TArgs extends readonly unknown[], TResult> =
  (...args: TArgs) => TResult | Promise<TResult>

export default function useApi<TResult> (
  api: ApiFunction<[], TResult> | undefined,
  args?: [],
  options?: UseApiOptions
): UseApiResult<Awaited<TResult>>
export default function useApi<TArg, TResult> (
  api: ApiFunction<[TArg], TResult> | undefined,
  args: TArg,
  options?: UseApiOptions
): UseApiResult<Awaited<TResult>>
export default function useApi<TArgs extends readonly unknown[], TResult> (
  api: ApiFunction<TArgs, TResult> | undefined,
  args: TArgs,
  options?: UseApiOptions
): UseApiResult<Awaited<TResult>>
export default function useApi<TResult> (
  api: ((...args: unknown[]) => TResult | Promise<TResult>) | undefined,
  args: unknown | readonly unknown[] = [],
  options: UseApiOptions = {}
): UseApiResult<Awaited<TResult>> {
  const { debounce = 0 } = options || {}
  const [data, setData] = useState<Awaited<TResult> | undefined>()
  const [error, setError] = useState<unknown>()
  const [loading, setLoading] = useState(false)
  const requestIdRef = useRef(0)
  const stableArgs = useStableDeps(Array.isArray(args) ? args : [args])

  useEffect(() => {
    if (typeof api !== 'function') return
    let cancelled = false
    const requestId = ++requestIdRef.current
    let timer: ReturnType<typeof setTimeout> | undefined

    const run = async () => {
      try {
        setLoading(true)
        const result = await api(...stableArgs)
        if (cancelled || requestId !== requestIdRef.current) return
        setData(result as Awaited<TResult>)
        setError(undefined)
      } catch (err) {
        if (cancelled || requestId !== requestIdRef.current) return
        setError(err)
      } finally {
        if (!cancelled && requestId === requestIdRef.current) setLoading(false)
      }
    }

    if (debounce > 0) {
      timer = setTimeout(run, debounce)
    } else {
      run()
    }

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [api, debounce, stableArgs])

  return [data, loading, error]
}

function useStableDeps (deps: readonly unknown[]): readonly unknown[] {
  const depsRef = useRef<readonly unknown[]>([])
  if (!shallowEqualArrays(depsRef.current, deps)) {
    depsRef.current = deps
  }
  return depsRef.current
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
