export const REGISTRY_SWEEP_INTERVAL = 10000

type TimeoutId = ReturnType<typeof setTimeout>

interface PermanentRegistration<TValue> {
  readonly value: TValue
  readonly registeredAt: number
}

interface WeakRefRegistration<TValue> {
  readonly targetRef: WeakRef<object>
  readonly tokenRef?: WeakRef<object>
  readonly value: TValue
}

export interface FinalizationRegistryLike<TValue = unknown> {
  register: (target: object, value: TValue, token?: object) => void
  unregister: (token: object) => void
}

export type FinalizationRegistryLikeConstructor = new <TValue = unknown>(
  finalize: (value: TValue) => void
) => FinalizationRegistryLike<TValue>

// This implementation never finalizes. It is used where neither native
// FinalizationRegistry nor WeakRef-based polling can be simulated.
export class PermanentFinalizationRegistry<TValue = unknown> {
  readonly registrations = new Map<object, PermanentRegistration<TValue>>()
  sweepTimeout: TimeoutId | undefined
  private readonly finalize: (value: TValue) => void

  constructor (finalize: (value: TValue) => void) {
    this.finalize = finalize
  }

  // Token is required for this implementation because it is the map key.
  register (_target: object, value: TValue, token?: object): void {
    if (token == null) return
    this.registrations.set(token, {
      value,
      registeredAt: Date.now()
    })
  }

  unregister (token: object): void {
    this.registrations.delete(token)
  }
}

// This implementation polls WeakRefs when native FinalizationRegistry is missing.
export class WeakRefBasedFinalizationRegistry<TValue = unknown> {
  counter = 0
  readonly registrations = new Map<number, WeakRefRegistration<TValue>>()
  sweepTimeout: TimeoutId | undefined
  private readonly finalize: (value: TValue) => void

  constructor (finalize: (value: TValue) => void) {
    this.finalize = finalize
  }

  register (target: object, value: TValue, token?: object): void {
    this.registrations.set(this.counter, {
      targetRef: new WeakRef(target),
      tokenRef: token != null ? new WeakRef(token) : undefined,
      value
    })
    this.counter++
    this.scheduleSweep()
  }

  unregister (token?: object): void {
    if (token == null) return
    this.registrations.forEach((registration, key) => {
      if (registration.tokenRef?.deref() === token) {
        this.registrations.delete(key)
      }
    })
  }

  // Bound so it can be used directly as setTimeout callback.
  sweep = (): void => {
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

  scheduleSweep (): void {
    if (this.sweepTimeout) return
    this.sweepTimeout = setTimeout(this.sweep, REGISTRY_SWEEP_INTERVAL)
  }
}

let ExportedFinalizationRegistry: FinalizationRegistryLikeConstructor

if (typeof FinalizationRegistry !== 'undefined') {
  ExportedFinalizationRegistry = FinalizationRegistry as FinalizationRegistryLikeConstructor
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
