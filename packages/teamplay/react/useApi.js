import { useEffect, useRef, useState } from 'react'

export default function useApi (api, args = [], options = {}) {
  const { debounce = 0 } = options || {}
  const [data, setData] = useState()
  const [error, setError] = useState()
  const [loading, setLoading] = useState(false)
  const requestIdRef = useRef(0)
  const stableArgs = useStableDeps(Array.isArray(args) ? args : [args])

  useEffect(() => {
    if (typeof api !== 'function') return
    let cancelled = false
    const requestId = ++requestIdRef.current
    let timer

    const run = async () => {
      try {
        setLoading(true)
        const result = await api(...stableArgs)
        if (cancelled || requestId !== requestIdRef.current) return
        setData(result)
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

function useStableDeps (deps) {
  const depsRef = useRef([])
  if (!shallowEqualArrays(depsRef.current, deps)) {
    depsRef.current = deps
  }
  return depsRef.current
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
