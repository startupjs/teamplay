import { raw } from '@nx-js/observer-util'
import { set as _set, del as _del, getRaw } from './dataTree.js'
import getSignal from './getSignal.js'
import { QuerySubscriptions, hashQuery, Query, HASH, PARAMS, COLLECTION_NAME, parseQueryHash } from './Query.js'
import Signal, { SEGMENTS } from './Signal.js'

export const IS_AGGREGATION = Symbol('is aggregation signal')
export const AGGREGATIONS = '$aggregations'

class Aggregation extends Query {
  _initData () {
    {
      const extra = raw(this.shareQuery.extra)
      _set([AGGREGATIONS, this.hash], extra)
    }

    this.shareQuery.on('extra', extra => {
      extra = raw(extra)
      _set([AGGREGATIONS, this.hash], extra)
    })
  }

  _removeData () {
    _del([AGGREGATIONS, this.hash])
  }
}

export const aggregationSubscriptions = new QuerySubscriptions(Aggregation)

export function getAggregationSignal (collectionName, params, options) {
  params = JSON.parse(JSON.stringify(params))
  const hash = hashQuery(collectionName, params)

  const $aggregation = getSignal(undefined, [AGGREGATIONS, hash], options)
  $aggregation[IS_AGGREGATION] ??= true
  $aggregation[COLLECTION_NAME] ??= collectionName
  $aggregation[PARAMS] ??= params
  $aggregation[HASH] ??= hash
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
export function getAggregationDocId (segments) {
  if (!(segments.length >= 3)) return
  if (!(segments[0] === AGGREGATIONS)) return
  if (!(typeof segments[2] === 'number')) return
  const doc = getRaw(segments)
  const docId = doc?._id || doc?.id
  return docId
}

export function getAggregationCollectionName (segments) {
  if (!(segments.length >= 2)) return
  if (!(segments[0] === AGGREGATIONS)) return
  const hash = segments[1]
  const { collectionName } = parseQueryHash(hash)
  return collectionName
}
