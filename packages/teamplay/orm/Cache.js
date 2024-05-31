import FinalizationRegistry from '../utils/MockFinalizationRegistry.js'
import WeakRef, { destroyMockWeakRef } from '../utils/MockWeakRef.js'

export default class Cache {
  constructor () {
    this.cache = new Map()
    this.fr = new FinalizationRegistry(([key]) => this.delete(key))
  }

  get (key) {
    return this.cache.get(key)?.deref()
  }

  /**
   * @param {string} key
   * @param {*} value
   * @param {Array} inputs - extra inputs to register with the finalization registry
   *                         to hold strong references to them until the value is garbage collected
   */
  set (key, value, inputs = []) {
    this.cache.set(key, new WeakRef(value))
    this.fr.register(value, [key, ...inputs])
  }

  delete (key) {
    destroyMockWeakRef(this.cache.get(key)) // TODO: remove this when WeakRef is available in RN
    this.cache.delete(key)
  }

  get size () {
    return this.cache.size
  }
}
