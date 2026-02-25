import { useLayoutEffect } from 'react'
import {
  isModelEventsEnabled,
  normalizePattern,
  onModelEvent,
  removeModelListener,
  __resetModelEventsForTests
} from './modelEvents.js'

const listeners = new Map()

export function emit (eventName, ...args) {
  const subs = listeners.get(eventName)
  if (!subs) return
  for (const handler of subs) {
    handler(...args)
  }
}

export function on (eventName, handler) {
  if (!listeners.has(eventName)) listeners.set(eventName, new Set())
  const subs = listeners.get(eventName)
  subs.add(handler)
  return handler
}

export function removeListener (eventName, handler) {
  const subs = listeners.get(eventName)
  if (!subs) return
  subs.delete(handler)
  if (!subs.size) listeners.delete(eventName)
}

export function useOn (eventName, patternOrHandler, handler, deps) {
  const isModelEvent = eventName === 'change' || eventName === 'all'
  const isCustom = !isModelEvent || typeof patternOrHandler === 'function'
  if (isCustom) {
    if (typeof patternOrHandler !== 'function') throw Error('useOn() expects a handler function')
  } else {
    if (typeof handler !== 'function') throw Error('useOn() expects a handler function')
  }
  const normalizedPattern = isCustom ? null : normalizePatternMaybe(patternOrHandler)

  useLayoutEffect(() => {
    if (isCustom) {
      const listener = on(eventName, patternOrHandler)
      return () => {
        removeListener(eventName, listener)
      }
    }
    if (normalizedPattern == null) {
      handler(patternOrHandler)
      return
    }
    if (!isModelEventsEnabled()) return
    const listener = onModelEvent(eventName, normalizedPattern, handler)
    return () => {
      removeModelListener(eventName, listener)
    }
  }, [eventName, patternOrHandler, handler, deps, normalizedPattern, isCustom])
}

export function useEmit () {
  return emit
}

export function __resetEventsForTests () {
  listeners.clear()
  __resetModelEventsForTests()
}

function normalizePatternMaybe (pattern) {
  try {
    return normalizePattern(pattern)
  } catch {
    return null
  }
}
