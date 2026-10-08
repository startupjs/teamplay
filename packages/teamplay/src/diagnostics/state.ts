// Diagnostics runtime state.
//
// This module is imported by hot runtime paths (subscriptions, React hooks,
// FinalizationRegistry wrappers), so it must stay dependency-free and cheap.
// Every hook site guards itself with `if (diag.on)` so that a disabled
// diagnostics build pays one property read per call.
//
// Rule: diagnostics must never keep signals, docs or React objects alive.
// Registries below hold ids, strings, numbers and WeakRefs only.

import { SEGMENTS } from '../orm/signalSymbols.ts'

export interface DiagnosticsOptions {
  /** Record lifecycle events into a bounded ring buffer. */
  trace?: boolean
  /** Capture a stack trace for every traced event (expensive). Implies trace. */
  stacks?: boolean
  /** Ring buffer capacity (number of events). */
  traceSize?: number
}

export interface TraceEvent {
  seq: number
  t: number
  type: string
  key?: string
  data?: Record<string, unknown>
  stack?: string
}

export interface TimingStat {
  count: number
  totalMs: number
  maxMs: number
}

export interface LeaseMeta {
  id: number
  ref: WeakRefLike<object>
  createdAt: number
  committedAt?: number
  desc: string
  hookKey?: string
  componentId?: string
}

export interface AdmMeta {
  id: number
  ref: WeakRefLike<object>
  createdAt: number
  subscribedAt?: number
  componentId?: string
  name: string
}

export interface ObserverMeta {
  id: number
  ref: WeakRefLike<object>
  createdAt: number
  componentId?: string
  name: string
}

export interface PollerMeta {
  id: number
  kind: string
  desc: string
  startedAt: number
}

export interface PendingUnsubMeta {
  id: number
  kind: string
  key: string
  intent: string
  startedAt: number
}

export interface Incident {
  t: number
  code: string
  key?: string
  data?: Record<string, unknown>
}

interface WeakRefLike<T extends object> {
  deref: () => T | undefined
}

const DEFAULT_TRACE_SIZE = 5000
const MAX_INCIDENTS = 200
const MAX_CHURN_KEYS = 2000

export const diag = {
  /** Master switch. Checked by every hook site. */
  on: false,
  /** Ring buffer recording. */
  trace: false,
  /** Stack capture for traced events. */
  stacks: false,
  traceSize: DEFAULT_TRACE_SIZE,
  enabledAt: 0,
  /** True when diagnostics were enabled before teamplay modules finished loading. */
  enabledAtStartup: false,
  /** Name of the FinalizationRegistry whose callback is running right now. */
  finalizing: undefined as string | undefined
}

let counters: Record<string, number> = Object.create(null)
let timings: Record<string, TimingStat> = Object.create(null)
let buffer: Array<TraceEvent | undefined> = []
let seq = 0
let incidents: Incident[] = []
let nextId = 1

export const leases = new Map<number, LeaseMeta>()
export const adms = new Map<number, AdmMeta>()
export const observers = new Map<number, ObserverMeta>()
export const reactions = new Map<number, ObserverMeta>()
export const pollers = new Map<number, PollerMeta>()
export const pendingUnsubs = new Map<number, PendingUnsubMeta>()
// Churn maps: how many objects were created per key. Bounded.
export const leaseChurnByDesc = new Map<string, number>()
export const leaseChurnByHook = new Map<string, number>()
export const admChurnByName = new Map<string, number>()
// componentIds of every observer wrapper created since enabling (strings only, bounded)
export const seenAdmComponentIds = new Set<string>()
const MAX_SEEN_COMPONENT_IDS = 100000

const OBJECT_IDS = new WeakMap<object, number>()
const TIMESTAMPS = new WeakMap<object, number>()

const WeakRefCtor: (new <T extends object>(value: T) => WeakRefLike<T>) | undefined =
  typeof WeakRef !== 'undefined' ? WeakRef : undefined

export function now (): number {
  return Date.now()
}

export function weak<T extends object> (value: T): WeakRefLike<T> {
  if (WeakRefCtor) return new WeakRefCtor(value)
  // Without WeakRef we refuse to hold the object: report it as collected.
  return { deref: () => undefined }
}

export function objectId (obj: object): number {
  let id = OBJECT_IDS.get(obj)
  if (id == null) {
    id = nextId++
    OBJECT_IDS.set(obj, id)
  }
  return id
}

export function peekObjectId (obj: object): number | undefined {
  return OBJECT_IDS.get(obj)
}

/** Remember when an object (e.g. a pending destroy entry) was first seen. */
export function stamp (obj: object | null | undefined, t = now()): void {
  if (!obj || typeof obj !== 'object') return
  if (!TIMESTAMPS.has(obj)) TIMESTAMPS.set(obj, t)
}

export function getStamp (obj: object | null | undefined): number | undefined {
  if (!obj || typeof obj !== 'object') return undefined
  return TIMESTAMPS.get(obj)
}

export function count (type: string, by = 1): void {
  counters[type] = (counters[type] || 0) + by
}

export function time (type: string, ms: number): void {
  let stat = timings[type]
  if (!stat) stat = timings[type] = { count: 0, totalMs: 0, maxMs: 0 }
  stat.count += 1
  stat.totalMs += ms
  if (ms > stat.maxMs) stat.maxMs = ms
}

/**
 * Count an event and, when tracing, append it to the ring buffer.
 * Call sites must already be guarded by `if (diag.on)`.
 */
export function record (type: string, key?: string, data?: Record<string, unknown>): void {
  counters[type] = (counters[type] || 0) + 1
  if (!diag.trace) return
  seq += 1
  const event: TraceEvent = { seq, t: now(), type }
  if (key !== undefined) event.key = key
  if (data !== undefined) event.data = data
  if (diag.stacks) event.stack = captureStack()
  buffer[(seq - 1) % diag.traceSize] = event
}

export function addIncident (code: string, key?: string, data?: Record<string, unknown>): void {
  incidents.push({ t: now(), code, key, data })
  if (incidents.length > MAX_INCIDENTS) incidents.splice(0, incidents.length - MAX_INCIDENTS)
  record(code, key, data)
}

export function bumpChurn (map: Map<string, number>, key: string): void {
  const prev = map.get(key)
  if (prev != null) {
    map.set(key, prev + 1)
    return
  }
  if (map.size >= MAX_CHURN_KEYS) {
    map.set('(other)', (map.get('(other)') || 0) + 1)
    return
  }
  map.set(key, 1)
}

export interface TraceFilter {
  /** Event type prefix (e.g. 'doc.' or 'react.lease') or a list of prefixes. */
  type?: string | string[]
  /** Substring that must occur in the event key. */
  key?: string
  /** Only events with seq greater than this. */
  since?: number
  /** Keep only the last N matching events. */
  limit?: number
}

export function getTrace (filter: TraceFilter = {}): TraceEvent[] {
  const size = diag.traceSize
  const first = Math.max(1, seq - size + 1)
  const types = filter.type == null ? undefined : (Array.isArray(filter.type) ? filter.type : [filter.type])
  const result: TraceEvent[] = []
  for (let s = Math.max(first, (filter.since ?? 0) + 1); s <= seq; s++) {
    const event = buffer[(s - 1) % size]
    if (!event || event.seq !== s) continue
    if (types && !types.some(prefix => event.type.startsWith(prefix))) continue
    if (filter.key != null && !(event.key ?? '').includes(filter.key)) continue
    result.push(event)
  }
  if (filter.limit != null && result.length > filter.limit) return result.slice(result.length - filter.limit)
  return result
}

export function getTraceSeq (): number {
  return seq
}

export function clearTrace (): void {
  buffer = []
  seq = 0
}

export function getCounters (): Record<string, number> {
  return { ...counters }
}

export function getTimings (): Record<string, TimingStat> {
  const result: Record<string, TimingStat> = {}
  for (const key of Object.keys(timings)) result[key] = { ...timings[key] }
  return result
}

export function getIncidents (): Incident[] {
  return incidents.slice()
}

export function resetCounters (): void {
  counters = Object.create(null)
  timings = Object.create(null)
  incidents = []
  leaseChurnByDesc.clear()
  leaseChurnByHook.clear()
  admChurnByName.clear()
}

export function resetRegistries (): void {
  leases.clear()
  adms.clear()
  observers.clear()
  reactions.clear()
  pollers.clear()
  pendingUnsubs.clear()
  seenAdmComponentIds.clear()
}

export function applyOptions (options: DiagnosticsOptions = {}): void {
  if (options.traceSize != null) {
    const size = Math.floor(Number(options.traceSize))
    if (Number.isFinite(size) && size > 0 && size !== diag.traceSize) {
      diag.traceSize = size
      clearTrace()
    }
  }
  if (options.stacks != null) diag.stacks = !!options.stacks
  if (options.trace != null) diag.trace = !!options.trace
  if (diag.stacks) diag.trace = true
}

function captureStack (): string | undefined {
  const stack = new Error().stack
  if (!stack) return undefined
  const lines = stack.split('\n')
  // Drop "Error" and the diagnostics frames themselves.
  const frames = lines.slice(1).filter(line => !/[\\/]diagnostics[\\/]/.test(line))
  return frames.slice(0, 12).map(line => line.trim()).join('\n')
}

const MAX_DESC_PARAMS = 160

/** Short human-readable description of a sub()/useSub() target. Strings only. */
export function describeSubTarget (target: unknown, serializedParams?: string): string {
  let base: string
  const segments = target != null && (typeof target === 'object' || typeof target === 'function')
    ? (target as { [SEGMENTS]?: unknown[] })[SEGMENTS]
    : undefined
  if (Array.isArray(segments)) {
    if (segments.length === 1 && serializedParams != null) base = 'query ' + String(segments[0])
    else if (segments.length === 2 && serializedParams == null) base = 'doc ' + segments.join('.')
    else base = 'signal ' + segments.join('.')
  } else if (typeof target === 'function') {
    base = 'aggregationFn ' + String((target as { collection?: unknown }).collection ?? '?')
  } else if (target && typeof target === 'object') {
    const header = target as { collection?: unknown, name?: unknown }
    base = 'aggregation ' + String(header.collection ?? '?') + '.' + String(header.name ?? '?')
  } else {
    base = String(target)
  }
  if (serializedParams == null) return base
  const params = serializedParams.length > MAX_DESC_PARAMS
    ? serializedParams.slice(0, MAX_DESC_PARAMS) + '…'
    : serializedParams
  return base + ' ' + params
}

// ---- React-layer hooks (called from src/react/*, guarded by diag.on) ----

export function noteLeaseCreated (lease: object, desc: string, hookKey?: string, componentId?: string): void {
  const id = objectId(lease)
  leases.set(id, { id, ref: weak(lease), createdAt: now(), desc, hookKey, componentId })
  bumpChurn(leaseChurnByDesc, desc)
  if (hookKey) bumpChurn(leaseChurnByHook, hookKey)
  record('react.lease.create', desc, { lease: id, hook: hookKey })
}

export function noteLeaseCommitted (lease: object): void {
  const id = peekObjectId(lease)
  const meta = id != null ? leases.get(id) : undefined
  if (meta && meta.committedAt == null) meta.committedAt = now()
  record('react.lease.commit', meta?.desc, { lease: id })
}

export function noteLeaseReleased (lease: object, committed: boolean): void {
  const id = peekObjectId(lease)
  const meta = id != null ? leases.get(id) : undefined
  if (id != null) leases.delete(id)
  record(committed ? 'react.lease.release' : 'react.lease.releaseUncommitted', meta?.desc, {
    lease: id,
    ageMs: meta ? now() - meta.createdAt : undefined
  })
}

export function noteAdmCreated (adm: object, name: string, componentId?: string): void {
  const id = objectId(adm)
  adms.set(id, { id, ref: weak(adm), createdAt: now(), name, componentId })
  if (componentId) {
    if (seenAdmComponentIds.size >= MAX_SEEN_COMPONENT_IDS) seenAdmComponentIds.clear()
    seenAdmComponentIds.add(componentId)
  }
  bumpChurn(admChurnByName, name)
  record('react.adm.create', name, { adm: id, componentId })
}

export function noteAdmSubscribed (adm: object): void {
  const id = peekObjectId(adm)
  const meta = id != null ? adms.get(id) : undefined
  if (meta && meta.subscribedAt == null) meta.subscribedAt = now()
  record('react.adm.subscribe', meta?.name, { adm: id })
}

// A never-mounted observer wrapper was collected (its destroy callbacks ran
// from a finalizer).
export function noteAdmCollected (id: number): void {
  adms.delete(id)
  record('react.adm.collected', undefined, { adm: id })
}

export function noteAdmDestroyed (adm: object): void {
  const id = peekObjectId(adm)
  const meta = id != null ? adms.get(id) : undefined
  if (id != null) adms.delete(id)
  record('react.adm.destroy', meta?.name, { adm: id })
}

export function noteObserverCreated (reactionFn: object, name: string, componentId?: string): void {
  const id = objectId(reactionFn)
  observers.set(id, { id, ref: weak(reactionFn), createdAt: now(), name, componentId })
  record('react.observer.create', name, { observer: id, componentId })
}

export function noteObserverDestroyed (reactionFn: object | undefined, where?: string): void {
  if (!reactionFn) return
  const id = peekObjectId(reactionFn)
  const meta = id != null ? observers.get(id) : undefined
  if (id != null) observers.delete(id)
  record('react.observer.destroy', meta?.name, { observer: id, where })
}

export function noteReactionCreated (handle: object): void {
  const id = objectId(handle)
  reactions.set(id, { id, ref: weak(handle), createdAt: now(), name: 'reaction' })
  record('reaction.create', undefined, { reaction: id })
}

export function noteReactionDisposed (handle: object): void {
  const id = peekObjectId(handle)
  if (id != null) reactions.delete(id)
  record('reaction.dispose', undefined, { reaction: id })
}

export function pollerStart (kind: string, desc: string): number {
  const id = nextId++
  pollers.set(id, { id, kind, desc, startedAt: now() })
  record(kind + '.start', desc, { poller: id })
  return id
}

export function pollerEnd (id: number | undefined): void {
  if (id == null) return
  const meta = pollers.get(id)
  if (!meta) return
  pollers.delete(id)
  const ms = now() - meta.startedAt
  time(meta.kind, ms)
  record(meta.kind + '.end', meta.desc, { poller: id, ms })
}

export function noteSubRecordAdded (kind: string, intent: string): void {
  count(`sub.${kind}.${intent}`)
}

export function noteUnsubRecords (
  records: ReadonlyArray<{ kind: string, intent: string, disposed: boolean }> | undefined,
  requestedIntent?: string
): void {
  if (!records) {
    count('sub.unsub.noRecord')
    return
  }
  let fetch = 0
  let subscribe = 0
  let kind: string | undefined
  for (const record of records) {
    if (record.disposed) continue
    kind = record.kind
    if (record.intent === 'fetch') fetch++
    else subscribe++
  }
  count(`sub.unsub.${kind ?? 'none'}`)
  if (fetch > 0 && subscribe > 0 && requestedIntent == null) {
    // unsub() without { mode } on a signal holding both kinds releases a fetch record.
    addIncident('sub.unsub.mixedIntents', kind, { fetch, subscribe })
  }
}

// ---- startup flag ----

function parseFlag (flag: unknown): DiagnosticsOptions | undefined {
  if (!flag) return undefined
  if (flag === true) return {}
  if (typeof flag === 'object') return flag as DiagnosticsOptions
  if (typeof flag === 'number') return flag > 0 ? {} : undefined
  if (typeof flag !== 'string') return undefined
  const value = flag.trim().toLowerCase()
  if (!value || value === '0' || value === 'false' || value === 'off') return undefined
  const options: DiagnosticsOptions = {}
  for (const part of value.split(/[,\s]+/)) {
    if (part === 'trace') options.trace = true
    else if (part === 'stacks' || part === 'stack') options.stacks = true
    else if (part.startsWith('tracesize=')) options.traceSize = Number(part.slice('tracesize='.length))
  }
  return options
}

export function readStartupOptions (): DiagnosticsOptions | undefined {
  const g = globalThis as { __TEAMPLAY_DIAGNOSTICS__?: unknown, process?: { env?: Record<string, string | undefined> } }
  const fromGlobal = parseFlag(g.__TEAMPLAY_DIAGNOSTICS__)
  if (fromGlobal) return fromGlobal
  let fromEnv: string | undefined
  try {
    fromEnv = g.process?.env?.TEAMPLAY_DIAGNOSTICS
  } catch {}
  return parseFlag(fromEnv)
}

// Turn the switch on as early as possible (this module is imported by the
// FinalizationRegistry wrapper, i.e. before any teamplay registry exists), so
// counters cover the whole process. Method instrumentation is installed later
// by diagnostics/index.ts.
const startupOptions = readStartupOptions()
if (startupOptions) {
  diag.on = true
  diag.enabledAt = now()
  diag.enabledAtStartup = true
  applyOptions(startupOptions)
}
