import { getRefLinks } from './refRegistry.js'

const modelListeners = {
  change: new Map(),
  all: new Map()
}

export function isModelEventsEnabled () {
  return (
    globalThis?.teamplayCompatibilityMode ??
    (typeof process !== 'undefined' && process?.env?.TEAMPLAY_COMPAT === '1')
  )
}

export function normalizePattern (pattern, methodName) {
  if (pattern && typeof pattern.path === 'function') pattern = pattern.path()
  if (pattern == null || typeof pattern !== 'string') {
    if (methodName) throw Error(`${methodName} expects a string path or a signal`)
    return null
  }
  return pattern.split('.').filter(Boolean).join('.')
}

export function onModelEvent (eventName, pattern, handler) {
  if (typeof handler !== 'function') throw Error('Model event handler must be a function')
  if (!modelListeners[eventName]) throw Error(`Unsupported model event: ${eventName}`)
  const store = modelListeners[eventName]
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

export function removeModelListener (eventName, handler) {
  const store = modelListeners[eventName]
  if (!store) return
  for (const [pattern, entry] of store) {
    entry.handlers.delete(handler)
    if (!entry.handlers.size) store.delete(pattern)
  }
}

export function emitModelChange (path, value, prevValue, meta) {
  if (!isModelEventsEnabled()) return
  const initialSegments = splitPath(path)
  const visited = new Set()
  const queue = [initialSegments]
  const eventName = meta?.eventName || 'change'

  while (queue.length) {
    const segments = queue.shift()
    const key = segments.join('.')
    if (visited.has(key)) continue
    visited.add(key)

    emitForEvent('change', segments, value, prevValue, meta)
    emitForEvent('all', segments, value, prevValue, meta, eventName)

    for (const link of getRefLinks().values()) {
      if (!isPathPrefix(link.toSegments, segments)) continue
      const suffix = segments.slice(link.toSegments.length)
      const nextSegments = link.fromSegments.concat(suffix)
      const nextKey = nextSegments.join('.')
      if (!visited.has(nextKey)) queue.push(nextSegments)
    }
  }
}

export function __resetModelEventsForTests () {
  modelListeners.change.clear()
  modelListeners.all.clear()
}

function emitForEvent (eventName, pathSegments, value, prevValue, meta, resolvedEventName = eventName) {
  const store = modelListeners[eventName]
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

function splitPath (path) {
  if (Array.isArray(path)) return path.map(segment => String(segment))
  if (!path) return []
  return String(path).split('.').filter(Boolean)
}

function isPathPrefix (prefixSegments, fullSegments) {
  if (prefixSegments.length > fullSegments.length) return false
  for (let i = 0; i < prefixSegments.length; i++) {
    if (prefixSegments[i] !== fullSegments[i]) return false
  }
  return true
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
