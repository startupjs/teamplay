import type { PathSegment } from '../types/path.ts'

export function isDocReady (segments: readonly PathSegment[]): boolean

export function isQueryReady (
  collection: string,
  idsSegments: readonly PathSegment[],
  docsSegments: readonly PathSegment[],
  extraSegments: readonly PathSegment[],
  aggregationSegments: readonly PathSegment[],
  isAggregate: boolean,
  hasExtraResult: boolean
): boolean
