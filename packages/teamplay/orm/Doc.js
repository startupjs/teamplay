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
    this.subCount = new Map() // transportHash -> total ref count (owners + retained docs)
    this.ownerFetchCount = new Map() // ownerKey -> fetch intent count
    this.ownerSubscribeCount = new Map() // ownerKey -> subscribe intent count
    this.ownerMeta = new Map() // ownerKey -> { hash, segments, rootId }
    this.ownerKeysByHash = new Map() // transportHash -> Set(ownerKey)
    this.docs = new Map()
    this.pendingDestroyTimers = new Map()
    this.transportTasks = new Map()
    this.fr = new FinalizationRegistry(({ hash, ownerKey }) => this.destroyByOwnerKey(ownerKey, { hash, force: true }))
  }

  init ($doc) {
    const segments = [...$doc[SEGMENTS]]
    const hash = hashDoc(segments)
    let doc = this.docs.get(hash)
    if (doc) {
      if (doc.initialized) return
      doc.init()
    } else {
      doc = new this.DocClass(...segments)
      this.docs.set(hash, doc)
      doc.init()
    }
  }

  subscribe ($doc, { intent = 'subscribe' } = {}) {
    const segments = [...$doc[SEGMENTS]]
    const hash = hashDoc(segments)
    const rootId = getOwningRootId($doc)
    const ownerKey = getDocOwnerKey(rootId, hash)
    const token = getDocFinalizationToken($doc)
    const previousCount = this.subCount.get(hash) || 0
    this.cancelDestroy(hash)
    this.incrementOwnerIntent(ownerKey, intent)
    this.addOwnerMeta(ownerKey, hash, segments, rootId)
    this.subCount.set(hash, previousCount + 1)
    if (rootId) {
      registerRootOwnedDirectDocSubscription(rootId, hash, segments, token)
    }
    this.fr.register($doc, { hash, ownerKey }, token)

    this.init($doc)
    const doc = this.docs.get(hash)
    if (
      previousCount > 0 &&
      doc &&
      !doc._subscribing &&
      !this.transportTasks.get(hash) &&
      this.getDesiredTransportMode(hash) === doc.activeTransportMode
    ) return
    return this.reconcileTransport(hash)
  }

  retain ($doc) {
    const segments = [...$doc[SEGMENTS]]
    const hash = hashDoc(segments)
    this.cancelDestroy(hash)
    const count = this.subCount.get(hash) || 0
    this.subCount.set(hash, count + 1)
    this.init($doc)
  }

  async unsubscribe ($doc, { intent = 'subscribe' } = {}) {
    const segments = [...$doc[SEGMENTS]]
    const hash = hashDoc(segments)
    const rootId = getOwningRootId($doc)
    const ownerKey = getDocOwnerKey(rootId, hash)
    const token = getDocFinalizationToken($doc)
    const currentIntentCount = this.getOwnerIntentCount(ownerKey, intent)
    if (currentIntentCount <= 0) {
      if (ERROR_ON_EXCESSIVE_UNSUBSCRIBES) throw ERRORS.notSubscribed($doc)
      return
    }
    this.setOwnerIntentCount(ownerKey, intent, currentIntentCount - 1)
    const nextOwnerCount = this.getOwnerTotalCount(ownerKey)
    const count = Math.max((this.subCount.get(hash) || 0) - 1, 0)
    if (count > 0) this.subCount.set(hash, count)
    else this.subCount.set(hash, 0)
    if (rootId) {
      unregisterRootOwnedDirectDocSubscription(rootId, hash, token)
    }
    if (nextOwnerCount === 0) {
      this.fr.unregister(token)
      this.removeOwnerMeta(ownerKey, hash)
    }
    const destroyPromise = count === 0 ? this.scheduleDestroy(segments) : undefined
    await this.reconcileTransport(hash)
    if (count > 0) return
    await destroyPromise
  }

  async release ($doc) {
    const segments = [...$doc[SEGMENTS]]
    const hash = hashDoc(segments)
    let count = this.subCount.get(hash) || 0
    count -= 1
    if (count < 0) {
      if (ERROR_ON_EXCESSIVE_UNSUBSCRIBES) throw ERRORS.notSubscribed($doc)
      return
    }
    if (count > 0) {
      this.subCount.set(hash, count)
      return
    }
    this.subCount.set(hash, 0)
    await this.scheduleDestroy(segments)
  }

  async destroy (segments) {
    const hash = hashDoc(segments)
    await this.destroyByHash(hash, { force: true })
  }

  async clear () {
    const hashes = new Set([
      ...this.pendingDestroyTimers.keys(),
      ...this.docs.keys()
    ])
    for (const hash of hashes) {
      await this.destroyByHash(hash, { force: true })
    }
    this.subCount.clear()
    this.ownerFetchCount.clear()
    this.ownerSubscribeCount.clear()
    this.ownerMeta.clear()
    this.ownerKeysByHash.clear()
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
    const previous = this.transportTasks.get(hash) || Promise.resolve()
    const next = previous
      .catch(ignoreDestroyError)
      .then(() => this.reconcileTransportNow(hash))
    this.transportTasks.set(hash, next)
    try {
      await next
    } finally {
      if (this.transportTasks.get(hash) === next) this.transportTasks.delete(hash)
    }
  }

  async reconcileTransportNow (hash) {
    const doc = this.docs.get(hash)
    if (!doc) return
    while (true) {
      const desiredMode = this.getDesiredTransportMode(hash)
      const currentMode = doc.activeTransportMode
      if (desiredMode === currentMode) return
      if (desiredMode === 'idle') {
        if (currentMode === 'idle') return
        await doc.unsubscribe()
        continue
      }
      if (currentMode !== 'idle') {
        await doc.unsubscribe()
        continue
      }
      doc._subscribing = doc.subscribe({ mode: desiredMode }).then(() => { doc._subscribing = undefined })
      await doc._subscribing
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
      const count = this.subCount.get(hash) || 0
      if (!options.force && count > 0) {
        settlePending()
        return
      }
      const doc = this.docs.get(hash)
      if (!doc) {
        this.subCount.delete(hash)
        settlePending()
        return
      }
      await this.reconcileTransport(hash)
      if (!options.force && (this.subCount.get(hash) || 0) > 0) {
        settlePending()
        return
      }
      if (doc.activeTransportMode !== 'idle') {
        await doc.unsubscribe()
      }
      if (!options.force && (this.subCount.get(hash) || 0) > 0) {
        settlePending()
        return
      }
      if (typeof doc.hasPending === 'function' && doc.hasPending()) {
        if (typeof doc.whenNothingPending === 'function') {
          if (pendingDestroy) this.pendingDestroyTimers.set(hash, pendingDestroy)
          doc.whenNothingPending(() => {
            const nextOptions = pendingDestroy ? { ...options, _pendingDestroy: pendingDestroy } : options
            this.destroyByHash(hash, nextOptions).catch(ignoreDestroyError)
          })
        } else {
          settlePending()
        }
        return
      }
      if (typeof doc.destroy === 'function') await doc.destroy()
      if (typeof doc.dispose === 'function') doc.dispose()
      this.docs.delete(hash)
      this.subCount.delete(hash)
      this.ownerKeysByHash.delete(hash)
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

  getOwnerIntentCount (ownerKey, intent) {
    const store = intent === 'fetch' ? this.ownerFetchCount : this.ownerSubscribeCount
    return store.get(ownerKey) || 0
  }

  setOwnerIntentCount (ownerKey, intent, count) {
    const store = intent === 'fetch' ? this.ownerFetchCount : this.ownerSubscribeCount
    if (count > 0) store.set(ownerKey, count)
    else store.delete(ownerKey)
  }

  incrementOwnerIntent (ownerKey, intent) {
    this.setOwnerIntentCount(ownerKey, intent, this.getOwnerIntentCount(ownerKey, intent) + 1)
  }

  getOwnerTotalCount (ownerKey) {
    return (this.ownerFetchCount.get(ownerKey) || 0) + (this.ownerSubscribeCount.get(ownerKey) || 0)
  }

  addOwnerMeta (ownerKey, hash, segments, rootId) {
    if (this.ownerMeta.has(ownerKey)) return
    this.ownerMeta.set(ownerKey, { hash, segments: [...segments], rootId })
    let ownerKeys = this.ownerKeysByHash.get(hash)
    if (!ownerKeys) {
      ownerKeys = new Set()
      this.ownerKeysByHash.set(hash, ownerKeys)
    }
    ownerKeys.add(ownerKey)
  }

  removeOwnerMeta (ownerKey, hash) {
    const meta = this.ownerMeta.get(ownerKey)
    const knownHash = hash ?? meta?.hash
    this.ownerMeta.delete(ownerKey)
    this.ownerFetchCount.delete(ownerKey)
    this.ownerSubscribeCount.delete(ownerKey)
    if (!knownHash) return
    const ownerKeys = this.ownerKeysByHash.get(knownHash)
    if (!ownerKeys) return
    ownerKeys.delete(ownerKey)
    if (ownerKeys.size === 0) this.ownerKeysByHash.delete(knownHash)
  }

  getDesiredTransportMode (hash) {
    const ownerKeys = this.ownerKeysByHash.get(hash)
    if (!ownerKeys || ownerKeys.size === 0) return 'idle'
    let hasFetchBackedOwner = false
    for (const ownerKey of ownerKeys) {
      const subscribeCount = this.ownerSubscribeCount.get(ownerKey) || 0
      const fetchCount = this.ownerFetchCount.get(ownerKey) || 0
      const rootId = this.ownerMeta.get(ownerKey)?.rootId
      const subscribeMode = getRootTransportMode(rootId, 'subscribe')
      if (subscribeCount > 0 && subscribeMode === 'subscribe') return 'subscribe'
      if (fetchCount > 0 || (subscribeCount > 0 && subscribeMode === 'fetch')) {
        hasFetchBackedOwner = true
      }
    }
    return hasFetchBackedOwner ? 'fetch' : 'idle'
  }

  async destroyByOwnerKey (ownerKey, options = {}) {
    const meta = this.ownerMeta.get(ownerKey)
    if (!meta) {
      const hash = options.hash
      const ownerCount = this.getOwnerTotalCount(ownerKey)
      const currentCount = hash ? (this.subCount.get(hash) || 0) : 0
      const nextCount = Math.max(currentCount - ownerCount, 0)
      this.ownerFetchCount.delete(ownerKey)
      this.ownerSubscribeCount.delete(ownerKey)
      if (!hash) return
      this.removeOwnerMeta(ownerKey, hash)
      if (nextCount > 0) this.subCount.set(hash, nextCount)
      else this.subCount.set(hash, 0)
      const doc = this.docs.get(hash)
      await this.reconcileTransport(hash)
      if (nextCount > 0) return
      if (!doc) {
        this.subCount.delete(hash)
        this.ownerKeysByHash.delete(hash)
        return
      }
      if (doc.activeTransportMode !== 'idle') {
        await doc.unsubscribe()
      }
      if ((this.subCount.get(hash) || 0) > 0) return
      if (typeof doc.destroy === 'function') await doc.destroy()
      if (typeof doc.dispose === 'function') doc.dispose()
      this.docs.delete(hash)
      this.ownerKeysByHash.delete(hash)
      this.subCount.delete(hash)
      return
    }
    const { hash, segments } = meta
    const ownerCount = this.getOwnerTotalCount(ownerKey)
    if (!options.force && ownerCount > 0) return

    const currentCount = this.subCount.get(hash) || 0
    const nextCount = Math.max(currentCount - ownerCount, 0)
    if (nextCount > 0) this.subCount.set(hash, nextCount)
    else this.subCount.set(hash, 0)
    this.removeOwnerMeta(ownerKey, hash)
    await this.reconcileTransport(hash)
    if (nextCount > 0) return
    await this.scheduleDestroy(segments, { force: !!options.force })
  }
}

export const docSubscriptions = new DocSubscriptions()

function hashDoc (segments) {
  return JSON.stringify(segments)
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
