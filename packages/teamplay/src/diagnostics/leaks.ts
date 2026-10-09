import { collect, getListCount, type Collected, type CollectOptions } from './collect.ts'
import { getIncidents } from './state.ts'

export type Severity = 'error' | 'warn' | 'info'

export interface Finding {
  code: string
  severity: Severity
  count: number
  message: string
  examples: Array<Record<string, unknown>>
}

export interface CheckLeaksOptions extends CollectOptions {
  /** Finding codes to skip (exact code or prefix ending with '*'). */
  ignore?: string[]
  /** Collections whose examples are ignored (e.g. ['_session', 'auditLogs']). */
  ignoreCollections?: string[]
  /** Per-root signal hashes that are no longer in the signal cache before it is reported. */
  staleSignalHashesThreshold?: number
  /** Treat dead weak refs in the signal cache as a problem (meaningful right after forceGc()). */
  afterGc?: boolean
}

export interface LeakReport {
  ok: boolean
  takenAt: number
  errors: number
  warnings: number
  findings: Finding[]
}

interface Rule {
  code: string
  list: string
  severity: Severity
  message: string
}

const RULES: Rule[] = [
  // transport / ownership
  { code: 'docs.transportWithoutOwners', list: 'docs.transportWithoutOwners', severity: 'error', message: 'Doc transports are subscribed/fetched with zero owners and no pending destroy; nothing will ever close them.' },
  { code: 'docs.runtimeWithoutOwners', list: 'docs.runtimeWithoutOwners', severity: 'error', message: 'Doc runtimes keep materialized data with zero owners, no query retain and no pending destroy.' },
  { code: 'docs.emptyEntry', list: 'docs.emptyEntry', severity: 'warn', message: 'Empty doc manager entries that were never deleted.' },
  { code: 'docs.divergent', list: 'docs.divergent', severity: 'error', message: 'Doc transport mode differs from its target while the entry is stable and no reconcile is in flight (lost wakeup).' },
  { code: 'docs.stalePendingDestroy', list: 'docs.stalePendingDestroy', severity: 'error', message: 'Doc destroys pending longer than gcDelay + slack.' },
  { code: 'docs.graceTransportNotLive', list: 'docs.graceTransportNotLive', severity: 'error', message: 'Docs lingering in their GC grace as live subscriptions whose ShareDB doc is not subscribed; a new owner would adopt data that no longer updates.' },
  { code: 'docs.ownersOfClosedRoots', list: 'docs.ownersOfClosedRoots', severity: 'error', message: 'Doc owner records belong to roots that were already closed.' },
  { code: 'docs.ownersOfMissingRoots', list: 'docs.ownersOfMissingRoots', severity: 'error', message: 'Doc owner records belong to roots without a root context.' },
  { code: 'docs.zeroCountOwners', list: 'docs.zeroCountOwners', severity: 'warn', message: 'Doc owner records with zero counts and no pending destroy.' },
  { code: 'queries.transportWithoutOwners', list: 'queries.transportWithoutOwners', severity: 'error', message: 'Query transports are live with zero owners and no pending destroy.' },
  { code: 'queries.runtimeWithoutOwners', list: 'queries.runtimeWithoutOwners', severity: 'error', message: 'Query runtimes (and their retained result docs) with zero owners and no pending destroy.' },
  { code: 'queries.emptyEntry', list: 'queries.emptyEntry', severity: 'warn', message: 'Empty query manager entries that were never deleted.' },
  { code: 'queries.divergent', list: 'queries.divergent', severity: 'error', message: 'Query transport mode differs from its target while stable (lost wakeup).' },
  { code: 'queries.stalePendingDestroy', list: 'queries.stalePendingDestroy', severity: 'error', message: 'Query destroys pending longer than gcDelay + slack.' },
  { code: 'queries.graceTransportNotLive', list: 'queries.graceTransportNotLive', severity: 'error', message: 'Queries lingering in their GC grace as live subscriptions whose ShareDB query is not subscribed; a new owner would adopt results that no longer update.' },
  { code: 'queries.ownersOfClosedRoots', list: 'queries.ownersOfClosedRoots', severity: 'error', message: 'Query owner records belong to closed roots.' },
  { code: 'queries.ownersOfMissingRoots', list: 'queries.ownersOfMissingRoots', severity: 'error', message: 'Query owner records belong to roots without a root context.' },
  { code: 'queries.zeroCountOwners', list: 'queries.zeroCountOwners', severity: 'warn', message: 'Query owner records with zero counts and no pending destroy.' },
  { code: 'aggregations.transportWithoutOwners', list: 'aggregations.transportWithoutOwners', severity: 'error', message: 'Aggregation transports are live with zero owners and no pending destroy.' },
  { code: 'aggregations.runtimeWithoutOwners', list: 'aggregations.runtimeWithoutOwners', severity: 'error', message: 'Aggregation runtimes with zero owners and no pending destroy.' },
  { code: 'aggregations.emptyEntry', list: 'aggregations.emptyEntry', severity: 'warn', message: 'Empty aggregation manager entries that were never deleted.' },
  { code: 'aggregations.divergent', list: 'aggregations.divergent', severity: 'error', message: 'Aggregation transport mode differs from its target while stable (lost wakeup).' },
  { code: 'aggregations.stalePendingDestroy', list: 'aggregations.stalePendingDestroy', severity: 'error', message: 'Aggregation destroys pending longer than gcDelay + slack.' },
  { code: 'aggregations.graceTransportNotLive', list: 'aggregations.graceTransportNotLive', severity: 'error', message: 'Aggregations lingering in their GC grace as live subscriptions whose ShareDB query is not subscribed; a new owner would adopt rows that no longer update.' },
  { code: 'aggregations.ownersOfClosedRoots', list: 'aggregations.ownersOfClosedRoots', severity: 'error', message: 'Aggregation owner records belong to closed roots.' },
  { code: 'aggregations.ownersOfMissingRoots', list: 'aggregations.ownersOfMissingRoots', severity: 'error', message: 'Aggregation owner records belong to roots without a root context.' },
  { code: 'aggregations.zeroCountOwners', list: 'aggregations.zeroCountOwners', severity: 'warn', message: 'Aggregation owner records with zero counts and no pending destroy.' },
  // root private state
  { code: 'roots.orphanQueryData', list: 'roots.orphanQueryData', severity: 'error', message: 'Root $queries materializations without an owner or attached runtime.' },
  { code: 'roots.orphanAggregationData', list: 'roots.orphanAggregationData', severity: 'error', message: 'Root $aggregations materializations without an owner or attached runtime.' },
  // ShareDB connection
  { code: 'connection.untrackedSubscribedDocs', list: 'connection.untrackedSubscribedDocs', severity: 'error', message: 'ShareDB docs are subscribed on the connection but not tracked by the doc manager (server keeps streaming ops).' },
  { code: 'connection.untrackedQueries', list: 'connection.untrackedQueries', severity: 'error', message: 'ShareDB queries on the connection are not owned by any query/aggregation runtime.' },
  { code: 'connection.untrackedLoadedDocs', list: 'connection.untrackedLoadedDocs', severity: 'warn', message: 'Loaded ShareDB docs that no manager tracks (e.g. created/written without a subscription); they stay in connection.collections forever.' },
  { code: 'connection.phantomDocs', list: 'connection.phantomDocs', severity: 'warn', message: 'Empty ShareDB docs created by connection.get() probes (never fetched); they stay in connection.collections forever.' },
  { code: 'connection.untrackedPendingDocs', list: 'connection.untrackedPendingDocs', severity: 'info', message: 'Untracked ShareDB docs with ops in flight.' },
  // data tree
  { code: 'dataTree.orphanDocs', list: 'dataTree.orphanDocs', severity: 'warn', message: 'Docs in the public data tree without a doc manager entry (no subscription, no query retain).' },
  // React
  { code: 'react.staleUncommittedLeases', list: 'react.staleUncommittedLeases', severity: 'error', message: 'useSub() leases that never committed and were not released.' },
  { code: 'react.leasesCollectedWithoutRelease', list: 'react.leasesCollectedWithoutRelease', severity: 'error', message: 'useSub() leases were garbage collected without being released (their subscription count leaked).' },
  { code: 'react.stalePollers', list: 'react.stalePollers', severity: 'error', message: 'Readiness polling loops running longer than the threshold.' },
  { code: 'react.staleNeverSubscribedAdms', list: 'react.staleNeverSubscribedAdms', severity: 'warn', message: 'observer() wrappers that rendered but never mounted; their cache (leases, $() values) is only released by GC.' },
  { code: 'react.staleUnmountedObservers', list: 'react.staleUnmountedObservers', severity: 'warn', message: 'observer() reactions from renders that never committed; they stay connected to the observables they read.' },
  { code: 'react.orphanObservers', list: 'react.orphanObservers', severity: 'warn', message: 'observer() reactions still alive after their wrapper was destroyed (created by a render React discarded, e.g. StrictMode double render); never unobserved, they stay connected to the observables they read.' },
  { code: 'react.extraObservers', list: 'react.extraObservers', severity: 'warn', message: 'More than one live observer() reaction for one mounted component (the extra ones come from discarded renders).' },
  // sub()
  { code: 'sub.stalePendingUnsubs', list: 'sub.stalePendingUnsubs', severity: 'warn', message: 'unsub() promises pending longer than gcDelay + slack.' },
  // signals
  { code: 'signals.dead', list: 'signals.dead', severity: 'info', message: 'Signal cache entries whose weak ref is dead but the FinalizationRegistry has not evicted them yet.' }
]

const INCIDENT_SEVERITY: Record<string, Severity> = {
  'doc.fr.liveOwnerWiped': 'error',
  'query.fr.liveOwnerWiped': 'error',
  'aggregation.fr.liveOwnerWiped': 'error',
  'doc.unsubscribe.intentMismatch': 'warn',
  'query.unsubscribe.intentMismatch': 'warn',
  'aggregation.unsubscribe.intentMismatch': 'warn',
  'sub.unsub.mixedIntents': 'info',
  'react.lease.reacquireLoop': 'warn'
}

const INCIDENT_MESSAGES: Record<string, string> = {
  'doc.fr.liveOwnerWiped': 'A FinalizationRegistry callback force-destroyed a doc owner key that a live signal still owned.',
  'query.fr.liveOwnerWiped': 'A FinalizationRegistry callback force-destroyed a query owner key that a live signal still owned.',
  'aggregation.fr.liveOwnerWiped': 'A FinalizationRegistry callback force-destroyed an aggregation owner key that a live signal still owned.',
  'doc.unsubscribe.intentMismatch': 'unsubscribe() with an intent the owner does not hold while it holds the other intent (counts leak).',
  'query.unsubscribe.intentMismatch': 'Query unsubscribe() with an intent the owner does not hold while it holds the other intent.',
  'aggregation.unsubscribe.intentMismatch': 'Aggregation unsubscribe() with an intent the owner does not hold while it holds the other intent.',
  'sub.unsub.mixedIntents': 'unsub() without { mode } on a signal holding both fetch and subscribe records; a fetch record was released (pass { mode } to choose).',
  'react.lease.reacquireLoop': 'A useSub() hook kept re-acquiring the same target from uncommitted render attempts (a release/re-subscribe loop); its uncommitted lease is now kept until commit or unmount. Look for a re-subscribe that cannot join the released transport synchronously.'
}

export function checkLeaks (options: CheckLeaksOptions = {}): LeakReport {
  const collected = collect({ limit: 20, ...options })
  return evaluate(collected, options)
}

export function evaluate (collected: Collected, options: CheckLeaksOptions = {}): LeakReport {
  const findings: Finding[] = []
  const ignored = (code: string): boolean => !!options.ignore?.some(pattern =>
    pattern.endsWith('*') ? code.startsWith(pattern.slice(0, -1)) : code === pattern
  )
  const ignoreCollections = new Set(options.ignoreCollections || [])
  const filterExamples = (examples: Array<Record<string, unknown>>): Array<Record<string, unknown>> => {
    if (ignoreCollections.size === 0) return examples
    return examples.filter(example => !ignoreCollections.has(exampleCollection(example) ?? ''))
  }

  for (const rule of RULES) {
    if (ignored(rule.code)) continue
    let severity = rule.severity
    if (rule.code === 'signals.dead' && options.afterGc) severity = 'warn'
    const total = getListCount(collected, rule.list)
    if (total === 0) continue
    const examples = filterExamples(collected.lists[rule.list] || [])
    // When collections are ignored, only report if some example survived the filter
    // or the list was truncated (we can't know the rest).
    const truncated = total > (collected.lists[rule.list]?.length ?? 0)
    if (ignoreCollections.size > 0 && examples.length === 0 && !truncated) continue
    findings.push({ code: rule.code, severity, count: total, message: rule.message, examples })
  }

  // per-root stale signal hashes (signals collected but their hash kept in the root context)
  const threshold = options.staleSignalHashesThreshold ?? 1000
  const roots = (collected.lists['roots.list'] || []).filter(root => (root.staleSignalHashes as number) > threshold)
  if (roots.length > 0 && !ignored('roots.staleSignalHashes')) {
    findings.push({
      code: 'roots.staleSignalHashes',
      severity: 'warn',
      count: roots.length,
      message: `Roots remember more than ${threshold} signal hashes whose signals were already collected (the per-root set only shrinks on root dispose).`,
      examples: roots.map(root => ({ rootId: root.rootId, signalHashes: root.signalHashes, staleSignalHashes: root.staleSignalHashes }))
    })
  }

  // incidents recorded by hooks since the counters were reset
  const incidentsByCode = new Map<string, Array<Record<string, unknown>>>()
  for (const incident of getIncidents()) {
    let list = incidentsByCode.get(incident.code)
    if (!list) incidentsByCode.set(incident.code, list = [])
    list.push({ t: incident.t, key: incident.key, ...incident.data })
  }
  for (const [code, list] of incidentsByCode) {
    if (ignored(code)) continue
    findings.push({
      code,
      severity: INCIDENT_SEVERITY[code] ?? 'warn',
      count: list.length,
      message: INCIDENT_MESSAGES[code] ?? code,
      examples: list.slice(-20)
    })
  }

  // owners created by calling the managers directly instead of sub()
  const counters = collected.summary.counters || {}
  for (const kind of ['doc', 'query', 'aggregation']) {
    const code = kind + '.subscribe.bypassedSub'
    if (ignored(code)) continue
    const managerCount = counters[kind + '.subscribe'] || 0
    const subCount = (counters['sub.' + kind + '.subscribe'] || 0) + (counters['sub.' + kind + '.fetch'] || 0)
    const bypassed = managerCount - subCount
    if (bypassed <= 0) continue
    findings.push({
      code,
      severity: 'warn',
      count: bypassed,
      message: `${kind} subscriptions were created without sub() (no matching unsub()); they are released only when their signal is garbage collected. Trace '${kind}.subscribe' with stacks to find the caller.`,
      examples: []
    })
  }

  // informational: closed root ids are remembered while their root signal is alive
  const closedRemembered = collected.summary.roots?.closedRemembered ?? 0
  if (closedRemembered > 0 && !ignored('roots.closedRemembered')) {
    findings.push({
      code: 'roots.closedRemembered',
      severity: 'info',
      count: closedRemembered,
      message: 'Closed roots whose root signal is still referenced (by the app or by one of their signals). Their ids stay closed until the root signal is garbage collected; a count that keeps growing means closed roots are being retained.',
      examples: []
    })
  }

  const order: Record<Severity, number> = { error: 0, warn: 1, info: 2 }
  findings.sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count)
  const errors = findings.filter(finding => finding.severity === 'error').length
  const warnings = findings.filter(finding => finding.severity === 'warn').length
  return { ok: errors === 0, takenAt: collected.takenAt, errors, warnings, findings }
}

function exampleCollection (example: Record<string, unknown>): string | undefined {
  if (typeof example.collection === 'string') return example.collection
  const key = (example.hash ?? example.key) as unknown
  if (typeof key !== 'string') return undefined
  try {
    const parsed = JSON.parse(key)
    if (Array.isArray(parsed)) return String(parsed[0])
    if (parsed?.query) return String(parsed.query[0])
  } catch {}
  return undefined
}

// ---------------- diff ----------------

export interface DiffChange {
  metric: string
  before: number
  after: number
  delta: number
}

export interface SnapshotDiff {
  from: number
  to: number
  elapsedMs: number
  changes: DiffChange[]
  grew: DiffChange[]
  shrank: DiffChange[]
}

export interface DiffOptions {
  /** Ignore changes with |delta| below this. Default 1. */
  minDelta?: number
  /** Only metrics starting with one of these prefixes. */
  include?: string[]
  /** Skip metrics starting with one of these prefixes. */
  exclude?: string[]
}

const SKIP_KEYS = new Set(['takenAt', 'enabledAt', 'version', 'thresholds', 'env', 'trace'])

export function flattenMetrics (value: unknown, prefix = '', out: Record<string, number> = {}): Record<string, number> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return out
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (!prefix && SKIP_KEYS.has(key)) continue
    if (key === 'details' || key === 'largest') continue
    const child = (value as Record<string, unknown>)[key]
    const path = prefix ? prefix + '.' + key : key
    if (typeof child === 'number' && Number.isFinite(child)) out[path] = child
    else if (child && typeof child === 'object' && !Array.isArray(child)) flattenMetrics(child, path, out)
  }
  return out
}

export function diff (a: Record<string, any>, b: Record<string, any>, options: DiffOptions = {}): SnapshotDiff {
  const minDelta = options.minDelta ?? 1
  const before = a.metrics ?? flattenMetrics(a)
  const after = b.metrics ?? flattenMetrics(b)
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const changes: DiffChange[] = []
  for (const metric of keys) {
    if (options.include && !options.include.some(prefix => metric.startsWith(prefix))) continue
    if (options.exclude?.some(prefix => metric.startsWith(prefix))) continue
    // "oldest*Ms" style ages always change; they are not growth signals.
    if (/(^|\.)(oldest\w*Ms|\w*AgeMs|totalMs|maxMs|avgMs)$/.test(metric)) continue
    const x = before[metric] ?? 0
    const y = after[metric] ?? 0
    const delta = y - x
    if (Math.abs(delta) < minDelta) continue
    changes.push({ metric, before: x, after: y, delta })
  }
  changes.sort((p, q) => Math.abs(q.delta) - Math.abs(p.delta))
  return {
    from: a.takenAt,
    to: b.takenAt,
    elapsedMs: (b.takenAt ?? 0) - (a.takenAt ?? 0),
    changes,
    grew: changes.filter(change => change.delta > 0),
    shrank: changes.filter(change => change.delta < 0)
  }
}
