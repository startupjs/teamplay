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

export function useId () {
  const { componentId } = useContext(ComponentMetaContext)
  return componentId
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
