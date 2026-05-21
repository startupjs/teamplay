let silentDepth = 0
let modelEventsSilentDepth = 0

export function isSilentContextActive () {
  return silentDepth > 0
}

export function isModelEventsSilentContextActive () {
  return modelEventsSilentDepth > 0
}

export function runInSilentContext (fn) {
  silentDepth += 1
  try {
    return fn()
  } finally {
    silentDepth -= 1
  }
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
  silentDepth = 0
  modelEventsSilentDepth = 0
}
