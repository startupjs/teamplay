import { observe, unobserve } from '@nx-js/observer-util'
import { SEGMENTS } from './Signal.js'
import { LOCAL } from './Value.js'
import FinalizationRegistry from '../utils/MockFinalizationRegistry.js'
import { scheduleReaction } from './batchScheduler.js'
import { getRoot, ROOT_ID } from './Root.js'
import { delPrivateData, setPrivateData } from './privateData.js'

// this is `let` to be able to directly change it if needed in tests or in the app
export let DELETION_DELAY = 0 // eslint-disable-line prefer-const

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
    const reaction = observe(fn, { lazy: true, scheduler: reactionScheduler })
    this.fr.register($value, [rootId, id, reaction])
    runReaction(rootId, id, reaction)
  }

  destroy (rootId, id, reaction) {
    this.initialized.delete(id)
    unobserve(reaction)
    // don't delete data right away to prevent dependent reactions which are also going to be GC'ed
    // from triggering unnecessarily
    setTimeout(() => delPrivateData(rootId, [LOCAL, id]), DELETION_DELAY)
  }
}

export const reactionSubscriptions = new ReactionSubscriptions()

function runReaction (rootId, id, reaction) {
  const newValue = reaction()
  setPrivateData(rootId, [LOCAL, id], newValue)
}

export function setDeletionDelay (delayInMs) {
  DELETION_DELAY = delayInMs
}
