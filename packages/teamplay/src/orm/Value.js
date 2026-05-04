import { SEGMENTS } from './Signal.ts'
import { getRoot, ROOT_ID } from './Root.ts'
import { delPrivateData, setPrivateData } from './privateData.js'
import FinalizationRegistry from '../utils/MockFinalizationRegistry.ts'

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
    setPrivateData(rootId, [LOCAL, id], value)
    this.initialized.set(id, true)
    this.fr.register($value, [rootId, id])
  }

  destroy ([rootId, id]) {
    this.initialized.delete(id)
    delPrivateData(rootId, [LOCAL, id])
  }
}

export const valueSubscriptions = new ValueSubscriptions()
