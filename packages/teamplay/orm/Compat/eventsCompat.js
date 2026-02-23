import { useLayoutEffect } from 'react'

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

export function useOn (eventName, handler, deps) {
  useLayoutEffect(() => {
    const listener = on(eventName, handler)
    return () => {
      removeListener(eventName, listener)
    }
  }, [eventName, handler, deps])
}

export function useEmit () {
  return emit
}

export function __resetEventsForTests () {
  listeners.clear()
}
