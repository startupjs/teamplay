import { getRaw } from './dataTree.js'
import { getConnection } from './connection.ts'
import { isMissingShareDoc } from './missingDoc.js'

export function isQueryReady (
  collection,
  idsSegments,
  docsSegments,
  extraSegments,
  aggregationSegments,
  isAggregate,
  hasExtraResult
) {
  if (hasExtraResult) {
    return getRaw(extraSegments) !== undefined
  }
  if (isAggregate) {
    const docs = getRaw(docsSegments)
    if (Array.isArray(docs)) return true
    if (getRaw(extraSegments) !== undefined) return true
    return getRaw(aggregationSegments) !== undefined
  }
  const ids = getRaw(idsSegments)
  if (!Array.isArray(ids)) return false
  for (const id of ids) {
    if (id == null) continue
    if (!isDocReady([collection, id])) return false
  }
  return true
}

export function isDocReady (segments) {
  const rawDoc = getRaw(segments)
  if (rawDoc !== undefined) return true
  const [collection, id] = segments
  const shareDoc = getShareDoc(collection, id)
  // Missing docs should not block the batch barrier forever.
  return isMissingShareDoc(shareDoc)
}

function getShareDoc (collection, id) {
  try {
    return getConnection().get(collection, id)
  } catch {
    return undefined
  }
}
