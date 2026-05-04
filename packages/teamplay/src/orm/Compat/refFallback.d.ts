import type { PathSegment } from '../types/path.ts'
import type { SignalBaseInstance } from '../Signal.ts'

export const REF_TARGET: unique symbol
export function resolveRefSignalSafe<TSignal extends SignalBaseInstance> (
  $signal: TSignal | undefined,
  maxDepth?: number
): TSignal | undefined
export function resolveRefSegmentsSafe (
  segments: readonly PathSegment[],
  rootId?: string,
  maxDepth?: number
): PathSegment[] | undefined
