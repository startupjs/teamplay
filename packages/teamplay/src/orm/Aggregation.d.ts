import type Signal from './Signal.ts'
import type {
  QuerySubscriptions,
  QuerySignalOptions
} from './Query.js'

export const IS_AGGREGATION: unique symbol
export const AGGREGATIONS: '$aggregations'
export const aggregationSubscriptions: QuerySubscriptions
export function getAggregationSignal (collectionName: string, params: unknown, options?: QuerySignalOptions): Signal
export function isAggregationSignal ($signal: unknown): boolean | undefined
export function getAggregationDocId (
  segments: readonly unknown[],
  rootId?: string,
  method?: (path: unknown[]) => unknown
): string | undefined
export function getAggregationCollectionName (segments: readonly unknown[]): string | undefined
