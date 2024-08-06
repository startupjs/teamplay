import { isAggregationHeader, isAggregationFunction } from '@teamplay/utils/aggregation'
import Signal, { SEGMENTS, isPublicCollectionSignal, isPublicDocumentSignal } from './Signal.js'
import { docSubscriptions } from './Doc.js'
import { querySubscriptions, getQuerySignal } from './Query.js'
import { aggregationSubscriptions, getAggregationSignal } from './Aggregation.js'

export default function sub ($signal, params) {
  // TODO: temporarily disable support for multiple subscriptions
  //       since this has to be properly cached using useDeferredSignal() in useSub()
  // if (Array.isArray($signal)) {
  //   const res = $signal.map(args => Array.isArray(args) ? sub(...args) : sub(args))
  //   if (res.some($s => $s.then)) return Promise.all(res)
  //   return res
  // }
  if (isPublicDocumentSignal($signal)) {
    if (arguments.length > 1) throw Error(ERRORS.subDocArguments(...arguments))
    return doc$($signal)
  } else if (isPublicCollectionSignal($signal)) {
    if (arguments.length !== 2) throw Error(ERRORS.subQueryArguments(...arguments))
    return query$($signal[SEGMENTS][0], params)
  } else if (typeof $signal === 'function' && !($signal instanceof Signal)) {
    return api$($signal, params)
  } else if (isAggregationHeader($signal)) {
    params = {
      $aggregationName: $signal.name,
      $params: sanitizeAggregationParams(params)
    }
    return aggregation$($signal.collection, params)
  } else if (isAggregationFunction($signal)) {
    throw Error(ERRORS.gotAggregationFunction($signal))
  } else {
    throw Error('Invalid args passed for sub()')
  }
}

function doc$ ($doc) {
  const promise = docSubscriptions.subscribe($doc)
  if (!promise) return $doc
  return new Promise(resolve => promise.then(() => resolve($doc)))
}

function query$ (collectionName, params) {
  if (typeof params !== 'object') throw Error(ERRORS.queryParamsObject(collectionName, params))
  const $query = getQuerySignal(collectionName, params)
  const promise = querySubscriptions.subscribe($query)
  if (!promise) return $query
  return new Promise(resolve => promise.then(() => resolve($query)))
}

function aggregation$ (collectionName, params) {
  const $aggregationQuery = getAggregationSignal(collectionName, params)
  const promise = aggregationSubscriptions.subscribe($aggregationQuery)
  if (!promise) return $aggregationQuery
  return new Promise(resolve => promise.then(() => resolve($aggregationQuery)))
}

function api$ (fn, args) {
  throw Error('sub() for async functions is not implemented yet')
}

// aggregation params get transferred to the server
// and while doing so if some value is 'undefined', it actually gets transferred as 'null'
// which breaks logic of setting default values in the aggregation function.
// That's why we have to explicitly remove 'undefined' values from the aggregation params.
// This can be easily done by serializing and deserializing it to JSON.
function sanitizeAggregationParams (params) {
  return JSON.parse(JSON.stringify(params))
}

const ERRORS = {
  subDocArguments: ($signal, ...args) => `
    sub($doc) accepts only 1 argument - the document signal to subscribe to
    Doc: ${$signal[SEGMENTS]}
    Got args: ${[$signal, ...args]}
  `,
  subQueryArguments: ($signal, params, ...args) => `
    sub($collection, params) accepts 2 arguments - the collection signal and an object with query params.
    If you want to subscribe to all documents in a collection, pass an empty object: sub($collection, {}).
    Collection: ${$signal[SEGMENTS]}
    Params: ${params}
    Got args: ${[$signal, params, ...args]}
  `,
  queryParamsObject: (collectionName, params) => `
    sub($collection, params):
      Params must be an object.
      If you want to subscribe to all documents in a collection, pass an empty object: sub($collection, {}).

      Got:
        collectionName: ${collectionName}
        params: ${params}
  `,
  gotAggregationFunction: aggregationFn => `
    sub($$aggregation, params):
      Got aggregation function itself instead of the aggregation header.
      Looks like client-side code transformation did not work properly and your
      aggregation() function was not transformed into an __aggregationHeader().
      Make sure you only use aggregation() function inside project's 'model' folder using
      import { aggregation } from 'startupjs'

      Got:
        ${aggregationFn.toString()}
  `
}
