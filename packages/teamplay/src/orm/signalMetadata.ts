import { AGGREGATIONS, getAggregationCollectionName, getAggregationDocId } from './Aggregation.js'
import { SEGMENTS } from './signalSymbols.ts'
import type { PathSegment } from './types/path.ts'

export interface SignalMetadataOwner {
  readonly [SEGMENTS]: PathSegment[]
  readonly constructor: SignalMetadataConstructor
}

export interface SignalMetadataConstructor {
  readonly collection?: unknown
  readonly associations?: readonly unknown[]
}

export function getSignalPath ($signal: Pick<SignalMetadataOwner, typeof SEGMENTS>): string {
  return $signal[SEGMENTS].join('.')
}

export function getSignalLeaf ($signal: Pick<SignalMetadataOwner, typeof SEGMENTS>): string {
  const segments = $signal[SEGMENTS]
  if (segments.length === 0) return ''
  return String(segments[segments.length - 1])
}

export function getSignalParentSegments (
  $signal: Pick<SignalMetadataOwner, typeof SEGMENTS>,
  levels: unknown,
  argumentCount: number
): PathSegment[] {
  const normalizedLevels = normalizeParentLevels(levels, argumentCount)
  const segments = $signal[SEGMENTS]
  const targetLength = Math.max(0, segments.length - normalizedLevels)
  return segments.slice(0, targetLength)
}

export function normalizeParentLevels (levels: unknown, argumentCount: number): number {
  if (argumentCount > 1) throw Error('Signal.parent() expects a single argument')
  if (argumentCount === 0) return 1
  if (typeof levels !== 'number' || !Number.isFinite(levels) || !Number.isInteger(levels)) {
    throw Error('Signal.parent() expects an integer argument')
  }
  if (levels < 1) throw Error('Signal.parent() expects a positive integer')
  return levels
}

export function getSignalId (
  $signal: Pick<SignalMetadataOwner, typeof SEGMENTS>,
  rootId?: string
): string | number | undefined {
  const segments = $signal[SEGMENTS]
  if (segments.length === 0) throw Error('Can\'t get the id of the root signal')
  if (segments.length === 1) throw Error('Can\'t get the id of a collection')
  if (segments[0] === AGGREGATIONS && segments.length === 3) {
    return getAggregationDocId(segments, rootId)
  }
  return segments[segments.length - 1]
}

export function getSignalCollection ($signal: SignalMetadataOwner): PathSegment | undefined {
  const segments = $signal[SEGMENTS]
  if (segments.length === 0) throw Error('Can\'t get the collection of the root signal')
  if (segments[0] === AGGREGATIONS) {
    return getAggregationCollectionName(segments)
  }
  const collectionFromModel = $signal.constructor?.collection
  if (typeof collectionFromModel === 'string' && collectionFromModel) {
    return collectionFromModel
  }
  return segments[0]
}

export function getSignalAssociations ($rawSignal: Pick<SignalMetadataOwner, 'constructor'>): readonly unknown[] {
  return $rawSignal.constructor.associations || []
}
