import { isCompatEnv } from '../compatEnv.js'
import { isSilentContextActive, isModelEventsSilentContextActive } from './silentContext.js'
import { normalizeRootId } from '../rootScope.ts'
import { getRootContext, getRootContexts } from '../rootContext.ts'

const MODEL_EVENT_NAMES = ['change', 'all']

export function isModelEventsEnabled () {
  return isCompatEnv()
}

export function normalizePattern (pattern, methodName) {
  if (pattern && typeof pattern.path === 'function') pattern = pattern.path()
  if (pattern == null || typeof pattern !== 'string') {
    if (methodName) throw Error(`${methodName} expects a string path or a signal`)
    return null
  }
  return pattern.split('.').filter(Boolean).join('.')
}

export function onModelEvent (rootId, eventName, pattern, handler) {
  if (typeof handler !== 'function') throw Error('Model event handler must be a function')
  if (!MODEL_EVENT_NAMES.includes(eventName)) throw Error(`Unsupported model event: ${eventName}`)
  const store = getModelEventRootStore(eventName, rootId, true)
  const normalized = normalizePattern(pattern)
  let entry = store.get(normalized)
  if (!entry) {
    entry = {
      pattern: normalized,
      segments: splitPattern(normalized),
      handlers: new Set()
    }
    store.set(normalized, entry)
  }
  entry.handlers.add(handler)
  return handler
}

export function removeModelListener (rootId, eventName, handler) {
  const store = getModelEventRootStore(eventName, rootId)
  if (!store) return
  for (const [pattern, entry] of store) {
    entry.handlers.delete(handler)
    if (!entry.handlers.size) store.delete(pattern)
  }
}

export function emitModelChange (path, value, prevValue, meta) {
  if (!isModelEventsEnabled()) return
  if (isSilentContextActive() || isModelEventsSilentContextActive()) return
  const initialSegments = splitPath(path)
  const eventName = meta?.eventName || 'change'
  const rootIds = getTargetRootIds(meta?.rootId)

  for (const rootId of rootIds) {
    emitForEvent(rootId, 'change', initialSegments, value, prevValue, meta)
    emitForEvent(rootId, 'all', initialSegments, value, prevValue, meta, eventName)
  }
}

export function __resetModelEventsForTests () {
  for (const context of getRootContexts()) {
    context.resetModelListeners()
  }
}

function emitForEvent (rootId, eventName, pathSegments, value, prevValue, meta, resolvedEventName = eventName) {
  const store = getModelEventRootStore(eventName, rootId)
  if (!store || store.size === 0) return
  for (const entry of store.values()) {
    const captures = matchPattern(entry.segments, pathSegments)
    if (!captures) continue
    for (const handler of entry.handlers) {
      if (eventName === 'all') {
        handler(...captures, resolvedEventName, value, prevValue, meta)
      } else {
        handler(...captures, value, prevValue, meta)
      }
    }
  }
}

function splitPattern (pattern) {
  if (!pattern) return []
  return pattern.split('.').filter(Boolean)
}

function getModelEventRootStore (eventName, rootId, create = false) {
  return getRootContext(normalizeRootId(rootId), create)?.getModelEventStore(eventName, create)
}

function getModelEventRootIds () {
  const rootIds = new Set()
  for (const context of getRootContexts()) {
    for (const store of Object.values(context.modelListeners)) {
      if (store.size) rootIds.add(context.rootId)
    }
  }
  return rootIds
}

function getTargetRootIds (rootId) {
  if (rootId != null) return [normalizeRootId(rootId)]
  return getModelEventRootIds()
}

function splitPath (path) {
  if (Array.isArray(path)) return path.map(segment => String(segment))
  if (!path) return []
  return String(path).split('.').filter(Boolean)
}

function matchPattern (patternSegments, pathSegments) {
  function walk (patternIndex, pathIndex) {
    if (patternIndex === patternSegments.length) {
      return pathIndex === pathSegments.length ? [] : null
    }

    const segment = patternSegments[patternIndex]
    if (segment === '**') {
      for (let i = pathIndex; i <= pathSegments.length; i++) {
        const rest = walk(patternIndex + 1, i)
        if (rest !== null) {
          const capture = pathSegments.slice(pathIndex, i).join('.')
          return [capture, ...rest]
        }
      }
      return null
    }

    if (pathIndex >= pathSegments.length) return null

    if (segment === '*') {
      const rest = walk(patternIndex + 1, pathIndex + 1)
      if (rest === null) return null
      return [pathSegments[pathIndex], ...rest]
    }

    if (segment !== pathSegments[pathIndex]) return null
    return walk(patternIndex + 1, pathIndex + 1)
  }

  return walk(0, 0)
}
