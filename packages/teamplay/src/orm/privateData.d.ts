import type { PathSegment } from './types/path.ts'

export function getPrivateData (
  rootId: string | undefined,
  logicalSegments: readonly PathSegment[],
  raw?: boolean
): unknown
