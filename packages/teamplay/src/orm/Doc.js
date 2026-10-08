import { isObservable, observable, raw } from '@nx-js/observer-util'
import { set as _set, del as _del, getRaw as _getRaw } from './dataTree.js'
import { SEGMENTS } from './Signal.ts'
import { getConnection } from './connection.ts'
import FinalizationRegistry from '../utils/MockFinalizationRegistry.ts'
import SubscriptionState from './SubscriptionState.js'
import { getIdFieldsForSegments, injectIdFields, isPlainObject } from './idFields.ts'
import { getSubscriptionGcDelay } from './subscriptionGcDelay.ts'
import { isMissingShareDoc } from './missingDoc.js'
import {
  addOwnerToken,
  canJoinTransport,
  createOwnerTokenCounts,
  getTransportTargetMode,
  reconcileEntryTransport,
  removeOwnerToken
} from './subscriptionTransport.js'
import { getRoot, ROOT_ID, GLOBAL_ROOT_ID, getRootTransportMode } from './Root.ts'
import {
  registerRootOwnedDirectDocSubscription,
  unregisterRootOwnedDirectDocSubscription,
  getRootOwnedDirectDocSubscriptions,
  clearRootOwnedDirectDocSubscriptions
} from './rootContext.ts'

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

function deepEqualDocData (left, right) {
  if (left === right) return true
  if (left == null || right == null) return left === right

  const leftIsArray = Array.isArray(left)
  if (leftIsArray || Array.isArray(right)) {
    if (!leftIsArray || !Array.isArray(right)) return false
    if (left.length !== right.length) return false
    for (let i = 0; i < left.length; i++) {
      if (!deepEqualDocData(left[i], right[i])) return false
    }
    return true
  }

  if (typeof left !== 'object' || typeof right !== 'object') return false

  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false

  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false
    if (!deepEqualDocData(left[key], right[key])) return false
  }

  return true
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
    const current = _getRaw(path)
    if (deepEqualDocData(current, data)) {
      if (current != null && current !== raw(doc.data)) doc.data = current
      if (!isObservable(doc.data)) doc.data = observable(doc.data)
      return
    }
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
    this.fr = new FinalizationRegistry(({ hash, ownerKey, token }) => {
      this.releaseFinalizedToken(ownerKey, hash, token).catch(ignoreDestroyError)
    })
    this.lingeringHashesByRoot = new Map() // rootId -> Set<hash> released by that root, pending GC
    this.subCount = createReadonlyMapView({
      get: hash => this.getTrackedCount(hash),
      has: hash => this.getTrackedCount(hash) !== undefined,
      size: () => this.getTrackedHashCountSize(),
      keys: () => getTrackedHashes(this.entries)
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
    this.ownerMeta = createReadonlyMapView({
      get: ownerKey => this.getOwnerMeta(ownerKey),
      has: ownerKey => this.ownerRecords.has(ownerKey),
      size: () => this.ownerRecords.size,
      keys: () => this.ownerRecords.keys()
    })
    this.ownerKeysByHash = createReadonlyMapView({
      get: hash => this.getOwnerKeys(hash),
      has: hash => !!this.getOwnerKeys(hash),
      size: () => countMapLike(this.entries, entry => entry.owners.size > 0),
      keys: () => filterMapKeys(this.entries, entry => entry.owners.size > 0)
    })
    this.docs = createReadonlyMapView({
      get: hash => this.getRuntime(hash),
      has: hash => this.hasRuntime(hash),
      size: () => this.getRuntimeCount(),
      keys: () => filterMapKeys(this.entries, entry => !!entry.runtime)
    })
    this.pendingDestroyTimers = createReadonlyMapView({
      get: hash => this.entries.get(hash)?.pendingDestroy,
      has: hash => !!this.entries.get(hash)?.pendingDestroy,
      size: () => countMapLike(this.entries, entry => !!entry.pendingDestroy),
      keys: () => filterMapKeys(this.entries, entry => !!entry.pendingDestroy)
    })
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
        subscribeCount: 0,
        tokens: createOwnerTokenCounts()
      }
      this.ownerRecords.set(ownerKey, record)
    } else {
      if (meta.rootId != null) record.rootId = meta.rootId
      if (meta.hash != null) record.hash = meta.hash
      if (meta.segments != null) record.segments = [...meta.segments]
    }
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
        pendingDestroy: null,
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

  getEntryTrackedTotal (entry) {
    if (!entry) return undefined
    const total = this.getEntryTotalCount(entry)
    if (total > 0 || entry.pendingDestroy) return total
  }

  syncOwnerMirror () {}

  clearOwnerMirror () {}

  syncEntryMirror () {}

  deleteEntryIfEmpty (hash) {
    const entry = this.entries.get(hash)
    if (!entry) return
    if (!this.canDeleteEntry(entry)) return
    this.entries.delete(hash)
  }

  canDeleteEntry (entry) {
    if (!entry) return false
    if (this.getEntryTrackedTotal(entry) !== undefined) return false
    if (entry.runtime) return false
    if (entry.phase === 'transition') return false
    return true
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
    this.getOrCreateEntry(hash, segments)
    this.ensureRuntime(hash, segments)
  }

  subscribe ($doc, { intent = 'subscribe' } = {}) {
    const segments = [...$doc[SEGMENTS]]
    const hash = hashDoc(segments)
    const rootId = getOwningRootId($doc)
    const ownerKey = getDocOwnerKey(rootId, hash)
    const token = getDocFinalizationToken($doc)
    const entry = this.getOrCreateEntry(hash, segments)
    this.cancelDestroy(hash)
    const record = this.getOrCreateOwnerRecord(ownerKey, { hash, segments, rootId })
    this.incrementOwnerIntent(record, intent)
    this.addOwnerToEntry(record)
    if (rootId) {
      registerRootOwnedDirectDocSubscription(rootId, hash, segments, token)
    }
    if (addOwnerToken(record.tokens, token, intent)) {
      this.fr.register($doc, { hash, ownerKey, token }, token)
    }
    this.ensureRuntime(hash, segments)
    // Join a settled transport synchronously, including one lingering ownerless
    // in its GC grace: its runtime already holds the data.
    const targetMode = this.getTargetTransportMode(hash)
    if (canJoinTransport(entry, targetMode)) {
      entry.targetMode = targetMode
      return
    }
    return this.reconcileTransport(hash)
  }

  retain ($doc) {
    const segments = [...$doc[SEGMENTS]]
    const hash = hashDoc(segments)
    const entry = this.getOrCreateEntry(hash, segments)
    const hadPendingDestroy = !!entry.pendingDestroy
    this.cancelDestroy(hash)
    entry.retainCount += 1
    this.ensureRuntime(hash, segments)
    this.syncEntryMirror(entry)
    if (hadPendingDestroy) this.reconcileTransport(hash).catch(ignoreDestroyError)
  }

  // Releases one owner count. The returned promise settles once the release is
  // applied; with `awaitDestroy` (the default) it also waits for a deferred GC
  // destroy of the runtime, which public unsub() does not.
  async unsubscribe ($doc, { intent = 'subscribe', awaitDestroy = true } = {}) {
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
    const charged = removeOwnerToken(record.tokens, token, intent)
    if (charged.emptied) this.fr.unregister(charged.token)
    if (rootId) {
      unregisterRootOwnedDirectDocSubscription(rootId, hash, charged.token ?? token)
    }
    await this.applyOwnerRelease(record, { awaitDestroy })
  }

  // Shared tail of an owner release (unsubscribe and finalized signals).
  async applyOwnerRelease (record, { awaitDestroy = true } = {}) {
    const { hash, segments, rootId } = record
    const entry = this.getOrCreateEntry(hash, segments)
    if (this.getOwnerTotalCount(record) === 0) {
      this.removeOwnerFromEntry(record)
      this.deleteOwnerRecord(record)
    }
    const count = this.getEntryTotalCount(entry)
    const deferred = getSubscriptionGcDelay() > 0
    const destroyPromise = count === 0 ? this.scheduleDestroy(segments, { rootId }) : undefined
    await this.reconcileTransport(hash)
    if (count > 0) return
    if (deferred && !awaitDestroy) return
    await destroyPromise
  }

  // The signal that acquired these counts was garbage-collected without
  // unsub(): release exactly its counts. Other signals of the same path may
  // still own the doc through the same owner key.
  async releaseFinalizedToken (ownerKey, hash, token) {
    const record = this.ownerRecords.get(ownerKey)
    const counts = record?.tokens.get(token)
    if (!counts) return
    record.tokens.delete(token)
    const released = counts.fetchCount + counts.subscribeCount
    if (record.rootId) {
      for (let i = 0; i < released; i++) unregisterRootOwnedDirectDocSubscription(record.rootId, hash, token)
    }
    this.setOwnerIntentCount(record, 'fetch', record.fetchCount - counts.fetchCount)
    this.setOwnerIntentCount(record, 'subscribe', record.subscribeCount - counts.subscribeCount)
    await this.applyOwnerRelease(record, { awaitDestroy: false })
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
    if ((this.getTrackedCount(hash) || 0) > 0) return
    await this.scheduleDestroy(segments)
  }

  async destroy (segments) {
    const hash = hashDoc(segments)
    await this.destroyByHash(hash, { force: true })
  }

  async clear () {
    const hashes = new Set(this.entries.keys())
    for (const hash of hashes) {
      await this.destroyByHash(hash, { force: true })
    }
    this.entries.clear()
    this.ownerRecords.clear()
    this.lingeringHashesByRoot.clear()
  }

  async releaseRootOwnedSubscriptions (rootId) {
    const entries = Array.from(getRootOwnedDirectDocSubscriptions(rootId).entries())
    for (const [hash, entry] of entries) {
      for (const token of entry.tokenCounts.keys()) {
        this.fr.unregister(token)
      }
      await this.destroyByOwnerKey(getDocOwnerKey(rootId, hash), { hash, force: true })
    }
    if (entries.length) clearRootOwnedDirectDocSubscriptions(rootId)
    // Closing a root also ends the GC grace of what that root released last.
    const lingeringHashes = Array.from(this.lingeringHashesByRoot.get(rootId) || [])
    for (const hash of lingeringHashes) {
      const entry = this.entries.get(hash)
      if (!entry?.pendingDestroy?.rootIds.has(rootId)) continue
      if (this.getEntryTotalCount(entry) > 0) continue
      await this.destroyByHash(hash, { force: true })
    }
  }

  async flushPendingDestroys () {
    const hashes = Array.from(filterMapKeys(this.entries, entry => !!entry.pendingDestroy))
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
    const entry = this.getOrCreateEntry(hash, segments)
    const existing = entry.pendingDestroy
    if (existing) {
      if (options.force) existing.force = true
      this.trackLingeringRoot(existing, hash, options.rootId)
      return existing.promise
    }
    const pendingDestroy = createPendingDestroyEntry()
    if (options.force) pendingDestroy.force = true
    pendingDestroy.timer = setTimeout(() => {
      this.destroyByHash(hash, { force: pendingDestroy.force }).catch(ignoreDestroyError)
    }, delay)
    entry.pendingDestroy = pendingDestroy
    this.trackLingeringRoot(pendingDestroy, hash, options.rootId)
    return pendingDestroy.promise
  }

  trackLingeringRoot (pendingDestroy, hash, rootId) {
    if (rootId == null) return
    pendingDestroy.rootIds.add(rootId)
    let hashes = this.lingeringHashesByRoot.get(rootId)
    if (!hashes) {
      hashes = new Set()
      this.lingeringHashesByRoot.set(rootId, hashes)
    }
    hashes.add(hash)
  }

  untrackLingeringRoots (pendingDestroy, hash) {
    for (const rootId of pendingDestroy.rootIds) {
      const hashes = this.lingeringHashesByRoot.get(rootId)
      if (!hashes) continue
      hashes.delete(hash)
      if (hashes.size === 0) this.lingeringHashesByRoot.delete(rootId)
    }
    pendingDestroy.rootIds.clear()
  }

  cancelDestroy (hash) {
    const entry = this.takePendingDestroy(hash)
    if (!entry) return
    entry.resolve()
  }

  reconcileTransport (hash) {
    return reconcileEntryTransport(this, hash)
  }

  async reconcileTransportNow (hash, settle) {
    const entry = this.getOrCreateEntry(hash)
    while (true) {
      let doc = entry.runtime
      const desiredMode = entry.targetMode = this.getTargetTransportMode(hash)
      const currentMode = doc?.activeTransportMode ?? entry.mode
      entry.mode = currentMode
      if (desiredMode === currentMode) {
        settle?.()
        return
      }
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
        this.removeAllOwnersFromEntry(hash)
      }
      const count = entry ? this.getEntryTotalCount(entry) : (this.getTrackedCount(hash) || 0)
      if (!options.force && count > 0) {
        settlePending()
        return
      }
      const doc = entry?.runtime
      if (!doc) {
        if (entry) {
          entry.mode = 'idle'
          entry.runtime = null
          this.deleteEntryIfEmpty(hash)
        }
        settlePending()
        return
      }
      await this.reconcileTransport(hash)
      const nextEntry = this.entries.get(hash)
      const nextCount = nextEntry ? this.getEntryTotalCount(nextEntry) : (this.getTrackedCount(hash) || 0)
      if (!options.force && nextCount > 0) {
        settlePending()
        return
      }
      const activeDoc = nextEntry?.runtime || doc
      if (activeDoc.activeTransportMode !== 'idle') {
        await activeDoc.unsubscribe()
      }
      const finalEntryBeforeDestroy = this.entries.get(hash)
      const finalCountBeforeDestroy = finalEntryBeforeDestroy
        ? this.getEntryTotalCount(finalEntryBeforeDestroy)
        : (this.getTrackedCount(hash) || 0)
      if (!options.force && finalCountBeforeDestroy > 0) {
        settlePending()
        return
      }
      if (typeof activeDoc.hasPending === 'function' && activeDoc.hasPending()) {
        if (typeof activeDoc.whenNothingPending === 'function') {
          if (pendingDestroy) {
            const nextEntry = this.getOrCreateEntry(hash)
            nextEntry.pendingDestroy = pendingDestroy
          }
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
        this.deleteEntryIfEmpty(hash)
      }
      settlePending()
    } catch (err) {
      settlePending(err)
      throw err
    }
  }

  takePendingDestroy (hash, expectedEntry) {
    const transportEntry = this.entries.get(hash)
    const pendingDestroy = transportEntry?.pendingDestroy
    if (!pendingDestroy) return
    if (expectedEntry && pendingDestroy !== expectedEntry) return
    clearTimeout(pendingDestroy.timer)
    transportEntry.pendingDestroy = null
    this.untrackLingeringRoots(pendingDestroy, hash)
    this.deleteEntryIfEmpty(hash)
    return pendingDestroy
  }

  getOwnerIntentCount (recordOrOwnerKey, intent) {
    const record = typeof recordOrOwnerKey === 'string'
      ? this.ownerRecords.get(recordOrOwnerKey)
      : recordOrOwnerKey
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

  addOwnerMeta (ownerKey, hash, segments, rootId) {
    const record = this.getOrCreateOwnerRecord(ownerKey, { hash, segments, rootId })
    this.addOwnerToEntry(record)
  }

  removeOwnerMeta (ownerKey, hash) {
    const record = this.ownerRecords.get(ownerKey)
    const knownHash = hash ?? record?.hash
    if (record) {
      this.removeOwnerFromEntry(record)
      this.deleteOwnerRecord(record)
    }
    if (!knownHash) return
    const ownerKeys = this.entries.get(knownHash)?.owners
    if (!ownerKeys) return
    ownerKeys.delete(ownerKey)
    this.deleteEntryIfEmpty(knownHash)
  }

  getDesiredTransportMode (hash) {
    const entry = this.entries.get(hash)
    const ownerKeys = entry?.owners
    if (!ownerKeys || ownerKeys.size === 0) return 'idle'
    let hasFetchBackedOwner = false
    for (const ownerKey of ownerKeys) {
      const record = this.ownerRecords.get(ownerKey)
      const subscribeCount = record?.subscribeCount || 0
      const fetchCount = record?.fetchCount || 0
      const rootId = record?.rootId
      const subscribeMode = getRootTransportMode(rootId, 'subscribe')
      if (subscribeCount > 0 && subscribeMode === 'subscribe') return 'subscribe'
      if (fetchCount > 0 || (subscribeCount > 0 && subscribeMode === 'fetch')) {
        hasFetchBackedOwner = true
      }
    }
    return hasFetchBackedOwner ? 'fetch' : 'idle'
  }

  // Owner-derived mode, except that an ownerless live transport lingers while
  // its GC destroy is pending (see subscriptionTransport.js).
  getTargetTransportMode (hash) {
    const entry = this.entries.get(hash)
    const lingering = !!entry?.pendingDestroy && this.getEntryTotalCount(entry) === 0
    return getTransportTargetMode(this.getDesiredTransportMode(hash), entry, lingering)
  }

  removeAllOwnersFromEntry (hash) {
    const entry = this.entries.get(hash)
    if (!entry) return
    for (const ownerKey of Array.from(entry.owners)) {
      const record = this.ownerRecords.get(ownerKey)
      if (record) {
        this.removeOwnerFromEntry(record)
        this.deleteOwnerRecord(record)
      } else {
        entry.owners.delete(ownerKey)
      }
    }
  }

  deleteOwnerRecord (record) {
    for (const token of record.tokens.keys()) this.fr.unregister(token)
    record.tokens.clear()
    if (this.ownerRecords.get(record.ownerKey) === record) this.ownerRecords.delete(record.ownerKey)
  }

  async destroyTransportEntry (hash, runtime) {
    const activeDoc = this.entries.get(hash)?.runtime || runtime
    if (!activeDoc) {
      const entry = this.entries.get(hash)
      if (entry) {
        entry.runtime = null
        entry.mode = 'idle'
      }
      this.deleteEntryIfEmpty(hash)
      return
    }
    if (activeDoc.activeTransportMode !== 'idle') {
      await activeDoc.unsubscribe()
    }
    if (typeof activeDoc.hasPending === 'function' && activeDoc.hasPending()) {
      if (typeof activeDoc.whenNothingPending === 'function') {
        await new Promise(resolve => activeDoc.whenNothingPending(resolve))
      }
    }
    if (typeof activeDoc.destroy === 'function') await activeDoc.destroy()
    if (typeof activeDoc.dispose === 'function') activeDoc.dispose()
    const finalEntry = this.entries.get(hash)
    if (finalEntry && finalEntry.owners.size > 0) return
    if (finalEntry) {
      finalEntry.runtime = null
      finalEntry.mode = 'idle'
    }
    this.deleteEntryIfEmpty(hash)
  }

  async destroyByOwnerKey (ownerKey, options = {}) {
    const record = this.ownerRecords.get(ownerKey)
    const hash = record?.hash ?? options.hash
    if (!hash) return
    const segments = record?.segments ?? parseDocHash(hash)
    const ownerCount = this.getOwnerTotalCount(record || ownerKey)
    if (!options.force && ownerCount > 0) return

    const entry = this.entries.get(hash)
    if (record) {
      this.removeOwnerFromEntry(record)
      this.deleteOwnerRecord(record)
    } else if (entry?.owners.has(ownerKey)) {
      entry.owners.delete(ownerKey)
    }

    if (!entry && !this.getRuntime(hash)) {
      return
    }

    await this.reconcileTransport(hash)
    const nextEntry = this.entries.get(hash)
    const nextCount = nextEntry ? this.getEntryTotalCount(nextEntry) : (this.getTrackedCount(hash) || 0)
    if (nextCount > 0) {
      this.deleteEntryIfEmpty(hash)
      return
    }
    if (options.force) {
      await this.destroyTransportEntry(hash, nextEntry?.runtime || entry?.runtime)
      return
    }
    await this.scheduleDestroy(segments, { force: false, rootId: record?.rootId })
  }

  getRuntime (hash) {
    return this.entries.get(hash)?.runtime
  }

  hasRuntime (hash) {
    return !!this.getRuntime(hash)
  }

  getRuntimeCount () {
    return countMapLike(this.entries, entry => !!entry.runtime)
  }

  getTrackedCount (hash) {
    const entry = this.entries.get(hash)
    return this.getEntryTrackedTotal(entry)
  }

  getTrackedHashCountSize () {
    return countMapLike(this.entries, entry => this.getEntryTrackedTotal(entry) !== undefined)
  }

  getOwnerMeta (ownerKey) {
    const record = this.ownerRecords.get(ownerKey)
    if (!record) return undefined
    return {
      hash: record.hash,
      segments: [...record.segments],
      rootId: record.rootId
    }
  }

  getOwnerKeys (hash) {
    const owners = this.entries.get(hash)?.owners
    if (!owners?.size) return undefined
    return new Set(owners)
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
    rootIds: new Set(),
    promise,
    resolve: resolvePending,
    reject: rejectPending
  }
}

const ERRORS = {
  notSubscribed: $doc => Error('trying to unsubscribe when not subscribed. Doc: ' + $doc.path())
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

function * filterMapKeys (iterableMap, predicate) {
  for (const [key, value] of iterableMap.entries()) {
    if (predicate(value)) yield key
  }
}

function * getTrackedHashes (entries) {
  yield * entries.keys()
}
