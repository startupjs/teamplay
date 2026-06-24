import { observe, unobserve } from '@nx-js/observer-util'
import { scheduleReaction } from './batchScheduler.js'

export interface ReactionOptions {
  lazy?: boolean
  debugger?: Function
  scheduler?: (run: () => unknown) => unknown
  onError?: (error: unknown) => unknown
}

export interface ReactionHandle {
  dispose: () => void
}

export function reaction (fn: () => unknown, options: ReactionOptions = {}): ReactionHandle {
  if (typeof fn !== 'function') throw Error('reaction() expects a function')

  let disposed = false
  let pendingReactionFn: (() => unknown) | undefined

  function runReaction (runner: () => unknown) {
    if (disposed) return
    try {
      return runner()
    } catch (error) {
      if (typeof options.onError === 'function') return options.onError(error)
      throw error
    }
  }

  const scheduledRun = () => {
    if (!pendingReactionFn) return
    return runReaction(pendingReactionFn)
  }

  const runner = observe(fn, {
    lazy: true,
    debugger: options.debugger,
    scheduler: (reactionFn: () => unknown) => {
      pendingReactionFn = reactionFn
      if (typeof options.scheduler === 'function') return options.scheduler(scheduledRun)
      scheduleReaction(scheduledRun)
    }
  }) as () => unknown

  if (!options.lazy) runReaction(runner)

  return {
    dispose () {
      if (disposed) return
      disposed = true
      pendingReactionFn = undefined
      unobserve(runner)
    }
  }
}

export default reaction
