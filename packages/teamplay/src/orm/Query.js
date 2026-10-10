import { raw } from '@nx-js/observer-util'
import { set as _set, getRaw } from './dataTree.js'
import getSignal from './getSignal.ts'
import { getConnection } from './connection.ts'
import { docSubscriptions } from './Doc.js'
import { isMissingShareDoc } from './missingDoc.js'
import { addQueryDoc, removeQueryDoc } from './queryDocIndex.js'
import { SEGMENTS } from './signalSymbols.ts'
import { runInBatch } from './batchScheduler.js'
import FinalizationRegistry from '../utils/MockFinalizationRegistry.ts'
import { getIdFieldsForSegments, injectIdFields, isPlainObject } from './idFields.ts'
import { getSubscriptionGcDelay } from './subscriptionGcDelay.ts'
import { getScopedSignalHash, normalizeRootId } from './rootScope.ts'
import { getRoot, ROOT_ID, getRootTransportMode } from './Root.ts'
import { registerRootOwnedRuntime, unregisterRootOwnedRuntime } from './rootContext.ts'
import { setSignalRuntimeDescriptor } from './signalRuntimeDescriptor.ts'
import unrefTimer from '../utils/unrefTimer.ts'
import {
  addOwnerToken,
  canJoinTransport,
  clearDowngradeGrace,
  createOwnerTokenCounts,
  flushDowngradeGraces,
  getTransportTargetMode,
  reconcileEntryTransport,
  removeOwnerToken,
  scheduleDowngradeGrace
} from './subscriptionTransport.js'
import {
  delPrivateData,
  getPrivateData,
  setPrivateData,
  setReplacePrivateData
} from './privateData.js'

const ERROR_ON_EXCESSIVE_UNSUBSCRIBES = false
const QUERY_FINALIZATION_TOKENS = new WeakMap()

function getQueryFinalizationToken ($query) {
  let token = QUERY_FINALIZATION_TOKENS.get($query)
  if (!token) {
    token = {}
    QUERY_FINALIZATION_TOKENS.set($query, token)
  }
  return token
}
export const COLLECTION_NAME = Symbol('query collection name')
export const PARAMS = Symbol('query params')
export const HASH = Symbol('query hash')
export const IS_QUERY = Symbol('is query signal')
export const QUERIES = '$queries'

export class Query {
  initialized
  shareQuery

  constructor (collectionName, params, { hash = hashQuery(collectionName, params) } = {}) {
    this.collectionName = collectionName
    this.params = params
    this.hash = hash
    this.rootIds = new Set()
    this.docSignals = new Set()
    this.requestedTransportMode = 'subscribe'
    this.activeTransportMode = 'idle'
  }

  // Transport calls are made only by the manager's reconcile loop, which runs
  // one transition per entry at a time (see subscriptionTransport.js).
  get subscribed () {
    return this.activeTransportMode !== 'idle'
  }

  init () {
    if (this.initialized) return
    this.initialized = true
    this._initData()
  }

  async subscribe ({ mode } = {}) {
    if (mode) this.requestedTransportMode = mode
    await this._subscribe()
    this.init()
  }

  async unsubscribe () {
    if (this.activeTransportMode !== 'idle') await this._unsubscribe()
    if (!this.subscribed) {
      this.initialized = undefined
      this._detachTransportData({ keepRoots: false })
    }
  }

  attachRoot (rootId) {
    if (rootId == null) return
    if (this.rootIds.has(rootId)) return
    this.rootIds.add(rootId)
    if (this.initialized) this._syncRootData(rootId)
  }

  detachRoot (rootId) {
    if (rootId == null) return
    if (!this.rootIds.delete(rootId)) return
    this._removeRootData(rootId)
  }

  async _subscribe () {
    const mode = this.requestedTransportMode
    await new Promise((resolve, reject) => {
      const method = mode === 'fetch' ? 'createFetchQuery' : 'createSubscribeQuery'
      this.shareQuery = getConnection()[method](this.collectionName, this.params, {}, err => {
        if (err) return reject(err)
        this.activeTransportMode = mode
        resolve()
      })
    })
  }

  async _unsubscribe () {
    if (!this.shareQuery) {
      this.activeTransportMode = 'idle'
      return
    }
    await new Promise((resolve, reject) => {
      this.shareQuery.destroy(err => {
        if (err) return reject(err)
        this.activeTransportMode = 'idle'
        resolve()
      })
      this.shareQuery = undefined
    })
  }

  _initData () {
    // reference fetched docs once per transport query
    maybeMaterializeQueryDocsToCollection(this.collectionName, this.shareQuery.results)
    for (const doc of this.shareQuery.results) this._addDoc(doc.id)
    this._syncAllRootsData()

    // ShareDB has already applied the diff to shareQuery.results
    this.shareQuery.on('insert', shareDocs => {
      maybeMaterializeQueryDocsToCollection(this.collectionName, shareDocs)
      for (const doc of shareDocs) this._addDoc(doc.id)
      this._syncListedResults()
    })
    this.shareQuery.on('move', () => {
      this._syncListedResults()
    })
    this.shareQuery.on('remove', shareDocs => {
      for (const doc of shareDocs) {
        const $doc = getSignal(undefined, [this.collectionName, doc.id])
        docSubscriptions.release($doc).catch(ignoreDestroyError)
        this.docSignals.delete($doc)
        removeQueryDoc(this.collectionName, doc.id, this)
      }
      this._syncListedResults()
    })
    this.shareQuery.on('extra', extra => {
      extra = raw(extra)
      this._forEachRoot(rootId => {
        if (getPrivateData(rootId, [QUERIES, this.hash]) == null) return
        setPrivateData(rootId, [QUERIES, this.hash, 'extra'], extra)
      })
    })
  }

  _syncAllRootsData () {
    this._forEachRoot(rootId => this._syncRootData(rootId))
  }

  _syncRootData (rootId) {
    if (!this.shareQuery) return
    maybeMaterializeQueryDocsToCollection(this.collectionName, this.shareQuery.results)
    // assigned, never diffed into lists handed out before (see _syncListedResults())
    const { ids, docs } = this._getListedResults()
    setReplacePrivateData(rootId, [QUERIES, this.hash, 'docs'], docs)
    setReplacePrivateData(rootId, [QUERIES, this.hash, 'ids'], ids)

    if (this.shareQuery.extra !== undefined) {
      const extra = raw(this.shareQuery.extra)
      setPrivateData(rootId, [QUERIES, this.hash, 'extra'], extra)
    }
  }

  _removeRootData (rootId) {
    delPrivateData(rootId, [QUERIES, this.hash])
  }

  _forEachRoot (fn) {
    for (const rootId of this.rootIds) fn(rootId)
  }

  // The results whose docs exist, in the order of the results: their ids and
  // their data-tree objects (what their doc signals read). A result whose doc
  // is missing (deleted on this client or by another one after the server
  // read the results: until the server removes it, for good in a fetch
  // query) is left out of both, never a hole, until it exists again.
  _getListedResults () {
    const ids = []
    const docs = []
    for (const shareDoc of this.shareQuery.results) {
      if (isMissingShareDoc(shareDoc)) continue
      const doc = getRaw([this.collectionName, shareDoc.id])
      if (doc == null) continue
      ids.push(shareDoc.id)
      docs.push(doc)
    }
    return { ids, docs }
  }

  // Copy-on-write: a list handed out by $query.get() or getIds() is a
  // snapshot, never changed afterwards (a caller may delete the listed docs
  // while it loops over it, or keep it as a memo dependency). When the listed
  // results change, every root gets new lists (shared between roots: nothing
  // changes them); otherwise the current lists stay, so reads and in-place
  // updates of a doc allocate nothing. Both lists change in one batch, so a
  // reaction never sees one updated without the other.
  _syncListedResults () {
    if (!this.shareQuery) return
    let listed
    runInBatch(() => {
      this._forEachRoot(rootId => {
        const rawIds = getPrivateData(rootId, [QUERIES, this.hash, 'ids'], true)
        const rawDocs = getPrivateData(rootId, [QUERIES, this.hash, 'docs'], true)
        if (!Array.isArray(rawIds) || !Array.isArray(rawDocs)) return
        listed ??= this._getListedResults()
        if (!isSameList(rawDocs, listed.docs)) setReplacePrivateData(rootId, [QUERIES, this.hash, 'docs'], listed.docs)
        if (!isSameList(rawIds, listed.ids)) setReplacePrivateData(rootId, [QUERIES, this.hash, 'ids'], listed.ids)
      })
    })
  }

  // The data-tree object of a listed doc was replaced: deleted (it leaves the
  // lists), created again (it comes back at its place) or loaded anew.
  refreshDoc () {
    this._syncListedResults()
  }

  _addDoc (docId) {
    const $doc = getSignal(undefined, [this.collectionName, docId])
    docSubscriptions.retain($doc)
    this.docSignals.add($doc)
    addQueryDoc(this.collectionName, docId, this)
  }

  _detachTransportData ({ keepRoots = true } = {}) {
    for (const $doc of this.docSignals) {
      docSubscriptions.release($doc).catch(ignoreDestroyError)
      removeQueryDoc(this.collectionName, $doc[SEGMENTS][1], this)
    }
    this.docSignals.clear()
    this._forEachRoot(rootId => this._removeRootData(rootId))
    if (!keepRoots) this.rootIds.clear()
  }

  _removeData () {
    this._detachTransportData({ keepRoots: false })
  }
}

export class QuerySubscriptions {
  constructor (QueryClass = Query) {
    this.QueryClass = QueryClass
    this.runtimeKind = 'query'
    this.ownerRecords = new Map() // ownerKey -> owner record
    this.entries = new Map() // transportHash -> transport entry
    this.fr = new FinalizationRegistry(({ ownerKey, token }) => {
      this.releaseFinalizedToken(ownerKey, token).catch(ignoreDestroyError)
    })
    this.subCount = createReadonlyMapView({
      get: ownerKey => this.getTrackedOwnerCount(ownerKey),
      has: ownerKey => this.getTrackedOwnerCount(ownerKey) !== undefined,
      size: () => this.getTrackedOwnerCountSize(),
      keys: () => getUnionKeys(this.ownerRecords.keys(), this.getPendingDestroyOwnerKeys())
    })
    this.transportSubCount = createReadonlyMapView({
      get: transportHash => this.getTransportOwnerCount(transportHash),
      has: transportHash => this.getTransportOwnerCount(transportHash) !== undefined,
      size: () => this.getTrackedTransportCountSize(),
      keys: () => filterMapKeys(this.entries, entry => entry.owners.size > 0 || !!entry.runtime)
    })
    this.ownerFetchCount = createReadonlyMapView({
      get: ownerKey => {
        const count = this.ownerRecords.get(ownerKey)?.fetchCount
        return count > 0 ? count : undefined
      },
      has: ownerKey => !!this.ownerRecords.get(ownerKey)?.fetchCount,
      size: () => countMapLike(this.ownerRecords, record => record.fetchCount > 0),
      keys: () => filterMapKeys(this.ownerRecords, record => record.fetchCount > 0)
    })
    this.ownerSubscribeCount = createReadonlyMapView({
      get: ownerKey => {
        const count = this.ownerRecords.get(ownerKey)?.subscribeCount
        return count > 0 ? count : undefined
      },
      has: ownerKey => !!this.ownerRecords.get(ownerKey)?.subscribeCount,
      size: () => countMapLike(this.ownerRecords, record => record.subscribeCount > 0),
      keys: () => filterMapKeys(this.ownerRecords, record => record.subscribeCount > 0)
    })
    this.queries = createReadonlyMapView({
      get: transportHash => this.getRuntime(transportHash),
      has: transportHash => this.hasRuntime(transportHash),
      size: () => this.getRuntimeCount(),
      keys: () => filterMapKeys(this.entries, entry => !!entry.runtime)
    })
    this.ownerToTransport = createReadonlyMapView({
      get: ownerKey => this.ownerRecords.get(ownerKey)?.transportHash,
      has: ownerKey => this.ownerRecords.has(ownerKey),
      size: () => this.ownerRecords.size,
      keys: () => this.ownerRecords.keys()
    })
    this.ownerMeta = createReadonlyMapView({
      get: ownerKey => this.getOwnerMeta(ownerKey),
      has: ownerKey => this.ownerRecords.has(ownerKey),
      size: () => this.ownerRecords.size,
      keys: () => this.ownerRecords.keys()
    })
    this.ownerKeysByTransport = createReadonlyMapView({
      get: transportHash => this.getOwnerKeys(transportHash),
      has: transportHash => !!this.getOwnerKeys(transportHash),
      size: () => countMapLike(this.entries, entry => entry.owners.size > 0),
      keys: () => filterMapKeys(this.entries, entry => entry.owners.size > 0)
    })
    this.pendingDestroyTimers = createReadonlyMapView({
      get: ownerKey => this.getPendingDestroy(ownerKey),
      has: ownerKey => this.hasPendingDestroy(ownerKey),
      size: () => this.getPendingDestroyCount(),
      keys: () => this.getPendingDestroyOwnerKeys()
    })
  }

  getOrCreateOwnerRecord (ownerKey, meta) {
    let record = this.ownerRecords.get(ownerKey)
    if (!record) {
      record = {
        ownerKey,
        rootId: meta.rootId,
        collectionName: meta.collectionName,
        params: meta.params,
        transportHash: meta.transportHash,
        fetchCount: 0,
        subscribeCount: 0,
        tokens: createOwnerTokenCounts()
      }
      this.ownerRecords.set(ownerKey, record)
    } else {
      if (meta.rootId != null) record.rootId = meta.rootId
      if (meta.collectionName != null) record.collectionName = meta.collectionName
      if (meta.params != null) record.params = meta.params
      if (meta.transportHash != null) record.transportHash = meta.transportHash
    }
    return record
  }

  getOrCreateEntry (transportHash) {
    let entry = this.entries.get(transportHash)
    if (!entry) {
      entry = {
        transportHash,
        mode: 'idle',
        targetMode: 'idle',
        phase: 'stable',
        runtime: null,
        owners: new Set(),
        pendingDestroyByOwner: new Map(),
        downgradeGrace: null,
        reconcilePromise: null
      }
      this.entries.set(transportHash, entry)
    }
    return entry
  }

  getEntry (transportHash) {
    return this.entries.get(transportHash)
  }

  syncOwnerMirror () {}

  clearOwnerMirror () {}

  syncEntryMirror () {}

  deleteEntryIfEmpty (transportHash) {
    const entry = this.entries.get(transportHash)
    if (!entry) return
    if (entry.owners.size > 0) return
    if (entry.pendingDestroyByOwner.size > 0) return
    if (entry.runtime) return
    if (entry.phase === 'transition') return
    this.entries.delete(transportHash)
  }

  addOwnerToEntry (record) {
    const entry = this.getOrCreateEntry(record.transportHash)
    if (entry.owners.has(record.ownerKey)) {
      this.syncEntryMirror(entry)
      return entry
    }
    entry.owners.add(record.ownerKey)
    attachQueryRoot(entry.runtime, record.rootId)
    registerRootOwnedRuntime(record.rootId, this.runtimeKind, record.transportHash)
    this.syncEntryMirror(entry)
    return entry
  }

  // `keepRoot` leaves the owner's root attached (its materialized data stays)
  // and registered with the root while the owner lingers in its GC grace; the
  // owner's pending destroy (or root close) detaches it later.
  removeOwnerFromEntry (record, { keepRoot = false } = {}) {
    const entry = this.entries.get(record.transportHash)
    if (!entry) return
    entry.owners.delete(record.ownerKey)
    if (!keepRoot) {
      detachQueryRoot(entry.runtime, record.rootId)
      unregisterRootOwnedRuntime(record.rootId, this.runtimeKind, record.transportHash)
    }
    this.syncEntryMirror(entry)
  }

  getEntryMeta (transportHash) {
    const entry = this.entries.get(transportHash)
    if (entry?.runtime) {
      return {
        collectionName: entry.runtime.collectionName,
        params: entry.runtime.params
      }
    }
    const ownerKey = entry?.owners.values()?.next?.().value
    if (ownerKey) {
      const record = this.ownerRecords.get(ownerKey)
      if (record) {
        return {
          collectionName: record.collectionName,
          params: record.params
        }
      }
    }
    const parsed = parseQueryHash(transportHash)
    return {
      collectionName: parsed.collectionName,
      params: parsed.params
    }
  }

  ensureRuntime (transportHash) {
    const entry = this.getOrCreateEntry(transportHash)
    if (!entry.runtime) {
      const { collectionName, params } = this.getEntryMeta(transportHash)
      entry.runtime = new this.QueryClass(collectionName, params, { hash: transportHash })
    }
    this.syncRuntimeRoots(entry)
    this.syncEntryMirror(entry)
    return entry.runtime
  }

  syncRuntimeRoots (entry) {
    if (!entry?.runtime) return
    for (const ownerKey of entry.owners) {
      const record = this.ownerRecords.get(ownerKey)
      if (!record) continue
      attachQueryRoot(entry.runtime, record.rootId)
    }
  }

  subscribe ($query, { intent = 'subscribe' } = {}) {
    const collectionName = $query[COLLECTION_NAME]
    const params = cloneQueryParams(collectionName, $query[PARAMS])
    const transportHash = $query[HASH]
    const rootId = getOwningRootId($query)
    const ownerKey = getQueryOwnerKey(rootId, transportHash)
    this.cancelDestroy(ownerKey, transportHash)

    const record = this.getOrCreateOwnerRecord(ownerKey, {
      rootId,
      collectionName,
      params,
      transportHash
    })
    const entry = this.addOwnerToEntry(record)
    this.incrementOwnerIntent(record, intent)
    const token = getQueryFinalizationToken($query)
    if (addOwnerToken(record.tokens, token, intent)) {
      this.fr.register($query, { ownerKey, token }, token)
    }

    // A subscriber arriving in a downgrade grace keeps the transport live.
    if (this.getDesiredTransportMode(transportHash) === 'subscribe') clearDowngradeGrace(entry)
    // Join a settled transport synchronously, including one lingering ownerless
    // in its GC grace: the runtime is materialized and the root is attached.
    const targetMode = this.getTargetTransportMode(transportHash)
    if (canJoinTransport(entry, targetMode)) {
      entry.targetMode = targetMode
      return
    }
    return this.reconcileTransport(transportHash)
  }

  // Releases one owner count. The returned promise settles once the release is
  // applied; with `awaitDestroy` (the default) it also waits for a deferred GC
  // destroy of the owner, which public unsub() does not.
  async unsubscribe ($query, { intent = 'subscribe', awaitDestroy = true, minGraceMs } = {}) {
    const ownerKey = getQueryOwnerKey(getOwningRootId($query), $query[HASH])
    const record = this.ownerRecords.get(ownerKey)
    const currentIntentCount = this.getOwnerIntentCount(record, intent)
    if (currentIntentCount <= 0) {
      if (ERROR_ON_EXCESSIVE_UNSUBSCRIBES) throw Error(ERRORS.notSubscribed($query))
      return
    }
    this.setOwnerIntentCount(record, intent, currentIntentCount - 1)
    const charged = removeOwnerToken(record.tokens, getQueryFinalizationToken($query), intent)
    if (charged.emptied) this.fr.unregister(charged.token)
    await this.applyOwnerRelease(record, { awaitDestroy, minGraceMs })
  }

  // Shared tail of an owner release (unsubscribe and finalized signals).
  // `minGraceMs` extends the grace of what this release leaves behind beyond
  // the GC delay (React render attempts that were not committed).
  async applyOwnerRelease (record, { awaitDestroy = true, minGraceMs = 0 } = {}) {
    const { ownerKey, transportHash } = record
    const count = this.getOwnerTotalCount(record)
    if (count === 0) {
      for (const token of record.tokens.keys()) this.fr.unregister(token)
      record.tokens.clear()
      this.removeOwnerFromEntry(record, { keepRoot: true })
    }
    const delay = Math.max(getSubscriptionGcDelay(), minGraceMs)
    const deferred = delay > 0
    const entry = this.entries.get(transportHash)
    if (entry?.owners.size > 0) scheduleDowngradeGrace(this, transportHash, entry, delay)
    else clearDowngradeGrace(entry)
    const destroyPromise = count === 0
      ? this.scheduleDestroy(record.collectionName, record.params, ownerKey, { transportHash, delay })
      : undefined

    await this.reconcileTransport(transportHash)
    if (count > 0) return
    if (deferred && !awaitDestroy) return
    await destroyPromise
  }

  // The signal that acquired these counts was garbage-collected without
  // unsub(): release exactly its counts. Another signal of the same root and
  // params may still own the query through the same owner key.
  async releaseFinalizedToken (ownerKey, token) {
    const record = this.ownerRecords.get(ownerKey)
    const counts = record?.tokens.get(token)
    if (!counts) return
    record.tokens.delete(token)
    this.setOwnerIntentCount(record, 'fetch', record.fetchCount - counts.fetchCount)
    this.setOwnerIntentCount(record, 'subscribe', record.subscribeCount - counts.subscribeCount)
    await this.applyOwnerRelease(record, { awaitDestroy: false })
  }

  async destroy (collectionName, params, options = {}) {
    const transportHash = hashQuery(collectionName, params)
    const entry = this.entries.get(transportHash)
    const ownerKeys = new Set([
      ...(entry?.owners || []),
      ...(entry?.pendingDestroyByOwner.keys() || [])
    ])
    for (const ownerKey of ownerKeys) {
      await this.destroyByOwnerKey(ownerKey, {
        collectionName,
        params,
        transportHash,
        force: options.force ?? true
      })
    }
  }

  async clear () {
    const ownerKeys = new Set([
      ...this.getPendingDestroyOwnerKeys(),
      ...this.ownerRecords.keys()
    ])
    for (const ownerKey of ownerKeys) {
      await this.destroyByOwnerKey(ownerKey, { force: true })
    }
    this.entries.clear()
    this.ownerRecords.clear()
  }

  async flushPendingDestroys () {
    await flushDowngradeGraces(this)
    const ownerKeys = Array.from(this.getPendingDestroyOwnerKeys())
    for (const ownerKey of ownerKeys) {
      await this.destroyByOwnerKey(ownerKey)
    }
  }

  async scheduleDestroy (collectionName, params, ownerKey, options = {}) {
    const transportHash = options.transportHash ?? hashQuery(collectionName, params)
    const fallbackOwnerKey = ownerKey ?? getQueryOwnerKey(undefined, transportHash)
    const delay = options.delay ?? getSubscriptionGcDelay()
    if (delay <= 0) {
      await this.destroyByOwnerKey(fallbackOwnerKey, {
        collectionName,
        params,
        transportHash,
        force: !!options.force
      })
      return
    }
    const entry = this.getOrCreateEntry(transportHash)
    const existing = entry.pendingDestroyByOwner.get(fallbackOwnerKey)
    if (existing) {
      if (options.force) existing.force = true
      return existing.promise
    }
    const pendingDestroy = createPendingDestroyEntry()
    if (options.force) pendingDestroy.force = true
    pendingDestroy.collectionName = collectionName
    pendingDestroy.params = params
    pendingDestroy.transportHash = transportHash
    pendingDestroy.timer = unrefTimer(setTimeout(() => {
      this.destroyByOwnerKey(fallbackOwnerKey, {
        collectionName,
        params,
        transportHash: pendingDestroy.transportHash,
        force: pendingDestroy.force
      })
        .catch(ignoreDestroyError)
    }, delay))
    entry.pendingDestroyByOwner.set(fallbackOwnerKey, pendingDestroy)
    return pendingDestroy.promise
  }

  cancelDestroy (ownerKey, transportHash) {
    const pendingDestroy = this.takePendingDestroy(ownerKey, transportHash)
    if (!pendingDestroy) return
    pendingDestroy.resolve()
  }

  reconcileTransport (transportHash) {
    return reconcileEntryTransport(this, transportHash)
  }

  async reconcileTransportNow (transportHash, settle) {
    const entry = this.getOrCreateEntry(transportHash)
    while (true) {
      let query = entry.runtime
      const desiredMode = entry.targetMode = this.getTargetTransportMode(transportHash)
      const currentMode = query?.activeTransportMode ?? entry.mode
      entry.mode = currentMode
      if (desiredMode === currentMode) {
        settle?.()
        return
      }
      if (desiredMode === 'idle') {
        if (query && currentMode !== 'idle') {
          await unsubscribeQueryTransport(query, { keepRoots: true })
        }
        entry.mode = 'idle'
        continue
      }
      if (currentMode !== 'idle' && query) {
        await unsubscribeQueryTransport(query, { keepRoots: true })
        entry.mode = 'idle'
        continue
      }
      query = this.ensureRuntime(transportHash)
      await subscribeQueryTransport(query, desiredMode)
      entry.runtime = query
      entry.mode = query.activeTransportMode || desiredMode
      this.syncEntryMirror(entry)
    }
  }

  getOwnerIntentCount (record, intent) {
    if (!record) return 0
    return intent === 'fetch' ? record.fetchCount : record.subscribeCount
  }

  setOwnerIntentCount (record, intent, count) {
    if (!record) return
    if (intent === 'fetch') record.fetchCount = Math.max(count, 0)
    else record.subscribeCount = Math.max(count, 0)
    this.syncOwnerMirror(record)
  }

  incrementOwnerIntent (record, intent) {
    this.setOwnerIntentCount(record, intent, this.getOwnerIntentCount(record, intent) + 1)
  }

  getOwnerTotalCount (recordOrOwnerKey) {
    const record = typeof recordOrOwnerKey === 'string'
      ? this.ownerRecords.get(recordOrOwnerKey)
      : recordOrOwnerKey
    if (!record) return 0
    return record.fetchCount + record.subscribeCount
  }

  getDesiredTransportMode (transportHash) {
    const entry = this.entries.get(transportHash)
    if (!entry || entry.owners.size === 0) return 'idle'
    let hasFetchBackedOwner = false
    for (const ownerKey of entry.owners) {
      const record = this.ownerRecords.get(ownerKey)
      if (!record) continue
      const subscribeCount = record.subscribeCount
      const fetchCount = record.fetchCount
      const rootId = record.rootId
      const subscribeMode = getRootTransportMode(rootId, 'subscribe')
      if (subscribeCount > 0 && subscribeMode === 'subscribe') return 'subscribe'
      if (fetchCount > 0 || (subscribeCount > 0 && subscribeMode === 'fetch')) {
        hasFetchBackedOwner = true
      }
    }
    return hasFetchBackedOwner ? 'fetch' : 'idle'
  }

  // Owner-derived mode, except that a live transport lingers while an
  // ownerless entry has a released owner's GC destroy pending, or in a
  // downgrade grace while owners remain (see subscriptionTransport.js).
  getTargetTransportMode (transportHash) {
    const entry = this.entries.get(transportHash)
    const lingering = !!entry && (entry.owners.size === 0
      ? entry.pendingDestroyByOwner.size > 0
      : !!entry.downgradeGrace)
    return getTransportTargetMode(this.getDesiredTransportMode(transportHash), entry, lingering)
  }

  async destroyTransportEntry (transportHash, runtime) {
    clearDowngradeGrace(this.entries.get(transportHash))
    const activeRuntime = this.entries.get(transportHash)?.runtime || runtime
    if (!activeRuntime) {
      const entry = this.entries.get(transportHash)
      if (entry) {
        entry.runtime = null
        entry.mode = 'idle'
      }
      this.deleteEntryIfEmpty(transportHash)
      return
    }
    if (activeRuntime.activeTransportMode !== 'idle') {
      await unsubscribeQueryTransport(activeRuntime, { keepRoots: true })
    }
    activeRuntime._detachTransportData?.({ keepRoots: false })
    const finalEntry = this.entries.get(transportHash)
    if (finalEntry && finalEntry.owners.size > 0) return
    if (finalEntry) {
      finalEntry.runtime = null
      finalEntry.mode = 'idle'
    }
    this.deleteEntryIfEmpty(transportHash)
  }

  async destroyByOwnerKey (ownerKey, options = {}) {
    const pendingDestroy = this.takePendingDestroy(ownerKey, options.transportHash)
    if (pendingDestroy?.force) options.force = true
    if (options.collectionName == null && pendingDestroy?.collectionName != null) {
      options.collectionName = pendingDestroy.collectionName
    }
    if (options.params == null && pendingDestroy?.params != null) {
      options.params = pendingDestroy.params
    }

    const settlePending = err => {
      if (!pendingDestroy) return
      if (err) pendingDestroy.reject(err)
      else pendingDestroy.resolve()
    }

    try {
      const count = this.getTrackedOwnerCount(ownerKey) || 0
      if (!options.force && count > 0) {
        settlePending()
        return
      }
      const record = this.ownerRecords.get(ownerKey)
      if (!record) {
        const ownerCount = this.getTrackedOwnerCount(ownerKey) || 0
        const transportHash = options.transportHash ||
          (options.collectionName && options.params ? hashQuery(options.collectionName, options.params) : undefined)
        if (!transportHash) {
          settlePending()
          return
        }
        const entry = this.entries.get(transportHash)
        if (entry && ownerCount > 0) {
          entry.owners.delete(ownerKey)
        }
        const query = entry?.runtime
        await this.reconcileTransport(transportHash)
        const nextEntry = this.entries.get(transportHash)
        if (!nextEntry || !this.isTransportStillHeld(nextEntry)) {
          await this.destroyTransportEntry(transportHash, query)
        }
        settlePending()
        return
      }
      const { transportHash } = record
      const entry = this.entries.get(transportHash)
      const query = entry?.runtime
      // Also detaches the root of an owner that was lingering in its grace.
      this.removeOwnerFromEntry(record)
      for (const token of record.tokens.keys()) this.fr.unregister(token)
      this.ownerRecords.delete(ownerKey)

      await this.reconcileTransport(transportHash)
      const nextEntry = this.entries.get(transportHash)
      if (nextEntry && this.isTransportStillHeld(nextEntry)) {
        settlePending()
        return
      }
      await this.destroyTransportEntry(transportHash, query)
      settlePending()
    } catch (err) {
      settlePending(err)
      throw err
    }
  }

  // Active owners keep the transport, and so do other released owners still in
  // their grace: a forced destroy ends only the claims of the owner it targets
  // (clear() and destroy() target every owner, lingering ones included).
  isTransportStillHeld (entry) {
    return entry.owners.size > 0 || entry.pendingDestroyByOwner.size > 0
  }

  async destroyByRuntimeHash (runtimeHash, options = {}) {
    const rootId = options.rootId ?? options.root?.[ROOT_ID]
    const ownerKey = getQueryOwnerKey(rootId, runtimeHash)
    return this.destroyByOwnerKey(ownerKey, {
      ...options,
      transportHash: runtimeHash
    })
  }

  takePendingDestroy (ownerKey, transportHash) {
    const entry = this.getEntryForPendingDestroy(ownerKey, transportHash)
    const pendingDestroy = entry?.pendingDestroyByOwner.get(ownerKey)
    if (!pendingDestroy) return
    clearTimeout(pendingDestroy.timer)
    entry.pendingDestroyByOwner.delete(ownerKey)
    this.deleteEntryIfEmpty(entry.transportHash)
    return pendingDestroy
  }

  removeOwnerMeta (ownerKey, transportHash) {
    const knownTransportHash = transportHash ?? this.ownerRecords.get(ownerKey)?.transportHash
    const entry = knownTransportHash ? this.entries.get(knownTransportHash) : undefined
    if (!entry) return
    entry.owners.delete(ownerKey)
    this.deleteEntryIfEmpty(knownTransportHash)
  }

  cleanupStaleTransportState (transportHash) {
    if (!transportHash) return
    const entry = this.entries.get(transportHash)
    if (entry) {
      if (!entry.runtime && entry.owners.size === 0) this.entries.delete(transportHash)
    }
  }

  getRuntime (transportHash) {
    return this.entries.get(transportHash)?.runtime
  }

  hasRuntime (transportHash) {
    return !!this.getRuntime(transportHash)
  }

  getRuntimeCount () {
    return countMapLike(this.entries, entry => !!entry.runtime)
  }

  getTrackedOwnerCount (ownerKey) {
    const record = this.ownerRecords.get(ownerKey)
    if (record) return record.fetchCount + record.subscribeCount
    if (this.hasPendingDestroy(ownerKey)) return 0
    return undefined
  }

  getTrackedOwnerCountSize () {
    return getUnionSize(this.ownerRecords.keys(), this.getPendingDestroyOwnerKeys())
  }

  getTransportOwnerCount (transportHash) {
    const entry = this.entries.get(transportHash)
    if (!entry) return undefined
    if (entry.owners.size > 0 || entry.runtime) return entry.owners.size
    return undefined
  }

  getTrackedTransportCountSize () {
    return countMapLike(this.entries, entry => entry.owners.size > 0 || !!entry.runtime)
  }

  getOwnerMeta (ownerKey) {
    const record = this.ownerRecords.get(ownerKey)
    if (!record) return undefined
    return {
      collectionName: record.collectionName,
      params: record.params,
      transportHash: record.transportHash,
      rootId: record.rootId
    }
  }

  getOwnerKeys (transportHash) {
    const owners = this.entries.get(transportHash)?.owners
    if (!owners?.size) return undefined
    return new Set(owners)
  }

  getPendingDestroy (ownerKey, transportHash) {
    const entry = this.getEntryForPendingDestroy(ownerKey, transportHash)
    return entry?.pendingDestroyByOwner.get(ownerKey)
  }

  hasPendingDestroy (ownerKey, transportHash) {
    return !!this.getPendingDestroy(ownerKey, transportHash)
  }

  getPendingDestroyCount () {
    let count = 0
    for (const entry of this.entries.values()) count += entry.pendingDestroyByOwner.size
    return count
  }

  getEntryForPendingDestroy (ownerKey, transportHash) {
    if (transportHash) return this.entries.get(transportHash)
    const knownTransportHash = this.ownerRecords.get(ownerKey)?.transportHash
    if (knownTransportHash) return this.entries.get(knownTransportHash)
    for (const entry of this.entries.values()) {
      if (entry.pendingDestroyByOwner.has(ownerKey)) return entry
    }
  }

  * getPendingDestroyOwnerKeys () {
    for (const entry of this.entries.values()) {
      yield * entry.pendingDestroyByOwner.keys()
    }
  }
}

export const querySubscriptions = new QuerySubscriptions()

function maybeMaterializeQueryDocsToCollection (collectionName, shareDocs) {
  for (const doc of shareDocs) {
    // A query result can be a missing doc: deleted on this client (or by an
    // op it received) after the server read the query results. ShareDB keeps
    // the deleted doc (it ignores the older snapshot) in the results until
    // the server sends the removal; a fetch query keeps it for good.
    if (!doc?.id || isMissingShareDoc(doc) || doc.data == null) continue
    const existing = getRaw([collectionName, doc.id])
    if (existing != null) continue
    const idFields = getIdFieldsForSegments([collectionName, doc.id])
    if (isPlainObject(doc.data)) injectIdFields(doc.data, idFields, doc.id)
    _set([collectionName, doc.id], raw(doc.data))
  }
}

export function materializeQueryDataDocsToCollection (collectionName, docs) {
  if (!Array.isArray(docs)) return
  for (const doc of docs) {
    const rawDoc = raw(doc)
    if (!isPlainObject(rawDoc)) continue
    const docId = rawDoc._id ?? rawDoc.id
    if (docId == null) continue
    const existing = getRaw([collectionName, docId])
    if (existing != null) continue
    // the list can still hold a doc deleted after it was read: never bring
    // it back
    if (isMissingShareDoc(getExistingShareDoc(collectionName, docId))) continue
    const idFields = getIdFieldsForSegments([collectionName, docId])
    injectIdFields(rawDoc, idFields, docId)
    _set([collectionName, docId], rawDoc)
  }
}

function isSameList (list, next) {
  if (list.length !== next.length) return false
  for (let i = 0; i < list.length; i++) {
    if (list[i] !== next[i]) return false
  }
  return true
}

function getExistingShareDoc (collectionName, docId) {
  return getConnection().collections?.[collectionName]?.[docId]
}

export function hashQuery (collectionName, params) {
  params = normalizeQueryParamsForHash(collectionName, params)
  // TODO: probably makes sense to use fast-stable-json-stringify for this because of the params
  return JSON.stringify({ query: [collectionName, params] })
}

export function parseQueryHash (hash) {
  try {
    const { query: [collectionName, params] } = JSON.parse(hash)
    return { collectionName, params }
  } catch (err) {
    return {}
  }
}

export function getQuerySignal (collectionName, params, options) {
  params = cloneQueryParams(collectionName, params)
  const transportHash = hashQuery(collectionName, params)
  const { root, signalOptions } = parseQuerySignalOptions(options)
  const signalHash = getScopedSignalHash(root?.[ROOT_ID] ?? signalOptions.rootId, transportHash, 'querySignal')

  const $query = getSignal(root, [collectionName], {
    signalHash,
    ...signalOptions
  })
  $query[IS_QUERY] ??= true
  $query[COLLECTION_NAME] ??= collectionName
  $query[PARAMS] ??= params
  $query[HASH] ??= transportHash
  setSignalRuntimeDescriptor($query, {
    kind: 'query',
    collectionName,
    itemPattern: [collectionName, '*']
  })
  return $query
}

const ERRORS = {
  notSubscribed: $query => `
    Trying to unsubscribe from Query when not subscribed.
      Collection: ${$query[COLLECTION_NAME]}
      Params: ${$query[PARAMS]}
  `
}

function ignoreDestroyError () {}

function attachQueryRoot (query, rootId) {
  if (rootId == null || !query) return
  if (typeof query.attachRoot === 'function') {
    query.attachRoot(rootId)
    return
  }
  if (query.rootIds?.add) query.rootIds.add(rootId)
}

function detachQueryRoot (query, rootId) {
  if (rootId == null || !query) return
  if (typeof query.detachRoot === 'function') {
    query.detachRoot(rootId)
    return
  }
  if (query.rootIds?.delete) query.rootIds.delete(rootId)
}

function getOwningRootId ($query) {
  return normalizeRootId(getRoot($query)?.[ROOT_ID])
}

function getQueryOwnerKey (rootId, transportHash) {
  return getScopedSignalHash(rootId, transportHash, 'queryOwner')
}

export function cloneQueryParams (collectionName, params) {
  return JSON.parse(JSON.stringify(params))
}

function parseQuerySignalOptions (options) {
  if (!options || typeof options !== 'object') {
    return {
      root: undefined,
      signalOptions: {}
    }
  }
  const { root, ...signalOptions } = options
  return { root, signalOptions }
}

function normalizeQueryParamsForHash (collectionName, params) {
  return params
}

function createPendingDestroyEntry () {
  let resolvePending
  let rejectPending
  const promise = new Promise((resolve, reject) => {
    resolvePending = resolve
    rejectPending = reject
  })
  promise.catch(ignoreDestroyError)
  return {
    timer: undefined,
    force: false,
    collectionName: undefined,
    params: undefined,
    promise,
    resolve: resolvePending,
    reject: rejectPending
  }
}

function createReadonlyMapView ({ get, has, size, keys }) {
  return {
    get,
    has,
    get size () {
      return size()
    },
    * keys () {
      yield * keys()
    },
    * values () {
      for (const key of keys()) yield get(key)
    },
    * entries () {
      for (const key of keys()) yield [key, get(key)]
    },
    [Symbol.iterator] () {
      return this.entries()
    }
  }
}

function countMapLike (iterableMap, predicate) {
  let count = 0
  for (const value of iterableMap.values()) {
    if (predicate(value)) count++
  }
  return count
}

function getUnionSize (aKeys, bKeys) {
  const keys = new Set(aKeys)
  for (const key of bKeys) keys.add(key)
  return keys.size
}

function * getUnionKeys (aKeys, bKeys) {
  const keys = new Set(aKeys)
  for (const key of bKeys) keys.add(key)
  yield * keys
}

function * filterMapKeys (iterableMap, predicate) {
  for (const [key, value] of iterableMap.entries()) {
    if (predicate(value)) yield key
  }
}

async function subscribeQueryTransport (query, mode) {
  query.requestedTransportMode = mode
  if (typeof query._subscribe === 'function') {
    query._subscribing = query._subscribe()
      .then(() => {
        query._subscribing = undefined
        query.initialized = undefined
        query.init?.()
      }, err => {
        query._subscribing = undefined
        throw err
      })
    await query._subscribing
    return
  }
  await query.subscribe({ mode })
  if (query.activeTransportMode == null || query.activeTransportMode === 'idle') {
    query.activeTransportMode = mode
  }
  if (query.initialized !== true) query.init?.()
}

async function unsubscribeQueryTransport (query, { keepRoots = true } = {}) {
  if (!query) return
  if (query.initialized) {
    query.initialized = undefined
    query._detachTransportData?.({ keepRoots })
  }
  if (typeof query._unsubscribe === 'function') {
    await query._unsubscribe()
    return
  }
  await query.unsubscribe?.()
  query.activeTransportMode = 'idle'
}
