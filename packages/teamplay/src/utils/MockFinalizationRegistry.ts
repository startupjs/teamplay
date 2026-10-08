import { diag, record } from '../diagnostics/state.ts'

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

let BaseFinalizationRegistry: FinalizationRegistryLikeConstructor
let baseImplementation: 'native' | 'weakref-poll' | 'permanent'

if (typeof FinalizationRegistry !== 'undefined') {
  BaseFinalizationRegistry = FinalizationRegistry as FinalizationRegistryLikeConstructor
  baseImplementation = 'native'
} else if (typeof WeakRef !== 'undefined') {
  console.warn('FinalizationRegistry is not available in this environment. ' +
      'Using a mock implementation: WeakRefBasedFinalizationRegistry')
  BaseFinalizationRegistry = WeakRefBasedFinalizationRegistry
  baseImplementation = 'weakref-poll'
} else {
  console.warn('Neither FinalizationRegistry nor WeakRef are available in this environment. ' +
      'Using a mock implementation: PermanentFinalizationRegistry')
  BaseFinalizationRegistry = PermanentFinalizationRegistry
  baseImplementation = 'permanent'
}

export interface FinalizationRegistryStats {
  name: string
  implementation: string
  registered: number
  unregistered: number
  finalized: number
}

const REGISTRY_STATS: FinalizationRegistryStats[] = []
const STATS = Symbol('teamplay finalization registry stats')

// Thin wrapper over the selected implementation. When diagnostics are off it
// costs one property read per register/unregister; when on it counts
// registrations, unregistrations (per token) and finalizations so leaks can be
// reported without holding any registered target.
class TrackedFinalizationRegistry<TValue = unknown> {
  readonly [STATS]: FinalizationRegistryStats
  readonly base: FinalizationRegistryLike<TValue>
  private readonly tokenCounts = new WeakMap<object, number>()

  constructor (finalize: (value: TValue) => void) {
    const stats: FinalizationRegistryStats = {
      name: 'unnamed',
      implementation: baseImplementation,
      registered: 0,
      unregistered: 0,
      finalized: 0
    }
    this[STATS] = stats
    REGISTRY_STATS.push(stats)
    this.base = new BaseFinalizationRegistry<TValue>(value => {
      if (!diag.on) return finalize(value)
      stats.finalized++
      record('fr.finalized', stats.name)
      const previous = diag.finalizing
      diag.finalizing = stats.name
      try {
        return finalize(value)
      } finally {
        diag.finalizing = previous
      }
    })
  }

  register (target: object, value: TValue, token?: object): void {
    if (diag.on) {
      this[STATS].registered++
      if (token != null) this.tokenCounts.set(token, (this.tokenCounts.get(token) || 0) + 1)
    }
    this.base.register(target, value, token)
  }

  unregister (token: object): void {
    if (diag.on && token != null) {
      const tokenCount = this.tokenCounts.get(token)
      if (tokenCount) {
        this[STATS].unregistered += tokenCount
        this.tokenCounts.delete(token)
      }
    }
    this.base.unregister(token)
  }
}

export function getFinalizationRegistryStats (registry: unknown): FinalizationRegistryStats | undefined {
  if (!registry || typeof registry !== 'object') return undefined
  return (registry as { [STATS]?: FinalizationRegistryStats })[STATS]
}

export function nameFinalizationRegistry (registry: unknown, name: string): void {
  const stats = getFinalizationRegistryStats(registry)
  if (stats) stats.name = name
}

export function getAllFinalizationRegistryStats (): FinalizationRegistryStats[] {
  return REGISTRY_STATS
}

export function getFinalizationRegistryImplementation (): string {
  return baseImplementation
}

// Trigger an immediate sweep of WeakRef-polling registries (no-op for native ones).
export function sweepFinalizationRegistry (registry: unknown): void {
  const base = (registry as { base?: { sweep?: () => void } } | undefined)?.base
  if (typeof base?.sweep === 'function') base.sweep()
}

const ExportedFinalizationRegistry = TrackedFinalizationRegistry as unknown as FinalizationRegistryLikeConstructor

export default ExportedFinalizationRegistry
