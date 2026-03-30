import { isObservable, observable, raw } from '@nx-js/observer-util'
import { set as _set, del as _del, getRaw as _getRaw } from './dataTree.js'
import { SEGMENTS } from './Signal.js'
import { getConnection, fetchOnly } from './connection.js'
import FinalizationRegistry from '../utils/MockFinalizationRegistry.js'
import SubscriptionState from './SubscriptionState.js'
import { getIdFieldsForSegments, injectIdFields, isPlainObject } from './idFields.js'
import { emitModelChange, isModelEventsEnabled } from './Compat/modelEvents.js'
import { getSubscriptionGcDelay } from './subscriptionGcDelay.js'
import { isMissingShareDoc } from './missingDoc.js'

const ERROR_ON_EXCESSIVE_UNSUBSCRIBES = false

class Doc {
  initialized

  constructor (collection, docId) {
    this.collection = collection
    this.docId = docId
    this.lifecycle = new SubscriptionState({
      onSubscribe: () => this._subscribe(),
      onUnsubscribe: () => this._unsubscribe()
    })
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

  async subscribe () {
    await this.lifecycle.subscribe()
    this.init()
  }

  async unsubscribe () {
    await this.lifecycle.unsubscribe()
  }

  async _subscribe () {
    const doc = getConnection().get(this.collection, this.docId)
    await new Promise((resolve, reject) => {
      const method = fetchOnly ? 'fetch' : 'subscribe'
      doc[method](err => {
        if (err) return reject(err)
        resolve()
      })
    })
  }

  async _unsubscribe () {
    const doc = getConnection().get(this.collection, this.docId)
    await new Promise((resolve, reject) => {
      doc.unsubscribe(err => {
        if (err) return reject(err)
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
    doc.on('del', () => _del([this.collection, this.docId]))
    if (isModelEventsEnabled()) {
      doc.on('op', op => emitDocOp(this.collection, this.docId, op))
    }
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
    this.subCount = new Map()
    this.docs = new Map()
    this.pendingDestroyTimers = new Map()
    this.fr = new FinalizationRegistry(segments => this.scheduleDestroy(segments, { force: true }))
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
      this.fr.register($doc, segments, $doc)
      doc.init()
    }
  }

  subscribe ($doc) {
    const segments = [...$doc[SEGMENTS]]
    const hash = hashDoc(segments)
    this.cancelDestroy(hash)
    let count = this.subCount.get(hash) || 0
    count += 1
    this.subCount.set(hash, count)
    if (count > 1) {
      const existingDoc = this.docs.get(hash)
      if (existingDoc) return existingDoc._subscribing
      // Recover from stale ref-count state when doc entry was already cleaned up.
      count = 1
      this.subCount.set(hash, count)
    }

    this.init($doc)
    const doc = this.docs.get(hash)
    doc._subscribing = doc.subscribe().then(() => { doc._subscribing = undefined })
    return doc._subscribing
  }

  retain ($doc) {
    const segments = [...$doc[SEGMENTS]]
    const hash = hashDoc(segments)
    this.cancelDestroy(hash)
    const count = this.subCount.get(hash) || 0
    this.subCount.set(hash, count + 1)
    this.init($doc)
  }

  async unsubscribe ($doc) {
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
    this.fr.unregister($doc)
    await this.scheduleDestroy(segments)
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
      // Always call unsubscribe() - if doc is in SUBSCRIBING state, the state machine
      // will queue a pending unsubscribe to execute after subscribe completes
      await doc.unsubscribe()
      if (doc.subscribed) {
        settlePending()
        return // Subscribed again while unsubscribing
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
}

export const docSubscriptions = new DocSubscriptions()

function hashDoc (segments) {
  return JSON.stringify(segments)
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
