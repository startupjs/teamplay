let silentDepth = 0

export function isSilentContextActive () {
  return silentDepth > 0
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

export function __resetSilentContextForTests () {
  silentDepth = 0
}
