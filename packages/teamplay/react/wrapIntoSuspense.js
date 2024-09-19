// useSyncExternalStore is used to trigger an update same as in MobX
// ref: https://github.com/mobxjs/mobx/blob/94bc4997c14152ff5aefcaac64d982d5c21ba51a/packages/mobx-react-lite/src/useObserver.ts
import { useSyncExternalStore, forwardRef as _forwardRef, memo, createElement as el, Suspense, useId, useRef } from 'react'
import { pipeComponentMeta, pipeComponentDisplayName, ComponentMetaContext } from './helpers.js'

// TODO: probably add FinalizationRegistry to handle destruction of observer() before it ever mounted.
//       In such case we might have a memory leak because subscribe() would never fire and would never
//       clean up the cache
function destroyAdm (adm) {
  adm.onStoreChange = undefined
  adm.scheduledUpdatePromise = undefined
  adm.scheduleUpdate = undefined
  adm.cache?.clear()
  adm.cache = undefined
}

export default function wrapIntoSuspense ({
  Component,
  forwardRef,
  suspenseProps = DEFAULT_SUSPENSE_PROPS
} = {}) {
  if (!suspenseProps?.fallback) throw Error(ERRORS.noFallback)

  let SuspenseWrapper = (props, ref) => {
    const componentId = useId()
    const componentMetaRef = useRef()
    const admRef = useRef()
    if (!admRef.current) {
      const adm = {
        stateVersion: Symbol(), // eslint-disable-line symbol-description
        onStoreChange: undefined,
        scheduledUpdatePromise: undefined,
        cache: new Map(),
        scheduleUpdate: promise => {
          if (!promise?.then) throw Error('scheduleUpdate() expects a promise')
          if (adm.scheduledUpdatePromise === promise) return
          adm.scheduledUpdatePromise = promise
          promise.then(() => {
            if (adm.scheduledUpdatePromise !== promise) return
            adm.scheduledUpdatePromise = undefined
            adm.onStoreChange?.()
          })
        },
        subscribe (onStoreChange) {
          adm.onStoreChange = () => {
            adm.stateVersion = Symbol() // eslint-disable-line symbol-description
            onStoreChange()
          }
          return () => destroyAdm(adm)
        },
        getSnapshot () {
          return adm.stateVersion
        }
      }
      admRef.current = adm
    }
    const adm = admRef.current

    useSyncExternalStore(adm.subscribe, adm.getSnapshot, adm.getSnapshot)

    if (!componentMetaRef.current) {
      componentMetaRef.current = {
        componentId,
        createdAt: Date.now(),
        triggerUpdate: () => adm.onStoreChange?.(),
        scheduleUpdate: promise => adm.scheduleUpdate?.(promise),
        cache: {
          get: key => adm.cache?.get(key),
          set: (key, value) => adm.cache?.set(key, value),
          has: key => adm.cache?.has(key)
        }
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
