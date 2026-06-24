import { raw } from '@nx-js/observer-util'
import { getRaw } from './dataTree.js'
import getSignal from './getSignal.ts'
import {
  QuerySubscriptions,
  hashQuery,
  Query,
  cloneQueryParams,
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
const DEFAULT_AGGREGATION_ID_FIELDS = ['_id', 'id']

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
  const idFields = getCollectionIdFields(collectionName)
  for (const doc of extra) {
    if (!isPlainObject(doc)) continue
    const docId = getAggregationRowId(doc, collectionName)
    if (docId == null) continue
    for (const field of idFields) {
      if (doc[field] !== docId) doc[field] = docId
    }
  }
}

export function getAggregationRowId (row, collectionName) {
  if (!isPlainObject(row)) return
  const idFields = getAggregationIdFields(collectionName)
  for (const field of idFields) {
    const value = row[field]
    if (typeof value === 'string') return value
  }
}

export function getAggregationSignal (collectionName, params, options) {
  params = cloneQueryParams(collectionName, params)
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
//          AND only if the aggregation row carries a source document id field
export function getAggregationDocId (segments, rootId, method) {
  if (!(segments.length >= 3)) return
  if (!(segments[0] === AGGREGATIONS)) return
  if (!(typeof segments[2] === 'number')) return
  const collectionName = getAggregationCollectionName(segments)
  const idFields = getAggregationIdFields(collectionName)
  if (typeof method !== 'function') {
    method = path => rootId == null ? getRaw(path) : getPrivateData(rootId, path)
  }
  for (const field of idFields) {
    const id = method([...segments.slice(0, 3), field])
    if (typeof id === 'string') return id
  }
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

function getAggregationIdFields (collectionName) {
  const idFields = getCollectionIdFields(collectionName)
  return uniq(idFields.concat(DEFAULT_AGGREGATION_ID_FIELDS))
}

function getCollectionIdFields (collectionName) {
  return collectionName
    ? getIdFieldsForSegments([collectionName, ''])
    : []
}

function uniq (values) {
  return Array.from(new Set(values))
}
