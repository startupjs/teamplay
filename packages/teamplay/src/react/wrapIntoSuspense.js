// useSyncExternalStore is used to trigger an update same as in MobX
// ref: https://github.com/mobxjs/mobx/blob/94bc4997c14152ff5aefcaac64d982d5c21ba51a/packages/mobx-react-lite/src/useObserver.ts
import {
  useSyncExternalStore,
  forwardRef as _forwardRef,
  memo,
  createContext,
  createElement as el,
  Fragment,
  Suspense,
  useContext,
  useId,
  useLayoutEffect,
  useRef
} from 'react'
import { pipeComponentMeta, pipeComponentDisplayName, ComponentMetaContext } from './helpers.ts'
import FinalizationRegistry from '../utils/MockFinalizationRegistry.ts'
import { diag, objectId, noteAdmCreated, noteAdmSubscribed, noteAdmDestroyed, noteAdmCollected } from '../diagnostics/state.ts'

const SuspenseGroupContext = createContext()

export function SuspenseGroup ({ children, fallback = null }) {
  const storeRef = useRef()
  if (!storeRef.current) storeRef.current = createSuspenseGroupStore()
  const store = storeRef.current

  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

  return el(
    SuspenseGroupContext.Provider,
    { value: store },
    el(Suspense, { fallback },
      el(Fragment, null,
        children,
        el(GroupCommitMarker, { store })
      )
    )
  )
}

function GroupCommitMarker ({ store }) {
  // React 19 runs no layout effect on the server and no longer warns about it
  useLayoutEffect(() => {
    store.hasRevealedContent = true
  }, [store])
  return null
}

export function useSuspenseGroupScheduleUpdate () {
  return useContext(SuspenseGroupContext)?.scheduleUpdate
}

function createSuspenseGroupStore () {
  let version = 0
  const listeners = new Set()
  const scheduled = new WeakSet()

  return {
    createdAt: Date.now(),
    hasRevealedContent: false,
    subscribe (listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot () {
      return version
    },
    scheduleUpdate (promise) {
      if (!promise?.then) throw Error('scheduleUpdate() expects a promise')
      if (scheduled.has(promise)) return
      scheduled.add(promise)

      const retry = () => {
        version++
        for (const listener of listeners) listener()
      }
      promise.then(retry, retry)
    }
  }
}

// A wrapper whose render React discarded before it mounted never subscribes,
// so destroyAdm() never runs for it. Once it is collected, run its cache
// destroy callbacks (useSub() lease releases) from this registry. The held
// value is the callbacks set, which never references the wrapper.
const unmountedAdms = new FinalizationRegistry(({ callbacks, diagId }) => {
  for (const cleanup of Array.from(callbacks)) {
    try {
      cleanup()
    } catch {}
  }
  callbacks.clear()
  if (diagId != null) noteAdmCollected(diagId)
})

// Releases what the wrapper holds while it is subscribed. The wrapper stays
// usable: <Activity> unsubscribes a subtree it hides but keeps mounted, and
// subscribes it again when it shows it.
function destroyAdm (adm) {
  unmountedAdms.unregister(adm)
  if (diag.on) noteAdmDestroyed(adm)
  clearTimeout(adm.destroyTimer)
  adm.destroyTimer = undefined
  adm.destroyed = true
  for (const cleanup of Array.from(adm.cacheDestroyCallbacks)) cleanup()
  adm.cacheDestroyCallbacks.clear()
  adm.onStoreChange = undefined
  adm.scheduledUpdatePromise = undefined
  adm.cache.clear()
}

function scheduleDestroyAdm (adm) {
  if (adm.destroyTimer) return
  adm.destroyTimer = setTimeout(() => destroyAdm(adm))
}

export default function wrapIntoSuspense ({
  Component,
  forwardRef,
  defer,
  suspenseProps = DEFAULT_SUSPENSE_PROPS
} = {}) {
  if (!suspenseProps?.fallback) throw Error(ERRORS.noFallback)

  let SuspenseWrapper = (props, ref) => {
    const suspenseGroup = useContext(SuspenseGroupContext)
    const inheritsSuspense = (
      !!suspenseGroup && !suspenseGroup.hasRevealedContent
    )
    const componentId = useId()
    const componentMetaRef = useRef()
    const admRef = useRef()
    if (!admRef.current) {
      const name = Component.displayName || Component.name || 'Anonymous'
      const adm = {
        stateVersion: Symbol(), // eslint-disable-line symbol-description
        onStoreChange: undefined,
        scheduledUpdatePromise: undefined,
        destroyTimer: undefined,
        destroyed: false,
        cache: new Map(),
        cacheDestroyCallbacks: new Set(),
        // A new snapshot even without a listener: an update that arrives
        // between a render and the subscription (children's effects run
        // before this wrapper subscribes, StrictMode replays subscriptions)
        // is caught by useSyncExternalStore's own check after it subscribes.
        notify () {
          adm.stateVersion = Symbol() // eslint-disable-line symbol-description
          adm.onStoreChange?.()
        },
        scheduleUpdate: promise => {
          if (!promise?.then) throw Error('scheduleUpdate() expects a promise')
          if (adm.scheduledUpdatePromise === promise) return
          adm.scheduledUpdatePromise = promise
          promise.then(() => {
            if (adm.scheduledUpdatePromise !== promise) return
            adm.scheduledUpdatePromise = undefined
            adm.notify()
          })
        },
        subscribe (onStoreChange) {
          unmountedAdms.unregister(adm)
          if (adm.destroyed) {
            // shown again by <Activity>
            adm.destroyed = false
            if (diag.on) noteAdmCreated(adm, name, componentId)
          }
          if (diag.on) noteAdmSubscribed(adm)
          clearTimeout(adm.destroyTimer)
          adm.destroyTimer = undefined
          adm.onStoreChange = onStoreChange
          return () => {
            // Never notify React after it unsubscribed: React queues an update
            // to an unmounted fiber until its next render, keeping the fiber
            // alive.
            if (adm.onStoreChange === onStoreChange) adm.onStoreChange = undefined
            scheduleDestroyAdm(adm)
          }
        },
        getSnapshot () {
          return adm.stateVersion
        }
      }
      admRef.current = adm
      if (diag.on) noteAdmCreated(adm, name, componentId)
      unmountedAdms.register(adm, {
        callbacks: adm.cacheDestroyCallbacks,
        diagId: diag.on ? objectId(adm) : undefined
      }, adm)
    }
    const adm = admRef.current

    useSyncExternalStore(adm.subscribe, adm.getSnapshot, adm.getSnapshot)

    if (!componentMetaRef.current) {
      componentMetaRef.current = {
        componentId,
        createdAt: suspenseGroup?.createdAt ?? Date.now(),
        defer,
        triggerUpdate: () => adm.notify(),
        scheduleUpdate: promise => adm.scheduleUpdate(promise),
        cache: {
          get: key => adm.cache.get(key),
          set: (key, value) => adm.cache.set(key, value),
          has: key => adm.cache.has(key),
          onDestroy: cleanup => {
            // capture the set, not the wrapper: the returned closure is kept by
            // what the callback cleans up (a lease), which must not keep the
            // wrapper alive
            const callbacks = adm.cacheDestroyCallbacks
            callbacks.add(cleanup)
            return () => {
              callbacks.delete(cleanup)
            }
          }
        }
      }
    }

    if (forwardRef) props = { ...props, ref }

    const contents = el(
      ComponentMetaContext.Provider,
      { value: componentMetaRef.current },
      el(Component, props)
    )
    const hasCustomFallback = suspenseProps !== DEFAULT_SUSPENSE_PROPS
    return inheritsSuspense && !hasCustomFallback
      ? contents
      : el(Suspense, suspenseProps, contents)
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
