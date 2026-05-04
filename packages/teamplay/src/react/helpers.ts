import type * as React from 'react'
import { useContext, createContext, useRef, useEffect, useLayoutEffect } from 'react'

export interface ComponentMetaCache {
  get: (key: unknown) => unknown
  set: (key: unknown, value: unknown) => unknown
  has: (key: unknown) => boolean
}

export interface ComponentMeta {
  readonly componentId: string
  readonly createdAt: number
  readonly defer?: boolean | number
  readonly triggerUpdate: () => void
  readonly scheduleUpdate: (promise: PromiseLike<unknown>) => void
  readonly cache: ComponentMetaCache
}

interface ComponentWithMeta {
  displayName?: string
  readonly name?: string
  propTypes?: unknown
  defaultProps?: unknown
}

export const ComponentMetaContext = createContext<Partial<ComponentMeta>>({})

export function pipeComponentDisplayName (
  SourceComponent: ComponentWithMeta,
  TargetComponent: ComponentWithMeta,
  suffix = '',
  defaultName = 'StartupjsWrapper'
): void {
  const displayName = SourceComponent.displayName || SourceComponent.name

  if (!TargetComponent.displayName) {
    TargetComponent.displayName = displayName ? (displayName + suffix) : defaultName
  }
}

export function pipeComponentMeta<TTargetComponent extends ComponentWithMeta> (
  SourceComponent: ComponentWithMeta,
  TargetComponent: TTargetComponent,
  suffix = '',
  defaultName = 'StartupjsWrapper'
): TTargetComponent {
  pipeComponentDisplayName(SourceComponent, TargetComponent, suffix, defaultName)

  if (!TargetComponent.propTypes && SourceComponent.propTypes) {
    TargetComponent.propTypes = SourceComponent.propTypes
  }
  if (!TargetComponent.defaultProps && SourceComponent.defaultProps) {
    TargetComponent.defaultProps = SourceComponent.defaultProps
  }
  return TargetComponent
}

export function useNow (): number {
  const context = useContext(ComponentMetaContext)
  if (!context) throw Error(ERRORS.useNow)
  return context.createdAt as number
}

export function useId (): string {
  const context = useContext(ComponentMetaContext)
  if (!context) throw Error(ERRORS.useId)
  return context.componentId as string
}

export function useTriggerUpdate (): () => void {
  const context = useContext(ComponentMetaContext)
  if (!context) throw Error(ERRORS.useTriggerUpdate)
  return context.triggerUpdate as () => void
}

export function useScheduleUpdate (): (promise: PromiseLike<unknown>) => void {
  const context = useContext(ComponentMetaContext)
  if (!context) throw Error(ERRORS.useScheduleUpdate)
  return context.scheduleUpdate as (promise: PromiseLike<unknown>) => void
}

export function useDefer (): boolean | number | undefined {
  const context = useContext(ComponentMetaContext)
  if (!context) throw Error(ERRORS.useScheduleUpdate)
  return context.defer
}

export function useCache (_key?: unknown): ComponentMetaCache {
  const context = useContext(ComponentMetaContext)
  if (!context) throw Error(ERRORS.useCache)
  return context.cache as ComponentMetaCache
}

export function useUnmount (fn: () => void): void {
  const fnRef = useRef(fn)
  if (fnRef.current !== fn) fnRef.current = fn
  useEffect(
    () => () => {
      fnRef.current()
    },
    []
  )
}

export function useDidUpdate (
  fn: React.EffectCallback,
  deps?: React.DependencyList
): void {
  const isFirst = useRef(true)
  const fnRef = useRef(fn)
  if (fnRef.current !== fn) fnRef.current = fn
  const stableDeps = useStableDeps(deps)
  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false
      return
    }
    return fnRef.current()
  }, stableDeps) // eslint-disable-line react-hooks/exhaustive-deps
}

export function useOnce (condition: unknown, fn: React.EffectCallback): void {
  const fired = useRef(false)
  useEffect(() => {
    if (fired.current) return
    if (!condition) return
    fired.current = true
    return fn()
  }, [condition, fn])
}

export function useSyncEffect (
  fn: React.EffectCallback,
  deps?: React.DependencyList
): void {
  const stableDeps = useStableDeps(deps)
  useLayoutEffect(fn, [fn, stableDeps])
}

function useStableDeps (deps: React.DependencyList | undefined): React.DependencyList {
  const depsRef = useRef<React.DependencyList>([])
  const nextDeps = Array.isArray(deps) ? deps : []
  if (!shallowEqualArrays(depsRef.current, nextDeps)) {
    depsRef.current = nextDeps
  }
  return depsRef.current
}

function shallowEqualArrays (
  a: React.DependencyList | undefined,
  b: React.DependencyList
): boolean {
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
