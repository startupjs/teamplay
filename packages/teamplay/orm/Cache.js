import FinalizationRegistry from '../utils/MockFinalizationRegistry.js'
import WeakRef, { destroyMockWeakRef } from '../utils/MockWeakRef.js'

export default class Cache {
  constructor () {
    this.cache = new Map()
    this.fr = new FinalizationRegistry(([key]) => {
      // handle situation when FinalizationRegistry triggers
      // way later after the WeakRef is already garbage collected.
      // In this case we might already have a new value in the cache
      // and we don't want to delete it.
      if (this.get(key)) return
      this.delete(key)
    })
  }

  // for testing purposes
  _getKeys () {
    return Array.from(this.cache.keys()).sort()
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
    if (typeof key !== 'string') throw Error('Cache key should be a string')
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
