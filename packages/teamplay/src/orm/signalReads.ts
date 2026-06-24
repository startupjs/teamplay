import { AGGREGATIONS, IS_AGGREGATION, getAggregationCollectionName, getAggregationRowId } from './Aggregation.js'
import { HASH, IS_QUERY, QUERIES } from './Query.js'
import { SEGMENTS } from './signalSymbols.ts'
import type { PathSegment } from './types/path.ts'

export type SignalReadMethod<TValue = unknown> = (segments: PathSegment[]) => TValue

export interface SignalReadOwner {
  readonly [SEGMENTS]: PathSegment[]
  readonly [HASH]?: string
  readonly [IS_QUERY]?: unknown
  readonly [IS_AGGREGATION]?: unknown
}

export interface SignalReadContext<TSignal extends SignalReadOwner> {
  getOwningRootId: ($signal: TSignal) => string | undefined
  getStorageSegments: ($signal: TSignal) => PathSegment[]
  isPrivateSegments: (segments: readonly PathSegment[]) => boolean
  readLogicalRootSnapshot: (rootId: string | undefined, raw: boolean) => unknown
  readPrivateData: (
    rootId: string | undefined,
    segments: readonly PathSegment[],
    raw: boolean
  ) => unknown
  readPublicData: <TValue>(
    segments: PathSegment[],
    method: SignalReadMethod<TValue>
  ) => TValue
  warn: (message: string, ...args: unknown[]) => void
  error: (message: string) => void
}

export function readSignalValue<TSignal extends SignalReadOwner, TValue> (
  $signal: TSignal,
  context: SignalReadContext<TSignal>,
  method: SignalReadMethod<TValue>,
  rawMethod: SignalReadMethod
): TValue {
  const raw = method === rawMethod
  const segments = $signal[SEGMENTS]
  const rootId = context.getOwningRootId($signal)

  if (segments.length === 0) {
    return context.readLogicalRootSnapshot(rootId, raw) as TValue
  }
  if ($signal[IS_QUERY]) {
    return context.readPrivateData(rootId, [QUERIES, getQueryHashSegment($signal), 'docs'], raw) as TValue
  }
  if (context.isPrivateSegments(segments)) {
    return context.readPrivateData(rootId, segments, raw) as TValue
  }
  return context.readPublicData(context.getStorageSegments($signal), method)
}

export function getSignalValue<TSignal extends SignalReadOwner, TValue> (
  $signal: TSignal,
  context: SignalReadContext<TSignal>,
  method: SignalReadMethod<TValue>,
  rawMethod: SignalReadMethod
): TValue {
  if (isQueryIdsValueSignal($signal)) {
    const ids = readSignalValue($signal, context, method, rawMethod)
    if (!Array.isArray(ids)) {
      context.warn('Signal.get() on Query didn\'t find ids', $signal[SEGMENTS])
      return [] as TValue
    }
    return ids.filter(isString) as TValue
  }
  return readSignalValue($signal, context, method, rawMethod)
}

export function getSignalIds<TSignal extends SignalReadOwner> (
  $signal: TSignal,
  context: SignalReadContext<TSignal>
): string[] {
  const rootId = context.getOwningRootId($signal)
  if ($signal[IS_QUERY]) {
    const ids = context.readPrivateData(rootId, [QUERIES, getQueryHashSegment($signal), 'ids'], false)
    if (!Array.isArray(ids)) {
      context.warn('Signal.getIds() on Query didn\'t find ids', [QUERIES, getQueryHashSegment($signal), 'ids'])
      return []
    }
    return ids.filter(isString)
  }
  if ($signal[IS_AGGREGATION]) {
    const docs = context.readPrivateData(rootId, $signal[SEGMENTS], false)
    if (!Array.isArray(docs)) return []
    const collectionName = getAggregationCollectionName($signal[SEGMENTS])
    return docs.map(doc => getAggregationRowId(doc, collectionName)).filter(isString)
  }

  context.error(
    'Signal.getIds() can only be used on query signals or aggregation signals. ' +
    'Received a regular signal: ' + JSON.stringify($signal[SEGMENTS])
  )
  return []
}

export function isQueryIdsValueSignal<TSignal extends SignalReadOwner> (
  $signal: TSignal
): boolean {
  const segments = $signal[SEGMENTS]
  return segments.length === 3 && segments[0] === QUERIES && segments[2] === 'ids'
}

export function isAggregationValueSignal<TSignal extends SignalReadOwner> (
  $signal: TSignal
): boolean {
  const segments = $signal[SEGMENTS]
  return segments.length >= 2 && segments[0] === AGGREGATIONS
}

function isString (value: unknown): value is string {
  return typeof value === 'string'
}

function getQueryHashSegment<TSignal extends SignalReadOwner> ($signal: TSignal): PathSegment {
  return $signal[HASH] as PathSegment
}
