import { isAggregationHeader, isAggregationFunction, isClientAggregationFunction } from '@teamplay/utils/aggregation'
import Signal, { SEGMENTS, isPublicCollectionSignal, isPublicDocumentSignal } from './Signal.js'
import { docSubscriptions } from './Doc.js'
import { querySubscriptions, getQuerySignal } from './Query.js'
import { aggregationSubscriptions, getAggregationSignal } from './Aggregation.js'
import isServer from '../utils/isServer.js'

export default function sub ($signal, params) {
  // TODO: temporarily disable support for multiple subscriptions
  //       since this has to be properly cached using useDeferredSignal() in useSub()
  // if (Array.isArray($signal)) {
  //   const res = $signal.map(args => Array.isArray(args) ? sub(...args) : sub(args))
  //   if (res.some($s => $s.then)) return Promise.all(res)
  //   return res
  // }
  if (Array.isArray($signal)) throw Error('sub() does not support multiple subscriptions yet')
  if (isPublicDocumentSignal($signal)) {
    if (arguments.length > 1) throw Error(ERRORS.subDocArguments(...arguments))
    return doc$($signal)
  } else if (isPublicCollectionSignal($signal)) {
    if (arguments.length !== 2) throw Error(ERRORS.subQueryArguments(...arguments))
    return query$($signal[SEGMENTS][0], params)
  } else if (isClientAggregationFunction($signal)) {
    return getAggregationFromFunction($signal, $signal.collection, params)
  } else if (isAggregationHeader($signal)) {
    params = {
      $aggregationName: $signal.name,
      $params: sanitizeAggregationParams(params)
    }
    return aggregation$($signal.collection, params)
  } else if (isAggregationFunction($signal)) {
    if (isServer) {
      if (!params?.$collection) throw Error(ERRORS.subServerAggregationCollection($signal, params))
      params = { ...params }
      const collection = params.$collection
      delete params.$collection
      return getAggregationFromFunction($signal, collection, params)
    } else {
      throw Error(ERRORS.gotAggregationFunction($signal))
    }
  } else if (typeof $signal === 'function' && !($signal instanceof Signal)) {
    return api$($signal, params)
  } else {
    throw Error('Invalid args passed for sub()')
  }
}

function getAggregationFromFunction (fn, collection, params) {
  params = sanitizeAggregationParams(params) // clones it, so mutation becomes safe
  let session
  if (params.$session) {
    session = params.$session
    delete params.$session
  }
  session ??= {}
  // should match the context in @teamplay/backend/features/serverAggregate.js
  const context = { collection, session, isServer }
  params = fn(params, context)
  if (Array.isArray(params)) params = { $aggregate: params }
  return aggregation$(collection, params)
}

function doc$ ($doc) {
  const promise = docSubscriptions.subscribe($doc)
  if (!promise) return $doc
  return new Promise(resolve => promise.then(() => resolve($doc)))
}

function query$ (collectionName, params) {
  if (typeof params !== 'object') throw Error(ERRORS.queryParamsObject(collectionName, params))
  if (params?.$aggregate || params?.$aggregationName) return aggregation$(collectionName, params)
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
  `,
  subServerAggregationCollection: ($signal, params) => `
    sub($$aggregation, params):
      Server-side aggregation function must receive the collection name from the params.
      Make sure you pass the collection name as $collection in the params object
      when running aggregation from the server code:
      sub($$aggregation, { $collection: 'collectionName', ...actualParams })

      Got:
        Aggregation: ${$signal}
        Params: ${params}
  `
}
