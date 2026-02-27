import { useContext, createContext, useRef, useEffect, useLayoutEffect } from 'react'

export const ComponentMetaContext = createContext({})

export function pipeComponentDisplayName (SourceComponent, TargetComponent, suffix = '', defaultName = 'StartupjsWrapper') {
  const displayName = SourceComponent.displayName || SourceComponent.name

  if (!TargetComponent.displayName) {
    TargetComponent.displayName = displayName ? (displayName + suffix) : defaultName
  }
}

export function pipeComponentMeta (SourceComponent, TargetComponent, suffix = '', defaultName = 'StartupjsWrapper') {
  pipeComponentDisplayName(SourceComponent, TargetComponent, suffix, defaultName)

  if (!TargetComponent.propTypes && SourceComponent.propTypes) {
    TargetComponent.propTypes = SourceComponent.propTypes
  }
  if (!TargetComponent.defaultProps && SourceComponent.defaultProps) {
    TargetComponent.defaultProps = SourceComponent.defaultProps
  }
  return TargetComponent
}

export function useNow () {
  const context = useContext(ComponentMetaContext)
  if (!context) throw Error(ERRORS.useNow)
  return context.createdAt
}

export function useId () {
  const context = useContext(ComponentMetaContext)
  if (!context) throw Error(ERRORS.useId)
  return context.componentId
}

export function useTriggerUpdate () {
  const context = useContext(ComponentMetaContext)
  if (!context) throw Error(ERRORS.useTriggerUpdate)
  return context.triggerUpdate
}

export function useScheduleUpdate () {
  const context = useContext(ComponentMetaContext)
  if (!context) throw Error(ERRORS.useScheduleUpdate)
  return context.scheduleUpdate
}

export function useDefer () {
  const context = useContext(ComponentMetaContext)
  if (!context) throw Error(ERRORS.useScheduleUpdate)
  return context.defer
}

export function useCache (key) {
  const context = useContext(ComponentMetaContext)
  if (!context) throw Error(ERRORS.useCache)
  return context.cache
}

export function useUnmount (fn) {
  const fnRef = useRef()
  if (fnRef.current !== fn) fnRef.current = fn
  useEffect(
    () => () => {
      fnRef.current()
    },
    []
  )
}

export function useDidUpdate (fn, deps) {
  const isFirst = useRef(true)
  const stableDeps = useStableDeps(deps)
  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false
      return
    }
    return fn()
  }, [fn, stableDeps])
}

export function useOnce (condition, fn) {
  const fired = useRef(false)
  useEffect(() => {
    if (fired.current) return
    if (!condition) return
    fired.current = true
    return fn()
  }, [condition, fn])
}

export function useSyncEffect (fn, deps) {
  const stableDeps = useStableDeps(deps)
  useLayoutEffect(fn, [fn, stableDeps])
}

function useStableDeps (deps) {
  const depsRef = useRef([])
  const nextDeps = Array.isArray(deps) ? deps : []
  if (!shallowEqualArrays(depsRef.current, nextDeps)) {
    depsRef.current = nextDeps
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

const ERRORS = {
  useTriggerUpdate: `
    useTriggerUpdate() can only be used inside a component wrapped with observer().
    You have probably forgot to wrap your component with observer().
  `,
  useScheduleUpdate: `
    useScheduleUpdate() can only be used inside a component wrapped with observer().
    You have probably forgot to wrap your component with observer().
  `,
  useId: `
    useId() can only be used inside a component wrapped with observer().
    You have probably forgot to wrap your component with observer().
  `,
  useNow: `
    useNow() can only be used inside a component wrapped with observer().
    You have probably forgot to wrap your component with observer().
  `,
  useCache: `
    useCache() can only be used inside a component wrapped with observer().
    You have probably forgot to wrap your component with observer().
  `
}
