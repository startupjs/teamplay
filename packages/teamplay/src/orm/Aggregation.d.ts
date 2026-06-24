import type Signal from './Signal.ts'
import type {
  QuerySubscriptions,
  QuerySignalOptions
} from './Query.js'
import type { PathSegment } from './types/path.ts'

export const IS_AGGREGATION: unique symbol
export const AGGREGATIONS: '$aggregations'
export const aggregationSubscriptions: QuerySubscriptions
export function getAggregationSignal (collectionName: string, params: unknown, options?: QuerySignalOptions): Signal
export function isAggregationSignal ($signal: unknown): boolean | undefined
export function getAggregationRowId (row: unknown, collectionName?: string): string | undefined
export function getAggregationDocId (
  segments: readonly PathSegment[],
  rootId?: string,
  method?: (path: PathSegment[]) => unknown
): string | undefined
export function getAggregationCollectionName (segments: readonly PathSegment[]): string | undefined
