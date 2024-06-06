import Signal, { SEGMENTS, isPublicCollectionSignal, isPublicDocumentSignal } from './Signal.js'
import { docSubscriptions } from './Doc.js'
import { querySubscriptions, getQuerySignal } from './Query.js'

export default function sub ($signal, params) {
  if (Array.isArray($signal)) {
    const res = $signal.map(args => Array.isArray(args) ? sub(...args) : sub(args))
    if (res.some($s => $s.then)) return Promise.all(res)
    return res
  }
  if (isPublicDocumentSignal($signal)) {
    if (arguments.length > 1) throw Error(ERRORS.subDocArguments(...arguments))
    return doc$($signal)
  } else if (isPublicCollectionSignal($signal)) {
    if (arguments.length !== 2) throw Error(ERRORS.subQueryArguments(...arguments))
    return query$($signal, params)
  } else if (typeof $signal === 'function' && !($signal instanceof Signal)) {
    return api$($signal, params)
  } else {
    throw Error('Invalid args passed for sub()')
  }
}

function doc$ ($doc) {
  const promise = docSubscriptions.subscribe($doc)
  if (!promise) return $doc
  return new Promise(resolve => promise.then(() => resolve($doc)))
}

function query$ ($collection, params) {
  if (typeof params !== 'object') throw Error(ERRORS.queryParamsObject($collection, params))
  const $query = getQuerySignal($collection[SEGMENTS], params)
  const promise = querySubscriptions.subscribe($query)
  if (!promise) return $query
  return new Promise(resolve => promise.then(() => resolve($query)))
}

function api$ (fn, args) {
  throw Error('sub() for async functions is not implemented yet')
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
  queryParamsObject: ($collection, params) => `
    sub($collection, params):
      Params must be an object.
      If you want to subscribe to all documents in a collection, pass an empty object: sub($collection, {}).

      Got:
        $collection: ${$collection[SEGMENTS]}
        params: ${params}
  `
}
