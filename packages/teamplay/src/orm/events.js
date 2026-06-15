import { useLayoutEffect } from 'react'

const listeners = new Map()

export function emit (eventName, ...args) {
  const subs = listeners.get(eventName)
  if (!subs) return
  const snapshot = Array.from(subs)
  for (const handler of snapshot) {
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
  if (!isModelEvent || typeof patternOrHandler === 'function') {
    if (typeof patternOrHandler !== 'function') throw Error('useOn() expects a handler function')
  } else {
    throw Error('Signal model events are not supported. Use reaction() for signal changes.')
  }

  useLayoutEffect(() => {
    const listener = on(eventName, patternOrHandler)
    return () => {
      removeListener(eventName, listener)
    }
  }, [eventName, patternOrHandler, deps])
}

export function useEmit () {
  return emit
}

export function __resetEventsForTests () {
  listeners.clear()
}
