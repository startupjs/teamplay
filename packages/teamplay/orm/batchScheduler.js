let batchDepth = 0
let isFlushing = false
const queuedReactions = new Set()

export function beginBatch () {
  batchDepth += 1
}

export function endBatch () {
  if (batchDepth === 0) return
  batchDepth -= 1
  if (batchDepth === 0) flushReactions()
}

export function inBatch () {
  return batchDepth > 0
}

export function runInBatch (fn) {
  beginBatch()
  let result
  try {
    result = fn()
  } catch (err) {
    endBatch()
    throw err
  }
  if (result?.then) {
    return Promise.resolve(result).finally(endBatch)
  }
  endBatch()
  return result
}

export function scheduleReaction (reactionFn) {
  if (typeof reactionFn !== 'function') return
  if (inBatch() || isFlushing) {
    queuedReactions.add(reactionFn)
    return
  }
  reactionFn()
}

export function flushReactions () {
  if (isFlushing) return
  isFlushing = true
  try {
    while (queuedReactions.size > 0) {
      const queue = Array.from(queuedReactions)
      queuedReactions.clear()
      for (const reactionFn of queue) reactionFn()
    }
  } finally {
    isFlushing = false
  }
}

export function __resetBatchSchedulerForTests () {
  batchDepth = 0
  isFlushing = false
  queuedReactions.clear()
}
