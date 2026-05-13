export const isAggregationFlag = '__isAggregation' as const
export const isClientAggregationFlag = '__isClientAggregation' as const

/** Parameters passed by `sub(_aggregation, params)` or `useSub(_aggregation, params)`. */
export type AggregationParams = Record<string, any>

/** Query object returned by an aggregation callback. */
export type AggregationQuery = Record<string, any> | readonly Record<string, any>[]

/** Default TeamPlay session shape available in aggregation callbacks. */
export interface DefaultAggregationSession {
  userId?: string
}

/** Context passed as the second argument to an aggregation callback. */
export interface AggregationContext<
  TCollection extends string = string,
  TSession = DefaultAggregationSession
> {
  /** Collection this aggregation runs against. */
  collection: TCollection
  /** Connect session object attached to the request. */
  session: TSession
  /** Whether the aggregation is being evaluated from server-side code. */
  isServer?: boolean
}

/**
 * Function passed to `aggregation()`.
 *
 * @param params Parameters from `sub(_aggregation, params)` or `useSub(_aggregation, params)`.
 * @param context Runtime context with `{ collection, session, isServer }`.
 * @returns A Mongo aggregation pipeline array, or an aggregation query object such as `{ $aggregate: [...] }`.
 */
export type AggregationCallback<
  TCollection extends string = string,
  TSession = DefaultAggregationSession
> = (params: any, context: AggregationContext<TCollection, TSession>) => any

type AggregationCollection<TCollectionOrSession, TFallback extends string = string> =
  TCollectionOrSession extends string ? TCollectionOrSession : TFallback

type AggregationSession<TCollectionOrSession, TSession> =
  TCollectionOrSession extends string ? TSession : TCollectionOrSession

export interface AggregationMeta<
  TCollection extends string = string,
  TOutput = unknown,
  TSession = DefaultAggregationSession
> {
  /** Marker used by TeamPlay to identify aggregation headers. */
  readonly [isAggregationFlag]: true
  /** Collection this aggregation runs against. */
  readonly collection: TCollection
  /** Aggregation name registered by the StartupJS model loader. */
  readonly name: string
  /** Type-only metadata for the value returned by aggregation subscriptions. */
  readonly __teamplayAggregationOutput?: TOutput
  /** Type-only metadata for the session shape passed to the aggregation callback. */
  readonly __teamplayAggregationSession?: TSession
}

export interface AggregationFunction<
  TOutput = unknown,
  TCollection extends string = string,
  TSession = DefaultAggregationSession
> {
  /**
   * Execute the server aggregation pipeline builder.
   * @param params Subscription params passed to the aggregation.
   * @param context Runtime context with `{ collection, session, isServer }`.
   */
  (...args: any[]): any
  /** Marker used by TeamPlay to identify aggregation functions. */
  readonly [isAggregationFlag]: true
  /** Collection this aggregation runs against when known on the client. */
  readonly collection?: TCollection
  /** Type-only metadata for the value returned by aggregation subscriptions. */
  readonly __teamplayAggregationOutput?: TOutput
  /** Type-only metadata for the session shape passed to the aggregation callback. */
  readonly __teamplayAggregationSession?: TSession
}

export interface ClientAggregationFunction<
  TOutput = unknown,
  TCollection extends string = string,
  TSession = DefaultAggregationSession
> extends AggregationFunction<TOutput, TCollection, TSession> {
  /** Marker used by TeamPlay to identify client aggregations with a known collection. */
  readonly [isClientAggregationFlag]: true
  /** Collection this aggregation runs against. */
  readonly collection: TCollection
}

type MutableAggregationFunction<
  TOutput = unknown,
  TCollection extends string = string,
  TSession = DefaultAggregationSession
> =
  ((...args: any[]) => any) & {
    [isAggregationFlag]?: true
    [isClientAggregationFlag]?: true
    collection?: TCollection
    __teamplayAggregationOutput?: TOutput
    __teamplayAggregationSession?: TSession
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
 *
 * Use `aggregation<User[]>('users', fn)` for row-like results and
 * `aggregation<{ total: number }>('users', fn)` for custom result objects.
 *
 * @typeParam TOutput Full value returned by aggregation subscriptions.
 * @typeParam TCollectionOrSession Collection name when it is a string, otherwise session shape.
 * @typeParam TSession Session shape when the second generic is used for collection name.
 * @param collection Collection name this aggregation runs against.
 * @param fn Aggregation callback. It receives `(params, context)`, where `params`
 * are the subscription params and `context` has `{ collection, session, isServer }`.
 * Return a Mongo aggregation pipeline array, or an aggregation query object such
 * as `{ $aggregate: [...] }`.
 */
export function aggregation<
  TOutput = unknown,
  TCollectionOrSession = string,
  TSession = DefaultAggregationSession,
  TCollection extends string = AggregationCollection<TCollectionOrSession>
> (
  collection: TCollection,
  fn: AggregationCallback<TCollection, AggregationSession<TCollectionOrSession, TSession>>
): ClientAggregationFunction<TOutput, TCollection, AggregationSession<TCollectionOrSession, TSession>>
/**
 * Mark a model-file aggregation function for server aggregation loading.
 *
 * Use `aggregation<User[]>(fn)` for row-like results and
 * `aggregation<{ total: number }>(fn)` for custom result objects.
 * Use `aggregation<User[], Session>(fn)` to type `context.session`, or
 * `aggregation<User[], 'users', Session>(fn)` when the collection type is
 * part of the call site.
 * The TeamPlay Babel plugin replaces this call with an aggregation header in
 * client bundles, including when the call uses a TypeScript generic.
 *
 * @typeParam TOutput Full value returned by aggregation subscriptions.
 * @typeParam TCollectionOrSession Collection name when it is a string, otherwise session shape.
 * @typeParam TSession Session shape when the second generic is used for collection name.
 * @param fn Aggregation callback. It receives `(params, context)`, where `params`
 * are the subscription params and `context` has `{ collection, session, isServer }`.
 * Return a Mongo aggregation pipeline array, or an aggregation query object such
 * as `{ $aggregate: [...] }`.
 */
export function aggregation<
  TOutput = unknown,
  TCollectionOrSession = string,
  TSession = DefaultAggregationSession
> (
  fn: AggregationCallback<
    AggregationCollection<TCollectionOrSession>,
    AggregationSession<TCollectionOrSession, TSession>
  >
): AggregationFunction<
  TOutput,
  AggregationCollection<TCollectionOrSession>,
  AggregationSession<TCollectionOrSession, TSession>
>
/**
 * Mark a model-file aggregation function for server aggregation loading.
 * @param fn Aggregation callback. It receives `(params, context)`, where `params`
 * are the subscription params and `context` has `{ collection, session, isServer }`.
 */
export function aggregation (fn: AggregationCallback): AggregationFunction
export function aggregation<
  TOutput = unknown,
  TCollectionOrSession = string,
  TSession = DefaultAggregationSession,
  TCollection extends string = AggregationCollection<TCollectionOrSession>
> (
  collectionOrFn: TCollection | AggregationCallback<TCollection, AggregationSession<TCollectionOrSession, TSession>>,
  aggregationFn?: AggregationCallback<TCollection, AggregationSession<TCollectionOrSession, TSession>>
): AggregationFunction<TOutput, TCollection, AggregationSession<TCollectionOrSession, TSession>> | ClientAggregationFunction<TOutput, TCollection, AggregationSession<TCollectionOrSession, TSession>> {
  if (typeof collectionOrFn === 'string') return clientAggregation(collectionOrFn, aggregationFn)
  if (typeof collectionOrFn !== 'function') throw Error('aggregation: argument must be a function')
  const fn = collectionOrFn as MutableAggregationFunction<TOutput, TCollection, AggregationSession<TCollectionOrSession, TSession>>
  fn[isAggregationFlag] = true
  return fn as AggregationFunction<TOutput, TCollection, AggregationSession<TCollectionOrSession, TSession>>
}

/**
 * Create a client aggregation for a specific collection.
 *
 * Prefer `aggregation(collection, fn)` in application code; this lower-level
 * helper is exposed for internal integrations that need the explicit client marker.
 *
 * @typeParam TOutput Full value returned by aggregation subscriptions.
 * @typeParam TCollectionOrSession Collection name when it is a string, otherwise session shape.
 * @typeParam TSession Session shape when the second generic is used for collection name.
 * @param collection Collection name this aggregation runs against.
 * @param aggregationFn Aggregation callback. It receives `(params, context)`,
 * where `params` are the subscription params and `context` has
 * `{ collection, session, isServer }`. Return a Mongo aggregation pipeline array,
 * or an aggregation query object such as `{ $aggregate: [...] }`.
 */
export function clientAggregation<
  TOutput = unknown,
  TCollectionOrSession = string,
  TSession = DefaultAggregationSession,
  TCollection extends string = AggregationCollection<TCollectionOrSession>
> (
  collection: TCollection,
  aggregationFn?: AggregationCallback<TCollection, AggregationSession<TCollectionOrSession, TSession>>
): ClientAggregationFunction<TOutput, TCollection, AggregationSession<TCollectionOrSession, TSession>> {
  if (typeof collection !== 'string') throw Error('clientAggregation: collection must be a string')
  if (typeof aggregationFn !== 'function') throw Error('clientAggregation: aggregationFn must be a function')
  const fn = aggregationFn as MutableAggregationFunction<TOutput, TCollection, AggregationSession<TCollectionOrSession, TSession>>
  fn[isAggregationFlag] = true
  fn[isClientAggregationFlag] = true
  fn.collection = collection
  return fn as ClientAggregationFunction<TOutput, TCollection, AggregationSession<TCollectionOrSession, TSession>>
}

/**
 * Create an aggregation header for client bundles.
 *
 * TeamPlay's Babel plugin usually generates this while eliminating server-only
 * model code. Runtime code can subscribe to the header without bundling the
 * server aggregation implementation.
 *
 * @typeParam TOutput Full value returned by aggregation subscriptions.
 * @typeParam TCollectionOrSession Collection name when it is a string, otherwise session shape.
 * @typeParam TSession Session shape when the second generic is used for collection name.
 * @param aggregationMeta Collection and model-file aggregation name.
 */
export function aggregationHeader<
  TOutput = unknown,
  TCollectionOrSession = string,
  TSession = DefaultAggregationSession
> (
  aggregationMeta: { collection: AggregationCollection<TCollectionOrSession>, name: string }
): AggregationMeta<
  AggregationCollection<TCollectionOrSession>,
  TOutput,
  AggregationSession<TCollectionOrSession, TSession>
>
export function aggregationHeader<
  TOutput = unknown,
  TCollectionOrSession = string,
  TSession = DefaultAggregationSession
> (
  aggregationMeta: { collection: AggregationCollection<TCollectionOrSession>, name: string }
): AggregationMeta<
  AggregationCollection<TCollectionOrSession>,
  TOutput,
  AggregationSession<TCollectionOrSession, TSession>
> {
  if (!validateAggregationMeta(aggregationMeta)) {
    throw Error(ERRORS.wrongAggregationMeta(aggregationMeta))
  }
  const meta = aggregationMeta as AggregationMeta<
    AggregationCollection<TCollectionOrSession>,
    TOutput,
    AggregationSession<TCollectionOrSession, TSession>
  >
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
