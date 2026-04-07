import { SEGMENTS } from './Signal.js'
import { set as _set, del as _del, resolveStorageSegments } from './dataTree.js'
import { getRoot, ROOT_ID } from './Root.js'
import FinalizationRegistry from '../utils/MockFinalizationRegistry.js'

export const LOCAL = '$local'

class ValueSubscriptions {
  constructor () {
    this.initialized = new Map()
    this.fr = new FinalizationRegistry(id => this.destroy(id))
  }

  init ($value, value) {
    const id = $value[SEGMENTS][1]
    if (this.initialized.has(id)) return

    const rootId = getRoot($value)?.[ROOT_ID] || $value?.[ROOT_ID]
    _set(resolveStorageSegments(rootId, [LOCAL, id]), value)
    this.initialized.set(id, true)
    this.fr.register($value, [rootId, id])
  }

  destroy ([rootId, id]) {
    this.initialized.delete(id)
    _del(resolveStorageSegments(rootId, [LOCAL, id]))
  }
}

export const valueSubscriptions = new ValueSubscriptions()
