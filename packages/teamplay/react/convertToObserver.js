// TODO: rewrite to use useSyncExternalStore like in mobx. This will also help with handling Suspense abandonment better
//       to cleanup the observer() reaction when the component is unmounted or was abandoned and unmounts will never trigger.
//       ref: https://github.com/mobxjs/mobx/blob/94bc4997c14152ff5aefcaac64d982d5c21ba51a/packages/mobx-react-lite/src/useObserver.ts
import { forwardRef as _forwardRef, useRef, useSyncExternalStore } from 'react'
import { observe, unobserve } from '@nx-js/observer-util'
import _throttle from 'lodash/throttle.js'
import { createCaches, getDummyCache } from '@teamplay/cache'
import { __increment, __decrement } from '@teamplay/debug'
import executionContextTracker from './executionContextTracker.js'
import { pipeComponentMeta, useUnmount, useId } from './helpers.js'
import trapRender from './trapRender.js'

const DEFAULT_THROTTLE_TIMEOUT = 100

export default function convertToObserver (BaseComponent, {
  forwardRef,
  cache: enableCache = true,
  throttle,
  ...options
} = {}) {
  throttle = normalizeThrottle(throttle)
  // MAGIC. This fixes hot-reloading. TODO: figure out WHY it fixes it
  // const random = Math.random()

  // memo; we are not intested in deep updates
  // in props; we assume that if deep objects are changed,
  // this is in observables, which would have been tracked anyway
  let Component = (...args) => {
    const [cache, destroyCache] = useCreateCacheRef(enableCache)
    const componentId = useId()

    const admRef = useRef()
    if (!admRef.current) {
      const adm = {
        stateVersion: Symbol(), // eslint-disable-line symbol-description
        onStoreChange: undefined,
        subscribe (onStoreChange) {
          adm.onStoreChange = () => {
            adm.stateVersion = Symbol() // eslint-disable-line symbol-description
            onStoreChange()
          }
          return () => {
            adm.onStoreChange = undefined
          }
        },
        getSnapshot () {
          return adm.stateVersion
        }
      }
      admRef.current = adm
    }
    const adm = admRef.current

    useSyncExternalStore(adm.subscribe, adm.getSnapshot, adm.getSnapshot)

    // wrap the BaseComponent into an observe decorator once.
    // This way it will track any observable changes and will trigger rerender
    const reactionRef = useRef()
    const destroyRef = useRef()
    if (!reactionRef.current) {
      let update = () => {
        // It's important to block updates caused by rendering itself
        // (when the sync rendering is in progress).
        if (!executionContextTracker.isActive()) adm.onStoreChange?.()
      }
      if (throttle) update = _throttle(update, throttle)
      destroyRef.current = (where) => {
        if (!reactionRef.current) throw Error(`NO REACTION REF - ${where}`)
        unobserve(reactionRef.current)
        reactionRef.current = undefined
        destroyRef.current = undefined
        destroyCache(where)
      }
      const trappedRender = trapRender({
        render: BaseComponent,
        cache,
        destroy: destroyRef.current,
        componentId
      })
      reactionRef.current = observe(trappedRender, {
        scheduler: update,
        lazy: true
      })
    }

    // clean up observer on unmount
    useUnmount(() => {
      destroyRef.current('useUnmount()')
    })

    return reactionRef.current(...args)
  }

  if (forwardRef) Component = _forwardRef(Component)
  pipeComponentMeta(BaseComponent, Component)

  return { Component, forwardRef, ...options }
}

function normalizeThrottle (throttle) {
  if (typeof throttle === 'boolean') {
    if (throttle) return DEFAULT_THROTTLE_TIMEOUT
    else return undefined
  }
  if (typeof throttle === 'number') return throttle
  if (throttle == null) return undefined
  throw Error('observer(): throttle can be either boolean or number (milliseconds)')
}

function useCreateCacheRef (enableCache) {
  const cacheRef = useRef()
  const destroyCacheRef = useRef()
  if (!cacheRef.current) {
    __increment('ObserverWrapper.cache')
    const _createCaches = enableCache ? createCaches : getDummyCache
    cacheRef.current = _createCaches(['styles', 'model'])
    destroyCacheRef.current = (where) => {
      if (!cacheRef.current) throw Error(`NO CACHE REF - ${where}`)
      __decrement('ObserverWrapper.cache')
      cacheRef.current.clear()
      cacheRef.current = undefined
      destroyCacheRef.current = undefined
    }
  }
  return [cacheRef.current, destroyCacheRef.current]
}
