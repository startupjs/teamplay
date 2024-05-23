export const DEBUG = {}

if (typeof window !== 'undefined') {
  if (!window.__teamplay__) window.__teamplay__ = {}
  window.__teamplay__.DEBUG = DEBUG
}

export function __increment (name) {
  if (!DEBUG[name]) DEBUG[name] = 0
  DEBUG[name] += 1
}

export function __decrement (name) {
  if (!DEBUG[name]) DEBUG[name] = 0
  DEBUG[name] -= 1
}

export function setDebugVar (key, value) {
  DEBUG[key] = value
}
