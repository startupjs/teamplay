// Method instrumentation for the subscription managers and their runtime
// classes. Installed only while diagnostics are enabled, removed on disable,
// so a disabled runtime runs the original methods with zero overhead.
//
// The wrappers are installed as own properties on the manager instances (and
// on the runtime class prototypes). Managers call their own methods through
// `this.method(...)`, so internal calls (FinalizationRegistry callbacks,
// destroy timers, root disposal) are observed too. The wrappers never change
// arguments, return values or promise identity.
import { docSubscriptions } from '../orm/Doc.js'
import { querySubscriptions, hashQuery, HASH } from '../orm/Query.js'
import { aggregationSubscriptions } from '../orm/Aggregation.js'
import { SEGMENTS } from '../orm/signalSymbols.ts'
import { getRoot, ROOT_ID, GLOBAL_ROOT_ID } from '../orm/Root.ts'
import {
  diag,
  record,
  count,
  time,
  stamp,
  getStamp,
  addIncident,
  pendingUnsubs,
  weak,
  objectId,
  now
} from './state.ts'

type AnyFn = (this: any, ...args: any[]) => any
type Manager = any

interface Patch {
  target: Record<string, unknown>
  name: string
  hadOwn: boolean
  descriptor?: PropertyDescriptor
}

interface TokenRecord {
  ref: { deref: () => object | undefined }
  count: number
}

const patches: Patch[] = []
// manager -> ownerKey -> tokenId -> token record (WeakRef + subscribe count)
const ownerTokens = new WeakMap<object, Map<string, Map<number, TokenRecord>>>()
let nextPendingUnsubId = 1
// > 0 while a manager's releaseFinalizedToken() runs (see observeFinalizedRelease)
let finalizedReleaseDepth = 0

export function isInstrumented (): boolean {
  return patches.length > 0
}

export function installInstrumentation (): void {
  if (patches.length > 0) return
  instrumentDocManager(docSubscriptions, 'doc')
  instrumentQueryManager(querySubscriptions, 'query')
  instrumentQueryManager(aggregationSubscriptions, 'aggregation')
  instrumentDocRuntime((docSubscriptions as Manager).DocClass?.prototype)
  instrumentQueryRuntime(
    (querySubscriptions as Manager).QueryClass?.prototype,
    (aggregationSubscriptions as Manager).QueryClass
  )
}

export function uninstallInstrumentation (): void {
  for (let i = patches.length - 1; i >= 0; i--) {
    const { target, name, hadOwn, descriptor } = patches[i]
    if (hadOwn && descriptor) Object.defineProperty(target, name, descriptor)
    else delete target[name]
  }
  patches.length = 0
  for (const manager of [docSubscriptions, querySubscriptions, aggregationSubscriptions]) {
    ownerTokens.delete(manager as object)
  }
}

function patch (target: unknown, name: string, makeWrapper: (original: AnyFn) => AnyFn): void {
  if (!target || typeof target !== 'object') return
  const object = target as Record<string, unknown>
  const original = object[name]
  if (typeof original !== 'function') {
    // The method was renamed or removed. Instrumentation degrades instead of failing.
    count('diagnostics.patchMissing.' + name)
    return
  }
  const hadOwn = Object.prototype.hasOwnProperty.call(object, name)
  const descriptor = Object.getOwnPropertyDescriptor(object, name)
  Object.defineProperty(object, name, {
    value: makeWrapper(original as AnyFn),
    writable: true,
    configurable: true,
    enumerable: descriptor?.enumerable ?? false
  })
  patches.push({ target: object, name, hadOwn, descriptor })
}

// ---- helpers ----

export function isThenable (value: unknown): value is PromiseLike<unknown> {
  return !!value &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
}

function normalizeRoot (rootId: unknown): string {
  return rootId == null ? GLOBAL_ROOT_ID : String(rootId)
}

function signalRootId ($signal: any): string {
  return normalizeRoot(getRoot($signal)?.[ROOT_ID])
}

function docHash ($doc: any): string {
  return JSON.stringify($doc?.[SEGMENTS])
}

function entryMode (entry: any): string {
  if (!entry) return 'idle'
  return entry.runtime?.activeTransportMode ?? entry.mode ?? 'idle'
}

function safely (fn: () => void): void {
  try {
    fn()
  } catch (err) {
    count('diagnostics.error')
  }
}

// Owner keys are looked up through the manager's own records so the
// diagnostics never depend on the owner key format.
function findOwnerKey (manager: Manager, entryKey: string, rootId: string): string | undefined {
  const entry = manager.entries.get(entryKey)
  if (!entry) return undefined
  for (const ownerKey of entry.owners) {
    const ownerRecord = manager.ownerRecords.get(ownerKey)
    if (ownerRecord && normalizeRoot(ownerRecord.rootId) === rootId) return ownerKey
  }
  for (const [ownerKey, ownerRecord] of manager.ownerRecords) {
    const recordEntryKey = ownerRecord.hash ?? ownerRecord.transportHash
    if (recordEntryKey === entryKey && normalizeRoot(ownerRecord.rootId) === rootId) return ownerKey
  }
  return undefined
}

function getTokenMap (manager: Manager, ownerKey: string): Map<number, TokenRecord> {
  let byOwner = ownerTokens.get(manager)
  if (!byOwner) {
    byOwner = new Map()
    ownerTokens.set(manager, byOwner)
  }
  let tokens = byOwner.get(ownerKey)
  if (!tokens) {
    tokens = new Map()
    byOwner.set(ownerKey, tokens)
  }
  return tokens
}

function trackToken (manager: Manager, ownerKey: string | undefined, token: object, delta: number): void {
  if (!ownerKey || !token) return
  const tokens = getTokenMap(manager, ownerKey)
  const id = objectId(token)
  let tokenRecord = tokens.get(id)
  if (!tokenRecord) {
    if (delta <= 0) return
    tokenRecord = { ref: weak(token), count: 0 }
    tokens.set(id, tokenRecord)
  }
  tokenRecord.count += delta
  if (tokenRecord.count <= 0) tokens.delete(id)
  if (tokens.size === 0) ownerTokens.get(manager)?.delete(ownerKey)
}

function clearTokens (manager: Manager, ownerKey: string | undefined): void {
  if (!ownerKey) return
  ownerTokens.get(manager)?.delete(ownerKey)
}

export function getTrackedOwnerTokenCount (manager: Manager): number {
  let total = 0
  const byOwner = ownerTokens.get(manager)
  if (!byOwner) return 0
  for (const tokens of byOwner.values()) total += tokens.size
  return total
}

interface TrackedOwnerTokens {
  liveTokens: number
  liveCount: number
  deadCount: number
}

// Reads the diagnostics' own per-signal counts of an owner key and drops the
// records of collected signals.
function readTrackedOwnerTokens (manager: Manager, ownerKey: string): TrackedOwnerTokens {
  const state = { liveTokens: 0, liveCount: 0, deadCount: 0 }
  const tokens = ownerTokens.get(manager)?.get(ownerKey)
  if (!tokens) return state
  for (const [id, tokenRecord] of tokens) {
    if (tokenRecord.ref.deref() !== undefined) {
      state.liveTokens++
      state.liveCount += tokenRecord.count
    } else {
      state.deadCount += tokenRecord.count
      tokens.delete(id)
    }
  }
  if (tokens.size === 0) ownerTokens.get(manager)?.delete(ownerKey)
  return state
}

function getOwnerCount (manager: Manager, ownerKey: string): number {
  const ownerRecord = manager.ownerRecords.get(ownerKey)
  return ownerRecord ? (ownerRecord.fetchCount || 0) + (ownerRecord.subscribeCount || 0) : 0
}

// A finalizer released the counts of one collected signal (the managers'
// releaseFinalizedToken). That is legitimate as long as the live signals of the
// same owner key keep theirs: an owner left with fewer counts than its live
// signals hold means the release wiped a live subscription. The release
// finishes asynchronously, so it is tracked like a pending unsub() and
// waitForIdle() waits for it.
function observeFinalizedRelease (
  manager: Manager,
  kind: string,
  ownerKey: string,
  entryKey: string | undefined,
  original: AnyFn,
  args: IArguments
): unknown {
  let ownerCountBefore = 0
  safely(() => { ownerCountBefore = getOwnerCount(manager, ownerKey) })
  finalizedReleaseDepth++
  let result: unknown
  try {
    result = Reflect.apply(original, manager, args)
  } finally {
    finalizedReleaseDepth--
  }
  safely(() => {
    const { liveTokens, liveCount, deadCount } = readTrackedOwnerTokens(manager, ownerKey)
    const ownerCount = getOwnerCount(manager, ownerKey)
    record(kind + '.fr.ownerFinalized', entryKey, {
      released: ownerCountBefore - ownerCount,
      ownerCount,
      liveCount,
      deadCount,
      registry: diag.finalizing
    })
    if (liveCount > ownerCount) {
      addIncident(kind + '.fr.liveOwnerWiped', entryKey, { ownerCount, liveCount, liveTokens, deadCount })
    }
    if (!manager.ownerRecords.has(ownerKey)) clearTokens(manager, ownerKey)
    if (isThenable(result)) trackPendingUnsub(kind, entryKey ?? '', 'finalized', result, kind + '.fr.release')
  })
  return result
}

// Called when a FinalizationRegistry callback destroys an owner key directly
// instead of going through releaseFinalizedToken() (the managers no longer do
// that; this catches a regression). A forced destroy ends every count of the
// owner key, so any live signal holding counts under it loses its
// subscription.
function checkFinalizedOwner (manager: Manager, kind: string, ownerKey: string | undefined, entryKey: string | undefined): void {
  if (!ownerKey || finalizedReleaseDepth > 0) return
  const { liveTokens, liveCount, deadCount } = readTrackedOwnerTokens(manager, ownerKey)
  const ownerCount = getOwnerCount(manager, ownerKey)
  record(kind + '.fr.ownerFinalized', entryKey, { ownerCount, liveCount, deadCount, registry: diag.finalizing, forced: true })
  if (liveCount > 0) {
    addIncident(kind + '.fr.liveOwnerWiped', entryKey, { ownerCount, liveCount, liveTokens, deadCount })
  }
}

function trackPendingUnsub (
  kind: string,
  key: string,
  intent: string,
  promise: PromiseLike<unknown>,
  timing = kind + '.unsubscribe'
): void {
  const id = nextPendingUnsubId++
  const startedAt = now()
  pendingUnsubs.set(id, { id, kind, key, intent, startedAt })
  const done = (): void => {
    pendingUnsubs.delete(id)
    time(timing, now() - startedAt)
  }
  promise.then(done, done)
}

function observeReconcile (manager: Manager, kind: string, key: string, original: AnyFn, args: unknown[]): unknown {
  const entry = manager.entries.get(key)
  const joined = !!(entry && entry.phase === 'transition' && entry.reconcilePromise)
  const from = entryMode(entry)
  const result = original.apply(manager, args)
  if (isThenable(result)) {
    result.then(() => {
      safely(() => {
        const to = entryMode(manager.entries.get(key))
        if (joined) count(kind + '.reconcile.joined')
        else if (from === to) count(kind + '.reconcile.noop')
        else record(kind + '.reconcile.changed', key, { from, to })
      })
    }, () => count(kind + '.reconcile.error'))
  }
  return result
}

function observeSubscribeResult (
  manager: Manager,
  kind: string,
  key: string,
  result: unknown,
  before: { mode: string, phase?: string, ownerCount: number, startedAt: number }
): void {
  if (!isThenable(result)) {
    count(kind + '.subscribe.sync')
    return
  }
  const desired = manager.getDesiredTransportMode(key)
  if (before.mode !== 'idle' && before.mode === desired) {
    // sub() returned a promise although the transport was already live:
    // the fast path was missed.
    const reason = before.ownerCount === 0
      ? 'noPreviousOwners'
      : (before.phase !== 'stable' ? 'phaseTransition' : 'other')
    count(kind + '.subscribe.slowPathWhileLive.' + reason)
    record(kind + '.subscribe.slowPathWhileLive', key, { reason, mode: before.mode })
  }
  result.then(
    () => time(kind + '.subscribe', now() - before.startedAt),
    () => count(kind + '.subscribe.error')
  )
}

// ---- doc manager ----

function instrumentDocManager (manager: Manager, kind: string): void {
  patch(manager, 'subscribe', original => function (this: Manager, $doc: any, options?: { intent?: string }) {
    if (!diag.on) return Reflect.apply(original, this, arguments)
    let key = ''
    let rootId = GLOBAL_ROOT_ID
    let before = { mode: 'idle', phase: undefined as string | undefined, ownerCount: 0, startedAt: now() }
    let hadPending = false
    safely(() => {
      key = docHash($doc)
      rootId = signalRootId($doc)
      const entry = this.entries.get(key)
      hadPending = !!entry?.pendingDestroy
      before = { mode: entryMode(entry), phase: entry?.phase, ownerCount: entry ? this.getEntryTotalCount(entry) : 0, startedAt: now() }
    })
    const result = Reflect.apply(original, this, arguments)
    safely(() => {
      const intent = options?.intent ?? 'subscribe'
      trackToken(this, findOwnerKey(this, key, rootId), $doc, 1)
      record(kind + '.subscribe', key, { intent, root: rootId, prevCount: before.ownerCount, prevMode: before.mode, revived: hadPending || undefined })
      observeSubscribeResult(this, kind, key, result, before)
    })
    return result
  })

  patch(manager, 'unsubscribe', original => function (this: Manager, $doc: any, options?: { intent?: string }) {
    if (!diag.on) return Reflect.apply(original, this, arguments)
    let key = ''
    let intent = 'subscribe'
    safely(() => {
      key = docHash($doc)
      intent = options?.intent ?? 'subscribe'
      const rootId = signalRootId($doc)
      const ownerKey = findOwnerKey(this, key, rootId)
      const ownerRecord = ownerKey ? this.ownerRecords.get(ownerKey) : undefined
      if (checkUnsubscribeIntent(kind, key, intent, ownerRecord)) trackToken(this, ownerKey, $doc, -1)
      record(kind + '.unsubscribe', key, { intent, root: rootId })
    })
    const result = Reflect.apply(original, this, arguments)
    if (isThenable(result)) safely(() => trackPendingUnsub(kind, key, intent, result))
    return result
  })

  patch(manager, 'retain', original => function (this: Manager, $doc: any) {
    if (diag.on) safely(() => record(kind + '.retain', docHash($doc)))
    return Reflect.apply(original, this, arguments)
  })

  patch(manager, 'release', original => function (this: Manager, $doc: any) {
    if (diag.on) safely(() => record(kind + '.release', docHash($doc)))
    return Reflect.apply(original, this, arguments)
  })

  patch(manager, 'scheduleDestroy', original => function (this: Manager, segments: unknown[], options?: { force?: boolean }) {
    if (!diag.on) return Reflect.apply(original, this, arguments)
    let key = ''
    let existing: unknown
    safely(() => {
      key = JSON.stringify(segments)
      existing = this.entries.get(key)?.pendingDestroy
    })
    const result = Reflect.apply(original, this, arguments)
    safely(() => {
      const pendingDestroy = this.entries.get(key)?.pendingDestroy
      if (pendingDestroy && pendingDestroy !== existing) {
        stamp(pendingDestroy)
        record(kind + '.destroy.scheduled', key, { force: !!options?.force })
      }
    })
    return result
  })

  patch(manager, 'cancelDestroy', original => function (this: Manager, hash: string) {
    if (!diag.on) return Reflect.apply(original, this, arguments)
    safely(() => {
      const pendingDestroy = this.entries.get(hash)?.pendingDestroy
      if (pendingDestroy) record(kind + '.destroy.cancelled', hash, { ageMs: ageSince(getStamp(pendingDestroy)) })
    })
    return Reflect.apply(original, this, arguments)
  })

  patch(manager, 'destroyByHash', original => function (this: Manager, hash: string, options?: { force?: boolean }) {
    if (!diag.on) return Reflect.apply(original, this, arguments)
    safely(() => {
      const pendingDestroy = this.entries.get(hash)?.pendingDestroy
      record(kind + '.destroy', hash, {
        force: !!options?.force,
        pendingAgeMs: pendingDestroy ? ageSince(getStamp(pendingDestroy)) : undefined
      })
    })
    const result = Reflect.apply(original, this, arguments)
    if (isThenable(result)) {
      result.then(() => safely(() => {
        const entry = this.entries.get(hash)
        if (!entry?.runtime) record(kind + '.destroyed', hash)
        else count(kind + '.destroy.kept')
      }), () => count(kind + '.destroy.error'))
    }
    return result
  })

  patch(manager, 'destroyByOwnerKey', original => function (this: Manager, ownerKey: string, options?: { hash?: string, force?: boolean }) {
    if (!diag.on) return Reflect.apply(original, this, arguments)
    safely(() => {
      const hash = this.ownerRecords.get(ownerKey)?.hash ?? options?.hash
      if (diag.finalizing && finalizedReleaseDepth === 0) checkFinalizedOwner(this, kind, ownerKey, hash)
      else record(kind + '.destroyByOwner', hash, { force: !!options?.force })
      if (options?.force) clearTokens(this, ownerKey)
    })
    return Reflect.apply(original, this, arguments)
  })

  // FinalizationRegistry callback: (ownerKey, hash, token)
  patch(manager, 'releaseFinalizedToken', original => function (this: Manager, ownerKey: string, hash: string) {
    if (!diag.on) return Reflect.apply(original, this, arguments)
    return observeFinalizedRelease(this, kind, ownerKey, hash ?? this.ownerRecords.get(ownerKey)?.hash, original, arguments)
  })

  patch(manager, 'reconcileTransport', original => function (this: Manager, hash: string) {
    if (!diag.on) return Reflect.apply(original, this, arguments)
    return observeReconcile(this, kind, hash, original, Array.from(arguments))
  })

  patch(manager, 'releaseRootOwnedSubscriptions', original => function (this: Manager, rootId: string) {
    if (diag.on) record(kind + '.releaseRoot', rootId)
    return Reflect.apply(original, this, arguments)
  })
}

// Returns true when the unsubscribe will actually release an owner count.
function checkUnsubscribeIntent (kind: string, key: string, intent: string, ownerRecord: any): boolean {
  const fetchCount = ownerRecord?.fetchCount || 0
  const subscribeCount = ownerRecord?.subscribeCount || 0
  const current = intent === 'fetch' ? fetchCount : subscribeCount
  if (current > 0) return true
  const other = intent === 'fetch' ? subscribeCount : fetchCount
  if (other > 0) {
    addIncident(kind + '.unsubscribe.intentMismatch', key, { intent, fetchCount, subscribeCount })
  } else {
    record(kind + '.unsubscribe.excessive', key, { intent })
  }
  return false
}

function ageSince (t: number | undefined): number | undefined {
  return t == null ? undefined : now() - t
}

// ---- query / aggregation manager ----

function instrumentQueryManager (manager: Manager, kind: string): void {
  patch(manager, 'subscribe', original => function (this: Manager, $query: any, options?: { intent?: string }) {
    if (!diag.on) return Reflect.apply(original, this, arguments)
    let key = ''
    let rootId = GLOBAL_ROOT_ID
    let before = { mode: 'idle', phase: undefined as string | undefined, ownerCount: 0, startedAt: now() }
    let hadPending = false
    safely(() => {
      key = $query?.[HASH]
      rootId = signalRootId($query)
      const entry = this.entries.get(key)
      const ownerKey = findOwnerKey(this, key, rootId)
      hadPending = !!(ownerKey && entry?.pendingDestroyByOwner?.has(ownerKey))
      before = { mode: entryMode(entry), phase: entry?.phase, ownerCount: ownerKey ? this.getOwnerTotalCount(ownerKey) : 0, startedAt: now() }
    })
    const result = Reflect.apply(original, this, arguments)
    safely(() => {
      const intent = options?.intent ?? 'subscribe'
      trackToken(this, findOwnerKey(this, key, rootId), $query, 1)
      record(kind + '.subscribe', key, { intent, root: rootId, prevCount: before.ownerCount, prevMode: before.mode, revived: hadPending || undefined })
      observeSubscribeResult(this, kind, key, result, before)
    })
    return result
  })

  patch(manager, 'unsubscribe', original => function (this: Manager, $query: any, options?: { intent?: string }) {
    if (!diag.on) return Reflect.apply(original, this, arguments)
    let key = ''
    let intent = 'subscribe'
    safely(() => {
      key = $query?.[HASH]
      intent = options?.intent ?? 'subscribe'
      const rootId = signalRootId($query)
      const ownerKey = findOwnerKey(this, key, rootId)
      const ownerRecord = ownerKey ? this.ownerRecords.get(ownerKey) : undefined
      if (checkUnsubscribeIntent(kind, key, intent, ownerRecord)) trackToken(this, ownerKey, $query, -1)
      record(kind + '.unsubscribe', key, { intent, root: rootId })
    })
    const result = Reflect.apply(original, this, arguments)
    if (isThenable(result)) safely(() => trackPendingUnsub(kind, key, intent, result))
    return result
  })

  patch(manager, 'scheduleDestroy', original => function (
    this: Manager,
    collectionName: string,
    params: unknown,
    ownerKey?: string,
    options?: { force?: boolean, transportHash?: string }
  ) {
    if (!diag.on) return Reflect.apply(original, this, arguments)
    let transportHash = ''
    let existing: unknown
    safely(() => {
      transportHash = options?.transportHash ?? hashQuery(collectionName, params)
      if (diag.finalizing) checkFinalizedOwner(this, kind, ownerKey, transportHash)
      existing = ownerKey ? this.entries.get(transportHash)?.pendingDestroyByOwner?.get(ownerKey) : undefined
    })
    const result = Reflect.apply(original, this, arguments)
    safely(() => {
      const pendingDestroy = ownerKey ? this.entries.get(transportHash)?.pendingDestroyByOwner?.get(ownerKey) : undefined
      if (pendingDestroy && pendingDestroy !== existing) {
        stamp(pendingDestroy)
        record(kind + '.destroy.scheduled', transportHash, { force: !!options?.force })
      }
    })
    return result
  })

  patch(manager, 'cancelDestroy', original => function (this: Manager, ownerKey: string, transportHash?: string) {
    if (!diag.on) return Reflect.apply(original, this, arguments)
    safely(() => {
      const pendingDestroy = this.getPendingDestroy(ownerKey, transportHash)
      if (pendingDestroy) record(kind + '.destroy.cancelled', transportHash, { ageMs: ageSince(getStamp(pendingDestroy)) })
    })
    return Reflect.apply(original, this, arguments)
  })

  patch(manager, 'destroyByOwnerKey', original => function (this: Manager, ownerKey: string, options?: { force?: boolean, transportHash?: string }) {
    if (!diag.on) return Reflect.apply(original, this, arguments)
    let transportHash: string | undefined
    safely(() => {
      transportHash = this.ownerRecords.get(ownerKey)?.transportHash ?? options?.transportHash
      const pendingDestroy = this.getPendingDestroy(ownerKey, transportHash)
      if (diag.finalizing) checkFinalizedOwner(this, kind, ownerKey, transportHash)
      record(kind + '.destroy', transportHash, {
        force: !!options?.force || !!pendingDestroy?.force,
        pendingAgeMs: pendingDestroy ? ageSince(getStamp(pendingDestroy)) : undefined
      })
      if (options?.force) clearTokens(this, ownerKey)
    })
    const result = Reflect.apply(original, this, arguments)
    if (isThenable(result)) {
      result.then(() => safely(() => {
        if (!this.ownerRecords.has(ownerKey)) clearTokens(this, ownerKey)
        const entry = transportHash ? this.entries.get(transportHash) : undefined
        if (!entry?.runtime) record(kind + '.destroyed', transportHash)
        else count(kind + '.destroy.kept')
      }), () => count(kind + '.destroy.error'))
    }
    return result
  })

  patch(manager, 'reconcileTransport', original => function (this: Manager, transportHash: string) {
    if (!diag.on) return Reflect.apply(original, this, arguments)
    return observeReconcile(this, kind, transportHash, original, Array.from(arguments))
  })

  // FinalizationRegistry callback: (ownerKey, token)
  patch(manager, 'releaseFinalizedToken', original => function (this: Manager, ownerKey: string) {
    if (!diag.on) return Reflect.apply(original, this, arguments)
    return observeFinalizedRelease(this, kind, ownerKey, this.ownerRecords.get(ownerKey)?.transportHash, original, arguments)
  })
}

// ---- runtime classes (transport level) ----

function instrumentDocRuntime (proto: unknown): void {
  patch(proto, '_subscribe', original => function (this: any) {
    if (!diag.on) return Reflect.apply(original, this, arguments)
    const key = JSON.stringify([this.collection, this.docId])
    const mode = this.requestedTransportMode === 'fetch' ? 'fetch' : 'subscribe'
    const startedAt = now()
    record('doc.transport.' + mode, key)
    const result = Reflect.apply(original, this, arguments)
    if (isThenable(result)) {
      result.then(
        () => time('doc.transport.' + mode, now() - startedAt),
        () => count('doc.transport.' + mode + '.error')
      )
    }
    return result
  })
  patch(proto, '_unsubscribe', original => function (this: any) {
    if (diag.on) {
      const method = this.activeTransportMode === 'fetch' ? 'unfetch' : 'unsubscribe'
      record('doc.transport.' + method, JSON.stringify([this.collection, this.docId]))
    }
    return Reflect.apply(original, this, arguments)
  })
  patch(proto, 'destroy', original => function (this: any) {
    if (diag.on) record('doc.runtime.destroy', JSON.stringify([this.collection, this.docId]))
    return Reflect.apply(original, this, arguments)
  })
  patch(proto, 'dispose', original => function (this: any) {
    if (diag.on) record('doc.runtime.dispose', JSON.stringify([this.collection, this.docId]))
    return Reflect.apply(original, this, arguments)
  })
}

function instrumentQueryRuntime (proto: unknown, AggregationClass: unknown): void {
  const kindOf = (runtime: unknown): string =>
    typeof AggregationClass === 'function' && runtime instanceof (AggregationClass as new (...args: any[]) => unknown)
      ? 'aggregation'
      : 'query'
  patch(proto, '_subscribe', original => function (this: any) {
    if (!diag.on) return Reflect.apply(original, this, arguments)
    const kind = kindOf(this)
    const mode = this.requestedTransportMode === 'fetch' ? 'fetch' : 'subscribe'
    const startedAt = now()
    record(kind + '.transport.' + mode, this.hash)
    const result = Reflect.apply(original, this, arguments)
    if (isThenable(result)) {
      result.then(
        () => time(kind + '.transport.' + mode, now() - startedAt),
        () => count(kind + '.transport.' + mode + '.error')
      )
    }
    return result
  })
  patch(proto, '_unsubscribe', original => function (this: any) {
    if (diag.on) record(kindOf(this) + '.transport.destroy', this.hash, { hadShareQuery: !!this.shareQuery })
    return Reflect.apply(original, this, arguments)
  })
  patch(proto, '_detachTransportData', original => function (this: any, options?: { keepRoots?: boolean }) {
    if (diag.on) record(kindOf(this) + '.runtime.detach', this.hash, { docs: this.docSignals?.size, keepRoots: options?.keepRoots })
    return Reflect.apply(original, this, arguments)
  })
}
