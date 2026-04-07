import { raw } from '@nx-js/observer-util'
import { set as _set, del as _del, getRaw } from './dataTree.js'
import getSignal from './getSignal.js'
import {
  QuerySubscriptions,
  hashQuery,
  hashScopedSignalHash,
  Query,
  HASH,
  VIEW_HASH,
  PARAMS,
  COLLECTION_NAME,
  TRANSPORT_HASH,
  SCOPED_SIGNAL_HASH,
  parseQueryHash
} from './Query.js'
import Signal, { SEGMENTS } from './Signal.js'
import { getIdFieldsForSegments, isPlainObject } from './idFields.js'

export const IS_AGGREGATION = Symbol('is aggregation signal')
export const AGGREGATIONS = '$aggregations'

class Aggregation extends Query {
  _initData () {
    this._syncAllViewsData()

    this.shareQuery.on('extra', extra => {
      extra = raw(extra)
      injectAggregationIds(extra, this.collectionName)
      this._forEachView(viewHash => {
        _set([AGGREGATIONS, viewHash], extra)
      })
    })
  }

  _syncViewData (viewHash) {
    if (!this.shareQuery) return
    const extra = raw(this.shareQuery.extra)
    injectAggregationIds(extra, this.collectionName)
    _set([AGGREGATIONS, viewHash], extra)
  }

  _removeViewData (viewHash) {
    _del([AGGREGATIONS, viewHash])
  }

  _removeData () {
    this._forEachView(viewHash => this._removeViewData(viewHash))
    this.viewHashes.clear()
  }
}

export const aggregationSubscriptions = new QuerySubscriptions(Aggregation)

function injectAggregationIds (extra, collectionName) {
  if (!Array.isArray(extra)) return
  const idFields = getIdFieldsForSegments([collectionName, ''])
  for (const doc of extra) {
    if (!isPlainObject(doc)) continue
    const docId = doc._id ?? doc.id
    if (docId == null) continue
    if (idFields.includes('_id') && doc._id !== docId) doc._id = docId
    if (idFields.includes('id') && doc.id !== docId) doc.id = docId
  }
}

export function getAggregationSignal (collectionName, params, options) {
  params = JSON.parse(JSON.stringify(params))
  const transportHash = hashQuery(collectionName, params)
  const { root, scopeKey, signalOptions } = parseAggregationSignalOptions(options)
  const viewHash = hashScopedSignalHash(transportHash, scopeKey ?? signalOptions.rootId)

  const $aggregation = getSignal(root, [AGGREGATIONS, viewHash], signalOptions)
  $aggregation[IS_AGGREGATION] ??= true
  $aggregation[COLLECTION_NAME] ??= collectionName
  $aggregation[PARAMS] ??= params
  // Backward compatible operational hash:
  // - used by subscription managers and aggregation/query data storage.
  $aggregation[HASH] ??= transportHash
  $aggregation[VIEW_HASH] ??= viewHash
  $aggregation[TRANSPORT_HASH] ??= transportHash
  $aggregation[SCOPED_SIGNAL_HASH] ??= viewHash
  return $aggregation
}

// example: ['$aggregations', '{"active":true}']
export function isAggregationSignal ($signal) {
  if (!($signal instanceof Signal)) return
  const segments = $signal[SEGMENTS]
  if (!(segments.length === 2)) return
  if (!(segments[0] === AGGREGATIONS)) return
  return true
}

// example: ['$aggregations', '{"active":true}', 42]
//          AND only if it also has either '_id' or 'id' field inside
export function getAggregationDocId (segments, method = getRaw) {
  if (!(segments.length >= 3)) return
  if (!(segments[0] === AGGREGATIONS)) return
  if (!(typeof segments[2] === 'number')) return
  const docId = method([...segments.slice(0, 3), '_id']) || method([...segments.slice(0, 3), 'id'])
  return docId
}

export function getAggregationCollectionName (segments) {
  if (!(segments.length >= 2)) return
  if (!(segments[0] === AGGREGATIONS)) return
  const hash = resolveTransportHash(segments[1])
  const { collectionName } = parseQueryHash(hash)
  return collectionName
}

function parseAggregationSignalOptions (options) {
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

function resolveTransportHash (hash) {
  try {
    const parsed = JSON.parse(hash)
    if (parsed?.querySignal?.[1]) return parsed.querySignal[1]
  } catch {}
  return hash
}
