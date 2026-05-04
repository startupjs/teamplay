import { IS_QUERY } from './Query.js'
import { ROOT_ID, getRoot } from './Root.ts'
import { isPrivateCollectionSegments } from './rootScope.ts'
import {
  ensureArrayTargetSegments,
  ensureValueTargetSegments
} from './signalMutationGuards.ts'
import { SEGMENTS } from './signalSymbols.ts'
import type { PathSegment } from './types/path.ts'

export interface SignalSegmentsOwner {
  readonly [SEGMENTS]: PathSegment[]
}

export interface SignalQueryState {
  readonly [IS_QUERY]?: unknown
}

export type SignalRuntimeState = SignalSegmentsOwner & SignalQueryState

interface RootIdOwner {
  readonly [ROOT_ID]?: string
}

export function getSignalSegments ($signal: SignalSegmentsOwner): PathSegment[] {
  return $signal[SEGMENTS]
}

export function getSignalStorageSegments (
  $signal: SignalSegmentsOwner,
  segments: PathSegment[] = getSignalSegments($signal)
): PathSegment[] {
  return segments
}

export function getSignalOwningRootId ($signal: SignalSegmentsOwner): string | undefined {
  const $root = getRoot($signal as never) as RootIdOwner | undefined
  return ($root || ($signal as RootIdOwner))?.[ROOT_ID]
}

export function isPrivateSignalSegments (
  segments: unknown
): segments is readonly [PathSegment, ...PathSegment[]] {
  return isPrivateCollectionSegments(segments)
}

export function ensureArraySignalTarget ($signal: SignalRuntimeState): PathSegment[] {
  return ensureArrayTargetSegments(getSignalSegments($signal), !!$signal[IS_QUERY])
}

export function ensureValueSignalTarget ($signal: SignalRuntimeState): PathSegment[] {
  return ensureValueTargetSegments(getSignalSegments($signal), !!$signal[IS_QUERY])
}
