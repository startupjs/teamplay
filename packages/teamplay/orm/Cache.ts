import FinalizationRegistry from '../utils/MockFinalizationRegistry.ts'
import WeakRef, { destroyMockWeakRef, type WeakRefLike } from '../utils/MockWeakRef.ts'

type FinalizationValue = readonly [string, ...object[]]

export default class Cache<TValue extends object = object> {
  private readonly cache = new Map<string, WeakRefLike<TValue>>()
  private readonly fr = new FinalizationRegistry<FinalizationValue>(([key]) => {
    // FinalizationRegistry can trigger long after the WeakRef was already
    // collected and a fresh value was stored for the same key.
    if (this.get(key)) return
    this.delete(key)
  })

  // For testing purposes.
  _getKeys (): string[] {
    return Array.from(this.cache.keys()).sort()
  }

  get (key: string): TValue | undefined {
    return this.cache.get(key)?.deref()
  }

  set (key: string, value: TValue, inputs: readonly object[] = []): void {
    if (typeof key !== 'string') throw Error('Cache key should be a string')
    this.cache.set(key, new WeakRef(value))
    this.fr.register(value, [key, ...inputs])
  }

  delete (key: string): void {
    destroyMockWeakRef(this.cache.get(key))
    this.cache.delete(key)
  }

  get size (): number {
    return this.cache.size
  }
}
