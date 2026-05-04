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
  let result
  try {
    result = fn()
  } catch (error) {
    silentDepth -= 1
    throw error
  }
  if (result?.then) {
    return Promise.resolve(result).finally(() => {
      silentDepth -= 1
    })
  }
  silentDepth -= 1
  return result
}

export function runInModelEventsSilentContext (fn) {
  modelEventsSilentDepth += 1
  let result
  try {
    result = fn()
  } catch (error) {
    modelEventsSilentDepth -= 1
    throw error
  }
  if (result?.then) {
    return Promise.resolve(result).finally(() => {
      modelEventsSilentDepth -= 1
    })
  }
  modelEventsSilentDepth -= 1
  return result
}

export function __resetSilentContextForTests () {
  silentDepth = 0
  modelEventsSilentDepth = 0
}
