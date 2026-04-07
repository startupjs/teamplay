import { raw } from '@nx-js/observer-util'
import { get as _get, set as _set, del as _del, getRaw } from './dataTree.js'
import getSignal from './getSignal.js'
import { getConnection, fetchOnly } from './connection.js'
import { emitModelChange, isModelEventsEnabled } from './Compat/modelEvents.js'
import { isCompatEnv } from './compatEnv.js'
import { docSubscriptions } from './Doc.js'
import FinalizationRegistry from '../utils/MockFinalizationRegistry.js'
import SubscriptionState from './SubscriptionState.js'
import { getIdFieldsForSegments, injectIdFields, isPlainObject } from './idFields.js'
import { getSubscriptionGcDelay } from './subscriptionGcDelay.js'
import { getScopedSignalHash } from './rootScope.js'

const ERROR_ON_EXCESSIVE_UNSUBSCRIBES = false
export const COLLECTION_NAME = Symbol('query collection name')
export const PARAMS = Symbol('query params')
export const HASH = Symbol('query hash')
export const VIEW_HASH = Symbol('query view hash')
export const TRANSPORT_HASH = Symbol('query transport hash')
export const SCOPED_SIGNAL_HASH = Symbol('query scoped signal hash')
export const IS_QUERY = Symbol('is query signal')
export const QUERIES = '$queries'

export class Query {
  initialized
  shareQuery

  constructor (collectionName, params, { hash = hashQuery(collectionName, params) } = {}) {
    this.collectionName = collectionName
    this.params = params
    this.hash = hash
    this.viewHashes = new Set()
    this.docSignals = new Set()
    this.lifecycle = new SubscriptionState({
      onSubscribe: () => this._subscribe(),
      onUnsubscribe: () => this._unsubscribe()
    })
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
    if (!this.subscribed) {
      this.initialized = undefined
      this._removeData()
    }
  }

  attachView (viewHash) {
    if (viewHash == null) return
    if (this.viewHashes.has(viewHash)) return
    this.viewHashes.add(viewHash)
    if (this.initialized) this._syncViewData(viewHash)
  }

  detachView (viewHash) {
    if (viewHash == null) return
    if (!this.viewHashes.delete(viewHash)) return
    this._removeViewData(viewHash)
  }

  async _subscribe () {
    await new Promise((resolve, reject) => {
      const method = fetchOnly ? 'createFetchQuery' : 'createSubscribeQuery'
      this.shareQuery = getConnection()[method](this.collectionName, this.params, {}, err => {
        if (err) return reject(err)
        resolve()
      })
    })
  }

  async _unsubscribe () {
    if (!this.shareQuery) throw Error('this.shareQuery is not defined. This should never happen')
    await new Promise((resolve, reject) => {
      this.shareQuery.destroy(err => {
        if (err) return reject(err)
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
    this._syncAllViewsData()

    this.shareQuery.on('insert', (shareDocs, index) => {
      maybeMaterializeQueryDocsToCollection(this.collectionName, shareDocs)
      const newDocs = this._mapShareDocsToRaw(shareDocs)
      const ids = shareDocs.map(doc => doc.id)
      for (const docId of ids) {
        const $doc = getSignal(undefined, [this.collectionName, docId])
        docSubscriptions.retain($doc)
        this.docSignals.add($doc)
      }
      this._forEachView(viewHash => {
        const docs = _get([QUERIES, viewHash, 'docs'])
        const idsState = _get([QUERIES, viewHash, 'ids'])
        if (!Array.isArray(docs) || !Array.isArray(idsState)) return
        docs.splice(index, 0, ...newDocs)
        idsState.splice(index, 0, ...ids)

        if (!isModelEventsEnabled()) return
        const docsPath = [QUERIES, viewHash, 'docs']
        const idsPath = [QUERIES, viewHash, 'ids']
        for (let i = 0; i < newDocs.length; i++) {
          emitModelChange(docsPath.concat(index + i), newDocs[i], undefined, {
            op: 'queryInsert',
            index: index + i
          })
        }
        for (let i = 0; i < ids.length; i++) {
          emitModelChange(idsPath.concat(index + i), ids[i], undefined, {
            op: 'queryInsert',
            index: index + i
          })
        }
      })
    })
    this.shareQuery.on('move', (shareDocs, from, to) => {
      const movedDocs = this._mapShareDocsToRaw(shareDocs)
      const movedIds = shareDocs.map(doc => doc.id)
      this._forEachView(viewHash => {
        const docs = _get([QUERIES, viewHash, 'docs'])
        const ids = _get([QUERIES, viewHash, 'ids'])
        if (!Array.isArray(docs) || !Array.isArray(ids)) return
        const prevDocs = isModelEventsEnabled() ? docs.slice() : undefined
        docs.splice(from, shareDocs.length)
        docs.splice(to, 0, ...movedDocs)

        const prevIds = isModelEventsEnabled() ? ids.slice() : undefined
        ids.splice(from, shareDocs.length)
        ids.splice(to, 0, ...movedIds)

        if (!isModelEventsEnabled()) return
        emitModelChange([QUERIES, viewHash, 'docs'], docs, prevDocs, {
          op: 'queryMove',
          from,
          to,
          howMany: shareDocs.length
        })
        emitModelChange([QUERIES, viewHash, 'ids'], ids, prevIds, {
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
      this._forEachView(viewHash => {
        const docs = _get([QUERIES, viewHash, 'docs'])
        const ids = _get([QUERIES, viewHash, 'ids'])
        if (!Array.isArray(docs) || !Array.isArray(ids)) return
        const removedDocs = isModelEventsEnabled() ? docs.slice(index, index + shareDocs.length) : undefined
        docs.splice(index, shareDocs.length)

        const removedIds = isModelEventsEnabled() ? ids.slice(index, index + docIds.length) : undefined
        ids.splice(index, docIds.length)

        if (!isModelEventsEnabled()) return
        const docsPath = [QUERIES, viewHash, 'docs']
        const idsPath = [QUERIES, viewHash, 'ids']
        for (let i = 0; i < removedDocs.length; i++) {
          emitModelChange(docsPath.concat(index + i), undefined, removedDocs[i], {
            op: 'queryRemove',
            index: index + i
          })
        }
        for (let i = 0; i < removedIds.length; i++) {
          emitModelChange(idsPath.concat(index + i), undefined, removedIds[i], {
            op: 'queryRemove',
            index: index + i
          })
        }
      })
    })
    this.shareQuery.on('extra', extra => {
      extra = raw(extra)
      this._forEachView(viewHash => {
        if (_get([QUERIES, viewHash]) == null) return
        _set([QUERIES, viewHash, 'extra'], extra)
      })
    })
  }

  _syncAllViewsData () {
    this._forEachView(viewHash => this._syncViewData(viewHash))
  }

  _syncViewData (viewHash) {
    if (!this.shareQuery) return
    maybeMaterializeQueryDocsToCollection(this.collectionName, this.shareQuery.results)
    const docs = this._mapShareDocsToRaw(this.shareQuery.results)
    _set([QUERIES, viewHash, 'docs'], docs)

    const ids = this.shareQuery.results.map(doc => doc.id)
    _set([QUERIES, viewHash, 'ids'], ids)

    if (this.shareQuery.extra !== undefined) {
      const extra = raw(this.shareQuery.extra)
      _set([QUERIES, viewHash, 'extra'], extra)
    }
  }

  _removeViewData (viewHash) {
    _del([QUERIES, viewHash])
  }

  _forEachView (fn) {
    for (const viewHash of this.viewHashes) fn(viewHash)
  }

  _mapShareDocsToRaw (shareDocs) {
    return shareDocs.map(doc => {
      const idFields = getIdFieldsForSegments([this.collectionName, doc.id])
      if (isPlainObject(doc.data)) injectIdFields(doc.data, idFields, doc.id)
      return raw(doc.data)
    })
  }

  _removeData () {
    for (const $doc of this.docSignals) {
      docSubscriptions.release($doc).catch(ignoreDestroyError)
    }
    this.docSignals.clear()
    this._forEachView(viewHash => this._removeViewData(viewHash))
    this.viewHashes.clear()
  }
}

export class QuerySubscriptions {
  constructor (QueryClass = Query) {
    this.QueryClass = QueryClass
    this.subCount = new Map() // viewHash -> count
    this.transportSubCount = new Map() // transportHash -> attached views count
    this.queries = new Map()
    this.viewToTransport = new Map() // viewHash -> transportHash
    this.viewMeta = new Map() // viewHash -> { collectionName, params, transportHash }
    this.viewHashesByTransport = new Map() // transportHash -> Set(viewHash)
    this.pendingDestroyTimers = new Map()
    this.fr = new FinalizationRegistry(({ collectionName, params, viewHash }) => {
      this.scheduleDestroy(collectionName, params, viewHash, { force: true })
    })
  }

  subscribe ($query) {
    const collectionName = $query[COLLECTION_NAME]
    const params = cloneQueryParams($query[PARAMS])
    const transportHash = $query[HASH]
    const viewHash = getQueryViewHash($query)
    this.cancelDestroy(viewHash)
    let count = this.subCount.get(viewHash) || 0
    count += 1
    this.subCount.set(viewHash, count)
    if (count > 1) {
      const existingQuery = this.queries.get(transportHash)
      if (existingQuery) return existingQuery._subscribing
      // Recover from stale ref-count state when query was already cleaned up.
      count = 1
      this.subCount.set(viewHash, count)
    }

    this.fr.register($query, { collectionName, params, viewHash }, $query)

    let query = this.queries.get(transportHash)
    if (!query) {
      query = new this.QueryClass(collectionName, params, { hash: transportHash })
      this.queries.set(transportHash, query)
    }

    const existingTransportHash = this.viewToTransport.get(viewHash)
    const isAttached = existingTransportHash != null

    if (!isAttached || existingTransportHash !== transportHash) {
      if (isAttached) this.removeViewMeta(viewHash, existingTransportHash)
      this.viewToTransport.set(viewHash, transportHash)
      this.viewMeta.set(viewHash, { collectionName, params, transportHash })
      let viewHashes = this.viewHashesByTransport.get(transportHash)
      if (!viewHashes) {
        viewHashes = new Set()
        this.viewHashesByTransport.set(transportHash, viewHashes)
      }
      viewHashes.add(viewHash)
      attachQueryView(query, viewHash)

      const transportCount = (this.transportSubCount.get(transportHash) || 0) + 1
      this.transportSubCount.set(transportHash, transportCount)
      if (transportCount === 1) {
        query._subscribing = query.subscribe().then(() => { query._subscribing = undefined })
      }
    }

    return query._subscribing
  }

  async unsubscribe ($query) {
    const viewHash = getQueryViewHash($query)
    let count = this.subCount.get(viewHash) || 0
    count -= 1
    if (count < 0) {
      if (ERROR_ON_EXCESSIVE_UNSUBSCRIBES) throw Error(ERRORS.notSubscribed($query))
      return
    }
    if (count > 0) {
      this.subCount.set(viewHash, count)
      return
    }
    this.subCount.set(viewHash, 0)
    this.fr.unregister($query)
    await this.scheduleDestroy($query[COLLECTION_NAME], $query[PARAMS], viewHash)
  }

  async destroy (collectionName, params, options = {}) {
    const transportHash = hashQuery(collectionName, params)
    const viewHashes = Array.from(this.viewHashesByTransport.get(transportHash) || [])
    if (viewHashes.length === 0) {
      await this.destroyByViewHash(transportHash, {
        collectionName,
        params,
        force: options.force ?? true
      })
      return
    }
    for (const viewHash of viewHashes) {
      await this.destroyByViewHash(viewHash, {
        collectionName,
        params,
        force: options.force ?? true
      })
    }
  }

  async clear () {
    const viewHashes = new Set([
      ...this.pendingDestroyTimers.keys(),
      ...this.viewMeta.keys()
    ])
    for (const viewHash of viewHashes) {
      await this.destroyByViewHash(viewHash, { force: true })
    }
    this.subCount.clear()
    this.transportSubCount.clear()
    this.viewToTransport.clear()
    this.viewMeta.clear()
    this.viewHashesByTransport.clear()
  }

  async flushPendingDestroys () {
    const viewHashes = Array.from(this.pendingDestroyTimers.keys())
    for (const viewHash of viewHashes) {
      await this.destroyByViewHash(viewHash)
    }
  }

  async scheduleDestroy (collectionName, params, viewHash = hashQuery(collectionName, params), options = {}) {
    const delay = getSubscriptionGcDelay()
    if (delay <= 0) {
      await this.destroyByViewHash(viewHash, { collectionName, params, force: !!options.force })
      return
    }
    const existing = this.pendingDestroyTimers.get(viewHash)
    if (existing) {
      if (options.force) existing.force = true
      return existing.promise
    }
    const entry = createPendingDestroyEntry()
    if (options.force) entry.force = true
    entry.timer = setTimeout(() => {
      this.destroyByViewHash(viewHash, { collectionName, params, force: entry.force })
        .catch(ignoreDestroyError)
    }, delay)
    this.pendingDestroyTimers.set(viewHash, entry)
    return entry.promise
  }

  cancelDestroy (viewHash) {
    const entry = this.takePendingDestroy(viewHash)
    if (!entry) return
    entry.resolve()
  }

  async destroyByViewHash (viewHash, options = {}) {
    const pendingDestroy = this.takePendingDestroy(viewHash)
    if (pendingDestroy?.force) options.force = true

    const settlePending = err => {
      if (!pendingDestroy) return
      if (err) pendingDestroy.reject(err)
      else pendingDestroy.resolve()
    }

    try {
      const count = this.subCount.get(viewHash) || 0
      if (!options.force && count > 0) {
        settlePending()
        return
      }
      const meta = this.viewMeta.get(viewHash)
      if (!meta) {
        this.subCount.delete(viewHash)
        settlePending()
        return
      }
      const { transportHash } = meta
      const query = this.queries.get(transportHash)
      if (!query) {
        this.subCount.delete(viewHash)
        this.removeViewMeta(viewHash, transportHash)
        const nextTransportCount = Math.max((this.transportSubCount.get(transportHash) || 0) - 1, 0)
        if (nextTransportCount > 0) this.transportSubCount.set(transportHash, nextTransportCount)
        else this.transportSubCount.delete(transportHash)
        settlePending()
        return
      }
      this.subCount.delete(viewHash)
      this.removeViewMeta(viewHash, transportHash)
      detachQueryView(query, viewHash)

      const nextTransportCount = Math.max((this.transportSubCount.get(transportHash) || 0) - 1, 0)
      this.transportSubCount.set(transportHash, nextTransportCount)
      if (nextTransportCount > 0) {
        settlePending()
        return
      }
      await query.unsubscribe()
      if (query.subscribed) {
        settlePending()
        return // if we subscribed again while waiting for unsubscribe, we don't delete the query
      }
      if ((this.transportSubCount.get(transportHash) || 0) > 0) {
        settlePending()
        return
      }
      this.transportSubCount.delete(transportHash)
      this.queries.delete(transportHash)
      settlePending()
    } catch (err) {
      settlePending(err)
      throw err
    }
  }

  takePendingDestroy (viewHash) {
    const entry = this.pendingDestroyTimers.get(viewHash)
    if (!entry) return
    clearTimeout(entry.timer)
    this.pendingDestroyTimers.delete(viewHash)
    return entry
  }

  removeViewMeta (viewHash, transportHash) {
    const knownTransportHash = transportHash ?? this.viewToTransport.get(viewHash)
    this.viewToTransport.delete(viewHash)
    this.viewMeta.delete(viewHash)
    if (!knownTransportHash) return
    const viewHashes = this.viewHashesByTransport.get(knownTransportHash)
    if (!viewHashes) return
    viewHashes.delete(viewHash)
    if (viewHashes.size === 0) this.viewHashesByTransport.delete(knownTransportHash)
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

export function hashScopedSignalHash (transportHash, scopeKey) {
  return getScopedSignalHash(scopeKey, transportHash, 'querySignal')
}

export function getQuerySignal (collectionName, params, options) {
  params = cloneQueryParams(params)
  const transportHash = hashQuery(collectionName, params)
  const { root, scopeKey, signalOptions } = parseQuerySignalOptions(options)
  const viewHash = hashScopedSignalHash(transportHash, scopeKey ?? signalOptions.rootId)

  const $query = getSignal(root, [collectionName], {
    signalHash: viewHash,
    ...signalOptions
  })
  $query[IS_QUERY] ??= true
  $query[COLLECTION_NAME] ??= collectionName
  $query[PARAMS] ??= params
  // Backward compatible operational hash:
  // - used by subscription managers and query data storage ($queries.<hash>.*)
  $query[HASH] ??= transportHash
  $query[VIEW_HASH] ??= viewHash
  // Explicit metadata for incremental migration.
  $query[TRANSPORT_HASH] ??= transportHash
  $query[SCOPED_SIGNAL_HASH] ??= viewHash
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

function attachQueryView (query, viewHash) {
  if (viewHash == null || !query) return
  if (typeof query.attachView === 'function') {
    query.attachView(viewHash)
    return
  }
  if (query.viewHashes?.add) query.viewHashes.add(viewHash)
}

function detachQueryView (query, viewHash) {
  if (viewHash == null || !query) return
  if (typeof query.detachView === 'function') {
    query.detachView(viewHash)
    return
  }
  if (query.viewHashes?.delete) query.viewHashes.delete(viewHash)
}

function cloneQueryParams (params) {
  if (!isCompatEnv()) return JSON.parse(JSON.stringify(params))
  return cloneQueryParamsCompat(params)
}

function parseQuerySignalOptions (options) {
  if (!options || typeof options !== 'object') {
    return {
      root: undefined,
      scopeKey: undefined,
      signalOptions: {}
    }
  }
  const { root, scopeKey, ...signalOptions } = options
  return { root, scopeKey, signalOptions }
}

function getQueryViewHash ($query) {
  return $query[VIEW_HASH] || $query[HASH]
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
    promise,
    resolve: resolvePending,
    reject: rejectPending
  }
}
