import { GLOBAL_ROOT_ID } from './Root.js'

export const ROOTS_BUCKET = '__roots'
const REGEX_PRIVATE_COLLECTION = /^[_$]/
const UNSCOPED_PRIVATE_COLLECTIONS = new Set(['$queries', '$aggregations'])

export function normalizeRootId (rootId) {
  return rootId ?? GLOBAL_ROOT_ID
}

export function isGlobalRootId (rootId) {
  return normalizeRootId(rootId) === GLOBAL_ROOT_ID
}

export function isPrivateCollectionSegments (segments) {
  return Array.isArray(segments) &&
    segments.length > 0 &&
    REGEX_PRIVATE_COLLECTION.test(String(segments[0])) &&
    !UNSCOPED_PRIVATE_COLLECTIONS.has(String(segments[0]))
}

export function scopeStorageSegments (rootId, logicalSegments) {
  if (!rootId || isGlobalRootId(rootId) || !isPrivateCollectionSegments(logicalSegments)) {
    return logicalSegments
  }
  return [ROOTS_BUCKET, normalizeRootId(rootId), ...logicalSegments]
}

export function getPrivateDataSegments (logicalSegments) {
  if (!isPrivateCollectionSegments(logicalSegments)) return logicalSegments
  return [...logicalSegments]
}

export function descopeStorageSegments (physicalSegments) {
  if (!Array.isArray(physicalSegments)) return physicalSegments
  return physicalSegments[0] === ROOTS_BUCKET ? physicalSegments.slice(2) : physicalSegments
}

export function getLogicalRootSnapshot (rootId, tree) {
  const snapshot = {}
  for (const key of Object.keys(tree)) {
    if (key === ROOTS_BUCKET) continue
    snapshot[key] = tree[key]
  }
  if (!rootId || isGlobalRootId(rootId)) return snapshot
  const privateRoot = getPath([ROOTS_BUCKET, normalizeRootId(rootId)], tree)
  if (!privateRoot || typeof privateRoot !== 'object') return snapshot
  for (const key of Object.keys(privateRoot)) {
    snapshot[key] = privateRoot[key]
  }
  return snapshot
}

export function getSignalIdentityHash (rootId, segments) {
  const normalizedRootId = normalizeRootId(rootId)
  if (segments.length === 0) return JSON.stringify({ root: normalizedRootId })
  if (isPrivateCollectionSegments(segments)) {
    return JSON.stringify({ private: [normalizedRootId, segments] })
  }
  return JSON.stringify({ public: [normalizedRootId, segments] })
}

export function getScopedSignalHash (scopeKey, transportHash, kind = 'querySignal') {
  if (scopeKey == null) return transportHash
  return JSON.stringify({ [kind]: [scopeKey, transportHash] })
}

export function getRootScopedRegistryKey (rootId, key) {
  return JSON.stringify([normalizeRootId(rootId), key])
}

function getPath (segments, tree) {
  let dataNode = tree
  for (const segment of segments) {
    if (dataNode == null) return dataNode
    dataNode = dataNode[segment]
  }
  return dataNode
}
