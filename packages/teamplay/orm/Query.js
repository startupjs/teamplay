import { raw } from '@nx-js/observer-util'
import { set as _set, getRaw } from './dataTree.js'
import getSignal from './getSignal.js'
import { getConnection } from './connection.js'
import { emitModelChange, isModelEventsEnabled } from './Compat/modelEvents.js'
import { isCompatEnv } from './compatEnv.js'
import { docSubscriptions } from './Doc.js'
import FinalizationRegistry from '../utils/MockFinalizationRegistry.js'
import SubscriptionState from './SubscriptionState.js'
import { getIdFieldsForSegments, injectIdFields, isPlainObject } from './idFields.js'
import { getSubscriptionGcDelay } from './subscriptionGcDelay.js'
import { getScopedSignalHash } from './rootScope.js'
import { getRoot, ROOT_ID, getRootTransportMode } from './Root.js'
import { registerRootOwnedRuntime, unregisterRootOwnedRuntime } from './rootContext.js'
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

        if (!isModelEventsEnabled()) return
        const docsPath = [QUERIES, this.hash, 'docs']
        const idsPath = [QUERIES, this.hash, 'ids']
        for (let i = 0; i < newDocs.length; i++) {
          emitModelChange(rootId, docsPath.concat(index + i), newDocs[i], undefined, {
            op: 'queryInsert',
            index: index + i
          })
        }
        for (let i = 0; i < ids.length; i++) {
          emitModelChange(rootId, idsPath.concat(index + i), ids[i], undefined, {
            op: 'queryInsert',
            index: index + i
          })
        }
      })
    })
    this.shareQuery.on('move', (shareDocs, from, to) => {
      const movedDocs = this._mapShareDocsToRaw(shareDocs)
      const movedIds = shareDocs.map(doc => doc.id)
      this._forEachRoot(rootId => {
        const docs = getPrivateData(rootId, [QUERIES, this.hash, 'docs'])
        const ids = getPrivateData(rootId, [QUERIES, this.hash, 'ids'])
        if (!Array.isArray(docs) || !Array.isArray(ids)) return
        const prevDocs = isModelEventsEnabled() ? docs.slice() : undefined
        docs.splice(from, shareDocs.length)
        docs.splice(to, 0, ...movedDocs)

        const prevIds = isModelEventsEnabled() ? ids.slice() : undefined
        ids.splice(from, shareDocs.length)
        ids.splice(to, 0, ...movedIds)

        if (!isModelEventsEnabled()) return
        emitModelChange(rootId, [QUERIES, this.hash, 'docs'], docs, prevDocs, {
          op: 'queryMove',
          from,
          to,
          howMany: shareDocs.length
        })
        emitModelChange(rootId, [QUERIES, this.hash, 'ids'], ids, prevIds, {
          op: 'queryMove',
          from,
          to,
          howMany: shareDocs.length
        })
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
        const removedDocs = isModelEventsEnabled() ? docs.slice(index, index + shareDocs.length) : undefined
        docs.splice(index, shareDocs.length)

        const removedIds = isModelEventsEnabled() ? ids.slice(index, index + docIds.length) : undefined
        ids.splice(index, docIds.length)

        if (!isModelEventsEnabled()) return
        const docsPath = [QUERIES, this.hash, 'docs']
        const idsPath = [QUERIES, this.hash, 'ids']
        for (let i = 0; i < removedDocs.length; i++) {
          emitModelChange(rootId, docsPath.concat(index + i), undefined, removedDocs[i], {
            op: 'queryRemove',
            index: index + i
          })
        }
        for (let i = 0; i < removedIds.length; i++) {
          emitModelChange(rootId, idsPath.concat(index + i), undefined, removedIds[i], {
            op: 'queryRemove',
            index: index + i
          })
        }
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
    this.subCount = new Map() // ownerKey -> total ref count
    this.transportSubCount = new Map() // transportHash -> attached owner count (mirror)
    this.ownerFetchCount = new Map() // ownerKey -> fetch intent count (mirror)
    this.ownerSubscribeCount = new Map() // ownerKey -> subscribe intent count (mirror)
    this.queries = new Map() // transportHash -> runtime (mirror)
    this.ownerToTransport = new Map() // ownerKey -> transportHash (mirror)
    this.ownerMeta = new Map() // ownerKey -> { collectionName, params, transportHash, rootId } (mirror)
    this.ownerKeysByTransport = new Map() // transportHash -> Set(ownerKey) (mirror)
    this.pendingDestroyTimers = new Map()
    this.fr = new FinalizationRegistry(({ collectionName, params, ownerKey }) => {
      this.scheduleDestroy(collectionName, params, ownerKey, { force: true })
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
        pendingDestroy: false
      }
      this.ownerRecords.set(ownerKey, record)
    } else {
      if (meta.rootId != null) record.rootId = meta.rootId
      if (meta.collectionName != null) record.collectionName = meta.collectionName
      if (meta.params != null) record.params = meta.params
      if (meta.transportHash != null) record.transportHash = meta.transportHash
    }
    this.syncOwnerMirror(record)
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
        reconcilePromise: null
      }
      this.entries.set(transportHash, entry)
    }
    return entry
  }

  getEntry (transportHash) {
    return this.entries.get(transportHash)
  }

  syncOwnerMirror (record) {
    if (!record) return
    this.ownerToTransport.set(record.ownerKey, record.transportHash)
    this.ownerMeta.set(record.ownerKey, {
      collectionName: record.collectionName,
      params: record.params,
      transportHash: record.transportHash,
      rootId: record.rootId
    })
    if (record.fetchCount > 0) this.ownerFetchCount.set(record.ownerKey, record.fetchCount)
    else this.ownerFetchCount.delete(record.ownerKey)
    if (record.subscribeCount > 0) this.ownerSubscribeCount.set(record.ownerKey, record.subscribeCount)
    else this.ownerSubscribeCount.delete(record.ownerKey)
  }

  clearOwnerMirror (ownerKey) {
    this.ownerToTransport.delete(ownerKey)
    this.ownerMeta.delete(ownerKey)
    this.ownerFetchCount.delete(ownerKey)
    this.ownerSubscribeCount.delete(ownerKey)
  }

  syncEntryMirror (entry) {
    if (!entry) return
    if (entry.runtime) this.queries.set(entry.transportHash, entry.runtime)
    else this.queries.delete(entry.transportHash)

    if (entry.owners.size > 0) this.ownerKeysByTransport.set(entry.transportHash, new Set(entry.owners))
    else this.ownerKeysByTransport.delete(entry.transportHash)

    if (entry.owners.size > 0 || entry.runtime) this.transportSubCount.set(entry.transportHash, entry.owners.size)
    else this.transportSubCount.delete(entry.transportHash)
  }

  deleteEntryIfEmpty (transportHash) {
    const entry = this.entries.get(transportHash)
    if (!entry) return
    if (entry.owners.size > 0) return
    if (entry.runtime) return
    if (entry.phase === 'transition') return
    this.entries.delete(transportHash)
    this.queries.delete(transportHash)
    this.transportSubCount.delete(transportHash)
    this.ownerKeysByTransport.delete(transportHash)
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
    const params = cloneQueryParams($query[PARAMS])
    const transportHash = $query[HASH]
    const rootId = getOwningRootId($query)
    const ownerKey = getQueryOwnerKey(rootId, transportHash)
    this.cancelDestroy(ownerKey)

    let previousCount = this.subCount.get(ownerKey) || 0
    let record = this.ownerRecords.get(ownerKey)
    if (previousCount > 0 && !record) {
      this.subCount.delete(ownerKey)
      const staleTransportHash = this.ownerToTransport.get(ownerKey)
      if (staleTransportHash) {
        this.clearOwnerMirror(ownerKey)
        this.cleanupStaleTransportState(staleTransportHash)
      }
      previousCount = 0
    }

    record = this.getOrCreateOwnerRecord(ownerKey, {
      rootId,
      collectionName,
      params,
      transportHash
    })
    record.pendingDestroy = false
    const entry = this.addOwnerToEntry(record)
    this.incrementOwnerIntent(record, intent)
    this.subCount.set(ownerKey, previousCount + 1)
    this.fr.register($query, { collectionName, params, ownerKey }, $query)
    this.syncOwnerMirror(record)
    this.syncEntryMirror(entry)

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
      if ((this.subCount.get(ownerKey) || 0) > 0 && !record) {
        const staleTransportHash = this.ownerToTransport.get(ownerKey) || $query[HASH]
        this.subCount.delete(ownerKey)
        this.clearOwnerMirror(ownerKey)
        if (staleTransportHash) this.cleanupStaleTransportState(staleTransportHash)
      }
      if (ERROR_ON_EXCESSIVE_UNSUBSCRIBES) throw Error(ERRORS.notSubscribed($query))
      return
    }
    const transportHash = record?.transportHash ?? $query[HASH]
    this.setOwnerIntentCount(record, intent, currentIntentCount - 1)

    const count = Math.max((this.subCount.get(ownerKey) || 0) - 1, 0)
    if (count > 0) {
      this.subCount.set(ownerKey, count)
    } else {
      this.subCount.set(ownerKey, 0)
    }

    if (count === 0) {
      this.fr.unregister($query)
      if (record) {
        record.pendingDestroy = true
        this.removeOwnerFromEntry(record)
        this.syncOwnerMirror(record)
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
    const ownerKeys = Array.from(this.ownerKeysByTransport.get(transportHash) || [])
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
      ...this.pendingDestroyTimers.keys(),
      ...this.ownerRecords.keys(),
      ...this.ownerMeta.keys()
    ])
    for (const ownerKey of ownerKeys) {
      await this.destroyByOwnerKey(ownerKey, { force: true })
    }
    this.entries.clear()
    this.ownerRecords.clear()
    this.subCount.clear()
    this.transportSubCount.clear()
    this.ownerFetchCount.clear()
    this.ownerSubscribeCount.clear()
    this.ownerToTransport.clear()
    this.ownerMeta.clear()
    this.ownerKeysByTransport.clear()
  }

  async flushPendingDestroys () {
    const ownerKeys = Array.from(this.pendingDestroyTimers.keys())
    for (const ownerKey of ownerKeys) {
      await this.destroyByOwnerKey(ownerKey)
    }
  }

  async scheduleDestroy (collectionName, params, ownerKey, options = {}) {
    const fallbackOwnerKey = ownerKey ?? getQueryOwnerKey(undefined, hashQuery(collectionName, params))
    const delay = getSubscriptionGcDelay()
    if (delay <= 0) {
      await this.destroyByOwnerKey(fallbackOwnerKey, {
        collectionName,
        params,
        transportHash: options.transportHash,
        force: !!options.force
      })
      return
    }
    const existing = this.pendingDestroyTimers.get(fallbackOwnerKey)
    if (existing) {
      if (options.force) existing.force = true
      return existing.promise
    }
    const entry = createPendingDestroyEntry()
    if (options.force) entry.force = true
    entry.collectionName = collectionName
    entry.params = params
    entry.transportHash = options.transportHash
    entry.timer = setTimeout(() => {
      this.destroyByOwnerKey(fallbackOwnerKey, {
        collectionName,
        params,
        transportHash: entry.transportHash,
        force: entry.force
      })
        .catch(ignoreDestroyError)
    }, delay)
    this.pendingDestroyTimers.set(fallbackOwnerKey, entry)
    return entry.promise
  }

  cancelDestroy (ownerKey) {
    const entry = this.takePendingDestroy(ownerKey)
    if (!entry) return
    entry.resolve()
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
    const existingQuery = this.queries.get(transportHash)
    const entry = this.getOrCreateEntry(transportHash)
    if (existingQuery && !entry.runtime) {
      entry.runtime = existingQuery
      entry.mode = existingQuery.activeTransportMode || entry.mode
      this.syncEntryMirror(entry)
    }
    while (true) {
      let query = entry.runtime || this.queries.get(transportHash)
      if (query && entry.runtime !== query) entry.runtime = query
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

  async destroyByOwnerKey (ownerKey, options = {}) {
    const pendingDestroy = this.takePendingDestroy(ownerKey)
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
      const count = this.subCount.get(ownerKey) || 0
      if (!options.force && count > 0) {
        settlePending()
        return
      }
      const record = this.ownerRecords.get(ownerKey)
      if (!record) {
        const ownerCount = this.subCount.get(ownerKey) || 0
        const transportHash = options.transportHash ||
          (options.collectionName && options.params ? hashQuery(options.collectionName, options.params) : this.ownerToTransport.get(ownerKey))
        this.subCount.delete(ownerKey)
        this.clearOwnerMirror(ownerKey)
        if (!transportHash) {
          settlePending()
          return
        }
        const entry = this.entries.get(transportHash)
        if (entry && ownerCount > 0) {
          entry.owners.delete(ownerKey)
          this.syncEntryMirror(entry)
        }
        const query = entry?.runtime || this.queries.get(transportHash)
        await this.reconcileTransport(transportHash)
        const nextEntry = this.entries.get(transportHash)
        if (!nextEntry || nextEntry.owners.size === 0) {
          if (query?.activeTransportMode !== 'idle') {
            await unsubscribeQueryTransport(query, { keepRoots: true })
          }
          query?._detachTransportData?.({ keepRoots: false })
          if (nextEntry) nextEntry.runtime = null
          this.deleteEntryIfEmpty(transportHash)
        }
        this.cleanupStaleTransportState(transportHash)
        settlePending()
        return
      }
      const { transportHash } = record
      const entry = this.entries.get(transportHash)
      const query = entry?.runtime || this.queries.get(transportHash)

      this.subCount.delete(ownerKey)
      if (entry?.owners.has(ownerKey)) this.removeOwnerFromEntry(record)
      this.ownerRecords.delete(ownerKey)
      this.clearOwnerMirror(ownerKey)

      await this.reconcileTransport(transportHash)
      const nextEntry = this.entries.get(transportHash)
      if (nextEntry && nextEntry.owners.size > 0) {
        settlePending()
        return
      }
      if (!query) {
        this.deleteEntryIfEmpty(transportHash)
        this.cleanupStaleTransportState(transportHash)
        settlePending()
        return
      }
      if (query.activeTransportMode !== 'idle') await unsubscribeQueryTransport(query, { keepRoots: true })
      query._detachTransportData?.({ keepRoots: false })
      const finalEntry = this.entries.get(transportHash)
      if (finalEntry && finalEntry.owners.size > 0) {
        settlePending()
        return
      }
      if (finalEntry) finalEntry.runtime = null
      this.deleteEntryIfEmpty(transportHash)
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

  takePendingDestroy (ownerKey) {
    const entry = this.pendingDestroyTimers.get(ownerKey)
    if (!entry) return
    clearTimeout(entry.timer)
    this.pendingDestroyTimers.delete(ownerKey)
    return entry
  }

  removeOwnerMeta (ownerKey, transportHash) {
    const knownTransportHash = transportHash ?? this.ownerToTransport.get(ownerKey)
    this.clearOwnerMirror(ownerKey)
    if (!knownTransportHash) return
    const ownerKeys = this.ownerKeysByTransport.get(knownTransportHash)
    if (!ownerKeys) return
    ownerKeys.delete(ownerKey)
    if (ownerKeys.size === 0) this.ownerKeysByTransport.delete(knownTransportHash)
  }

  cleanupStaleTransportState (transportHash) {
    if (!transportHash) return
    const entry = this.entries.get(transportHash)
    if (entry) {
      if (!entry.runtime && entry.owners.size === 0) this.entries.delete(transportHash)
      else this.syncEntryMirror(entry)
    }
    if (this.queries.has(transportHash)) return
    const ownerKeys = this.ownerKeysByTransport.get(transportHash)
    if (ownerKeys?.size) return
    const transportCount = this.transportSubCount.get(transportHash)
    if (transportCount == null || transportCount <= 0) {
      this.transportSubCount.delete(transportHash)
      this.ownerKeysByTransport.delete(transportHash)
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

export function hashQuery (collectionName, params) {
  params = normalizeQueryParamsForHash(params)
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
  params = cloneQueryParams(params)
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
  return getRoot($query)?.[ROOT_ID]
}

function getQueryOwnerKey (rootId, transportHash) {
  return getScopedSignalHash(rootId, transportHash, 'queryOwner')
}

function cloneQueryParams (params) {
  if (!isCompatEnv()) return JSON.parse(JSON.stringify(params))
  return cloneQueryParamsCompat(params)
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

function normalizeQueryParamsForHash (params) {
  if (!isCompatEnv()) return params
  return cloneQueryParamsCompat(params)
}

// Racer compat: keep query keys with undefined values by normalizing them to null
// instead of dropping them via JSON serialization.
function cloneQueryParamsCompat (value) {
  if (value === undefined) return null
  if (value == null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(item => cloneQueryParamsCompat(item))
  const object = {}
  for (const key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      object[key] = cloneQueryParamsCompat(value[key])
    }
  }
  return object
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
