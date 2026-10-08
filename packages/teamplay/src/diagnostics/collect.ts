// Read-only collectors over the runtime state. They read existing manager
// state (entries, owner records, root contexts, ShareDB connection) plus the
// registries filled by the diagnostics hooks, and return plain JSON.
//
// Collectors never subscribe, never write and never read through observables
// (raw objects only), so taking a snapshot inside a render or a reaction does
// not create reactive dependencies.
import { __DEBUG_SIGNALS_CACHE__ as SIGNALS_CACHE } from '../orm/getSignal.ts'
import { docSubscriptions } from '../orm/Doc.js'
import { querySubscriptions, QUERIES, parseQueryHash } from '../orm/Query.js'
import { aggregationSubscriptions, AGGREGATIONS } from '../orm/Aggregation.js'
import { getRootContexts, getClosedRootContextCount, isRootContextClosed } from '../orm/rootContext.ts'
import { getPendingRootDisposeCount } from '../orm/disposeRootContext.ts'
import { GLOBAL_ROOT_ID } from '../orm/Root.ts'
import { connection } from '../orm/connection.ts'
import { getSubscriptionGcDelay } from '../orm/subscriptionGcDelay.ts'
import { __getListenerCountsForDiagnostics } from '../orm/events.js'
import { __getBatchSchedulerState } from '../orm/batchScheduler.js'
import { __getStateForDiagnostics as getPromiseBatcherState } from '../react/promiseBatcher.ts'
import renderAttemptDestroyer from '../react/renderAttemptDestroyer.ts'
import { __getSuspendMemoInFlightCount } from '../react/useSuspendMemo.ts'
import isServer from '../utils/isServer.ts'
import {
  getAllFinalizationRegistryStats,
  getFinalizationRegistryImplementation
} from '../utils/MockFinalizationRegistry.ts'
import { getTrackedOwnerTokenCount } from './instrument.ts'
import { DEBUG, dataTreeRaw, valueSubscriptions, reactionSubscriptions } from './runtimeRefs.js'
import {
  diag,
  now,
  stamp,
  getStamp,
  leases,
  adms,
  observers,
  reactions,
  pollers,
  pendingUnsubs,
  leaseChurnByDesc,
  leaseChurnByHook,
  admChurnByName,
  seenAdmComponentIds,
  getCounters,
  getTimings,
  getIncidents,
  getTraceSeq
} from './state.ts'

type Dict<T = number> = Record<string, T>
type AnyRecord = Record<string, any>

export interface Thresholds {
  /** Pending destroys older than this are stale. Default: gcDelay + 2000ms. */
  pendingDestroyMaxAgeMs?: number
  /** unsub() promises pending longer than this are stale. Default: gcDelay + 2000ms. */
  pendingUnsubMaxAgeMs?: number
  /** useSub() leases that never committed. Default: 5000ms. */
  uncommittedLeaseMaxAgeMs?: number
  /** observer() wrappers rendered but never mounted. Default: 5000ms. */
  neverSubscribedMaxAgeMs?: number
  /** Readiness polling loops. Default: 10000ms. */
  pollerMaxAgeMs?: number
}

export interface CollectOptions {
  /** Max examples per list. */
  limit?: number
  /** Staleness thresholds. */
  thresholds?: Thresholds
  /** Max keys in "top" breakdowns (by collection, by root, ...). */
  top?: number
  /** Approximate private data sizes with JSON.stringify (slower). */
  sizes?: boolean
}

export interface Collected {
  takenAt: number
  summary: AnyRecord
  lists: Record<string, AnyRecord[]>
}

const DEFAULT_LIMIT = 50
const DEFAULT_TOP = 25

export function collect (options: CollectOptions = {}): Collected {
  const limit = options.limit ?? DEFAULT_LIMIT
  const top = options.top ?? DEFAULT_TOP
  const takenAt = now()
  const lists: Record<string, AnyRecord[]> = {}
  const gcDelay = getSubscriptionGcDelay()
  const thresholds: Required<Thresholds> = {
    pendingDestroyMaxAgeMs: gcDelay + 2000,
    pendingUnsubMaxAgeMs: gcDelay + 2000,
    uncommittedLeaseMaxAgeMs: 5000,
    neverSubscribedMaxAgeMs: 5000,
    pollerMaxAgeMs: 10000,
    ...dropUndefined(options.thresholds)
  }
  const ctx = { limit, top, takenAt, lists, sizes: !!options.sizes, thresholds }

  const signals = collectSignals(ctx)
  const docs = collectDocs(ctx)
  const queries = collectQueries(ctx, querySubscriptions, 'query')
  const aggregations = collectQueries(ctx, aggregationSubscriptions, 'aggregation')
  const roots = collectRoots(ctx)
  const dataTree = collectDataTree(ctx)
  const conn = collectConnection(ctx)
  const react = collectReact(ctx)
  const subs = collectSub(ctx)

  const summary = {
    version: 1,
    takenAt,
    enabled: diag.on,
    enabledAt: diag.enabledAt || undefined,
    enabledAtStartup: diag.enabledAtStartup,
    env: {
      isServer: !!isServer,
      gcAvailable: typeof (globalThis as { gc?: unknown }).gc === 'function',
      subscriptionGcDelay: getSubscriptionGcDelay(),
      finalizationRegistry: getFinalizationRegistryImplementation()
    },
    signals,
    docs,
    queries,
    aggregations,
    roots,
    finalization: collectFinalization(),
    react,
    dataTree,
    connection: conn,
    sub: subs,
    thresholds,
    trace: { enabled: diag.trace, stacks: diag.stacks, size: diag.traceSize, seq: getTraceSeq() },
    counters: getCounters(),
    timings: withAverages(getTimings())
  }
  return { takenAt, summary, lists }
}

interface Ctx {
  limit: number
  top: number
  takenAt: number
  sizes: boolean
  thresholds: Required<Thresholds>
  lists: Record<string, AnyRecord[]>
}

function dropUndefined<T extends object> (value: T | undefined): Partial<T> {
  const result: Partial<T> = {}
  if (!value) return result
  for (const key of Object.keys(value) as Array<keyof T>) {
    if (value[key] !== undefined) result[key] = value[key]
  }
  return result
}

// ---------------- helpers ----------------

function inc (dict: Dict, key: string, by = 1): void {
  dict[key] = (dict[key] || 0) + by
}

function topN (dict: Dict, n: number): Dict {
  const keys = Object.keys(dict)
  if (keys.length <= n) return sortDict(dict)
  const sorted = keys.sort((a, b) => dict[b] - dict[a])
  const result: Dict = {}
  let other = 0
  sorted.forEach((key, i) => {
    if (i < n) result[key] = dict[key]
    else other += dict[key]
  })
  result['(other)'] = other
  return result
}

function sortDict (dict: Dict): Dict {
  const result: Dict = {}
  for (const key of Object.keys(dict).sort((a, b) => dict[b] - dict[a])) result[key] = dict[key]
  return result
}

function push (ctx: Ctx, list: string, item: AnyRecord): void {
  const items = ctx.lists[list] ??= []
  if (items.length < ctx.limit) items.push(item)
}

function bump (ctx: Ctx, list: string): void {
  // keep count of items even when the list is truncated
  const key = list + '#count'
  const items = ctx.lists[key] ??= [{ count: 0 }]
  items[0].count++
}

function addExample (ctx: Ctx, list: string, item: AnyRecord): void {
  bump(ctx, list)
  push(ctx, list, item)
}

// First-seen age for objects whose creation time was not stamped by a hook
// (e.g. scheduled before diagnostics were enabled). Lower bound.
function ageOf (obj: object | null | undefined, at: number): number | undefined {
  if (!obj) return undefined
  let t = getStamp(obj)
  if (t == null) {
    stamp(obj, at)
    t = at
  }
  return at - t
}

function maxOf (current: number | undefined, value: number | undefined): number | undefined {
  if (value == null) return current
  if (current == null || value > current) return value
  return current
}

function entryMode (entry: AnyRecord | undefined): string {
  if (!entry) return 'idle'
  return entry.runtime?.activeTransportMode ?? entry.mode ?? 'idle'
}

function normalizeRoot (rootId: unknown): string {
  return rootId == null ? GLOBAL_ROOT_ID : String(rootId)
}

// The mode the manager drives a transport to. During the GC grace an ownerless
// live ('subscribe') transport keeps 'subscribe' as its target (transport
// grace), so it is compared against this rather than the owner-derived mode.
function targetModeOf (manager: AnyRecord, key: string): string {
  return typeof manager.getTargetTransportMode === 'function'
    ? manager.getTargetTransportMode(key)
    : manager.getDesiredTransportMode(key)
}

// A lingering entry in 'subscribe' mode is adopted synchronously by the next
// owner, so its ShareDB transport must really be subscribed. `wantSubscribe`
// and a registered 'qs' query survive disconnects (ShareDB resubscribes them),
// so a disconnected client is not reported.
function isShareDocLive (collection: unknown, id: unknown): boolean {
  if (collection == null || id == null) return false
  const shareDoc = (connection as AnyRecord | undefined)?.collections?.[String(collection)]?.[String(id)]
  if (!shareDoc) return false
  // the latest queued request wins, as in ShareDB's own _queueSubscribe()
  const pending = shareDoc.pendingSubscribe
  const lastRequest = pending?.[pending.length - 1] ?? shareDoc.inflightSubscribe
  return lastRequest ? !!lastRequest.wantSubscribe : !!shareDoc.wantSubscribe
}

function isShareQueryLive (runtime: AnyRecord | undefined): boolean {
  const shareQuery = runtime?.shareQuery
  if (!shareQuery || shareQuery.action !== 'qs') return false
  return (connection as AnyRecord | undefined)?.queries?.[shareQuery.id] === shareQuery
}

function safeParse (json: string): any {
  try {
    return JSON.parse(json)
  } catch {
    return undefined
  }
}

function withAverages (timings: Record<string, { count: number, totalMs: number, maxMs: number }>): AnyRecord {
  const result: AnyRecord = {}
  for (const key of Object.keys(timings)) {
    const stat = timings[key]
    result[key] = { ...stat, avgMs: stat.count ? Math.round((stat.totalMs / stat.count) * 10) / 10 : 0 }
  }
  return result
}

// ---------------- signals cache ----------------

export interface SignalHashInfo {
  kind: string
  rootId?: string
  collection?: string
}

export function classifySignalHash (hash: string): SignalHashInfo {
  const parsed = safeParse(hash)
  if (!parsed || typeof parsed !== 'object') return { kind: 'other' }
  if ('root' in parsed) return { kind: 'root', rootId: parsed.root }
  if ('querySignal' in parsed) {
    const [rootId, transportHash] = parsed.querySignal || []
    return { kind: 'query', rootId, collection: parseQueryHash(transportHash).collectionName }
  }
  if ('private' in parsed) {
    const [rootId, segments] = parsed.private || []
    const first = segments?.[0]
    if (first === QUERIES) return { kind: 'queryData', rootId, collection: parseQueryHash(segments?.[1]).collectionName }
    if (first === AGGREGATIONS) {
      return {
        kind: segments.length === 2 ? 'aggregation' : 'aggregationRow',
        rootId,
        collection: parseQueryHash(segments?.[1]).collectionName
      }
    }
    if (first === '$local') return { kind: 'local', rootId }
    return { kind: 'private', rootId, collection: String(first) }
  }
  if ('public' in parsed) {
    const [rootId, segments] = parsed.public || []
    const length = segments?.length ?? 0
    const kind = length <= 1 ? 'collection' : (length === 2 ? 'doc' : 'field')
    return { kind, rootId, collection: segments?.[0] }
  }
  return { kind: 'other' }
}

function collectSignals (ctx: Ctx): AnyRecord {
  const byKind: Dict = {}
  const deadByKind: Dict = {}
  const byCollection: Dict = {}
  const byRoot: Dict = {}
  let total = 0
  let live = 0
  let dead = 0
  for (const [key, alive] of SIGNALS_CACHE._diagnosticEntries()) {
    total++
    const info = classifySignalHash(key)
    inc(byKind, info.kind)
    if (alive) live++
    else {
      dead++
      inc(deadByKind, info.kind)
      addExample(ctx, 'signals.dead', { key: truncate(key) })
    }
    if (info.collection) inc(byCollection, info.collection)
    inc(byRoot, normalizeRoot(info.rootId))
  }
  return {
    cache: {
      total,
      live,
      dead,
      byKind: sortDict(byKind),
      deadByKind: sortDict(deadByKind),
      byCollection: topN(byCollection, ctx.top),
      byRoot: topN(byRoot, ctx.top)
    }
  }
}

function truncate (value: string, max = 300): string {
  return value.length > max ? value.slice(0, max) + '…' : value
}

// ---------------- doc subscriptions ----------------

function collectDocs (ctx: Ctx): AnyRecord {
  const manager = docSubscriptions as AnyRecord
  const byMode: Dict = {}
  const byPhase: Dict = {}
  const byCollection: Dict = {}
  const categories: Dict = { owned: 0, retainedOnly: 0, graceLive: 0, graceStale: 0, ownerless: 0, transition: 0 }
  let runtimes = 0
  let owners = 0
  let retained = 0
  let retainTotal = 0
  let pendingDestroys = 0
  let stalePendingDestroys = 0
  let oldestPendingDestroyMs: number | undefined
  let divergent = 0
  let graceTransportNotLive = 0
  for (const [hash, entry] of manager.entries as Map<string, AnyRecord>) {
    const mode = entryMode(entry)
    inc(byMode, mode)
    inc(byPhase, entry.phase)
    const segments = entry.segments ?? safeParse(hash)
    const collection = segments?.[0]
    if (collection != null) inc(byCollection, String(collection))
    if (entry.runtime) runtimes++
    owners += entry.owners.size
    if (entry.retainCount > 0) {
      retained++
      retainTotal += entry.retainCount
    }
    const total = manager.getEntryTotalCount(entry)
    const pendingAgeMs = entry.pendingDestroy ? ageOf(entry.pendingDestroy, ctx.takenAt) : undefined
    if (entry.pendingDestroy) {
      pendingDestroys++
      oldestPendingDestroyMs = maxOf(oldestPendingDestroyMs, pendingAgeMs)
    }
    const example = {
      hash,
      mode,
      targetMode: entry.targetMode,
      phase: entry.phase,
      owners: entry.owners.size,
      retain: entry.retainCount,
      total,
      pendingAgeMs,
      runtime: !!entry.runtime,
      lifecycle: entry.runtime?.lifecycle?.state
    }
    if (entry.phase === 'transition') categories.transition++
    if (entry.owners.size > 0) {
      categories.owned++
      addExample(ctx, 'docs.owned', { ...example, ownerRoots: ownerRootsOf(manager, entry) })
    } else if (entry.retainCount > 0) {
      // held by query results only (including a query lingering in its grace)
      categories.retainedOnly++
      addExample(ctx, 'docs.retainedOnly', example)
    } else if (entry.pendingDestroy) {
      // GC grace. Expected while the timer is not overdue and the transport is
      // either live (transport grace) or closed (released fetch). A fetch
      // transport left open shows up as divergent below.
      if (mode === 'subscribe') categories.graceLive++
      else categories.graceStale++
      addExample(ctx, 'docs.pendingDestroy', example)
      if ((pendingAgeMs ?? 0) > ctx.thresholds.pendingDestroyMaxAgeMs) {
        stalePendingDestroys++
        addExample(ctx, 'docs.stalePendingDestroy', example)
      }
      if (mode === 'subscribe' && entry.phase === 'stable' && !entry.reconcilePromise && !isShareDocLive(collection, segments?.[1])) {
        graceTransportNotLive++
        addExample(ctx, 'docs.graceTransportNotLive', example)
      }
    } else if (entry.phase === 'stable') {
      // Nobody owns it and nothing will clean it up: leak suspect.
      categories.ownerless++
      if (mode !== 'idle') addExample(ctx, 'docs.transportWithoutOwners', example)
      else if (entry.runtime) addExample(ctx, 'docs.runtimeWithoutOwners', example)
      else addExample(ctx, 'docs.emptyEntry', example)
    }
    if (entry.phase === 'stable' && !entry.reconcilePromise) {
      const desired = targetModeOf(manager, hash)
      if (desired !== mode) {
        divergent++
        addExample(ctx, 'docs.divergent', { ...example, desired, grace: (entry.owners.size === 0 && !!entry.pendingDestroy) || undefined })
      }
    }
  }
  const ownerStats = collectOwnerRecords(ctx, manager, 'docs', record => record.hash)
  return {
    entries: manager.entries.size,
    runtimes,
    owners,
    retained,
    retainTotal,
    pendingDestroys,
    stalePendingDestroys,
    oldestPendingDestroyMs,
    divergent,
    graceTransportNotLive,
    categories,
    byMode: sortDict(byMode),
    byPhase: sortDict(byPhase),
    byCollection: topN(byCollection, ctx.top),
    ownerRecords: ownerStats,
    trackedOwnerTokens: getTrackedOwnerTokenCount(manager)
  }
}

function ownerRootsOf (manager: AnyRecord, entry: AnyRecord): string[] {
  const roots: string[] = []
  for (const ownerKey of entry.owners) {
    const record = manager.ownerRecords.get(ownerKey)
    roots.push(normalizeRoot(record?.rootId) + ':' + ((record?.subscribeCount || 0) + (record?.fetchCount || 0)))
    if (roots.length >= 5) break
  }
  return roots
}

function collectOwnerRecords (
  ctx: Ctx,
  manager: AnyRecord,
  listPrefix: string,
  getEntryKey: (record: AnyRecord) => string
): AnyRecord {
  const byRoot: Dict = {}
  let fetch = 0
  let subscribe = 0
  let closedRootOwners = 0
  let missingRootOwners = 0
  let zeroCountOwners = 0
  const liveRootIds = new Set<string>()
  for (const context of getRootContexts()) liveRootIds.add(context.rootId)
  for (const [ownerKey, record] of manager.ownerRecords as Map<string, AnyRecord>) {
    const rootId = normalizeRoot(record.rootId)
    inc(byRoot, rootId)
    fetch += record.fetchCount || 0
    subscribe += record.subscribeCount || 0
    const example = {
      ownerKey: truncate(ownerKey),
      rootId,
      key: getEntryKey(record),
      fetch: record.fetchCount,
      subscribe: record.subscribeCount
    }
    if (rootId !== GLOBAL_ROOT_ID) {
      if (isRootContextClosed(rootId)) {
        closedRootOwners++
        addExample(ctx, listPrefix + '.ownersOfClosedRoots', example)
      } else if (!liveRootIds.has(rootId)) {
        missingRootOwners++
        addExample(ctx, listPrefix + '.ownersOfMissingRoots', example)
      }
    }
    if ((record.fetchCount || 0) + (record.subscribeCount || 0) === 0) {
      zeroCountOwners++
      const pending = typeof manager.hasPendingDestroy === 'function'
        ? manager.hasPendingDestroy(ownerKey, record.transportHash)
        : !!manager.entries.get(getEntryKey(record))?.pendingDestroy
      if (!pending) addExample(ctx, listPrefix + '.zeroCountOwners', example)
    }
  }
  return {
    count: manager.ownerRecords.size,
    fetch,
    subscribe,
    zeroCount: zeroCountOwners,
    closedRoots: closedRootOwners,
    missingRoots: missingRootOwners,
    byRoot: topN(byRoot, ctx.top)
  }
}

// ---------------- query / aggregation subscriptions ----------------

function collectQueries (ctx: Ctx, manager: AnyRecord, kind: string): AnyRecord {
  const listPrefix = kind === 'query' ? 'queries' : 'aggregations'
  const byMode: Dict = {}
  const byPhase: Dict = {}
  const byCollection: Dict = {}
  const categories: Dict = { owned: 0, graceLive: 0, graceStale: 0, ownerless: 0, transition: 0 }
  let runtimes = 0
  let owners = 0
  let pendingDestroys = 0
  let stalePendingDestroys = 0
  let oldestPendingDestroyMs: number | undefined
  let docSignals = 0
  let attachedRoots = 0
  let results = 0
  let divergent = 0
  let graceTransportNotLive = 0
  for (const [transportHash, entry] of manager.entries as Map<string, AnyRecord>) {
    const mode = entryMode(entry)
    inc(byMode, mode)
    inc(byPhase, entry.phase)
    const runtime = entry.runtime
    const collection = runtime?.collectionName ?? parseQueryHash(transportHash).collectionName
    if (collection != null) inc(byCollection, String(collection))
    owners += entry.owners.size
    let entryOldest: number | undefined
    let entryStale = 0
    for (const pendingDestroy of entry.pendingDestroyByOwner.values()) {
      pendingDestroys++
      const ageMs = ageOf(pendingDestroy, ctx.takenAt)
      entryOldest = maxOf(entryOldest, ageMs)
      if ((ageMs ?? 0) > ctx.thresholds.pendingDestroyMaxAgeMs) entryStale++
    }
    stalePendingDestroys += entryStale
    oldestPendingDestroyMs = maxOf(oldestPendingDestroyMs, entryOldest)
    if (runtime) {
      runtimes++
      docSignals += runtime.docSignals?.size || 0
      attachedRoots += runtime.rootIds?.size || 0
      results += runtime.shareQuery?.results?.length || 0
    }
    const example = {
      hash: truncate(transportHash),
      collection,
      mode,
      targetMode: entry.targetMode,
      phase: entry.phase,
      owners: entry.owners.size,
      pendingDestroys: entry.pendingDestroyByOwner.size,
      pendingAgeMs: entryOldest,
      runtime: !!runtime,
      docSignals: runtime?.docSignals?.size,
      rootIds: runtime ? Array.from(runtime.rootIds || []).slice(0, 5) : undefined
    }
    if (entryStale > 0) addExample(ctx, listPrefix + '.stalePendingDestroy', { ...example, stale: entryStale })
    if (entry.phase === 'transition') categories.transition++
    if (entry.owners.size > 0) {
      categories.owned++
      addExample(ctx, listPrefix + '.owned', { ...example, ownerRoots: ownerRootsOf(manager, entry) })
    } else if (entry.pendingDestroyByOwner.size > 0) {
      // GC grace: the released owners keep their roots attached (root data
      // stays) until their per-owner timers fire. A live transport stays
      // subscribed (transport grace); a released fetch is closed eagerly.
      // Expected while no timer is overdue (stalePendingDestroy above); a fetch
      // transport left open shows up as divergent below.
      if (mode === 'subscribe') categories.graceLive++
      else categories.graceStale++
      addExample(ctx, listPrefix + '.pendingDestroy', example)
      if (mode === 'subscribe' && entry.phase === 'stable' && !entry.reconcilePromise && !isShareQueryLive(runtime)) {
        graceTransportNotLive++
        addExample(ctx, listPrefix + '.graceTransportNotLive', example)
      }
    } else if (entry.phase === 'stable') {
      categories.ownerless++
      if (mode !== 'idle') addExample(ctx, listPrefix + '.transportWithoutOwners', example)
      else if (runtime) addExample(ctx, listPrefix + '.runtimeWithoutOwners', example)
      else addExample(ctx, listPrefix + '.emptyEntry', example)
    }
    if (entry.phase === 'stable' && !entry.reconcilePromise) {
      const desired = targetModeOf(manager, transportHash)
      if (desired !== mode) {
        divergent++
        addExample(ctx, listPrefix + '.divergent', { ...example, desired, grace: (entry.owners.size === 0 && entry.pendingDestroyByOwner.size > 0) || undefined })
      }
    }
  }
  const ownerStats = collectOwnerRecords(ctx, manager, listPrefix, record => record.transportHash)
  return {
    entries: manager.entries.size,
    runtimes,
    owners,
    pendingDestroys,
    stalePendingDestroys,
    oldestPendingDestroyMs,
    divergent,
    graceTransportNotLive,
    categories,
    materializedDocSignals: docSignals,
    attachedRoots,
    results,
    byMode: sortDict(byMode),
    byPhase: sortDict(byPhase),
    byCollection: topN(byCollection, ctx.top),
    ownerRecords: ownerStats,
    trackedOwnerTokens: getTrackedOwnerTokenCount(manager)
  }
}

// ---------------- root contexts ----------------

function collectRoots (ctx: Ctx): AnyRecord {
  const ownersByRoot = new Map<string, { doc: number, query: number, aggregation: number }>()
  const queryOwnerKeys = new Set<string>()
  const aggregationOwnerKeys = new Set<string>()
  const countOwners = (manager: AnyRecord, kind: 'doc' | 'query' | 'aggregation', keys?: Set<string>): void => {
    for (const record of (manager.ownerRecords as Map<string, AnyRecord>).values()) {
      const rootId = normalizeRoot(record.rootId)
      let counts = ownersByRoot.get(rootId)
      if (!counts) ownersByRoot.set(rootId, counts = { doc: 0, query: 0, aggregation: 0 })
      counts[kind]++
      if (keys && record.transportHash) keys.add(rootId + '\u0000' + record.transportHash)
    }
  }
  countOwners(docSubscriptions as AnyRecord, 'doc')
  countOwners(querySubscriptions as AnyRecord, 'query', queryOwnerKeys)
  countOwners(aggregationSubscriptions as AnyRecord, 'aggregation', aggregationOwnerKeys)
  addAttachedRoots(querySubscriptions as AnyRecord, queryOwnerKeys)
  addAttachedRoots(aggregationSubscriptions as AnyRecord, aggregationOwnerKeys)

  const list: AnyRecord[] = []
  let count = 0
  let signalHashes = 0
  let staleSignalHashes = 0
  let privateQueries = 0
  let privateAggregations = 0
  let localValues = 0
  for (const context of getRootContexts()) {
    count++
    const rootId = context.rootId
    let stale = 0
    for (const hash of context.signalHashes) {
      if (SIGNALS_CACHE.get(hash) === undefined) stale++
    }
    signalHashes += context.signalHashes.size
    staleSignalHashes += stale
    const raw = context.getPrivateDataRawRoot() as AnyRecord
    const privateKeys: Dict = {}
    for (const key of Object.keys(raw)) {
      const value = raw[key]
      privateKeys[key] = value && typeof value === 'object' ? Object.keys(value).length : 1
    }
    const queriesData = raw[QUERIES] && typeof raw[QUERIES] === 'object' ? Object.keys(raw[QUERIES]) : []
    const aggregationsData = raw[AGGREGATIONS] && typeof raw[AGGREGATIONS] === 'object' ? Object.keys(raw[AGGREGATIONS]) : []
    privateQueries += queriesData.length
    privateAggregations += aggregationsData.length
    localValues += privateKeys.$local || 0
    for (const hash of queriesData) {
      if (!queryOwnerKeys.has(rootId + '\u0000' + hash)) {
        addExample(ctx, 'roots.orphanQueryData', { rootId, hash: truncate(hash) })
      }
    }
    for (const hash of aggregationsData) {
      if (!aggregationOwnerKeys.has(rootId + '\u0000' + hash)) {
        addExample(ctx, 'roots.orphanAggregationData', { rootId, hash: truncate(hash) })
      }
    }
    let directDocCount = 0
    for (const entry of context.directDocSubscriptions.values()) directDocCount += entry.count
    const owners = ownersByRoot.get(rootId) || { doc: 0, query: 0, aggregation: 0 }
    const item: AnyRecord = {
      rootId,
      global: rootId === GLOBAL_ROOT_ID,
      fetchOnly: context.getFetchOnly(),
      signalHashes: context.signalHashes.size,
      staleSignalHashes: stale,
      queryRuntimes: context.queryRuntimeHashes.size,
      aggregationRuntimes: context.aggregationRuntimeHashes.size,
      directDocSubscriptions: context.directDocSubscriptions.size,
      directDocSubscriptionCount: directDocCount,
      owners,
      private: privateKeys
    }
    if (ctx.sizes) item.privateBytes = approximateBytes(raw)
    list.push(item)
  }
  list.sort((a, b) => weightOfRoot(b) - weightOfRoot(a))
  ctx.lists['roots.list'] = list.slice(0, ctx.limit)
  const ownerRootsWithoutContext: string[] = []
  const liveRootIds = new Set(list.map(item => item.rootId))
  for (const rootId of ownersByRoot.keys()) {
    if (!liveRootIds.has(rootId) && rootId !== GLOBAL_ROOT_ID) ownerRootsWithoutContext.push(rootId)
  }
  return {
    count,
    closedRemembered: getClosedRootContextCount(),
    pendingDisposes: getPendingRootDisposeCount(),
    signalHashes,
    staleSignalHashes,
    privateQueries,
    privateAggregations,
    localValues,
    ownerRootsWithoutContext: ownerRootsWithoutContext.length,
    largest: list.slice(0, Math.min(ctx.top, 10)).map(item => ({
      rootId: item.rootId,
      signalHashes: item.signalHashes,
      staleSignalHashes: item.staleSignalHashes,
      owners: item.owners,
      private: item.private
    }))
  }
}

function addAttachedRoots (manager: AnyRecord, keys: Set<string>): void {
  for (const [transportHash, entry] of manager.entries as Map<string, AnyRecord>) {
    for (const rootId of entry.runtime?.rootIds || []) keys.add(normalizeRoot(rootId) + '\u0000' + transportHash)
  }
}

function weightOfRoot (item: AnyRecord): number {
  const owners = item.owners || {}
  return (item.signalHashes || 0) + (owners.doc || 0) + (owners.query || 0) + (owners.aggregation || 0) +
    (item.directDocSubscriptions || 0) + (item.global ? 1e9 : 0)
}

function approximateBytes (value: unknown): number | undefined {
  try {
    return JSON.stringify(value)?.length
  } catch {
    return undefined
  }
}

// ---------------- finalization registries ----------------

function collectFinalization (): AnyRecord {
  const registries = getAllFinalizationRegistryStats().map(stats => ({
    ...stats,
    // Only exact when diagnostics were enabled before teamplay loaded.
    liveEstimate: stats.registered - stats.unregistered - stats.finalized
  }))
  return {
    implementation: getFinalizationRegistryImplementation(),
    exact: diag.enabledAtStartup,
    registries
  }
}

// ---------------- data tree ----------------

function collectDataTree (ctx: Ctx): AnyRecord {
  const tree = dataTreeRaw as AnyRecord
  const byCollection: Dict = {}
  let docs = 0
  let collections = 0
  let orphanDocs = 0
  const orphansByCollection: Dict = {}
  const entries = (docSubscriptions as AnyRecord).entries as Map<string, AnyRecord>
  for (const collection of Object.keys(tree)) {
    const docsMap = tree[collection]
    if (!docsMap || typeof docsMap !== 'object') continue
    collections++
    const ids = Object.keys(docsMap)
    docs += ids.length
    byCollection[collection] = ids.length
    for (const id of ids) {
      if (entries.has(JSON.stringify([collection, id]))) continue
      orphanDocs++
      inc(orphansByCollection, collection)
      addExample(ctx, 'dataTree.orphanDocs', { collection, id })
    }
  }
  return {
    collections,
    docs,
    orphanDocs,
    byCollection: topN(byCollection, ctx.top),
    orphansByCollection: topN(orphansByCollection, ctx.top)
  }
}

// ---------------- ShareDB connection ----------------

function collectConnection (ctx: Ctx): AnyRecord {
  const conn = connection as AnyRecord | undefined
  if (!conn) return { present: false }
  const docEntries = (docSubscriptions as AnyRecord).entries as Map<string, AnyRecord>
  const docsByCollection: Dict = {}
  const untracked: Dict = { subscribed: 0, pending: 0, phantom: 0, loaded: 0 }
  let total = 0
  let subscribed = 0
  let wantSubscribe = 0
  let pendingOps = 0
  let inflightOps = 0
  let inflightFetch = 0
  let pendingFetch = 0
  let inflightSubscribe = 0
  let neverLoaded = 0
  let missing = 0
  const collections = (conn.collections || {}) as Record<string, Record<string, AnyRecord>>
  for (const collection of Object.keys(collections)) {
    const docs = collections[collection]
    for (const id of Object.keys(docs)) {
      const doc = docs[id]
      if (!doc) continue
      total++
      inc(docsByCollection, collection)
      if (doc.subscribed) subscribed++
      if (doc.wantSubscribe) wantSubscribe++
      pendingOps += doc.pendingOps?.length || 0
      if (doc.inflightOp) inflightOps++
      inflightFetch += doc.inflightFetch?.length || 0
      pendingFetch += doc.pendingFetch?.length || 0
      if (doc.inflightSubscribe) inflightSubscribe++
      if (doc.version == null) neverLoaded++
      else if (doc.type == null) missing++
      if (docEntries.has(JSON.stringify([collection, id]))) continue
      const hasPending = typeof doc.hasPending === 'function' ? doc.hasPending() : false
      const example = { collection, id, subscribed: !!doc.subscribed, wantSubscribe: !!doc.wantSubscribe, version: doc.version, hasPending }
      if (doc.subscribed || doc.wantSubscribe) {
        untracked.subscribed++
        addExample(ctx, 'connection.untrackedSubscribedDocs', example)
      } else if (hasPending) {
        untracked.pending++
        addExample(ctx, 'connection.untrackedPendingDocs', example)
      } else if (doc.version == null && doc.data === undefined) {
        untracked.phantom++
        addExample(ctx, 'connection.phantomDocs', example)
      } else {
        untracked.loaded++
        addExample(ctx, 'connection.untrackedLoadedDocs', example)
      }
    }
  }

  const trackedShareQueries = new Set<unknown>()
  for (const manager of [querySubscriptions, aggregationSubscriptions] as AnyRecord[]) {
    for (const entry of (manager.entries as Map<string, AnyRecord>).values()) {
      if (entry.runtime?.shareQuery) trackedShareQueries.add(entry.runtime.shareQuery)
    }
  }
  const queriesByAction: Dict = {}
  const queriesByCollection: Dict = {}
  let queries = 0
  let untrackedQueries = 0
  for (const query of Object.values((conn.queries || {}) as Record<string, AnyRecord>)) {
    if (!query) continue
    queries++
    inc(queriesByAction, String(query.action))
    inc(queriesByCollection, String(query.collection))
    if (!trackedShareQueries.has(query)) {
      untrackedQueries++
      addExample(ctx, 'connection.untrackedQueries', {
        id: query.id,
        action: query.action,
        collection: query.collection,
        query: truncate(safeStringify(query.query)),
        ready: query.ready
      })
    }
  }

  const result: AnyRecord = {
    present: true,
    state: conn.state,
    canSend: conn.canSend,
    id: conn.id ?? undefined,
    docs: {
      total,
      subscribed,
      wantSubscribe,
      pendingOps,
      inflightOps,
      inflightFetch,
      pendingFetch,
      inflightSubscribe,
      neverLoaded,
      missing,
      untracked,
      byCollection: topN(docsByCollection, ctx.top)
    },
    queries: {
      total: queries,
      untracked: untrackedQueries,
      byAction: queriesByAction,
      byCollection: topN(queriesByCollection, ctx.top)
    },
    presences: conn._presences ? Object.keys(conn._presences).length : undefined,
    snapshotRequests: conn._snapshotRequests ? Object.keys(conn._snapshotRequests).length : undefined
  }
  const agent = conn.agent as AnyRecord | undefined
  const backend = agent?.backend as AnyRecord | undefined
  if (backend) {
    result.server = {
      agentsCount: backend.agentsCount,
      pubsubStreams: backend.pubsub?.streamsCount,
      pubsubChannels: backend.pubsub?.streams ? Object.keys(backend.pubsub.streams).length : undefined,
      agentSubscribedDocs: countNested(agent?.subscribedDocs),
      agentSubscribedQueries: agent?.subscribedQueries ? Object.keys(agent.subscribedQueries).length : undefined,
      agentClosed: agent?.closed
    }
  }
  return result
}

function countNested (map: AnyRecord | undefined): number | undefined {
  if (!map) return undefined
  let total = 0
  for (const key of Object.keys(map)) {
    const value = map[key]
    total += value && typeof value === 'object' ? Object.keys(value).length : 1
  }
  return total
}

function safeStringify (value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

// ---------------- React layer ----------------

function collectReact (ctx: Ctx): AnyRecord {
  const at = ctx.takenAt
  // leases
  const leaseStats = { tracked: 0, committed: 0, uncommitted: 0, staleUncommitted: 0, pending: 0, collectedWithoutRelease: 0, oldestUncommittedMs: undefined as number | undefined }
  for (const meta of leases.values()) {
    leaseStats.tracked++
    const lease = meta.ref.deref() as AnyRecord | undefined
    const ageMs = at - meta.createdAt
    if (!lease) {
      leaseStats.collectedWithoutRelease++
      addExample(ctx, 'react.leasesCollectedWithoutRelease', { id: meta.id, desc: meta.desc, ageMs })
      continue
    }
    const pending = isThenable(lease.value)
    if (pending) leaseStats.pending++
    if (lease.committed) leaseStats.committed++
    else {
      leaseStats.uncommitted++
      leaseStats.oldestUncommittedMs = maxOf(leaseStats.oldestUncommittedMs, ageMs)
      const example = { id: meta.id, desc: meta.desc, hook: meta.hookKey, ageMs, pending }
      addExample(ctx, 'react.uncommittedLeases', example)
      if (ageMs > ctx.thresholds.uncommittedLeaseMaxAgeMs) {
        leaseStats.staleUncommitted++
        addExample(ctx, 'react.staleUncommittedLeases', example)
      }
    }
  }
  // adms (observer wrapper state)
  const admStats = {
    tracked: 0,
    subscribed: 0,
    neverSubscribed: 0,
    staleNeverSubscribed: 0,
    oldestNeverSubscribedMs: undefined as number | undefined,
    collectedWithoutDestroy: 0,
    cacheEntries: 0,
    cacheKeys: { subscriptionLease: 0, suspendMemo: 0, other: 0 } as Dict,
    destroyCallbacks: 0,
    pendingDestroyTimers: 0
  }
  const mountedComponentIds = new Set<string>()
  const trackedComponentIds = new Set<string>()
  for (const meta of adms.values()) {
    admStats.tracked++
    if (meta.componentId) trackedComponentIds.add(meta.componentId)
    const adm = meta.ref.deref() as AnyRecord | undefined
    if (!adm) {
      admStats.collectedWithoutDestroy++
      continue
    }
    if (meta.subscribedAt != null) {
      admStats.subscribed++
      if (meta.componentId) mountedComponentIds.add(meta.componentId)
    } else {
      admStats.neverSubscribed++
      const ageMs = at - meta.createdAt
      admStats.oldestNeverSubscribedMs = maxOf(admStats.oldestNeverSubscribedMs, ageMs)
      const example = { id: meta.id, name: meta.name, ageMs, cacheEntries: adm.cache?.size }
      addExample(ctx, 'react.neverSubscribedAdms', example)
      if (ageMs > ctx.thresholds.neverSubscribedMaxAgeMs) {
        admStats.staleNeverSubscribed++
        addExample(ctx, 'react.staleNeverSubscribedAdms', example)
      }
    }
    if (adm.destroyTimer) admStats.pendingDestroyTimers++
    admStats.destroyCallbacks += adm.cacheDestroyCallbacks?.size || 0
    if (adm.cache) {
      admStats.cacheEntries += adm.cache.size
      for (const key of adm.cache.keys()) {
        const k = String(key)
        if (k.startsWith('subscriptionLease:')) admStats.cacheKeys.subscriptionLease++
        else if (k.startsWith('suspendMemo:')) admStats.cacheKeys.suspendMemo++
        else admStats.cacheKeys.other++
      }
    }
  }
  // observer reactions
  // A reaction belongs to the observer wrapper (adm) with the same componentId.
  //  - orphaned: no live wrapper with that id any more (the wrapper was destroyed
  //    or collected) but the reaction is still alive -> it was created by a render
  //    React discarded (StrictMode double render, abandoned mount) and stays
  //    connected to the observables it read.
  //  - extra: more than one live reaction for one mounted wrapper.
  //  - unmounted: the wrapper exists but never mounted, older than the threshold.
  const liveAdmIds = new Set<string>()
  for (const meta of adms.values()) {
    if (meta.componentId && meta.ref.deref()) liveAdmIds.add(meta.componentId)
  }
  const observerStats = {
    tracked: 0,
    collectedWithoutDestroy: 0,
    orphaned: 0,
    extra: 0,
    withoutMountedWrapper: 0,
    staleWithoutMountedWrapper: 0,
    oldestWithoutMountedWrapperMs: undefined as number | undefined,
    byName: {} as Dict
  }
  const liveByMountedComponent = new Map<string, number>()
  for (const meta of observers.values()) {
    observerStats.tracked++
    if (!meta.ref.deref()) {
      observerStats.collectedWithoutDestroy++
      continue
    }
    inc(observerStats.byName, meta.name)
    const ageMs = at - meta.createdAt
    if (!meta.componentId || !seenAdmComponentIds.has(meta.componentId)) continue
    if (!liveAdmIds.has(meta.componentId)) {
      observerStats.orphaned++
      addExample(ctx, 'react.orphanObservers', { id: meta.id, name: meta.name, ageMs })
    } else if (mountedComponentIds.has(meta.componentId)) {
      liveByMountedComponent.set(meta.componentId, (liveByMountedComponent.get(meta.componentId) || 0) + 1)
    } else {
      observerStats.withoutMountedWrapper++
      observerStats.oldestWithoutMountedWrapperMs = maxOf(observerStats.oldestWithoutMountedWrapperMs, ageMs)
      addExample(ctx, 'react.unmountedObservers', { id: meta.id, name: meta.name, ageMs })
      if (ageMs > ctx.thresholds.neverSubscribedMaxAgeMs) {
        observerStats.staleWithoutMountedWrapper++
        addExample(ctx, 'react.staleUnmountedObservers', { id: meta.id, name: meta.name, ageMs })
      }
    }
  }
  for (const [componentId, liveCount] of liveByMountedComponent) {
    if (liveCount <= 1) continue
    observerStats.extra += liveCount - 1
    addExample(ctx, 'react.extraObservers', { componentId, live: liveCount })
  }
  observerStats.byName = topN(observerStats.byName, ctx.top)
  // standalone reaction() handles
  let reactionsAlive = 0
  let reactionsCollected = 0
  for (const meta of reactions.values()) {
    if (meta.ref.deref()) reactionsAlive++
    else reactionsCollected++
  }
  // pollers
  const pollerByKind: Dict = {}
  let oldestPollerMs: number | undefined
  let stalePollers = 0
  for (const meta of pollers.values()) {
    inc(pollerByKind, meta.kind)
    const ageMs = at - meta.startedAt
    oldestPollerMs = maxOf(oldestPollerMs, ageMs)
    const example = { id: meta.id, kind: meta.kind, desc: meta.desc, ageMs }
    addExample(ctx, 'react.pollers', example)
    if (ageMs > ctx.thresholds.pollerMaxAgeMs) {
      stalePollers++
      addExample(ctx, 'react.stalePollers', example)
    }
  }
  return {
    leases: {
      ...leaseStats,
      churnByDesc: topN(mapToDict(leaseChurnByDesc), ctx.top),
      churnByHook: topN(filterDict(mapToDict(leaseChurnByHook), value => value > 1), ctx.top)
    },
    adms: { ...admStats, churnByName: topN(mapToDict(admChurnByName), ctx.top) },
    observers: observerStats,
    reactions: { alive: reactionsAlive, collectedWithoutDispose: reactionsCollected },
    pollers: { active: pollers.size, stale: stalePollers, oldestMs: oldestPollerMs, byKind: pollerByKind },
    suspendMemoInFlight: __getSuspendMemoInFlightCount(),
    promiseBatcher: getPromiseBatcherState(),
    renderAttemptDestroyer: { suspenseGateArmed: renderAttemptDestroyer.suspenseGateArmed },
    localValues: valueSubscriptions.initialized.size,
    localReactions: reactionSubscriptions.initialized.size,
    eventListeners: __getListenerCountsForDiagnostics(),
    batchScheduler: __getBatchSchedulerState(),
    debugCounters: { ...(DEBUG as Dict) }
  }
}

function mapToDict (map: Map<string, number>): Dict {
  const result: Dict = {}
  for (const [key, value] of map) result[key] = value
  return result
}

function filterDict (dict: Dict, predicate: (value: number) => boolean): Dict {
  const result: Dict = {}
  for (const key of Object.keys(dict)) if (predicate(dict[key])) result[key] = dict[key]
  return result
}

function isThenable (value: unknown): boolean {
  return !!value &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
}

// ---------------- sub()/unsub() ----------------

function collectSub (ctx: Ctx): AnyRecord {
  let oldestMs: number | undefined
  let stale = 0
  const byKind: Dict = {}
  for (const meta of pendingUnsubs.values()) {
    inc(byKind, meta.kind)
    const ageMs = ctx.takenAt - meta.startedAt
    oldestMs = maxOf(oldestMs, ageMs)
    const example = { kind: meta.kind, key: truncate(meta.key ?? ''), intent: meta.intent, ageMs }
    addExample(ctx, 'sub.pendingUnsubs', example)
    if (ageMs > ctx.thresholds.pendingUnsubMaxAgeMs) {
      stale++
      addExample(ctx, 'sub.stalePendingUnsubs', example)
    }
  }
  return {
    pendingUnsubs: { count: pendingUnsubs.size, stale, oldestMs, byKind },
    incidents: getIncidents().length
  }
}

export function getListCount (collected: Collected, list: string): number {
  return collected.lists[list + '#count']?.[0]?.count ?? 0
}
