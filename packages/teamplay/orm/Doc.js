import { isObservable, observable, raw } from '@nx-js/observer-util'
import { set as _set, del as _del, getRaw as _getRaw } from './dataTree.js'
import { SEGMENTS } from './Signal.js'
import { getConnection } from './connection.js'
import FinalizationRegistry from '../utils/MockFinalizationRegistry.js'
import SubscriptionState from './SubscriptionState.js'
import { getIdFieldsForSegments, injectIdFields, isPlainObject } from './idFields.js'
import { emitModelChange, isModelEventsEnabled } from './Compat/modelEvents.js'
import { getSubscriptionGcDelay } from './subscriptionGcDelay.js'
import { isMissingShareDoc } from './missingDoc.js'
import { getRoot, ROOT_ID, GLOBAL_ROOT_ID, getRootTransportMode } from './Root.js'
import {
  registerRootOwnedDirectDocSubscription,
  unregisterRootOwnedDirectDocSubscription,
  getRootOwnedDirectDocSubscriptions,
  clearRootOwnedDirectDocSubscriptions
} from './rootContext.js'

const ERROR_ON_EXCESSIVE_UNSUBSCRIBES = false
const DOC_FINALIZATION_TOKENS = new WeakMap()

function getDocFinalizationToken ($doc) {
  let token = DOC_FINALIZATION_TOKENS.get($doc)
  if (!token) {
    token = {}
    DOC_FINALIZATION_TOKENS.set($doc, token)
  }
  return token
}

function getOwningRootId ($doc) {
  const $root = getRoot($doc)
  const rootId = $root?.[ROOT_ID]
  if (rootId == null || rootId === GLOBAL_ROOT_ID) return undefined
  return rootId
}

class Doc {
  initialized

  constructor (collection, docId) {
    this.collection = collection
    this.docId = docId
    this.lifecycle = new SubscriptionState({
      onSubscribe: () => this._subscribe(),
      onUnsubscribe: () => this._unsubscribe()
    })
    this.requestedTransportMode = 'subscribe'
    this.activeTransportMode = 'idle'
    this.init()
  }

  get subscribed () {
    return this.lifecycle.subscribed
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
  }

  async _subscribe () {
    const doc = getConnection().get(this.collection, this.docId)
    const mode = this.requestedTransportMode
    await new Promise((resolve, reject) => {
      const method = mode === 'fetch' ? 'fetch' : 'subscribe'
      doc[method](err => {
        if (err) return reject(err)
        this.activeTransportMode = mode
        resolve()
      })
    })
  }

  async _unsubscribe () {
    const doc = getConnection().get(this.collection, this.docId)
    await new Promise((resolve, reject) => {
      const method = this.activeTransportMode === 'fetch' && typeof doc.unfetch === 'function'
        ? 'unfetch'
        : 'unsubscribe'
      doc[method](err => {
        if (err) return reject(err)
        this.activeTransportMode = 'idle'
        resolve()
      })
    })
  }

  hasPending () {
    const doc = getConnection().get(this.collection, this.docId)
    if (typeof doc.hasPending !== 'function') return false
    return doc.hasPending()
  }

  whenNothingPending (fn) {
    const doc = getConnection().get(this.collection, this.docId)
    if (typeof doc.whenNothingPending !== 'function') return fn()
    doc.whenNothingPending(fn)
  }

  async destroy () {
    const doc = getConnection().get(this.collection, this.docId)
    await new Promise((resolve, reject) => {
      doc.destroy(err => {
        if (err) return reject(err)
        resolve()
      })
    })
  }

  dispose () {
    this.initialized = undefined
    this._removeData()
  }

  _initData () {
    const doc = getConnection().get(this.collection, this.docId)
    this._refData()
    doc.on('load', () => this._refData())
    doc.on('create', () => this._refData())
    doc.on('del', () => this._refMissingData())
    if (isModelEventsEnabled()) {
      doc.on('op', op => emitDocOp(this.collection, this.docId, op))
    }
  }

  _refMissingData () {
    _del([this.collection, this.docId])
    const doc = getConnection().get(this.collection, this.docId)
    doc.data = observable(undefined)
  }

  _refData () {
    const doc = getConnection().get(this.collection, this.docId)
    // Racer/react-sharedb-hooks normalizes a missing ShareDB doc into a truthy
    // observable placeholder on the shareDoc itself (`observable(undefined) -> {}`),
    // while still keeping the model tree path unresolved. Some legacy consumers
    // (for example readonly RTEditor paths) rely on this exact contract by reading
    // `connection.get(...).data` directly and only checking for truthiness.
    //
    // We intentionally mirror that behavior here:
    // - missing doc => keep model path undefined
    // - but make shareDoc.data truthy/observable so direct ShareDB consumers behave
    //   the same way they do under Racer.
    if (isMissingShareDoc(doc) && doc.data === undefined) {
      if (!isObservable(doc.data)) doc.data = observable(undefined)
      return
    }
    if (doc.data == null) return
    const idFields = getIdFieldsForSegments([this.collection, this.docId])
    if (isPlainObject(doc.data)) injectIdFields(doc.data, idFields, this.docId)
    const path = [this.collection, this.docId]
    const data = isObservable(doc.data) ? raw(doc.data) : doc.data
    _set(path, data)
    const synced = _getRaw(path)
    if (synced != null && synced !== raw(doc.data)) doc.data = synced
    if (!isObservable(doc.data)) doc.data = observable(doc.data)
  }

  _removeData () {
    _del([this.collection, this.docId])
  }
}

export class DocSubscriptions {
  constructor (DocClass = Doc) {
    this.DocClass = DocClass
    this.ownerRecords = new Map() // ownerKey -> owner record
    this.entries = new Map() // transportHash -> transport entry
    this.subCount = new Map() // transportHash -> total ref count (owners + retained docs) (mirror)
    this.ownerFetchCount = new Map() // ownerKey -> fetch intent count (mirror)
    this.ownerSubscribeCount = new Map() // ownerKey -> subscribe intent count (mirror)
    this.ownerMeta = new Map() // ownerKey -> { hash, segments, rootId } (mirror)
    this.ownerKeysByHash = new Map() // transportHash -> Set(ownerKey) (mirror)
    this.docs = new Map() // transportHash -> runtime (mirror)
    this.pendingDestroyTimers = new Map()
    this.fr = new FinalizationRegistry(({ hash, ownerKey }) => this.destroyByOwnerKey(ownerKey, { hash, force: true }))
  }

  getOrCreateOwnerRecord (ownerKey, meta) {
    let record = this.ownerRecords.get(ownerKey)
    if (!record) {
      record = {
        ownerKey,
        rootId: meta.rootId,
        hash: meta.hash,
        segments: meta.segments ? [...meta.segments] : parseDocHash(meta.hash),
        fetchCount: 0,
        subscribeCount: 0
      }
      this.ownerRecords.set(ownerKey, record)
    } else {
      if (meta.rootId != null) record.rootId = meta.rootId
      if (meta.hash != null) record.hash = meta.hash
      if (meta.segments != null) record.segments = [...meta.segments]
    }
    this.syncOwnerMirror(record)
    return record
  }

  getOrCreateEntry (hash, segments) {
    let entry = this.entries.get(hash)
    if (!entry) {
      entry = {
        hash,
        segments: segments ? [...segments] : parseDocHash(hash),
        mode: 'idle',
        targetMode: 'idle',
        phase: 'stable',
        runtime: null,
        owners: new Set(),
        retainCount: 0,
        reconcilePromise: null
      }
      this.entries.set(hash, entry)
    } else if (segments && !entry.segments?.length) {
      entry.segments = [...segments]
    }
    return entry
  }

  getEntry (hash) {
    return this.entries.get(hash)
  }

  getEntryTotalCount (entry) {
    if (!entry) return 0
    let count = entry.retainCount
    for (const ownerKey of entry.owners) {
      count += this.getOwnerTotalCount(ownerKey)
    }
    return count
  }

  syncOwnerMirror (record) {
    if (!record) return
    this.ownerMeta.set(record.ownerKey, {
      hash: record.hash,
      segments: [...record.segments],
      rootId: record.rootId
    })
    if (record.fetchCount > 0) this.ownerFetchCount.set(record.ownerKey, record.fetchCount)
    else this.ownerFetchCount.delete(record.ownerKey)
    if (record.subscribeCount > 0) this.ownerSubscribeCount.set(record.ownerKey, record.subscribeCount)
    else this.ownerSubscribeCount.delete(record.ownerKey)
  }

  clearOwnerMirror (ownerKey) {
    this.ownerMeta.delete(ownerKey)
    this.ownerFetchCount.delete(ownerKey)
    this.ownerSubscribeCount.delete(ownerKey)
  }

  syncEntryMirror (entry) {
    if (!entry) return
    if (entry.runtime) this.docs.set(entry.hash, entry.runtime)
    else this.docs.delete(entry.hash)

    if (entry.owners.size > 0) this.ownerKeysByHash.set(entry.hash, new Set(entry.owners))
    else this.ownerKeysByHash.delete(entry.hash)

    const totalCount = this.getEntryTotalCount(entry)
    if (totalCount > 0 || this.pendingDestroyTimers.has(entry.hash)) this.subCount.set(entry.hash, totalCount)
    else this.subCount.delete(entry.hash)
  }

  deleteEntryIfEmpty (hash) {
    const entry = this.entries.get(hash)
    if (!entry) return
    if (entry.owners.size > 0) return
    if (entry.retainCount > 0) return
    if (entry.runtime) return
    if (entry.phase === 'transition') return
    this.entries.delete(hash)
    this.docs.delete(hash)
    this.subCount.delete(hash)
    this.ownerKeysByHash.delete(hash)
  }

  ensureRuntime (hash, segments) {
    const entry = this.getOrCreateEntry(hash, segments)
    if (!entry.runtime) {
      const runtimeSegments = entry.segments?.length ? entry.segments : parseDocHash(hash)
      entry.runtime = new this.DocClass(...runtimeSegments)
    }
    entry.runtime.init()
    entry.mode = entry.runtime.activeTransportMode || entry.mode
    this.syncEntryMirror(entry)
    return entry.runtime
  }

  addOwnerToEntry (record) {
    const entry = this.getOrCreateEntry(record.hash, record.segments)
    entry.owners.add(record.ownerKey)
    this.syncEntryMirror(entry)
    return entry
  }

  removeOwnerFromEntry (record) {
    const entry = this.entries.get(record.hash)
    if (!entry) return
    entry.owners.delete(record.ownerKey)
    this.syncEntryMirror(entry)
  }

  init ($doc) {
    const segments = [...$doc[SEGMENTS]]
    const hash = hashDoc(segments)
    const entry = this.getOrCreateEntry(hash, segments)
    const doc = entry.runtime || this.docs.get(hash)
    if (doc && !entry.runtime) {
      entry.runtime = doc
      entry.mode = doc.activeTransportMode || entry.mode
      this.syncEntryMirror(entry)
    }
    this.ensureRuntime(hash, segments)
  }

  subscribe ($doc, { intent = 'subscribe' } = {}) {
    const segments = [...$doc[SEGMENTS]]
    const hash = hashDoc(segments)
    const rootId = getOwningRootId($doc)
    const ownerKey = getDocOwnerKey(rootId, hash)
    const token = getDocFinalizationToken($doc)
    const entry = this.getOrCreateEntry(hash, segments)
    const previousCount = this.getEntryTotalCount(entry)
    const previousMirrorCount = this.subCount.get(hash) || 0
    this.cancelDestroy(hash)
    const existingRecord = this.ownerRecords.get(ownerKey)
    const staleMirrorRecovery =
      previousCount > 0 &&
      previousMirrorCount <= 0 &&
      this.getOwnerTotalCount(existingRecord || ownerKey) > 0
    const record = this.getOrCreateOwnerRecord(ownerKey, { hash, segments, rootId })
    if (!staleMirrorRecovery) {
      this.incrementOwnerIntent(record, intent)
      this.addOwnerToEntry(record)
      if (rootId) {
        registerRootOwnedDirectDocSubscription(rootId, hash, segments, token)
      }
      this.fr.register($doc, { hash, ownerKey }, token)
    }
    this.ensureRuntime(hash, segments)
    const doc = entry.runtime || this.docs.get(hash)
    this.syncOwnerMirror(record)
    this.syncEntryMirror(entry)
    if (
      previousCount > 0 &&
      doc &&
      entry.phase === 'stable' &&
      this.getDesiredTransportMode(hash) === doc.activeTransportMode
    ) return
    return this.reconcileTransport(hash)
  }

  retain ($doc) {
    const segments = [...$doc[SEGMENTS]]
    const hash = hashDoc(segments)
    const entry = this.getOrCreateEntry(hash, segments)
    this.cancelDestroy(hash)
    entry.retainCount += 1
    this.ensureRuntime(hash, segments)
    this.syncEntryMirror(entry)
  }

  async unsubscribe ($doc, { intent = 'subscribe' } = {}) {
    const segments = [...$doc[SEGMENTS]]
    const hash = hashDoc(segments)
    const rootId = getOwningRootId($doc)
    const ownerKey = getDocOwnerKey(rootId, hash)
    const token = getDocFinalizationToken($doc)
    const record = this.ownerRecords.get(ownerKey)
    const currentIntentCount = this.getOwnerIntentCount(record, intent)
    if (currentIntentCount <= 0) {
      if (ERROR_ON_EXCESSIVE_UNSUBSCRIBES) throw ERRORS.notSubscribed($doc)
      return
    }
    this.setOwnerIntentCount(record, intent, currentIntentCount - 1)
    const nextOwnerCount = this.getOwnerTotalCount(record)
    if (rootId) {
      unregisterRootOwnedDirectDocSubscription(rootId, hash, token)
    }
    const entry = this.getOrCreateEntry(hash, segments)
    if (nextOwnerCount === 0) {
      this.fr.unregister(token)
      if (record) {
        this.removeOwnerFromEntry(record)
      }
      this.ownerRecords.delete(ownerKey)
      this.clearOwnerMirror(ownerKey)
    } else {
      this.syncOwnerMirror(record)
    }
    this.syncEntryMirror(entry)
    const count = this.getEntryTotalCount(entry)
    if (count === 0) this.subCount.set(hash, 0)
    const destroyPromise = count === 0 ? this.scheduleDestroy(segments) : undefined
    await this.reconcileTransport(hash)
    if (count > 0) return
    await destroyPromise
  }

  async release ($doc) {
    const segments = [...$doc[SEGMENTS]]
    const hash = hashDoc(segments)
    const entry = this.entries.get(hash)
    if (!entry) {
      if (ERROR_ON_EXCESSIVE_UNSUBSCRIBES) throw ERRORS.notSubscribed($doc)
      return
    }
    if (entry.retainCount <= 0) {
      if (ERROR_ON_EXCESSIVE_UNSUBSCRIBES) throw ERRORS.notSubscribed($doc)
      return
    }
    entry.retainCount -= 1
    this.syncEntryMirror(entry)
    if (this.getEntryTotalCount(entry) === 0) this.subCount.set(hash, 0)
    if ((this.subCount.get(hash) || 0) > 0) return
    await this.scheduleDestroy(segments)
  }

  async destroy (segments) {
    const hash = hashDoc(segments)
    await this.destroyByHash(hash, { force: true })
  }

  async clear () {
    const hashes = new Set([
      ...this.pendingDestroyTimers.keys(),
      ...this.docs.keys(),
      ...this.entries.keys()
    ])
    for (const hash of hashes) {
      await this.destroyByHash(hash, { force: true })
    }
    this.entries.clear()
    this.ownerRecords.clear()
    this.subCount.clear()
    this.ownerFetchCount.clear()
    this.ownerSubscribeCount.clear()
    this.ownerMeta.clear()
    this.ownerKeysByHash.clear()
    this.pendingDestroyTimers.clear()
  }

  async releaseRootOwnedSubscriptions (rootId) {
    const entries = Array.from(getRootOwnedDirectDocSubscriptions(rootId).entries())
    if (entries.length === 0) return
    for (const [hash, entry] of entries) {
      for (const token of entry.tokenCounts.keys()) {
        this.fr.unregister(token)
      }
      await this.destroyByOwnerKey(getDocOwnerKey(rootId, hash), { hash, force: true })
    }
    clearRootOwnedDirectDocSubscriptions(rootId)
  }

  async flushPendingDestroys () {
    const hashes = Array.from(this.pendingDestroyTimers.keys())
    for (const hash of hashes) {
      await this.destroyByHash(hash)
    }
  }

  async scheduleDestroy (segments, options = {}) {
    const hash = hashDoc(segments)
    const delay = getSubscriptionGcDelay()
    if (delay <= 0) {
      await this.destroyByHash(hash, options)
      return
    }
    const existing = this.pendingDestroyTimers.get(hash)
    if (existing) {
      if (options.force) existing.force = true
      return existing.promise
    }
    const entry = createPendingDestroyEntry()
    if (options.force) entry.force = true
    entry.timer = setTimeout(() => {
      this.destroyByHash(hash, { force: entry.force }).catch(ignoreDestroyError)
    }, delay)
    this.pendingDestroyTimers.set(hash, entry)
    return entry.promise
  }

  cancelDestroy (hash) {
    const entry = this.takePendingDestroy(hash)
    if (!entry) return
    entry.resolve()
  }

  async reconcileTransport (hash) {
    const entry = this.getOrCreateEntry(hash)
    entry.targetMode = this.getDesiredTransportMode(hash)
    if (entry.phase === 'transition' && entry.reconcilePromise) return entry.reconcilePromise
    const next = Promise.resolve()
      .catch(ignoreDestroyError)
      .then(() => this.reconcileTransportNow(hash))
    entry.phase = 'transition'
    entry.reconcilePromise = next
    try {
      await next
    } finally {
      const currentEntry = this.entries.get(hash)
      if (currentEntry?.reconcilePromise === next) {
        currentEntry.reconcilePromise = null
        currentEntry.phase = 'stable'
      }
      this.deleteEntryIfEmpty(hash)
    }
  }

  async reconcileTransportNow (hash) {
    const existingDoc = this.docs.get(hash)
    const entry = this.getOrCreateEntry(hash)
    if (existingDoc && !entry.runtime) {
      entry.runtime = existingDoc
      entry.mode = existingDoc.activeTransportMode || entry.mode
      this.syncEntryMirror(entry)
    }
    while (true) {
      let doc = entry.runtime || this.docs.get(hash)
      if (doc && entry.runtime !== doc) entry.runtime = doc
      const desiredMode = entry.targetMode = this.getDesiredTransportMode(hash)
      const currentMode = doc?.activeTransportMode ?? entry.mode
      entry.mode = currentMode
      if (desiredMode === currentMode) return
      if (desiredMode === 'idle') {
        if (doc && currentMode !== 'idle') {
          await doc.unsubscribe()
        }
        entry.mode = 'idle'
        continue
      }
      if (currentMode !== 'idle' && doc) {
        await doc.unsubscribe()
        entry.mode = 'idle'
        continue
      }
      doc = this.ensureRuntime(hash)
      await doc.subscribe({ mode: desiredMode })
      entry.runtime = doc
      entry.mode = doc.activeTransportMode || desiredMode
      this.syncEntryMirror(entry)
    }
  }

  async destroyByHash (hash, options = {}) {
    let pendingDestroy = options._pendingDestroy
    if (pendingDestroy) this.takePendingDestroy(hash, pendingDestroy)
    else pendingDestroy = this.takePendingDestroy(hash)
    if (pendingDestroy?.force) options.force = true

    const settlePending = err => {
      if (!pendingDestroy) return
      if (err) pendingDestroy.reject(err)
      else pendingDestroy.resolve()
    }

    try {
      const entry = this.entries.get(hash)
      if (options.force && entry?.owners.size) {
        for (const ownerKey of Array.from(entry.owners)) {
          this.ownerRecords.delete(ownerKey)
          this.clearOwnerMirror(ownerKey)
        }
        entry.owners.clear()
        this.syncEntryMirror(entry)
      }
      const count = entry ? this.getEntryTotalCount(entry) : (this.subCount.get(hash) || 0)
      if (!options.force && count > 0) {
        settlePending()
        return
      }
      const doc = entry?.runtime || this.docs.get(hash)
      if (!doc) {
        if (entry) {
          entry.mode = 'idle'
          entry.runtime = null
          this.syncEntryMirror(entry)
          this.deleteEntryIfEmpty(hash)
        } else {
          this.docs.delete(hash)
          this.subCount.delete(hash)
          this.ownerKeysByHash.delete(hash)
        }
        settlePending()
        return
      }
      await this.reconcileTransport(hash)
      const nextEntry = this.entries.get(hash)
      const nextCount = nextEntry ? this.getEntryTotalCount(nextEntry) : (this.subCount.get(hash) || 0)
      if (!options.force && nextCount > 0) {
        settlePending()
        return
      }
      const activeDoc = nextEntry?.runtime || this.docs.get(hash) || doc
      if (activeDoc.activeTransportMode !== 'idle') {
        await activeDoc.unsubscribe()
      }
      const finalEntryBeforeDestroy = this.entries.get(hash)
      const finalCountBeforeDestroy = finalEntryBeforeDestroy
        ? this.getEntryTotalCount(finalEntryBeforeDestroy)
        : (this.subCount.get(hash) || 0)
      if (!options.force && finalCountBeforeDestroy > 0) {
        settlePending()
        return
      }
      if (typeof activeDoc.hasPending === 'function' && activeDoc.hasPending()) {
        if (typeof activeDoc.whenNothingPending === 'function') {
          if (pendingDestroy) this.pendingDestroyTimers.set(hash, pendingDestroy)
          activeDoc.whenNothingPending(() => {
            const nextOptions = pendingDestroy ? { ...options, _pendingDestroy: pendingDestroy } : options
            this.destroyByHash(hash, nextOptions).catch(ignoreDestroyError)
          })
        } else {
          settlePending()
        }
        return
      }
      if (typeof activeDoc.destroy === 'function') await activeDoc.destroy()
      if (typeof activeDoc.dispose === 'function') activeDoc.dispose()
      const finalEntry = this.entries.get(hash)
      if (finalEntry) {
        finalEntry.runtime = null
        finalEntry.mode = 'idle'
        this.syncEntryMirror(finalEntry)
        this.deleteEntryIfEmpty(hash)
      } else {
        this.docs.delete(hash)
        this.subCount.delete(hash)
        this.ownerKeysByHash.delete(hash)
      }
      settlePending()
    } catch (err) {
      settlePending(err)
      throw err
    }
  }

  takePendingDestroy (hash, expectedEntry) {
    const entry = this.pendingDestroyTimers.get(hash)
    if (!entry) return
    if (expectedEntry && entry !== expectedEntry) return
    clearTimeout(entry.timer)
    this.pendingDestroyTimers.delete(hash)
    return entry
  }

  getOwnerIntentCount (recordOrOwnerKey, intent) {
    const record = typeof recordOrOwnerKey === 'string'
      ? this.ownerRecords.get(recordOrOwnerKey)
      : recordOrOwnerKey
    if (!record) {
      const ownerKey = typeof recordOrOwnerKey === 'string' ? recordOrOwnerKey : recordOrOwnerKey?.ownerKey
      const store = intent === 'fetch' ? this.ownerFetchCount : this.ownerSubscribeCount
      return ownerKey == null ? 0 : (store.get(ownerKey) || 0)
    }
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
    if (record) return record.fetchCount + record.subscribeCount
    const ownerKey = typeof recordOrOwnerKey === 'string' ? recordOrOwnerKey : recordOrOwnerKey?.ownerKey
    if (ownerKey == null) return 0
    return (this.ownerFetchCount.get(ownerKey) || 0) + (this.ownerSubscribeCount.get(ownerKey) || 0)
  }

  addOwnerMeta (ownerKey, hash, segments, rootId) {
    const record = this.getOrCreateOwnerRecord(ownerKey, { hash, segments, rootId })
    this.addOwnerToEntry(record)
  }

  removeOwnerMeta (ownerKey, hash) {
    const record = this.ownerRecords.get(ownerKey)
    const knownHash = hash ?? record?.hash ?? this.ownerMeta.get(ownerKey)?.hash
    if (record) {
      this.removeOwnerFromEntry(record)
      this.ownerRecords.delete(ownerKey)
    }
    this.clearOwnerMirror(ownerKey)
    if (!knownHash) return
    const ownerKeys = this.ownerKeysByHash.get(knownHash)
    if (!ownerKeys) return
    ownerKeys.delete(ownerKey)
    if (ownerKeys.size === 0) this.ownerKeysByHash.delete(knownHash)
  }

  getDesiredTransportMode (hash) {
    const entry = this.entries.get(hash)
    const ownerKeys = entry?.owners?.size ? entry.owners : this.ownerKeysByHash.get(hash)
    if (!ownerKeys || ownerKeys.size === 0) return 'idle'
    let hasFetchBackedOwner = false
    for (const ownerKey of ownerKeys) {
      const record = this.ownerRecords.get(ownerKey)
      const subscribeCount = record ? record.subscribeCount : (this.ownerSubscribeCount.get(ownerKey) || 0)
      const fetchCount = record ? record.fetchCount : (this.ownerFetchCount.get(ownerKey) || 0)
      const rootId = record?.rootId ?? this.ownerMeta.get(ownerKey)?.rootId
      const subscribeMode = getRootTransportMode(rootId, 'subscribe')
      if (subscribeCount > 0 && subscribeMode === 'subscribe') return 'subscribe'
      if (fetchCount > 0 || (subscribeCount > 0 && subscribeMode === 'fetch')) {
        hasFetchBackedOwner = true
      }
    }
    return hasFetchBackedOwner ? 'fetch' : 'idle'
  }

  async destroyByOwnerKey (ownerKey, options = {}) {
    const record = this.ownerRecords.get(ownerKey)
    const meta = this.ownerMeta.get(ownerKey)
    const hash = record?.hash ?? options.hash ?? meta?.hash
    if (!hash) return
    const segments = record?.segments ?? meta?.segments ?? parseDocHash(hash)
    const ownerCount = this.getOwnerTotalCount(record || ownerKey)
    if (!options.force && ownerCount > 0) return

    const entry = this.entries.get(hash)
    if (record) {
      this.removeOwnerFromEntry(record)
      this.ownerRecords.delete(ownerKey)
    } else if (entry?.owners.has(ownerKey)) {
      entry.owners.delete(ownerKey)
      this.syncEntryMirror(entry)
    }
    this.clearOwnerMirror(ownerKey)

    if (!entry && !this.docs.get(hash)) {
      this.subCount.delete(hash)
      this.ownerKeysByHash.delete(hash)
      return
    }

    await this.reconcileTransport(hash)
    const nextEntry = this.entries.get(hash)
    const nextCount = nextEntry ? this.getEntryTotalCount(nextEntry) : (this.subCount.get(hash) || 0)
    if (nextCount > 0) {
      this.deleteEntryIfEmpty(hash)
      return
    }
    if (options.force) {
      await this.destroyByHash(hash, { force: true })
      return
    }
    await this.scheduleDestroy(segments, { force: false })
  }
}

export const docSubscriptions = new DocSubscriptions()

function hashDoc (segments) {
  return JSON.stringify(segments)
}

function parseDocHash (hash) {
  return JSON.parse(hash)
}

function getDocOwnerKey (rootId, hash) {
  return JSON.stringify({ owner: [rootId, hash] })
}

function ignoreDestroyError () {}

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
    promise,
    resolve: resolvePending,
    reject: rejectPending
  }
}

function emitDocOp (collection, docId, op) {
  if (!isModelEventsEnabled()) return
  const ops = Array.isArray(op) ? op : [op]
  for (const component of ops) {
    if (!component || !component.p) continue
    const baseSegments = [collection, docId]
    let pathSegments = baseSegments.concat(component.p)
    const meta = {}
    let value
    let prevValue

    if (has(component, 'si') || has(component, 'sd')) {
      const index = component.p[component.p.length - 1]
      meta.op = has(component, 'si') ? 'stringInsert' : 'stringRemove'
      meta.index = index
      pathSegments = baseSegments.concat(component.p.slice(0, -1))
      value = _getRaw(pathSegments)
      prevValue = component.sd
    } else if (has(component, 'lm')) {
      meta.op = 'arrayMove'
      meta.from = component.p[component.p.length - 1]
      meta.to = component.lm
      pathSegments = baseSegments.concat(component.p.slice(0, -1))
      value = _getRaw(pathSegments)
    } else if (has(component, 'li') || has(component, 'ld')) {
      meta.op = has(component, 'li') ? 'arrayInsert' : 'arrayRemove'
      meta.index = component.p[component.p.length - 1]
      value = _getRaw(pathSegments)
      prevValue = component.ld
    } else if (has(component, 'na')) {
      meta.op = 'increment'
      meta.by = component.na
      value = _getRaw(pathSegments)
      if (typeof value === 'number') prevValue = value - component.na
    } else {
      meta.op = 'set'
      value = has(component, 'oi') ? component.oi : _getRaw(pathSegments)
      prevValue = component.od
    }

    emitModelChange(pathSegments, value, prevValue, meta)
  }
}

function has (obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

const ERRORS = {
  notSubscribed: $doc => Error('trying to unsubscribe when not subscribed. Doc: ' + $doc.path())
}
