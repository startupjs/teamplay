// TeamPlay runtime diagnostics: signals, caches, subscriptions, roots, React
// leases and the ShareDB connection. See docs/guide/diagnostics.md.
//
// Enable before teamplay loads (exact FinalizationRegistry counters):
//   globalThis.__TEAMPLAY_DIAGNOSTICS__ = true            // or { trace: true, stacks: true }
//   TEAMPLAY_DIAGNOSTICS=1 node server.js                 // or =trace,stacks
// or at runtime:
//   import { diagnostics } from 'teamplay'
//   diagnostics.enable({ trace: true })
import { docSubscriptions } from '../orm/Doc.js'
import { querySubscriptions } from '../orm/Query.js'
import { aggregationSubscriptions } from '../orm/Aggregation.js'
import { __DEBUG_SIGNALS_CACHE__ as SIGNALS_CACHE } from '../orm/getSignal.ts'
import { __getRootFinalizationRegistry } from '../orm/Root.ts'
import { getSubscriptionGcDelay } from '../orm/subscriptionGcDelay.ts'
import { valueSubscriptions, reactionSubscriptions } from './runtimeRefs.js'
import {
  nameFinalizationRegistry,
  sweepFinalizationRegistry
} from '../utils/MockFinalizationRegistry.ts'
import {
  diag,
  now,
  applyOptions,
  getTrace,
  clearTrace,
  getCounters,
  getTimings,
  getIncidents,
  resetCounters,
  resetRegistries,
  pendingUnsubs,
  pollers,
  type DiagnosticsOptions,
  type TraceEvent,
  type TraceFilter
} from './state.ts'
import { installInstrumentation, uninstallInstrumentation } from './instrument.ts'
import { collect, type CollectOptions } from './collect.ts'
import {
  checkLeaks,
  diff,
  flattenMetrics,
  type CheckLeaksOptions,
  type LeakReport,
  type SnapshotDiff,
  type DiffOptions
} from './leaks.ts'

export type {
  DiagnosticsOptions,
  TraceEvent,
  TraceFilter,
  CheckLeaksOptions,
  LeakReport,
  SnapshotDiff,
  DiffOptions
}

export interface SnapshotOptions extends CollectOptions {
  /** Include example lists (entries, owners, untracked docs, leases, ...). */
  details?: boolean
}

export type Snapshot = Record<string, any> & {
  takenAt: number
  metrics: Record<string, number>
  details?: Record<string, Array<Record<string, unknown>>>
}

const REGISTRIES: Array<[unknown, string]> = [
  [(docSubscriptions as { fr?: unknown }).fr, 'docSubscriptions'],
  [(querySubscriptions as { fr?: unknown }).fr, 'querySubscriptions'],
  [(aggregationSubscriptions as { fr?: unknown }).fr, 'aggregationSubscriptions'],
  [SIGNALS_CACHE._diagnosticRegistry(), 'signalCache'],
  [__getRootFinalizationRegistry(), 'roots'],
  [valueSubscriptions.fr, 'localValues'],
  [reactionSubscriptions.fr, 'localReactions']
]
for (const [registry, name] of REGISTRIES) nameFinalizationRegistry(registry, name)

export function enableDiagnostics (options: DiagnosticsOptions = {}): typeof diagnostics {
  if (!diag.on) {
    diag.on = true
    diag.enabledAt = now()
  }
  applyOptions(options)
  installInstrumentation()
  exposeGlobal()
  return diagnostics
}

export function disableDiagnostics (): void {
  diag.on = false
  diag.trace = false
  diag.stacks = false
  diag.enabledAtStartup = false
  uninstallInstrumentation()
  resetRegistries()
  resetCounters()
  clearTrace()
  unexposeGlobal()
}

export function isDiagnosticsEnabled (): boolean {
  return diag.on
}

/**
 * JSON-serializable report of every place runtime state accumulates.
 * Works when diagnostics are disabled too (manager/connection state is read
 * on demand); hook-based sections (leases, adms, pollers, counters, trace)
 * are empty unless diagnostics are enabled.
 */
export function snapshot (options: SnapshotOptions = {}): Snapshot {
  const collected = collect(options)
  const result: Snapshot = { ...collected.summary, takenAt: collected.takenAt, metrics: flattenMetrics(collected.summary) }
  if (options.details) {
    const details: Record<string, Array<Record<string, unknown>>> = {}
    for (const key of Object.keys(collected.lists)) {
      if (key.endsWith('#count')) continue
      details[key] = collected.lists[key]
    }
    result.details = details
  }
  return result
}

export interface ForceGcOptions {
  rounds?: number
  delayMs?: number
}

/**
 * Run globalThis.gc() (Node: --expose-gc, Chromium: --js-flags=--expose-gc)
 * several times, yielding to the event loop so FinalizationRegistry callbacks
 * run. Returns false when gc() is not exposed.
 */
export async function forceGc ({ rounds = 3, delayMs = 10 }: ForceGcOptions = {}): Promise<boolean> {
  const gc = (globalThis as { gc?: () => void }).gc
  for (let i = 0; i < rounds; i++) {
    await delay(delayMs)
    if (typeof gc === 'function') gc()
    await delay(delayMs)
    for (const [registry] of REGISTRIES) sweepFinalizationRegistry(registry)
  }
  return typeof gc === 'function'
}

export interface WaitForIdleOptions {
  /** Default: 2 * gcDelay + 5000ms. */
  timeoutMs?: number
  intervalMs?: number
}

export interface IdleState {
  idle: boolean
  waitedMs: number
  transitions: number
  pendingDestroys: number
  downgradeGraces: number
  pendingUnsubs: number
  pollers: number
}

/**
 * Wait until no subscription entry is in transition, no destroy or downgrade
 * grace is pending, no unsub() promise is pending and no readiness poller runs. Use it before a
 * snapshot that should describe a settled page.
 */
export async function waitForIdle ({ timeoutMs, intervalMs = 50 }: WaitForIdleOptions = {}): Promise<IdleState> {
  const limit = timeoutMs ?? getSubscriptionGcDelay() * 2 + 5000
  const startedAt = now()
  while (true) {
    const state = getIdleState(startedAt)
    if (state.idle || now() - startedAt >= limit) return state
    await delay(intervalMs)
  }
}

function getIdleState (startedAt: number): IdleState {
  let transitions = 0
  let pendingDestroys = 0
  let downgradeGraces = 0
  for (const entry of (docSubscriptions as any).entries.values()) {
    if (entry.phase === 'transition') transitions++
    if (entry.pendingDestroy) pendingDestroys++
    if (entry.downgradeGrace) downgradeGraces++
  }
  for (const manager of [querySubscriptions, aggregationSubscriptions] as any[]) {
    for (const entry of manager.entries.values()) {
      if (entry.phase === 'transition') transitions++
      pendingDestroys += entry.pendingDestroyByOwner.size
      if (entry.downgradeGrace) downgradeGraces++
    }
  }
  const counts = snapshotCounts()
  return {
    idle: transitions === 0 && pendingDestroys === 0 && downgradeGraces === 0 && counts.pendingUnsubs === 0 && counts.pollers === 0,
    waitedMs: now() - startedAt,
    transitions,
    pendingDestroys,
    downgradeGraces,
    pendingUnsubs: counts.pendingUnsubs,
    pollers: counts.pollers
  }
}

function snapshotCounts (): { pendingUnsubs: number, pollers: number } {
  return { pendingUnsubs: pendingUnsubs.size, pollers: pollers.size }
}

function delay (ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export {
  checkLeaks,
  diff,
  getTrace,
  clearTrace,
  getCounters,
  getTimings,
  getIncidents,
  resetCounters
}

export const diagnostics = {
  enable: enableDiagnostics,
  disable: disableDiagnostics,
  isEnabled: isDiagnosticsEnabled,
  snapshot,
  checkLeaks: (options?: CheckLeaksOptions): LeakReport => checkLeaks(options),
  diff: (a: Record<string, any>, b: Record<string, any>, options?: DiffOptions): SnapshotDiff => diff(a, b, options),
  getTrace: (filter?: TraceFilter): TraceEvent[] => getTrace(filter),
  clearTrace,
  getCounters,
  getTimings,
  getIncidents,
  resetCounters,
  forceGc,
  waitForIdle
}

interface GlobalTeamplay {
  __teamplay__?: Record<string, unknown>
}

function exposeGlobal (): void {
  const g = globalThis as GlobalTeamplay
  if (!g.__teamplay__) g.__teamplay__ = {}
  g.__teamplay__.diagnostics = diagnostics
}

function unexposeGlobal (): void {
  const g = globalThis as GlobalTeamplay
  if (g.__teamplay__?.diagnostics === diagnostics) delete g.__teamplay__.diagnostics
}

// Diagnostics requested before teamplay loaded (global flag or env var):
// counters are already on (state.ts), install the method instrumentation now.
if (diag.on) enableDiagnostics()
