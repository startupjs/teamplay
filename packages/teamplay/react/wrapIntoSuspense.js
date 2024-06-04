import { forwardRef as _forwardRef, memo, createElement as el, Suspense, useId, useRef } from 'react'
import { pipeComponentMeta, pipeComponentDisplayName, ComponentMetaContext } from './helpers.js'

export default function wrapIntoSuspense ({
  Component,
  forwardRef,
  suspenseProps = DEFAULT_SUSPENSE_PROPS
} = {}) {
  if (!suspenseProps?.fallback) throw Error(ERRORS.noFallback)

  let SuspenseWrapper = (props, ref) => {
    const componentId = useId()
    const componentMetaRef = useRef()
    if (!componentMetaRef.current) {
      componentMetaRef.current = {
        componentId,
        createdAt: Date.now()
      }
    }

    if (forwardRef) props = { ...props, ref }

    return (
      el(ComponentMetaContext.Provider, { value: componentMetaRef.current },
        el(Suspense, suspenseProps,
          el(Component, props)
        )
      )
    )
  }

  // pipe only displayName because forwardRef render function
  // do not support propTypes or defaultProps
  pipeComponentDisplayName(Component, SuspenseWrapper, 'StartupjsObserverWrapper')

  if (forwardRef) SuspenseWrapper = _forwardRef(SuspenseWrapper)
  SuspenseWrapper = memo(SuspenseWrapper)

  pipeComponentMeta(Component, SuspenseWrapper)

  return SuspenseWrapper
}

const DEFAULT_SUSPENSE_PROPS = { fallback: el(NullComponent, null, null) }
function NullComponent () { return null }

const ERRORS = {
  noFallback: '[observer()] You must pass at least a fallback parameter to suspenseProps'
}
