// @ts-nocheck
export const isAggregationFlag = '__isAggregation'
export const isClientAggregationFlag = '__isClientAggregation'

export interface AggregationMeta<TCollection extends string = string> {
  /** Marker used by TeamPlay to identify aggregation headers. */
  readonly __isAggregation: true
  /** Collection this aggregation runs against. */
  readonly collection: TCollection
  /** Aggregation name registered by the StartupJS model loader. */
  readonly name: string
}

export interface AggregationFunction<TCollection extends string = string> {
  (...args: any[]): any
  /** Marker used by TeamPlay to identify aggregation functions. */
  readonly __isAggregation: true
  /** Collection this aggregation runs against when known on the client. */
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

/**
 * Create a client aggregation for a specific collection.
 * @param collection Collection name this aggregation runs against.
 * @param fn Function returning a Mongo aggregation pipeline or aggregation query object.
 */
export function aggregation<TCollection extends string> (
  collection: TCollection,
  fn: (...args: any[]) => any
): AggregationFunction<TCollection>
/**
 * Mark a model-file aggregation function for StartupJS server aggregation loading.
 * @param fn Function returning a Mongo aggregation pipeline or aggregation query object.
 */
export function aggregation<TCollection extends string> (fn: (...args: any[]) => any): AggregationFunction<TCollection>
/**
 * Mark a model-file aggregation function for StartupJS server aggregation loading.
 * @param fn Function returning a Mongo aggregation pipeline or aggregation query object.
 */
export function aggregation (fn: (...args: any[]) => any): AggregationFunction
export function aggregation (collectionOrFn, aggregationFn) {
  if (typeof collectionOrFn === 'string') return clientAggregation(collectionOrFn, aggregationFn)
  if (typeof collectionOrFn !== 'function') throw Error('aggregation: argument must be a function')
  collectionOrFn[isAggregationFlag] = true
  return collectionOrFn
}

/**
 * Create a client aggregation for a specific collection.
 * @param collection Collection name this aggregation runs against.
 * @param aggregationFn Function returning a Mongo aggregation pipeline or aggregation query object.
 */
export function clientAggregation (collection, aggregationFn) {
  if (typeof collection !== 'string') throw Error('clientAggregation: collection must be a string')
  if (typeof aggregationFn !== 'function') throw Error('clientAggregation: aggregationFn must be a function')
  aggregationFn[isAggregationFlag] = true
  aggregationFn[isClientAggregationFlag] = true
  aggregationFn.collection = collection
  return aggregationFn
}

/**
 * Create an aggregation header. StartupJS usually generates this during compilation.
 * @param aggregationMeta Collection and model-file aggregation name.
 */
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
