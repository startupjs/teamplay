import { raw } from '@nx-js/observer-util'
import { getRaw } from './dataTree.js'
import getSignal from './getSignal.ts'
import {
  QuerySubscriptions,
  hashQuery,
  Query,
  HASH,
  PARAMS,
  COLLECTION_NAME,
  parseQueryHash
} from './Query.js'
import Signal, { SEGMENTS } from './Signal.ts'
import { getIdFieldsForSegments, isPlainObject } from './idFields.ts'
import { delPrivateData, getPrivateData, setPrivateData } from './privateData.js'
import { setSignalRuntimeDescriptor } from './signalRuntimeDescriptor.ts'

export const IS_AGGREGATION = Symbol('is aggregation signal')
export const AGGREGATIONS = '$aggregations'

class Aggregation extends Query {
  _initData () {
    this._syncAllRootsData()

    this.shareQuery.on('extra', extra => {
      extra = raw(extra)
      injectAggregationIds(extra, this.collectionName)
      this._forEachRoot(rootId => {
        setPrivateData(rootId, [AGGREGATIONS, this.hash], extra)
      })
    })
  }

  _syncRootData (rootId) {
    if (!this.shareQuery) return
    const extra = raw(this.shareQuery.extra)
    injectAggregationIds(extra, this.collectionName)
    setPrivateData(rootId, [AGGREGATIONS, this.hash], extra)
  }

  _removeRootData (rootId) {
    delPrivateData(rootId, [AGGREGATIONS, this.hash])
  }

  _removeData () {
    this._forEachRoot(rootId => this._removeRootData(rootId))
    this.rootIds.clear()
  }
}

export const aggregationSubscriptions = new QuerySubscriptions(Aggregation)
aggregationSubscriptions.runtimeKind = 'aggregation'

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
  const { root, signalOptions } = parseAggregationSignalOptions(options)

  const $aggregation = getSignal(root, [AGGREGATIONS, transportHash], signalOptions)
  $aggregation[IS_AGGREGATION] ??= true
  $aggregation[COLLECTION_NAME] ??= collectionName
  $aggregation[PARAMS] ??= params
  $aggregation[HASH] ??= transportHash
  setSignalRuntimeDescriptor($aggregation, {
    kind: 'aggregation',
    collectionName,
    itemPattern: [collectionName, '*']
  })
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
export function getAggregationDocId (segments, rootId, method) {
  if (!(segments.length >= 3)) return
  if (!(segments[0] === AGGREGATIONS)) return
  if (!(typeof segments[2] === 'number')) return
  if (typeof method !== 'function') {
    method = path => rootId == null ? getRaw(path) : getPrivateData(rootId, path)
  }
  const docId = method([...segments.slice(0, 3), '_id']) || method([...segments.slice(0, 3), 'id'])
  return docId
}

export function getAggregationCollectionName (segments) {
  if (!(segments.length >= 2)) return
  if (!(segments[0] === AGGREGATIONS)) return
  const hash = segments[1]
  const { collectionName } = parseQueryHash(hash)
  return collectionName
}

function parseAggregationSignalOptions (options) {
  if (!options || typeof options !== 'object') {
    return {
      root: undefined,
      signalOptions: {}
    }
  }
  const { root, ...signalOptions } = options
  return { root, signalOptions }
}
