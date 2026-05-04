import { GLOBAL_ROOT_ID } from './Root.ts'
import type { PathSegment } from './types/path.ts'

const REGEX_PRIVATE_COLLECTION = /^[_$]/

type RootId = string | null | undefined
type DataTree = Record<string, unknown>

export function normalizeRootId (rootId: RootId): string {
  return rootId ?? GLOBAL_ROOT_ID
}

export function isGlobalRootId (rootId: RootId): boolean {
  return normalizeRootId(rootId) === GLOBAL_ROOT_ID
}

export function isPrivateCollectionSegments (segments: unknown): segments is readonly [PathSegment, ...PathSegment[]] {
  return Array.isArray(segments) &&
    segments.length > 0 &&
    REGEX_PRIVATE_COLLECTION.test(String(segments[0]))
}

export function getPrivateDataSegments (logicalSegments: readonly PathSegment[]): readonly PathSegment[] {
  if (!isPrivateCollectionSegments(logicalSegments)) return logicalSegments
  return [...logicalSegments]
}

export function getLogicalRootSnapshot (
  _rootId: RootId,
  tree: DataTree,
  privateDataRoot: unknown
): DataTree {
  const snapshot: DataTree = {}
  for (const key of Object.keys(tree)) {
    snapshot[key] = tree[key]
  }
  if (!privateDataRoot || typeof privateDataRoot !== 'object') return snapshot
  const privateData = privateDataRoot as DataTree
  for (const key of Object.keys(privateData)) {
    snapshot[key] = privateData[key]
  }
  return snapshot
}

export function getSignalIdentityHash (
  rootId: RootId,
  segments: readonly PathSegment[]
): string {
  const normalizedRootId = normalizeRootId(rootId)
  if (segments.length === 0) return JSON.stringify({ root: normalizedRootId })
  if (isPrivateCollectionSegments(segments)) {
    return JSON.stringify({ private: [normalizedRootId, segments] })
  }
  return JSON.stringify({ public: [normalizedRootId, segments] })
}

export function getScopedSignalHash (
  rootId: RootId,
  transportHash: unknown,
  kind = 'querySignal'
): string {
  return JSON.stringify({ [kind]: [normalizeRootId(rootId), transportHash] })
}

export function getRootScopedRegistryKey (rootId: RootId, key: unknown): string {
  return JSON.stringify([normalizeRootId(rootId), key])
}
