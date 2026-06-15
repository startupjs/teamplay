import { raw } from '@nx-js/observer-util'
import { set as _set, getRaw } from './dataTree.js'
import getSignal from './getSignal.ts'
import { getConnection } from './connection.ts'
import { isCompatEnv } from './compatEnv.js'
import { docSubscriptions } from './Doc.js'
import FinalizationRegistry from '../utils/MockFinalizationRegistry.ts'
import SubscriptionState from './SubscriptionState.js'
import { getIdFieldsForSegments, injectIdFields, isPlainObject } from './idFields.ts'
import { getSubscriptionGcDelay } from './subscriptionGcDelay.ts'
import { getScopedSignalHash, normalizeRootId } from './rootScope.ts'
import { getRoot, ROOT_ID, getRootTransportMode } from './Root.ts'
import { registerRootOwnedRuntime, unregisterRootOwnedRuntime } from './rootContext.ts'
import { setSignalRuntimeDescriptor } from './signalRuntimeDescriptor.ts'
import {
  delPrivateData,
  getPrivateData,
  setPrivateData
} from './privateData.js'

const ERROR_ON_EXCESSIVE_UNSUBSCRIBES = false
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
    this.lifecycle = new SubscriptionState({
      onSubscribe: () => this._subscribe(),
      onUnsubscribe: () => this._unsubscribe()
    })
    this.requestedTransportMode = 'subscribe'
    this.activeTransportMode = 'idle'
  }

  get subscribed () {
    return this.activeTransportMode !== 'idle' || this.lifecycle.subscribed
  }

  init () {
    if (this.initialized) return
    this.initialized = true
    this._initData()
  }

  async subscribe ({ mode } = {}) {
    if (mode) this.requestedTransportMode = mode
    await this.lifecycle.subscribe()
    this.init()
  }

  async unsubscribe () {
    await this.lifecycle.unsubscribe()
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
    const ids = this.shareQuery.results.map(doc => doc.id)
    for (const docId of ids) {
      const $doc = getSignal(undefined, [this.collectionName, docId])
      docSubscriptions.retain($doc)
      this.docSignals.add($doc)
    }
    this._syncAllRootsData()

    this.shareQuery.on('insert', (shareDocs, index) => {
      maybeMaterializeQueryDocsToCollection(this.collectionName, shareDocs)
      const newDocs = this._mapShareDocsToRaw(shareDocs)
      const ids = shareDocs.map(doc => doc.id)
      for (const docId of ids) {
        const $doc = getSignal(undefined, [this.collectionName, docId])
        docSubscriptions.retain($doc)
        this.docSignals.add($doc)
      }
      this._forEachRoot(rootId => {
        const docs = getPrivateData(rootId, [QUERIES, this.hash, 'docs'])
        const idsState = getPrivateData(rootId, [QUERIES, this.hash, 'ids'])
        if (!Array.isArray(docs) || !Array.isArray(idsState)) return
        docs.splice(index, 0, ...newDocs)
        idsState.splice(index, 0, ...ids)
      })
    })
    this.shareQuery.on('move', (shareDocs, from, to) => {
      const movedDocs = this._mapShareDocsToRaw(shareDocs)
      const movedIds = shareDocs.map(doc => doc.id)
      this._forEachRoot(rootId => {
        const docs = getPrivateData(rootId, [QUERIES, this.hash, 'docs'])
        const ids = getPrivateData(rootId, [QUERIES, this.hash, 'ids'])
        if (!Array.isArray(docs) || !Array.isArray(ids)) return
        docs.splice(from, shareDocs.length)
        docs.splice(to, 0, ...movedDocs)

        ids.splice(from, shareDocs.length)
        ids.splice(to, 0, ...movedIds)
      })
    })
    this.shareQuery.on('remove', (shareDocs, index) => {
      const docIds = shareDocs.map(doc => doc.id)
      for (const docId of docIds) {
        const $doc = getSignal(undefined, [this.collectionName, docId])
        docSubscriptions.release($doc).catch(ignoreDestroyError)
        this.docSignals.delete($doc)
      }
      this._forEachRoot(rootId => {
        const docs = getPrivateData(rootId, [QUERIES, this.hash, 'docs'])
        const ids = getPrivateData(rootId, [QUERIES, this.hash, 'ids'])
        if (!Array.isArray(docs) || !Array.isArray(ids)) return
        docs.splice(index, shareDocs.length)

        ids.splice(index, docIds.length)
      })
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
    const docs = this._mapShareDocsToRaw(this.shareQuery.results)
    setPrivateData(rootId, [QUERIES, this.hash, 'docs'], docs)

    const ids = this.shareQuery.results.map(doc => doc.id)
    setPrivateData(rootId, [QUERIES, this.hash, 'ids'], ids)

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

  _mapShareDocsToRaw (shareDocs) {
    return shareDocs.map(doc => {
      const idFields = getIdFieldsForSegments([this.collectionName, doc.id])
      if (isPlainObject(doc.data)) injectIdFields(doc.data, idFields, doc.id)
      return raw(doc.data)
    })
  }

  _detachTransportData ({ keepRoots = true } = {}) {
    for (const $doc of this.docSignals) {
      docSubscriptions.release($doc).catch(ignoreDestroyError)
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
    this.fr = new FinalizationRegistry(({ collectionName, params, ownerKey }) => {
      this.scheduleDestroy(collectionName, params, ownerKey, { force: true })
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
        subscribeCount: 0
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

  removeOwnerFromEntry (record) {
    const entry = this.entries.get(record.transportHash)
    if (!entry) return
    if (!entry.owners.delete(record.ownerKey)) {
      this.syncEntryMirror(entry)
      return
    }
    detachQueryRoot(entry.runtime, record.rootId)
    unregisterRootOwnedRuntime(record.rootId, this.runtimeKind, record.transportHash)
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

    const previousCount = this.getOwnerTotalCount(ownerKey)
    let record = this.ownerRecords.get(ownerKey)

    record = this.getOrCreateOwnerRecord(ownerKey, {
      rootId,
      collectionName,
      params,
      transportHash
    })
    const entry = this.addOwnerToEntry(record)
    this.incrementOwnerIntent(record, intent)
    this.fr.register($query, { collectionName, params, ownerKey }, $query)

    if (
      previousCount > 0 &&
      entry.runtime &&
      entry.phase === 'stable' &&
      this.getDesiredTransportMode(transportHash) === entry.mode
    ) return

    return this.reconcileTransport(transportHash)
  }

  async unsubscribe ($query, { intent = 'subscribe' } = {}) {
    const ownerKey = getQueryOwnerKey(getOwningRootId($query), $query[HASH])
    const record = this.ownerRecords.get(ownerKey)
    const currentIntentCount = this.getOwnerIntentCount(record, intent)
    if (currentIntentCount <= 0) {
      if (ERROR_ON_EXCESSIVE_UNSUBSCRIBES) throw Error(ERRORS.notSubscribed($query))
      return
    }
    const transportHash = record?.transportHash ?? $query[HASH]
    this.setOwnerIntentCount(record, intent, currentIntentCount - 1)

    const count = this.getOwnerTotalCount(record)

    if (count === 0) {
      this.fr.unregister($query)
      if (record) {
        this.removeOwnerFromEntry(record)
      }
    }

    const destroyPromise = count === 0
      ? this.scheduleDestroy($query[COLLECTION_NAME], $query[PARAMS], ownerKey, { transportHash })
      : undefined

    await this.reconcileTransport(transportHash)
    if (count > 0) return
    await destroyPromise
  }

  async destroy (collectionName, params, options = {}) {
    const transportHash = hashQuery(collectionName, params)
    const ownerKeys = Array.from(this.getOwnerKeys(transportHash) || [])
    for (const ownerKey of ownerKeys) {
      await this.destroyByOwnerKey(ownerKey, {
        collectionName,
        params,
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
    const ownerKeys = Array.from(this.getPendingDestroyOwnerKeys())
    for (const ownerKey of ownerKeys) {
      await this.destroyByOwnerKey(ownerKey)
    }
  }

  async scheduleDestroy (collectionName, params, ownerKey, options = {}) {
    const transportHash = options.transportHash ?? hashQuery(collectionName, params)
    const fallbackOwnerKey = ownerKey ?? getQueryOwnerKey(undefined, transportHash)
    const delay = getSubscriptionGcDelay()
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
    pendingDestroy.timer = setTimeout(() => {
      this.destroyByOwnerKey(fallbackOwnerKey, {
        collectionName,
        params,
        transportHash: pendingDestroy.transportHash,
        force: pendingDestroy.force
      })
        .catch(ignoreDestroyError)
    }, delay)
    entry.pendingDestroyByOwner.set(fallbackOwnerKey, pendingDestroy)
    return pendingDestroy.promise
  }

  cancelDestroy (ownerKey, transportHash) {
    const pendingDestroy = this.takePendingDestroy(ownerKey, transportHash)
    if (!pendingDestroy) return
    pendingDestroy.resolve()
  }

  async reconcileTransport (transportHash) {
    const entry = this.getOrCreateEntry(transportHash)
    entry.targetMode = this.getDesiredTransportMode(transportHash)
    if (entry.phase === 'transition' && entry.reconcilePromise) return entry.reconcilePromise
    const next = Promise.resolve()
      .catch(ignoreDestroyError)
      .then(() => this.reconcileTransportNow(transportHash))
    entry.phase = 'transition'
    entry.reconcilePromise = next
    try {
      await next
    } finally {
      const currentEntry = this.entries.get(transportHash)
      if (currentEntry?.reconcilePromise === next) {
        currentEntry.reconcilePromise = null
        currentEntry.phase = 'stable'
      }
      this.deleteEntryIfEmpty(transportHash)
    }
  }

  async reconcileTransportNow (transportHash) {
    const entry = this.getOrCreateEntry(transportHash)
    while (true) {
      let query = entry.runtime
      const desiredMode = entry.targetMode = this.getDesiredTransportMode(transportHash)
      const currentMode = query?.activeTransportMode ?? entry.mode
      entry.mode = currentMode
      if (desiredMode === currentMode) return
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

  async destroyTransportEntry (transportHash, runtime) {
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
        if (!nextEntry || nextEntry.owners.size === 0) {
          await this.destroyTransportEntry(transportHash, query)
        }
        settlePending()
        return
      }
      const { transportHash } = record
      const entry = this.entries.get(transportHash)
      const query = entry?.runtime
      if (entry?.owners.has(ownerKey)) this.removeOwnerFromEntry(record)
      this.ownerRecords.delete(ownerKey)

      await this.reconcileTransport(transportHash)
      const nextEntry = this.entries.get(transportHash)
      if (nextEntry && nextEntry.owners.size > 0) {
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
  if (!isCompatEnv()) return
  for (const doc of shareDocs) {
    if (!doc?.id || doc.data == null) continue
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
    const idFields = getIdFieldsForSegments([collectionName, docId])
    injectIdFields(rawDoc, idFields, docId)
    _set([collectionName, docId], rawDoc)
  }
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
  warnIfCompatQueryParamsHaveUndefinedFields(collectionName, params)
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
  warnIfCompatQueryParamsHaveUndefinedFields(collectionName, params)
  return params
}

const warnedUndefinedQueryParamKeys = new Set()

function warnIfCompatQueryParamsHaveUndefinedFields (collectionName, params) {
  if (!isCompatEnv()) return

  const paths = getUndefinedQueryParamFieldPaths(params)
  if (paths.length === 0) return

  const key = `${collectionName || '<unknown>'}:${paths.join(',')}`
  if (warnedUndefinedQueryParamKeys.has(key)) return
  warnedUndefinedQueryParamKeys.add(key)

  console.warn(
    '[teamplay] Compat query params contain object fields with undefined values. ' +
    'TeamPlay now clones query params like non-compat mode, so these fields are dropped ' +
    'instead of being converted to null. Normalize query params explicitly.',
    {
      collectionName,
      paths
    },
    new Error().stack
  )
}

function getUndefinedQueryParamFieldPaths (value) {
  const paths = []
  collectUndefinedQueryParamFieldPaths(value, '', paths, new WeakSet())
  return paths
}

function collectUndefinedQueryParamFieldPaths (value, path, paths, seen) {
  if (value == null || typeof value !== 'object') return
  if (seen.has(value)) return
  seen.add(value)

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      collectUndefinedQueryParamFieldPaths(value[i], `${path}[${i}]`, paths, seen)
    }
    return
  }

  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue
    const childPath = path ? `${path}.${key}` : key
    if (value[key] === undefined) {
      paths.push(childPath)
      continue
    }
    collectUndefinedQueryParamFieldPaths(value[key], childPath, paths, seen)
  }
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
