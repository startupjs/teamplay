let modelEventsSilentDepth = 0

export function isSilentContextActive () {
  return false
}

export function isModelEventsSilentContextActive () {
  return modelEventsSilentDepth > 0
}

export function runInModelEventsSilentContext (fn) {
  modelEventsSilentDepth += 1
  try {
    return fn()
  } finally {
    modelEventsSilentDepth -= 1
  }
}

export function __resetSilentContextForTests () {
  modelEventsSilentDepth = 0
}
