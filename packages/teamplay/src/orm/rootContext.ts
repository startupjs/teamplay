import { observable } from '@nx-js/observer-util'
import { isGlobalRootId, normalizeRootId } from './rootScope.ts'
import { getDefaultFetchOnly } from './connection.ts'
import WeakRef, { type WeakRefLike } from '../utils/MockWeakRef.ts'
import type { PathSegment } from './types/path.ts'

type RootId = string | null | undefined
type DataTree = Record<string | number, unknown>
type RuntimeKind = 'query' | 'aggregation'

interface RootContextOptions {
  fetchOnly?: boolean
}

export interface DirectDocSubscriptionEntry {
  segments: PathSegment[]
  count: number
  tokenCounts: Map<unknown, number>
}

const ROOT_CONTEXTS = new Map<string, RootContext>()
// Closed root id -> weak ref to its root signal. A closed id must stay closed
// while something can still use it: every signal of a root holds its root
// signal strongly, so once the root signal is collected no signal can reach
// the id any more and the mark is dropped (lazily: on lookup, and by a sweep
// whose threshold doubles with the number of live marks).
const CLOSED_ROOT_CONTEXTS = new Map<string, WeakRefLike<object>>()
const MIN_CLOSED_SWEEP_THRESHOLD = 64
let closedSweepThreshold = MIN_CLOSED_SWEEP_THRESHOLD
const EMPTY_SET = new Set<string>()
const EMPTY_MAP = new Map<string, DirectDocSubscriptionEntry>()
const RUNTIME_KIND_QUERY = 'query'
const RUNTIME_KIND_AGGREGATION = 'aggregation'

export default class RootContext {
  readonly rootId: string
  fetchOnly: boolean
  privateDataRaw: DataTree
  privateData: DataTree

  readonly queryRuntimeHashes = new Set<string>()
  readonly aggregationRuntimeHashes = new Set<string>()
  readonly signalHashes = new Set<string>()
  readonly directDocSubscriptions = new Map<string, DirectDocSubscriptionEntry>()
  // public docs this root wrote while nothing tracked them; the doc manager
  // retains them for the root until it is disposed
  readonly writtenDocs = new Set<string>()

  constructor (rootId: RootId, { fetchOnly }: RootContextOptions = {}) {
    this.rootId = normalizeRootId(rootId)
    this.fetchOnly = fetchOnly == null ? getDefaultFetchOnly() : !!fetchOnly
    this.privateDataRaw = {}
    this.privateData = observable(this.privateDataRaw) as DataTree
  }

  getFetchOnly (): boolean {
    return !!this.fetchOnly
  }

  setFetchOnly (value: boolean): void {
    this.fetchOnly = !!value
  }

  getPrivateDataRoot (): DataTree {
    return this.privateData
  }

  getPrivateDataRawRoot (): DataTree {
    return this.privateDataRaw
  }

  getPrivateDataAt (segments: readonly PathSegment[]): unknown {
    return getPath(segments, this.privateData)
  }

  getPrivateDataRawAt (segments: readonly PathSegment[]): unknown {
    return getPath(segments, this.privateDataRaw)
  }

  setPrivateDataAt (segments: readonly PathSegment[], value: unknown): void {
    setPath(segments, value, this.privateData)
  }

  delPrivateDataAt (segments: readonly PathSegment[]): void {
    delPath(segments, this.privateData)
  }

  getRuntimeHashes (kind: RuntimeKind): Set<string> {
    switch (kind) {
      case RUNTIME_KIND_QUERY:
        return this.queryRuntimeHashes
      case RUNTIME_KIND_AGGREGATION:
        return this.aggregationRuntimeHashes
      default:
        throw Error(`Unsupported root-owned runtime kind: ${kind}`)
    }
  }

  registerRuntime (kind: RuntimeKind, runtimeHash: string | null | undefined): void {
    if (runtimeHash == null) return
    this.getRuntimeHashes(kind).add(runtimeHash)
  }

  unregisterRuntime (kind: RuntimeKind, runtimeHash: string | null | undefined): void {
    if (runtimeHash == null) return
    this.getRuntimeHashes(kind).delete(runtimeHash)
  }

  registerSignalHash (signalHash: string | null | undefined): void {
    if (signalHash == null) return
    this.signalHashes.add(signalHash)
  }

  unregisterSignalHash (signalHash: string | null | undefined): void {
    if (signalHash == null) return
    this.signalHashes.delete(signalHash)
  }

  registerDirectDocSubscription (
    hash: string | null | undefined,
    segments: readonly PathSegment[],
    token?: unknown
  ): void {
    if (hash == null) return
    let entry = this.directDocSubscriptions.get(hash)
    if (!entry) {
      entry = {
        segments: [...segments],
        count: 0,
        tokenCounts: new Map()
      }
      this.directDocSubscriptions.set(hash, entry)
    }
    entry.count += 1
    if (token != null) {
      entry.tokenCounts.set(token, (entry.tokenCounts.get(token) || 0) + 1)
    }
  }

  unregisterDirectDocSubscription (hash: string | null | undefined, token?: unknown): void {
    if (hash == null) return
    const entry = this.directDocSubscriptions.get(hash)
    if (!entry) return
    entry.count = Math.max(entry.count - 1, 0)
    if (token != null) {
      const nextTokenCount = (entry.tokenCounts.get(token) || 0) - 1
      if (nextTokenCount > 0) entry.tokenCounts.set(token, nextTokenCount)
      else entry.tokenCounts.delete(token)
    }
    if (entry.count === 0) this.directDocSubscriptions.delete(hash)
  }

  resetRuntimeHashes (): void {
    this.queryRuntimeHashes.clear()
    this.aggregationRuntimeHashes.clear()
  }

  resetPrivateData (): void {
    this.privateDataRaw = {}
    this.privateData = observable(this.privateDataRaw) as DataTree
  }

  resetSignalHashes (): void {
    this.signalHashes.clear()
  }

  resetDirectDocSubscriptions (): void {
    this.directDocSubscriptions.clear()
  }

  isRuntimeEmpty (): boolean {
    return (
      isPlainObjectEmpty(this.privateData) &&
      this.queryRuntimeHashes.size === 0 &&
      this.aggregationRuntimeHashes.size === 0 &&
      this.signalHashes.size === 0 &&
      this.directDocSubscriptions.size === 0 &&
      this.writtenDocs.size === 0
    )
  }
}

export function getRootContext (
  rootId: RootId,
  create: false,
  options?: RootContextOptions
): RootContext | undefined
export function getRootContext (
  rootId: RootId,
  create?: true,
  options?: RootContextOptions
): RootContext
export function getRootContext (
  rootId: RootId,
  create = true,
  options: RootContextOptions = {}
): RootContext | undefined {
  const normalizedRootId = normalizeRootId(rootId)
  if (create && isRootContextClosed(normalizedRootId)) return undefined
  let context = ROOT_CONTEXTS.get(normalizedRootId)
  if (!context && create) {
    context = new RootContext(normalizedRootId, options)
    ROOT_CONTEXTS.set(normalizedRootId, context)
  }
  return context
}

export function getRootContexts (): IterableIterator<RootContext> {
  return ROOT_CONTEXTS.values()
}

export function registerRootOwnedRuntime (
  rootId: RootId,
  kind: RuntimeKind,
  runtimeHash: string | null | undefined
): void {
  getRootContext(rootId, true).registerRuntime(kind, runtimeHash)
}

export function unregisterRootOwnedRuntime (
  rootId: RootId,
  kind: RuntimeKind,
  runtimeHash: string | null | undefined
): void {
  const context = getRootContext(rootId, false)
  if (!context) return
  context.unregisterRuntime(kind, runtimeHash)
}

export function getRootOwnedRuntimeHashes (
  rootId: RootId,
  kind: RuntimeKind
): ReadonlySet<string> {
  const context = getRootContext(rootId, false)
  if (!context) return EMPTY_SET
  return context.getRuntimeHashes(kind)
}

export function registerRootOwnedSignalHash (
  rootId: RootId,
  signalHash: string | null | undefined
): void {
  getRootContext(rootId, true).registerSignalHash(signalHash)
}

export function unregisterRootOwnedSignalHash (
  rootId: RootId,
  signalHash: string | null | undefined
): void {
  const context = getRootContext(rootId, false)
  if (!context) return
  context.unregisterSignalHash(signalHash)
}

export function getRootOwnedSignalHashes (rootId: RootId): ReadonlySet<string> {
  const context = getRootContext(rootId, false)
  if (!context) return EMPTY_SET
  return context.signalHashes
}

export function clearRootOwnedSignalHashes (rootId: RootId): void {
  const context = getRootContext(rootId, false)
  if (!context) return
  context.resetSignalHashes()
}

export function registerRootOwnedDirectDocSubscription (
  rootId: RootId,
  hash: string | null | undefined,
  segments: readonly PathSegment[],
  token?: unknown
): void {
  getRootContext(rootId, true).registerDirectDocSubscription(hash, segments, token)
}

export function unregisterRootOwnedDirectDocSubscription (
  rootId: RootId,
  hash: string | null | undefined,
  token?: unknown
): void {
  const context = getRootContext(rootId, false)
  if (!context) return
  context.unregisterDirectDocSubscription(hash, token)
}

export function getRootOwnedDirectDocSubscriptions (
  rootId: RootId
): ReadonlyMap<string, DirectDocSubscriptionEntry> {
  const context = getRootContext(rootId, false)
  if (!context) return EMPTY_MAP
  return context.directDocSubscriptions
}

export function clearRootOwnedDirectDocSubscriptions (rootId: RootId): void {
  const context = getRootContext(rootId, false)
  if (!context) return
  context.resetDirectDocSubscriptions()
}

// Deletes the context and marks the id closed for as long as `$root` (the root
// signal) is alive: late writes and subscriptions through its signals must not
// recreate the context. Without `$root` (the root signal was already
// collected) nothing can reach the id, so it is not remembered.
// Returns true when the doc is new for this root (the caller retains it once).
// A closed root or the global root does not hold written docs.
export function registerRootWrittenDoc (rootId: RootId, hash: string): boolean {
  if (rootId == null || isGlobalRootId(rootId)) return false
  const context = getRootContext(rootId, false)
  if (!context || context.writtenDocs.has(hash)) return false
  context.writtenDocs.add(hash)
  return true
}

export function takeRootWrittenDocs (rootId: RootId): string[] {
  const context = getRootContext(rootId, false)
  if (!context) return []
  const hashes = Array.from(context.writtenDocs)
  context.writtenDocs.clear()
  return hashes
}

export function deleteRootContext (rootId: RootId, $root?: object): void {
  const normalizedRootId = normalizeRootId(rootId)
  ROOT_CONTEXTS.delete(normalizedRootId)
  if ($root == null) {
    CLOSED_ROOT_CONTEXTS.delete(normalizedRootId)
    return
  }
  CLOSED_ROOT_CONTEXTS.set(normalizedRootId, new WeakRef($root))
  if (CLOSED_ROOT_CONTEXTS.size >= closedSweepThreshold) sweepClosedRootContexts()
}

export function reviveRootContext (rootId: RootId): void {
  CLOSED_ROOT_CONTEXTS.delete(normalizeRootId(rootId))
}

export function isRootContextClosed (rootId: RootId): boolean {
  const normalizedRootId = normalizeRootId(rootId)
  const mark = CLOSED_ROOT_CONTEXTS.get(normalizedRootId)
  if (!mark) return false
  if (mark.deref() !== undefined) return true
  CLOSED_ROOT_CONTEXTS.delete(normalizedRootId)
  return false
}

function sweepClosedRootContexts (): void {
  for (const [rootId, mark] of CLOSED_ROOT_CONTEXTS) {
    if (mark.deref() === undefined) CLOSED_ROOT_CONTEXTS.delete(rootId)
  }
  closedSweepThreshold = Math.max(MIN_CLOSED_SWEEP_THRESHOLD, CLOSED_ROOT_CONTEXTS.size * 2)
}

// For diagnostics: closed root ids whose root signal is still alive.
export function getClosedRootContextCount (): number {
  let count = 0
  for (const mark of CLOSED_ROOT_CONTEXTS.values()) {
    if (mark.deref() !== undefined) count++
  }
  return count
}

export function __getRootContextForTests (rootId: RootId): RootContext | undefined {
  return getRootContext(rootId, false)
}

export function __resetRootContextsForTests (): void {
  ROOT_CONTEXTS.clear()
  CLOSED_ROOT_CONTEXTS.clear()
  closedSweepThreshold = MIN_CLOSED_SWEEP_THRESHOLD
}

function getPath (segments: readonly PathSegment[], dataNode: unknown): unknown {
  let current = dataNode
  for (const segment of segments) {
    if (current == null) return current
    current = (current as DataTree)[segment]
  }
  return current
}

function setPath (segments: readonly PathSegment[], value: unknown, tree: DataTree): void {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw Error('setPrivateDataAt requires a non-empty segments array')
  }
  let dataNode = tree
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]
    const next = dataNode[segment]
    if (next == null || typeof next !== 'object') {
      dataNode[segment] = {}
    }
    dataNode = dataNode[segment] as DataTree
  }
  dataNode[segments[segments.length - 1]] = value
}

function delPath (segments: readonly PathSegment[], tree: DataTree): void {
  if (!Array.isArray(segments) || segments.length === 0) return
  const parents: Array<[DataTree, PathSegment]> = []
  let dataNode: unknown = tree
  for (let i = 0; i < segments.length - 1; i++) {
    if (dataNode == null) return
    const parent = dataNode as DataTree
    parents.push([parent, segments[i]])
    dataNode = parent[segments[i]]
  }
  if (dataNode == null) return
  delete (dataNode as DataTree)[segments[segments.length - 1]]
  for (let i = parents.length - 1; i >= 0; i--) {
    const [parent, segment] = parents[i]
    if (!isPlainObjectEmpty(parent[segment])) break
    delete parent[segment]
  }
}

function isPlainObjectEmpty (value: unknown): boolean {
  return value != null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
}
