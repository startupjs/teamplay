import { GLOBAL_ROOT_ID } from './Root.js'

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

export function getPrivateDataSegments (logicalSegments) {
  if (!isPrivateCollectionSegments(logicalSegments)) return logicalSegments
  return [...logicalSegments]
}

export function getLogicalRootSnapshot (rootId, tree, privateDataRoot) {
  const snapshot = {}
  for (const key of Object.keys(tree)) {
    snapshot[key] = tree[key]
  }
  if (!rootId || isGlobalRootId(rootId)) return snapshot
  if (!privateDataRoot || typeof privateDataRoot !== 'object') return snapshot
  for (const key of Object.keys(privateDataRoot)) {
    snapshot[key] = privateDataRoot[key]
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
