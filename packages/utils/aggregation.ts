// @ts-nocheck
export const isAggregationFlag = '__isAggregation'
export const isClientAggregationFlag = '__isClientAggregation'

export interface AggregationMeta<TCollection extends string = string> {
  readonly __isAggregation: true
  readonly collection: TCollection
  readonly name: string
}

export interface AggregationFunction<TCollection extends string = string> {
  (...args: any[]): any
  readonly __isAggregation: true
  readonly collection: TCollection
}

export function isAggregation (something) {
  return isAggregationFunction(something) || isAggregationHeader(something)
}

export function isAggregationFunction (fn) {
  return typeof fn === 'function' && fn[isAggregationFlag]
}

export function isClientAggregationFunction (fn) {
  return isAggregationFunction(fn) && fn[isClientAggregationFlag]
}

export function isAggregationHeader (aggregationMeta) {
  return validateAggregationMeta(aggregationMeta) && aggregationMeta[isAggregationFlag]
}

// this is a universal aggregation function which can be either used on client side or on server
// On the client it has arguments like clientAggregation('collectionName', aggregationFn)
export function aggregation<TCollection extends string> (
  collection: TCollection,
  fn: (...args: any[]) => any
): AggregationFunction<TCollection>
export function aggregation (fn: (...args: any[]) => any): AggregationFunction
export function aggregation (collectionOrFn, aggregationFn) {
  if (typeof collectionOrFn === 'string') return clientAggregation(collectionOrFn, aggregationFn)
  if (typeof collectionOrFn !== 'function') throw Error('aggregation: argument must be a function')
  collectionOrFn[isAggregationFlag] = true
  return collectionOrFn
}

export function clientAggregation (collection, aggregationFn) {
  if (typeof collection !== 'string') throw Error('clientAggregation: collection must be a string')
  if (typeof aggregationFn !== 'function') throw Error('clientAggregation: aggregationFn must be a function')
  aggregationFn[isAggregationFlag] = true
  aggregationFn[isClientAggregationFlag] = true
  aggregationFn.collection = collection
  return aggregationFn
}

// during compilation, calls to aggregation() are replaced with:
// aggregationHeader({ collection: 'collectionName', name: 'aggregationName' })
export function aggregationHeader<TCollection extends string> (
  aggregationMeta: { collection: TCollection, name: string }
): AggregationMeta<TCollection>
export function aggregationHeader (aggregationMeta) {
  if (!validateAggregationMeta(aggregationMeta)) {
    throw Error(ERRORS.wrongAggregationMeta(aggregationMeta))
  }
  aggregationMeta[isAggregationFlag] = true
  return aggregationMeta
}

function validateAggregationMeta (aggregationMeta) {
  if (
    typeof aggregationMeta === 'object' &&
    typeof aggregationMeta.collection === 'string' &&
    typeof aggregationMeta.name === 'string'
  ) return true
  return false
}

const ERRORS = {
  wrongAggregationMeta: (aggregationMeta) => `
    aggregationHeader: invalid aggregationMeta
      Expected: { collection: 'collectionName', name: 'aggregationName' }
      Received: ${JSON.stringify(aggregationMeta)}
  `
}
