// Counting FinalizationRegistry wrapper (full implementation only).
//
// utils/MockFinalizationRegistry.ts asks diag.createFinalizationRegistry() for every
// registry teamplay creates once 'teamplay/diagnostics' is loaded; before that
// it creates plain registries. So only registries created after diagnostics
// loaded are counted: import 'teamplay/diagnostics' before 'teamplay' (the
// Node entry does) for complete counts.
//
// When diagnostics are off a wrapped registry costs one property read per
// register/unregister; when on it counts registrations, unregistrations (per
// token) and finalizations without holding any registered target.
import type {
  FinalizationRegistryLike,
  FinalizationRegistryLikeConstructor
} from '../utils/MockFinalizationRegistry.ts'
import { diag, record } from './state.ts'

export interface FinalizationRegistryStats {
  name: string
  implementation: string
  registered: number
  unregistered: number
  finalized: number
}

const REGISTRY_STATS: FinalizationRegistryStats[] = []
const STATS = Symbol('teamplay finalization registry stats')
// Names of known registries created before diagnostics loaded (not counted).
const UNTRACKED: string[] = []

class TrackedFinalizationRegistry<TValue = unknown> {
  readonly [STATS]: FinalizationRegistryStats
  readonly base: FinalizationRegistryLike<TValue>
  private readonly tokenCounts = new WeakMap<object, number>()

  constructor (finalize: (value: TValue) => void, Base: FinalizationRegistryLikeConstructor) {
    const stats: FinalizationRegistryStats = {
      name: 'unnamed',
      implementation: describeImplementation(Base),
      registered: 0,
      unregistered: 0,
      finalized: 0
    }
    this[STATS] = stats
    REGISTRY_STATS.push(stats)
    this.base = new Base<TValue>(value => {
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

/** diag.createFinalizationRegistry: wraps a registry of the selected implementation (`Base`). */
export function createTrackedFinalizationRegistry<TValue> (
  finalize: (value: TValue) => void,
  Base: FinalizationRegistryLikeConstructor
): FinalizationRegistryLike<TValue> {
  return new TrackedFinalizationRegistry<TValue>(finalize, Base)
}

// The same choice utils/MockFinalizationRegistry.ts makes.
function describeImplementation (Base?: unknown): string {
  if (typeof FinalizationRegistry !== 'undefined' && (Base == null || Base === FinalizationRegistry)) return 'native'
  return typeof WeakRef !== 'undefined' ? 'weakref-poll' : 'permanent'
}

export function getFinalizationRegistryStats (registry: unknown): FinalizationRegistryStats | undefined {
  if (!registry || typeof registry !== 'object') return undefined
  return (registry as { [STATS]?: FinalizationRegistryStats })[STATS]
}

/** Names a counted registry; remembers the name of one created before diagnostics loaded. */
export function nameFinalizationRegistry (registry: unknown, name: string): void {
  const stats = getFinalizationRegistryStats(registry)
  if (stats) stats.name = name
  else if (registry && !UNTRACKED.includes(name)) UNTRACKED.push(name)
}

export function getAllFinalizationRegistryStats (): FinalizationRegistryStats[] {
  return REGISTRY_STATS
}

export function getUntrackedFinalizationRegistries (): string[] {
  return UNTRACKED.slice()
}

export function getFinalizationRegistryImplementation (): string {
  return REGISTRY_STATS[0]?.implementation ?? describeImplementation()
}

// Trigger an immediate sweep of WeakRef-polling registries (no-op for native ones).
export function sweepFinalizationRegistry (registry: unknown): void {
  const target = (registry as { base?: unknown } | undefined)?.base ?? registry
  const sweep = (target as { sweep?: () => void } | undefined)?.sweep
  if (typeof sweep === 'function') sweep()
}
