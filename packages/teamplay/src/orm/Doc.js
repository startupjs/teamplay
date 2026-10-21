import { isObservable, observable, raw } from '@nx-js/observer-util'
import { set as _set, del as _del, getRaw as _getRaw } from './dataTree.js'
import { SEGMENTS } from './Signal.ts'
import { getConnection } from './connection.ts'
import FinalizationRegistry from '../utils/MockFinalizationRegistry.ts'
import { getIdFieldsForSegments, injectIdFields, isPlainObject } from './idFields.ts'
import { getSubscriptionGcDelay } from './subscriptionGcDelay.ts'
import { isMissingShareDoc } from './missingDoc.js'
import { refreshQueryDocs } from './queryDocIndex.js'
import {
  clearSubscriptionFailure,
  getSubscriptionFailureKey,
  reportSubscriptionError,
  setSubscriptionFailure
} from './subscriptionFailures.js'
import { runInBatch } from './batchScheduler.js'
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
import { getRoot, ROOT_ID, GLOBAL_ROOT_ID, getRootTransportMode } from './Root.ts'
import {
  registerRootOwnedDirectDocSubscription,
  unregisterRootOwnedDirectDocSubscription,
  getRootOwnedDirectDocSubscriptions,
  clearRootOwnedDirectDocSubscriptions,
  registerRootWrittenDoc,
  takeRootWrittenDocs
} from './rootContext.ts'

const ERROR_ON_EXCESSIVE_UNSUBSCRIBES = false
const DOC_FINALIZATION_TOKENS = new WeakMap()
// ShareDB doc -> the runtime that follows its events (see Doc#_listen()). A
// ShareDB doc a runtime follows is that runtime's: no other runtime destroys it.
const SHARE_DOC_FOLLOWERS = new WeakMap()

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

// The ShareDB doc behind one entry of DocSubscriptions. Its transport calls
// are made only by the manager's reconcile loop (subscriptionTransport.js),
// which runs one transition per entry at a time and coalesces racing intents,
// so the runtime itself does not queue or collapse calls.
class Doc {
  initialized

  constructor (collection, docId) {
    this.collection = collection
    this.docId = docId
    this.requestedTransportMode = 'subscribe'
    this.activeTransportMode = 'idle'
    // set by the manager: (err, { stopped }) => void (see _onShareDocError())
    this.onTransportError = undefined
    // the ShareDB doc whose events the runtime follows (see _listen())
    this._shareDoc = undefined
    // the object linked into the data tree and ShareDB's doc.data (see _refData())
    this._linkedData = undefined
    // destroyed (see detach()): it never follows a ShareDB doc again
    this.detached = false
    this._onShareDocLoad = () => this._refData()
    this._onShareDocDel = () => this._refMissingData()
    this._onShareDocOp = this._onShareDocOp.bind(this)
    this._onShareDocError = this._onShareDocError.bind(this)
    this.init()
  }

  get subscribed () {
    return this.activeTransportMode !== 'idle'
  }

  init () {
    if (this.initialized || this.detached) return
    this.initialized = true
    this._initData()
  }

  async subscribe ({ mode } = {}) {
    if (mode) this.requestedTransportMode = mode
    await this._subscribe()
    this.init()
  }

  async unsubscribe () {
    if (this.activeTransportMode === 'idle') return
    await this._unsubscribe()
  }

  async _subscribe () {
    const doc = getConnection().get(this.collection, this.docId)
    // follow the connection's ShareDB doc of this id: ShareDB replaces the one
    // the runtime followed when something destroyed it under the runtime
    if (this.initialized && doc !== this._shareDoc) this._initData()
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
    const doc = this._getShareDoc()
    if (!doc) {
      this.activeTransportMode = 'idle'
      return
    }
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
    const doc = this._getShareDoc()
    if (typeof doc?.hasPending !== 'function') return false
    return doc.hasPending()
  }

  whenNothingPending (fn) {
    const doc = this._getShareDoc()
    if (typeof doc?.whenNothingPending !== 'function') return fn()
    doc.whenNothingPending(fn)
  }

  // The ShareDB doc the runtime follows, or else the connection's doc of this
  // id. Unlike connection.get(), it neither creates a doc nor cancels a
  // destroy ShareDB has in progress: teamplay calls connection.get() only for
  // a doc it takes (init, subscribe).
  _getShareDoc () {
    return this._shareDoc ?? getConnection().collections?.[this.collection]?.[this.docId]
  }

  // Destroys the connection's ShareDB doc of this id (after dispose()). A doc
  // that a newer runtime follows is that runtime's and is left to it; one taken
  // while ShareDB destroys it is kept by ShareDB (connection.get() cancels a
  // destroy in progress).
  async destroy () {
    const doc = getConnection().collections?.[this.collection]?.[this.docId]
    if (!doc) return
    const follower = SHARE_DOC_FOLLOWERS.get(doc)
    if (follower && follower !== this) return
    await new Promise((resolve, reject) => {
      doc.destroy(err => {
        if (err) return reject(err)
        resolve()
      })
    })
  }

  // The runtime is done: it stops following the ShareDB doc. The doc stays in
  // the data tree (see DocSubscriptions#destroyRuntime()).
  detach () {
    this.detached = true
    this.initialized = undefined
    this._unlisten()
  }

  dispose () {
    this.detach()
    this._clearData()
  }

  _initData () {
    this._listen(getConnection().get(this.collection, this.docId))
    this._refData()
  }

  // The runtime follows the events of the connection's ShareDB doc, and of
  // that doc only: the listeners go with the runtime (dispose()).
  _listen (doc) {
    if (this._shareDoc === doc) return
    this._unlisten()
    doc.on('load', this._onShareDocLoad)
    doc.on('create', this._onShareDocLoad)
    doc.on('del', this._onShareDocDel)
    doc.on('op', this._onShareDocOp)
    // ShareDB emits 'error' when a request it makes on its own fails (the
    // re-subscribe after a reconnect); with no listener the emit throws
    doc.on('error', this._onShareDocError)
    this._shareDoc = doc
    SHARE_DOC_FOLLOWERS.set(doc, this)
  }

  _unlisten () {
    const doc = this._shareDoc
    if (!doc) return
    doc.removeListener('load', this._onShareDocLoad)
    doc.removeListener('create', this._onShareDocLoad)
    doc.removeListener('del', this._onShareDocDel)
    doc.removeListener('op', this._onShareDocOp)
    doc.removeListener('error', this._onShareDocError)
    if (SHARE_DOC_FOLLOWERS.get(doc) === this) SHARE_DOC_FOLLOWERS.delete(doc)
    this._shareDoc = undefined
    this._linkedData = undefined
  }

  // ShareDB applies an op to doc.data, the tree's object, in place. An op with
  // a root component (`{ p: [] }`: the whole doc replaced, as setReplace() on a
  // doc signal does, here or on another connection) makes ShareDB set doc.data
  // to a new object instead, which the data tree does not hold: they are
  // linked again, as after a load. A remote op of several components comes
  // one component at a time.
  _onShareDocOp () {
    const doc = this._shareDoc
    if (!doc || doc.data === this._linkedData) return
    if (doc.data == null) {
      // the whole doc replaced with null (by another client: a doc-root
      // setReplace(null) throws here): it has no data to show
      this._clearData()
      this._linkedData = doc.data
      return
    }
    this._refData()
  }

  // The server refused the re-subscribe ShareDB made after a reconnect (the
  // only request teamplay makes without a callback): the subscription is gone.
  // ShareDB would ask again after every reconnect; it is unsubscribed instead,
  // so the transport is idle on both sides and the next subscribe() asks the
  // server again. The doc keeps its last data. Anything else is only reported.
  _onShareDocError (err) {
    const doc = this._shareDoc
    const stopped = this.activeTransportMode === 'subscribe' && !!doc && !doc.subscribed
    if (stopped) {
      this.activeTransportMode = 'idle'
      doc.unsubscribe(ignoreDestroyError)
    }
    if (this.onTransportError) {
      this.onTransportError(err, { stopped })
    } else {
      reportSubscriptionError(err, { path: this.collection + '.' + this.docId, stopped, owned: false })
    }
  }

  _refMissingData () {
    this._clearData()
    const doc = this._shareDoc
    if (!doc) return
    doc.data = observable(undefined)
    this._linkedData = doc.data
  }

  _refData () {
    const doc = this._shareDoc
    if (!doc) return
    this._doRefData(doc)
    this._linkedData = doc.data
  }

  _doRefData (doc) {
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
    // - and never materialize a missing doc, whatever its placeholder holds.
    if (isMissingShareDoc(doc)) {
      // known missing (deleted, or read as not existing): what the tree still
      // holds for it is gone; not loaded yet (a fresh doc): keep it until the load
      if (doc.version != null && _getRaw([this.collection, this.docId]) != null) this._clearData()
      if (doc.data == null) doc.data = observable(undefined)
      return
    }
    if (doc.data == null) {
      // a created doc with null data (a whole-doc replace with null elsewhere)
      if (_getRaw([this.collection, this.docId]) != null) this._clearData()
      return
    }
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
    // set() updates an existing object in place: only a new object (a doc
    // created again) changes what the queries listing the doc hold, and they
    // list it in the same batch. ShareDB is linked to the tree's object in the
    // batch too: the reactions it runs at its end can write to the doc, and
    // those writes go to doc.data.
    runInBatch(() => {
      _set(path, data)
      const synced = _getRaw(path)
      if (synced !== current) refreshQueryDocs(this.collection, this.docId)
      if (synced != null && synced !== raw(doc.data)) doc.data = synced
      if (!isObservable(doc.data)) doc.data = observable(doc.data)
    })
  }

  // the doc leaves the data tree, and the queries listing it (a forced
  // destroy ignores them) leave it out in the same batch
  _clearData () {
    runInBatch(() => {
      _del([this.collection, this.docId])
      refreshQueryDocs(this.collection, this.docId)
    })
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
    this.takes = 0 // subscribe() and retain() calls so far (see entry.lastTake)
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
        downgradeGrace: null,
        reconcilePromise: null,
        // the server stopped its subscription (see handleTransportError())
        stopped: false,
        // ShareDB's destroy of the doc in flight (see destroyRuntime())
        destroying: null,
        // the subscribe() or retain() that took the doc last (see destroyByHash())
        lastTake: 0
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
    if (entry.destroying) return false
    return true
  }

  ensureRuntime (hash, segments) {
    const entry = this.getOrCreateEntry(hash, segments)
    if (!entry.runtime) {
      const runtimeSegments = entry.segments?.length ? entry.segments : parseDocHash(hash)
      const runtime = new this.DocClass(...runtimeSegments)
      runtime.onTransportError = (err, details) => this.handleTransportError(hash, runtime, err, details)
      entry.runtime = runtime
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
    entry.lastTake = ++this.takes
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
    // A subscription the server stopped is asked for again by a new owner
    // only (see handleTransportError())
    entry.stopped = false
    // A subscriber arriving in a downgrade grace keeps the transport live.
    if (this.getDesiredTransportMode(hash) === 'subscribe') clearDowngradeGrace(entry)
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
    this.retainSegments([...$doc[SEGMENTS]])
  }

  retainSegments (segments) {
    const hash = hashDoc(segments)
    const entry = this.getOrCreateEntry(hash, segments)
    entry.lastTake = ++this.takes
    const hadPendingDestroy = !!entry.pendingDestroy
    this.cancelDestroy(hash)
    entry.retainCount += 1
    this.ensureRuntime(hash, segments)
    this.syncEntryMirror(entry)
    if (hadPendingDestroy) {
      // A live transport lingering ownerless keeps lingering when only query
      // results hold the doc now (a direct owner returning joins it).
      scheduleDowngradeGrace(this, hash, entry)
      this.reconcileTransport(hash).catch(ignoreDestroyError)
    }
  }

  // Releases one owner count. The returned promise settles once the release is
  // applied; with `awaitDestroy` (the default) it also waits for a deferred GC
  // destroy of the runtime, which public unsub() does not.
  async unsubscribe ($doc, { intent = 'subscribe', awaitDestroy = true, minGraceMs } = {}) {
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
    await this.applyOwnerRelease(record, { awaitDestroy, minGraceMs })
  }

  // Shared tail of an owner release (unsubscribe and finalized signals).
  // `minGraceMs` extends the grace of what this release leaves behind beyond
  // the GC delay (React render attempts that were not committed).
  async applyOwnerRelease (record, { awaitDestroy = true, minGraceMs = 0 } = {}) {
    const { hash, segments, rootId } = record
    const entry = this.getOrCreateEntry(hash, segments)
    if (this.getOwnerTotalCount(record) === 0) {
      this.removeOwnerFromEntry(record)
      this.deleteOwnerRecord(record)
    }
    const count = this.getEntryTotalCount(entry)
    const delay = Math.max(getSubscriptionGcDelay(), minGraceMs)
    const deferred = delay > 0
    if (count > 0) scheduleDowngradeGrace(this, hash, entry, delay)
    else clearDowngradeGrace(entry)
    const destroyPromise = count === 0 ? this.scheduleDestroy(segments, { rootId, delay }) : undefined
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

  // A public write through a non-global root to a doc that nothing tracks (no
  // owner, no retain, no pending destroy): the root holds the doc like a query
  // retain until it is disposed, so read-after-write keeps working while the
  // root lives and the doc does not outlive it (racer had a model and a
  // connection per request). The global root's writes are not tracked.
  retainWrittenDoc (rootId, segments) {
    if (rootId == null || rootId === GLOBAL_ROOT_ID) return
    const docSegments = segments.slice(0, 2)
    const hash = hashDoc(docSegments)
    const entry = this.entries.get(hash)
    if (entry && (this.getEntryTotalCount(entry) > 0 || entry.pendingDestroy)) return
    const [collection, docId] = docSegments
    if (!getConnection().collections?.[collection]?.[docId]) return
    if (!registerRootWrittenDoc(rootId, hash)) return
    this.retainSegments(docSegments)
  }

  // Root disposal: drop the retains of the docs the root wrote, and destroy
  // the ones nothing else holds (closing a root ends their grace).
  async releaseRootWrittenDocs (rootId) {
    for (const hash of takeRootWrittenDocs(rootId)) {
      const entry = this.entries.get(hash)
      if (!entry || entry.retainCount <= 0) continue
      entry.retainCount -= 1
      if (this.getEntryTotalCount(entry) > 0) continue
      clearDowngradeGrace(entry)
      await this.destroyByHash(hash)
    }
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
    clearDowngradeGrace(entry)
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
    await flushDowngradeGraces(this)
    const hashes = Array.from(filterMapKeys(this.entries, entry => !!entry.pendingDestroy))
    for (const hash of hashes) {
      await this.destroyByHash(hash)
    }
  }

  async scheduleDestroy (segments, options = {}) {
    const hash = hashDoc(segments)
    const delay = options.delay ?? getSubscriptionGcDelay()
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
    pendingDestroy.timer = unrefTimer(setTimeout(() => {
      this.destroyByHash(hash, { force: pendingDestroy.force }).catch(ignoreDestroyError)
    }, delay))
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
      if (entry.destroying) {
        // ShareDB is destroying the doc of this id: its destroy would undo a
        // subscribe made before it is done
        await entry.destroying.promise.catch(noop)
        continue
      }
      doc = this.ensureRuntime(hash)
      try {
        await doc.subscribe({ mode: desiredMode })
      } catch (err) {
        this.stopTransport(hash, entry, err)
        throw err
      }
      // destroyed while it subscribed: ShareDB's destroy ends the
      // subscription, and the next step takes a new runtime
      if (doc.detached) continue
      clearSubscriptionFailure(getSubscriptionFailureKey('doc', hash))
      entry.runtime = doc
      entry.mode = doc.activeTransportMode || desiredMode
    }
  }

  // ShareDB reported an error on the runtime's doc. A subscription the server
  // stopped fails like a refused subscribe: the entry stays idle (the owners
  // it has are not subscribed again: a new owner asks the server again), and
  // the components using it throw the error (see subscriptionFailures.js).
  // An entry nothing owns any more (lingering in its GC grace) only logs it.
  handleTransportError (hash, runtime, err, { stopped }) {
    const entry = this.entries.get(hash)
    const current = entry?.runtime === runtime
    const owned = current && entry.owners.size > 0
    if (stopped && current) {
      entry.mode = 'idle'
      if (owned) this.stopTransport(hash, entry, err)
    }
    reportSubscriptionError(err, { path: runtime.collection + '.' + runtime.docId, stopped, owned })
  }

  stopTransport (hash, entry, err) {
    entry.stopped = true
    setSubscriptionFailure(getSubscriptionFailureKey('doc', hash), err)
  }

  // The key of the doc's record in subscriptionFailures.js
  getSubscriptionFailureKey ($doc) {
    return getSubscriptionFailureKey('doc', hashDoc($doc[SEGMENTS]))
  }

  async destroyByHash (hash, options = {}) {
    let pendingDestroy = options._pendingDestroy
    if (pendingDestroy) {
      // A destroy that waited for the doc's pending ops (below) goes on only
      // if its pending destroy is still there: subscribe() and retain() of
      // the doc meanwhile cancel it, and other destroys take it
      if (!this.takePendingDestroy(hash, pendingDestroy)) return
    } else {
      pendingDestroy = this.takePendingDestroy(hash)
    }
    if (pendingDestroy?.force) options.force = true

    const settlePending = err => {
      if (!pendingDestroy) return
      if (err) pendingDestroy.reject(err)
      else pendingDestroy.resolve()
    }

    try {
      const entry = this.entries.get(hash)
      // what took the doc last when this destroy was called (see `forced`)
      const lastTake = entry?.lastTake
      if (options.force && entry?.owners.size) {
        this.removeAllOwnersFromEntry(hash)
      }
      if (options.force) clearDowngradeGrace(entry)
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
          // the ShareDB destroy of the runtime disposed last
          if (entry.destroying) await entry.destroying.promise.catch(noop)
          this.deleteEntryIfEmpty(hash)
        }
        settlePending()
        return
      }
      await this.reconcileTransport(hash)
      const nextEntry = this.entries.get(hash)
      const nextCount = nextEntry ? this.getEntryTotalCount(nextEntry) : (this.getTrackedCount(hash) || 0)
      // A forced destroy goes on despite the owners and query results that
      // held the doc when it was called, not despite one that took it since
      const forced = options.force && nextEntry?.lastTake === lastTake
      if (!forced && nextCount > 0) {
        settlePending()
        return
      }
      const activeDoc = nextEntry?.runtime || doc
      // The reconcile above closed the transport (no owner left, nothing
      // lingers) unless an owner arrived meanwhile: then it is theirs.
      if (activeDoc.activeTransportMode !== 'idle') {
        settlePending()
        return
      }
      const finalEntryBeforeDestroy = this.entries.get(hash)
      const finalCountBeforeDestroy = finalEntryBeforeDestroy
        ? this.getEntryTotalCount(finalEntryBeforeDestroy)
        : (this.getTrackedCount(hash) || 0)
      if (!forced && finalCountBeforeDestroy > 0) {
        settlePending()
        return
      }
      if (typeof activeDoc.hasPending === 'function' && activeDoc.hasPending()) {
        if (typeof activeDoc.whenNothingPending === 'function') {
          // The destroy waits as a pending destroy, which a new owner or a
          // query taking the doc meanwhile cancels (a forced one too)
          const waitingEntry = this.getOrCreateEntry(hash)
          const scheduled = waitingEntry.pendingDestroy
          if (scheduled && scheduled !== pendingDestroy) {
            // the doc was taken and released again while this destroy
            // awaited: the destroy that release scheduled goes on for both
            if (options.force) scheduled.force = true
            if (pendingDestroy) scheduled.promise.then(pendingDestroy.resolve, pendingDestroy.reject)
            return
          }
          if (!pendingDestroy) {
            pendingDestroy = createPendingDestroyEntry()
            pendingDestroy.force = !!options.force
          }
          waitingEntry.pendingDestroy = pendingDestroy
          activeDoc.whenNothingPending(() => {
            this.destroyByHash(hash, { ...options, _pendingDestroy: pendingDestroy }).catch(ignoreDestroyError)
          })
        } else {
          settlePending()
        }
        return
      }
      await this.destroyRuntime(hash, activeDoc)
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

  // Owner-derived mode, except that a live transport lingers while an ownerless
  // entry's GC destroy is pending, or in a downgrade grace while owners remain
  // (see subscriptionTransport.js).
  getTargetTransportMode (hash) {
    const entry = this.entries.get(hash)
    if (entry?.stopped) return 'idle'
    const lingering = this.getEntryTotalCount(entry) === 0
      ? !!entry?.pendingDestroy
      : !!entry?.downgradeGrace
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
    clearDowngradeGrace(this.entries.get(hash))
    // destroying now ends a grace the entry may still be lingering in
    this.takePendingDestroy(hash)?.resolve()
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
    // close the transport through the reconcile gate; a transport that stays
    // open belongs to an owner that arrived meanwhile
    if (activeDoc.activeTransportMode !== 'idle') await this.reconcileTransport(hash)
    if (activeDoc.activeTransportMode !== 'idle') return
    if (typeof activeDoc.hasPending === 'function' && activeDoc.hasPending()) {
      if (typeof activeDoc.whenNothingPending === 'function') {
        await new Promise(resolve => activeDoc.whenNothingPending(resolve))
      }
    }
    // nothing held the doc when this destroy started: whoever holds it now
    // (a query listing it, a retain) took it meanwhile
    if (this.getEntryTotalCount(this.entries.get(hash)) > 0) return
    // nor is it this destroy's if another destroy ended the runtime, or an
    // owner opened its transport or is opening it (and maybe left already:
    // its release destroys the doc after the subscribe)
    const current = this.entries.get(hash)
    if (current?.runtime !== activeDoc || activeDoc.activeTransportMode !== 'idle' || current.phase === 'transition') return
    await this.destroyRuntime(hash, activeDoc)
  }

  // Disposes a runtime nothing holds (the caller checked it in this tick),
  // then has ShareDB destroy its doc, then removes the doc from the data tree.
  // The runtime is gone at once: a doc taken again while ShareDB destroys it
  // (a query lists it, an owner subscribes to it) gets a new runtime, whose
  // connection.get() makes ShareDB keep the doc, and which takes over the data
  // the tree still holds. ShareDB's destroy is asynchronous and would undo a subscribe
  // made meanwhile, so the reconcile loop waits for `entry.destroying`, and
  // ShareDB destroys of one doc run one at a time (ShareDB removes a doc from
  // the connection by its id).
  destroyRuntime (hash, runtime) {
    const entry = this.getOrCreateEntry(hash)
    // a runtime that is not the entry's any more was disposed by another
    // destroy (a doc taken and released meanwhile has a new runtime: this
    // destroy is not the one that ends it)
    if (entry.runtime !== runtime) return entry.destroying?.promise.catch(noop)
    if (typeof runtime.detach === 'function') runtime.detach()
    if (entry.runtime === runtime) {
      entry.runtime = null
      entry.mode = 'idle'
      entry.stopped = false
    }
    clearSubscriptionFailure(getSubscriptionFailureKey('doc', hash))
    const previous = entry.destroying
    const destroying = { promise: undefined }
    entry.destroying = destroying
    destroying.promise = (async () => {
      try {
        if (previous) await previous.promise.catch(noop)
        if (typeof runtime.destroy === 'function') await runtime.destroy()
      } finally {
        // the doc leaves the data tree unless it was taken meanwhile (a new
        // runtime follows it and holds its data)
        // (the destroy record goes first: a reaction that throws as the doc
        // leaves the tree must not leave the entry destroying forever)
        const last = entry.destroying === destroying
        if (last) entry.destroying = null
        try {
          if (!entry.runtime && typeof runtime.dispose === 'function') runtime.dispose()
        } finally {
          if (last && this.entries.get(hash) === entry) this.deleteEntryIfEmpty(hash)
        }
      }
    })()
    return destroying.promise
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

function noop () {}

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
