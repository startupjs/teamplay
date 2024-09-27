import { useContext, createContext, useRef, useEffect } from 'react'

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
