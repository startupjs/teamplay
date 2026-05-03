import { getRefLinks, getRefRootIds } from './refRegistry.js'
import { isCompatEnv } from '../compatEnv.js'
import { isSilentContextActive, isModelEventsSilentContextActive, runInModelEventsSilentContext } from './silentContext.js'
import { normalizeRootId } from '../rootScope.js'
import { getRootContext, getRootContexts } from '../rootContext.js'
import { setReplace as setReplaceInDataTree, del as delFromDataTree } from '../dataTree.js'
import { setReplacePrivateData, delPrivateData } from '../privateData.js'

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
    const visited = new Set()
    const queue = [initialSegments]

    while (queue.length) {
      const segments = queue.shift()
      const key = segments.join('.')
      if (visited.has(key)) continue
      visited.add(key)

      emitForEvent(rootId, 'change', segments, value, prevValue, meta)
      emitForEvent(rootId, 'all', segments, value, prevValue, meta, eventName)

      for (const link of getRefLinks(rootId).values()) {
        if (!isPathPrefix(link.toSegments, segments)) continue
        if (link.mirrorOnly && typeof link.onChange === 'function') {
          link.onChange()
        } else if (!link.mirrorOnly) {
          mirrorRefAliasFromTargetSegments(rootId, link, segments, value, meta)
        }
        const suffix = segments.slice(link.toSegments.length)
        const nextSegments = link.fromSegments.concat(suffix)
        const nextKey = nextSegments.join('.')
        if (!visited.has(nextKey)) queue.push(nextSegments)
      }
    }
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

function mirrorRefAliasFromTargetSegments (rootId, link, targetSegments, value, meta) {
  const suffix = targetSegments.slice(link.toSegments.length)
  const fromSegments = link.fromSegments.concat(suffix)
  const fromRootId = normalizeRootId(link.fromRootId ?? rootId)
  const shouldDelete = shouldDeleteMirroredPath(value, meta)
  runInModelEventsSilentContext(() => {
    if (isPrivateSegments(fromSegments)) {
      if (shouldDelete) {
        delPrivateData(fromRootId, fromSegments)
      } else {
        setReplacePrivateData(fromRootId, fromSegments, cloneValue(value))
      }
      return
    }
    if (shouldDelete) {
      delFromDataTree(fromSegments)
      return
    }
    setReplaceInDataTree(fromSegments, cloneValue(value))
  })
}

function isPrivateSegments (segments) {
  if (!Array.isArray(segments) || !segments.length) return false
  return /^[_$]/.test(String(segments[0]))
}

function shouldDeleteMirroredPath (value, meta) {
  if (meta?.op === 'setReplace') return false
  if (meta?.op === 'del') return true
  return value === undefined
}

function cloneValue (value) {
  if (Array.isArray(value)) return value.map(cloneValue)
  if (value && typeof value === 'object') {
    const cloned = {}
    for (const key of Object.keys(value)) cloned[key] = cloneValue(value[key])
    return cloned
  }
  return value
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
  const rootIds = new Set([
    ...getModelEventRootIds(),
    ...getRefRootIds()
  ])
  return rootIds
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
