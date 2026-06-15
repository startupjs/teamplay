import { getRaw } from './dataTree.js'
import { getConnection } from './connection.ts'
import { isMissingShareDoc } from './missingDoc.js'
import { QUERIES, HASH, PARAMS, COLLECTION_NAME, querySubscriptions } from './Query.js'
import { AGGREGATIONS, IS_AGGREGATION, aggregationSubscriptions } from './Aggregation.js'
import { getPrivateData, setPrivateData } from './privateData.js'
import { getRoot, ROOT_ID } from './Root.ts'
import { isRootContextClosed } from './rootContext.ts'
import { getScopedSignalHash, normalizeRootId } from './rootScope.ts'

let imperativeQueryReadyTimeoutMs = 1000

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

export async function waitForImperativeQueryReady ($query) {
  const timeoutMs = imperativeQueryReadyTimeoutMs
  const startedAt = Date.now()
  const ownerState = createImperativeOwnerState($query)
  while (true) {
    if (isImperativeQueryCancelled($query, ownerState)) return
    if (isImperativeQueryReady($query)) {
      syncQueryDocsFromCollection($query)
      return
    }
    if (Date.now() - startedAt >= timeoutMs) {
      throw createImperativeQueryReadinessError($query, timeoutMs)
    }
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

export function __setImperativeQueryReadyTimeoutForTests (timeoutMs) {
  imperativeQueryReadyTimeoutMs = timeoutMs
}

export function __resetImperativeQueryReadyTimeoutForTests () {
  imperativeQueryReadyTimeoutMs = 1000
}

function isImperativeQueryReady ($query) {
  const collection = $query[COLLECTION_NAME]
  const hash = $query[HASH]
  const rootId = getRoot($query)?.[ROOT_ID]
  const params = $query[PARAMS]
  const hasExtraResult = isExtraQuery(params)
  if (hasExtraResult) return getPrivateData(rootId, [QUERIES, hash, 'extra'], true) !== undefined

  const isAggregate = !!$query[IS_AGGREGATION] || isAggregationQuery(params)
  if (isAggregate) {
    const docs = getPrivateData(rootId, [QUERIES, hash, 'docs'], true)
    if (Array.isArray(docs)) return true
    if (getPrivateData(rootId, [QUERIES, hash, 'extra'], true) !== undefined) return true
    return getPrivateData(rootId, [AGGREGATIONS, hash], true) !== undefined
  }

  const ids = getPrivateData(rootId, [QUERIES, hash, 'ids'], true)
  if (!Array.isArray(ids)) return false
  for (const id of ids) {
    if (id == null) continue
    if (getRaw([collection, id]) === undefined) return false
  }
  return true
}

function isImperativeQueryCancelled ($query, ownerState) {
  const rootId = getRoot($query)?.[ROOT_ID]
  if (isRootContextClosed(rootId)) return true
  if (!ownerState?.wasTracked) return false
  const trackedOwnerCount = ownerState.subscriptions.getTrackedOwnerCount(ownerState.ownerKey)
  return trackedOwnerCount == null || trackedOwnerCount <= 0
}

function createImperativeOwnerState ($query) {
  const hash = $query[HASH]
  const rootId = normalizeRootId(getRoot($query)?.[ROOT_ID])
  const subscriptions = ($query[IS_AGGREGATION] || isAggregationQuery($query[PARAMS]))
    ? aggregationSubscriptions
    : querySubscriptions
  const ownerKey = getScopedSignalHash(rootId, hash, 'queryOwner')
  return {
    subscriptions,
    ownerKey,
    wasTracked: subscriptions.getTrackedOwnerCount(ownerKey) != null
  }
}

function syncQueryDocsFromCollection ($query) {
  const params = $query[PARAMS]
  if ($query[IS_AGGREGATION] || isAggregationQuery(params) || isExtraQuery(params)) return

  const collection = $query[COLLECTION_NAME]
  const hash = $query[HASH]
  const rootId = getRoot($query)?.[ROOT_ID]
  const ids = getPrivateData(rootId, [QUERIES, hash, 'ids'], true)
  if (!Array.isArray(ids)) return

  const docs = []
  for (const id of ids) {
    if (id == null) continue
    const doc = getRaw([collection, id])
    if (doc === undefined) {
      throw createImperativeQueryReadinessError($query, imperativeQueryReadyTimeoutMs)
    }
    docs.push(doc)
  }

  setPrivateData(rootId, [QUERIES, hash, 'docs'], docs)
}

function createImperativeQueryReadinessError ($query, timeoutMs) {
  const collection = $query[COLLECTION_NAME]
  const hash = $query[HASH]
  const rootId = getRoot($query)?.[ROOT_ID]
  const params = $query[PARAMS]
  const ids = getPrivateData(rootId, [QUERIES, hash, 'ids'], true)
  const missingDocs = []

  if (Array.isArray(ids)) {
    for (const id of ids) {
      if (id == null) continue
      const doc = getRaw([collection, id])
      if (doc !== undefined) continue
      const shareDoc = getShareDoc(collection, id)
      missingDocs.push({
        id,
        missingShareDoc: isMissingShareDoc(shareDoc)
      })
    }
  }

  return Error(`
    Query did not fully materialize within ${timeoutMs}ms.
      Collection: ${collection}
      Params: ${JSON.stringify(params)}
      Hash: ${hash}
      Ids: ${JSON.stringify(ids)}
      Missing docs: ${JSON.stringify(missingDocs)}
  `)
}

function getShareDoc (collection, id) {
  try {
    return getConnection().get(collection, id)
  } catch {
    return undefined
  }
}

function isExtraQuery (query) {
  if (!query || typeof query !== 'object') return false
  return !!(query.$count || query.$queryName)
}

function isAggregationQuery (query) {
  if (!query || typeof query !== 'object') return false
  return !!(query.$aggregate || query.$aggregationName)
}
