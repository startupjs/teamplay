export const REGISTRY_FINALIZE_AFTER = 10_000
export const REGISTRY_SWEEP_INTERVAL = 10_000

// This is a mock implementation of FinalizationRegistry that uses setTimeout to
// schedule the sweep of outdated objects.
// It is used in environments where FinalizationRegistry is not available.
// For now we permanently keep the values in the registry until they are
// manually unregistered since we don't have a way to know when the object is
// no longer needed. In the future we might add the control logic to properly
// invalidate the objects.
export let PERMANENT = true
export function setPermanent (permanent) { PERMANENT = permanent }

export class TimerBasedFinalizationRegistry {
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
    if (!PERMANENT) this.scheduleSweep()
  }

  unregister (token) {
    this.registrations.delete(token)
  }

  // Bound so it can be used directly as setTimeout callback.
  sweep = (maxAge = REGISTRY_FINALIZE_AFTER) => {
    // cancel timeout so we can force sweep anytime
    clearTimeout(this.sweepTimeout)
    this.sweepTimeout = undefined

    const now = Date.now()
    this.registrations.forEach((registration, token) => {
      if (now - registration.registeredAt >= maxAge) {
        this.finalize(registration.value)
        this.registrations.delete(token)
      }
    })

    if (this.registrations.size > 0) {
      this.scheduleSweep()
    }
  }

  // Bound so it can be exported directly as clearTimers test utility.
  finalizeAllImmediately = () => {
    this.sweep(0)
  }

  scheduleSweep () {
    if (this.sweepTimeout === undefined) {
      this.sweepTimeout = setTimeout(this.sweep, REGISTRY_SWEEP_INTERVAL)
    }
  }
}

export default (typeof FinalizationRegistry !== 'undefined' ? FinalizationRegistry : TimerBasedFinalizationRegistry)
