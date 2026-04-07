import { raw } from '@nx-js/observer-util'
import { set as _set, getRaw } from './dataTree.js'
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
import { getRoot, ROOT_ID } from './Root.js'
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

  _removeData () {
    for (const $doc of this.docSignals) {
      docSubscriptions.release($doc).catch(ignoreDestroyError)
    }
    this.docSignals.clear()
    this._forEachRoot(rootId => this._removeRootData(rootId))
    this.rootIds.clear()
  }
}

export class QuerySubscriptions {
  constructor (QueryClass = Query) {
    this.QueryClass = QueryClass
    this.runtimeKind = 'query'
    this.subCount = new Map() // ownerKey -> count
    this.transportSubCount = new Map() // transportHash -> attached roots count
    this.queries = new Map()
    this.ownerToTransport = new Map() // ownerKey -> transportHash
    this.ownerMeta = new Map() // ownerKey -> { collectionName, params, transportHash, rootId }
    this.ownerKeysByTransport = new Map() // transportHash -> Set(ownerKey)
    this.pendingDestroyTimers = new Map()
    this.fr = new FinalizationRegistry(({ collectionName, params, ownerKey }) => {
      this.scheduleDestroy(collectionName, params, ownerKey, { force: true })
    })
  }

  subscribe ($query) {
    const collectionName = $query[COLLECTION_NAME]
    const params = cloneQueryParams($query[PARAMS])
    const transportHash = $query[HASH]
    const rootId = getOwningRootId($query)
    const ownerKey = getQueryOwnerKey(rootId, transportHash)
    this.cancelDestroy(ownerKey)
    let count = this.subCount.get(ownerKey) || 0
    count += 1
    this.subCount.set(ownerKey, count)
    if (count > 1) {
      const existingQuery = this.queries.get(transportHash)
      if (existingQuery) return existingQuery._subscribing
      // Recover from stale ref-count state when query was already cleaned up.
      count = 1
      this.subCount.set(ownerKey, count)
    }

    this.fr.register($query, { collectionName, params, ownerKey }, $query)

    let query = this.queries.get(transportHash)
    if (!query) {
      query = new this.QueryClass(collectionName, params, { hash: transportHash })
      this.queries.set(transportHash, query)
    }

    const existingTransportHash = this.ownerToTransport.get(ownerKey)
    const isAttached = existingTransportHash != null

    if (!isAttached || existingTransportHash !== transportHash) {
      if (isAttached) this.removeOwnerMeta(ownerKey, existingTransportHash)
      this.ownerToTransport.set(ownerKey, transportHash)
      this.ownerMeta.set(ownerKey, { collectionName, params, transportHash, rootId })
      let ownerKeys = this.ownerKeysByTransport.get(transportHash)
      if (!ownerKeys) {
        ownerKeys = new Set()
        this.ownerKeysByTransport.set(transportHash, ownerKeys)
      }
      ownerKeys.add(ownerKey)
      attachQueryRoot(query, rootId)
      registerRootOwnedRuntime(rootId, this.runtimeKind, transportHash)

      const transportCount = (this.transportSubCount.get(transportHash) || 0) + 1
      this.transportSubCount.set(transportHash, transportCount)
      if (transportCount === 1) {
        query._subscribing = query.subscribe().then(() => { query._subscribing = undefined })
      }
    }

    return query._subscribing
  }

  async unsubscribe ($query) {
    const ownerKey = getQueryOwnerKey(getOwningRootId($query), $query[HASH])
    let count = this.subCount.get(ownerKey) || 0
    count -= 1
    if (count < 0) {
      if (ERROR_ON_EXCESSIVE_UNSUBSCRIBES) throw Error(ERRORS.notSubscribed($query))
      return
    }
    if (count > 0) {
      this.subCount.set(ownerKey, count)
      return
    }
    this.subCount.set(ownerKey, 0)
    this.fr.unregister($query)
    await this.scheduleDestroy($query[COLLECTION_NAME], $query[PARAMS], ownerKey)
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
      ...this.ownerMeta.keys()
    ])
    for (const ownerKey of ownerKeys) {
      await this.destroyByOwnerKey(ownerKey, { force: true })
    }
    this.subCount.clear()
    this.transportSubCount.clear()
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
      await this.destroyByOwnerKey(fallbackOwnerKey, { collectionName, params, force: !!options.force })
      return
    }
    const existing = this.pendingDestroyTimers.get(fallbackOwnerKey)
    if (existing) {
      if (options.force) existing.force = true
      return existing.promise
    }
    const entry = createPendingDestroyEntry()
    if (options.force) entry.force = true
    entry.timer = setTimeout(() => {
      this.destroyByOwnerKey(fallbackOwnerKey, { collectionName, params, force: entry.force })
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

  async destroyByOwnerKey (ownerKey, options = {}) {
    const pendingDestroy = this.takePendingDestroy(ownerKey)
    if (pendingDestroy?.force) options.force = true

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
      const meta = this.ownerMeta.get(ownerKey)
      if (!meta) {
        this.subCount.delete(ownerKey)
        settlePending()
        return
      }
      const { transportHash, rootId } = meta
      const query = this.queries.get(transportHash)
      if (!query) {
        this.subCount.delete(ownerKey)
        this.removeOwnerMeta(ownerKey, transportHash)
        unregisterRootOwnedRuntime(rootId, this.runtimeKind, transportHash)
        const nextTransportCount = Math.max((this.transportSubCount.get(transportHash) || 0) - 1, 0)
        if (nextTransportCount > 0) this.transportSubCount.set(transportHash, nextTransportCount)
        else this.transportSubCount.delete(transportHash)
        settlePending()
        return
      }
      this.subCount.delete(ownerKey)
      this.removeOwnerMeta(ownerKey, transportHash)
      detachQueryRoot(query, rootId)
      unregisterRootOwnedRuntime(rootId, this.runtimeKind, transportHash)

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

  async destroyByRuntimeHash (runtimeHash, options = {}) {
    const rootId = options.rootId ?? options.root?.[ROOT_ID]
    const ownerKey = getQueryOwnerKey(rootId, runtimeHash)
    return this.destroyByOwnerKey(ownerKey, options)
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
    this.ownerToTransport.delete(ownerKey)
    this.ownerMeta.delete(ownerKey)
    if (!knownTransportHash) return
    const ownerKeys = this.ownerKeysByTransport.get(knownTransportHash)
    if (!ownerKeys) return
    ownerKeys.delete(ownerKey)
    if (ownerKeys.size === 0) this.ownerKeysByTransport.delete(knownTransportHash)
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
    promise,
    resolve: resolvePending,
    reject: rejectPending
  }
}
