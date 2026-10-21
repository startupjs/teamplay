import { observe, unobserve } from '@nx-js/observer-util'
import { SEGMENTS } from './Signal.ts'
import { LOCAL } from './Value.js'
import FinalizationRegistry from '../utils/MockFinalizationRegistry.ts'
import { scheduleReaction } from './batchScheduler.js'
import { getRoot, ROOT_ID } from './Root.ts'
import { delPrivateData, setPrivateData } from './privateData.js'
import unrefTimer from '../utils/unrefTimer.ts'

// this is `let` to be able to directly change it if needed in tests or in the app
export let DELETION_DELAY = 0

const FUNCTIONS = new WeakMap()

class ReactionSubscriptions {
  constructor () {
    this.initialized = new Map()
    this.fr = new FinalizationRegistry(([rootId, id, reaction]) => this.destroy(rootId, id, reaction))
  }

  init ($value, fn) {
    const id = $value[SEGMENTS][1]
    if (this.initialized.has(id)) return

    this.initialized.set(id, true)
    const rootId = getRoot($value)?.[ROOT_ID] || $value?.[ROOT_ID]
    const reactionScheduler = reaction => scheduleReaction(() => runReaction(rootId, id, reaction))
    const reaction = observe(callWhileAlive($value, fn), { lazy: true, scheduler: reactionScheduler })
    this.fr.register($value, [rootId, id, reaction])
    runReaction(rootId, id, reaction)
  }

  destroy (rootId, id, reaction) {
    this.initialized.delete(id)
    unobserve(reaction)
    // don't delete data right away to prevent dependent reactions which are also going to be GC'ed
    // from triggering unnecessarily
    unrefTimer(setTimeout(() => delPrivateData(rootId, [LOCAL, id]), DELETION_DELAY))
  }
}

export const reactionSubscriptions = new ReactionSubscriptions()

// The reaction is held by the data it reads, so it must not hold the signal,
// or the signal is never collected and the reaction never destroyed. `fn` can:
// it shares its closure context with the closures written next to it, and one
// of them may use the signal (a handler next to `$(() => ...)` in a component).
// So the signal holds `fn` (a WeakMap entry, which doesn't keep its key alive)
// and the reaction reaches the signal through a WeakRef.
function callWhileAlive ($value, fn) {
  if (typeof WeakRef === 'undefined') return fn
  FUNCTIONS.set($value, fn)
  const ref = new WeakRef($value)
  return () => {
    const $alive = ref.deref()
    if ($alive) return FUNCTIONS.get($alive)()
  }
}

function runReaction (rootId, id, reaction) {
  const newValue = reaction()
  setPrivateData(rootId, [LOCAL, id], newValue)
}

export function setDeletionDelay (delayInMs) {
  DELETION_DELAY = delayInMs
}
