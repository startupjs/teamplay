import type { PathSegment } from './types/path.ts'

export type MutationTargetSegments = PathSegment[]

export function ensureArrayTargetSegments (
  segments: MutationTargetSegments,
  isQuerySignal: boolean
): MutationTargetSegments {
  if (segments.length < 2) throw Error('Can\'t mutate array on a collection or root signal')
  if (isQuerySignal) throw Error('Array mutators can\'t be used on a query signal')
  return segments
}

export function ensureValueTargetSegments (
  segments: MutationTargetSegments,
  isQuerySignal: boolean
): MutationTargetSegments {
  if (segments.length < 2) throw Error('Can\'t mutate on a collection or root signal')
  if (isQuerySignal) throw Error('Mutators can\'t be used on a query signal')
  return segments
}
