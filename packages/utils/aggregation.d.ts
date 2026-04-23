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

export function aggregation<TCollection extends string> (
  collection: TCollection,
  fn: (...args: any[]) => any
): AggregationFunction<TCollection>
export function aggregation (fn: (...args: any[]) => any): AggregationFunction
export function aggregationHeader<TCollection extends string> (
  aggregationMeta: { collection: TCollection, name: string }
): AggregationMeta<TCollection>
export function isAggregationHeader (value: unknown): boolean
export function isAggregationFunction (value: unknown): boolean
export function isClientAggregationFunction (value: unknown): boolean
