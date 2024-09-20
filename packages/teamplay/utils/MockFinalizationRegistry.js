export const REGISTRY_SWEEP_INTERVAL = 10000

// This is a mock implementation of FinalizationRegistry which doesn't actually
// finalize anything. It's used in environments where FinalizationRegistry is not
// available and it can not be simulated using WeakRef (e.g. React Native <0.75 or Old Architecture).
export class PermanentFinalizationRegistry {
  registrations = new Map()
  sweepTimeout

  constructor (finalize) {
    this.finalize = finalize
  }

  // Token is actually required with this impl
  register (target, value, token) {
    this.registrations.set(token, {
      value,
      registeredAt: Date.now()
    })
  }

  unregister (token) {
    this.registrations.delete(token)
  }
}

// This is a mock implementation of FinalizationRegistry which uses WeakRef to
// track the target objects. It's used in environments where FinalizationRegistry
// is not available but WeakRef is (e.g. React Native >=0.75 on New Architecture).
export class WeakRefBasedFinalizationRegistry {
  counter = 0
  registrations = new Map()
  sweepTimeout

  constructor (finalize) {
    this.finalize = finalize
  }

  // Token is actually required with this impl
  register (target, value, token) {
    this.registrations.set(this.counter, {
      targetRef: new WeakRef(target),
      tokenRef: token != null ? new WeakRef(token) : undefined,
      value
    })
    this.counter++
    this.scheduleSweep()
  }

  unregister (token) {
    if (token == null) return
    this.registrations.forEach((registration, key) => {
      if (registration.tokenRef?.deref() === token) {
        this.registrations.delete(key)
      }
    })
  }

  // Bound so it can be used directly as setTimeout callback.
  sweep = () => {
    clearTimeout(this.sweepTimeout)
    this.sweepTimeout = undefined

    this.registrations.forEach((registration, key) => {
      if (registration.targetRef.deref() !== undefined) return
      const value = registration.value
      this.registrations.delete(key)
      this.finalize(value)
    })

    if (this.registrations.size > 0) this.scheduleSweep()
  }

  scheduleSweep () {
    if (this.sweepTimeout) return
    this.sweepTimeout = setTimeout(this.sweep, REGISTRY_SWEEP_INTERVAL)
  }
}

let ExportedFinalizationRegistry

if (typeof FinalizationRegistry !== 'undefined') {
  ExportedFinalizationRegistry = FinalizationRegistry
} else if (typeof WeakRef !== 'undefined') {
  console.warn('FinalizationRegistry is not available in this environment. ' +
      'Using a mock implementation: WeakRefBasedFinalizationRegistry')
  ExportedFinalizationRegistry = WeakRefBasedFinalizationRegistry
} else {
  console.warn('Neither FinalizationRegistry nor WeakRef are available in this environment. ' +
      'Using a mock implementation: PermanentFinalizationRegistry')
  ExportedFinalizationRegistry = PermanentFinalizationRegistry
}

export default ExportedFinalizationRegistry
