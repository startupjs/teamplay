export const isAggregationFlag = '__isAggregation' as const
export const isClientAggregationFlag = '__isClientAggregation' as const

export interface AggregationMeta<TCollection extends string = string> {
  /** Marker used by TeamPlay to identify aggregation headers. */
  readonly [isAggregationFlag]: true
  /** Collection this aggregation runs against. */
  readonly collection: TCollection
  /** Aggregation name registered by the StartupJS model loader. */
  readonly name: string
}

export interface AggregationFunction<TCollection extends string = string> {
  (...args: any[]): any
  /** Marker used by TeamPlay to identify aggregation functions. */
  readonly [isAggregationFlag]: true
  /** Collection this aggregation runs against when known on the client. */
  readonly collection?: TCollection
}

export interface ClientAggregationFunction<TCollection extends string = string> extends AggregationFunction<TCollection> {
  /** Marker used by TeamPlay to identify client aggregations with a known collection. */
  readonly [isClientAggregationFlag]: true
  /** Collection this aggregation runs against. */
  readonly collection: TCollection
}

type MutableAggregationFunction<TCollection extends string = string> =
  ((...args: any[]) => any) & {
    [isAggregationFlag]?: true
    [isClientAggregationFlag]?: true
    collection?: TCollection
  }

export function isAggregation (something: unknown): something is AggregationFunction | AggregationMeta {
  return isAggregationFunction(something) || isAggregationHeader(something)
}

export function isAggregationFunction (fn: unknown): fn is AggregationFunction {
  return typeof fn === 'function' && Boolean((fn as Partial<AggregationFunction>)[isAggregationFlag])
}

export function isClientAggregationFunction (fn: unknown): fn is ClientAggregationFunction {
  return isAggregationFunction(fn) && Boolean((fn as Partial<ClientAggregationFunction>)[isClientAggregationFlag])
}

export function isAggregationHeader (aggregationMeta: unknown): aggregationMeta is AggregationMeta {
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
): ClientAggregationFunction<TCollection>
/**
 * Mark a model-file aggregation function for StartupJS server aggregation loading.
 * @param fn Function returning a Mongo aggregation pipeline or aggregation query object.
 */
export function aggregation<TCollection extends string = string> (fn: (...args: any[]) => any): AggregationFunction<TCollection>
/**
 * Mark a model-file aggregation function for StartupJS server aggregation loading.
 * @param fn Function returning a Mongo aggregation pipeline or aggregation query object.
 */
export function aggregation (fn: (...args: any[]) => any): AggregationFunction
export function aggregation<TCollection extends string> (
  collectionOrFn: TCollection | ((...args: any[]) => any),
  aggregationFn?: (...args: any[]) => any
): AggregationFunction | ClientAggregationFunction<TCollection> {
  if (typeof collectionOrFn === 'string') return clientAggregation(collectionOrFn, aggregationFn)
  if (typeof collectionOrFn !== 'function') throw Error('aggregation: argument must be a function')
  const fn = collectionOrFn as MutableAggregationFunction
  fn[isAggregationFlag] = true
  return fn as AggregationFunction
}

/**
 * Create a client aggregation for a specific collection.
 * @param collection Collection name this aggregation runs against.
 * @param aggregationFn Function returning a Mongo aggregation pipeline or aggregation query object.
 */
export function clientAggregation<TCollection extends string> (
  collection: TCollection,
  aggregationFn?: (...args: any[]) => any
): ClientAggregationFunction<TCollection> {
  if (typeof collection !== 'string') throw Error('clientAggregation: collection must be a string')
  if (typeof aggregationFn !== 'function') throw Error('clientAggregation: aggregationFn must be a function')
  const fn = aggregationFn as MutableAggregationFunction<TCollection>
  fn[isAggregationFlag] = true
  fn[isClientAggregationFlag] = true
  fn.collection = collection
  return fn as ClientAggregationFunction<TCollection>
}

/**
 * Create an aggregation header. StartupJS usually generates this during compilation.
 * @param aggregationMeta Collection and model-file aggregation name.
 */
export function aggregationHeader<TCollection extends string> (
  aggregationMeta: { collection: TCollection, name: string }
): AggregationMeta<TCollection>
export function aggregationHeader<TCollection extends string> (
  aggregationMeta: { collection: TCollection, name: string }
): AggregationMeta<TCollection> {
  if (!validateAggregationMeta(aggregationMeta)) {
    throw Error(ERRORS.wrongAggregationMeta(aggregationMeta))
  }
  const meta = aggregationMeta as AggregationMeta<TCollection>
  ;(meta as { [isAggregationFlag]?: true })[isAggregationFlag] = true
  return meta
}

function validateAggregationMeta (aggregationMeta: unknown): aggregationMeta is AggregationMeta {
  if (
    aggregationMeta &&
    typeof aggregationMeta === 'object' &&
    typeof (aggregationMeta as Partial<AggregationMeta>).collection === 'string' &&
    typeof (aggregationMeta as Partial<AggregationMeta>).name === 'string'
  ) return true
  return false
}

const ERRORS = {
  wrongAggregationMeta: (aggregationMeta: unknown) => `
    aggregationHeader: invalid aggregationMeta
      Expected: { collection: 'collectionName', name: 'aggregationName' }
      Received: ${JSON.stringify(aggregationMeta)}
  `
}
