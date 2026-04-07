import { getRaw, set as _set } from '../dataTree.js'
import { getConnection } from '../connection.js'
import { isMissingShareDoc } from '../missingDoc.js'
import { QUERIES, HASH, VIEW_HASH, PARAMS, COLLECTION_NAME } from '../Query.js'
import { AGGREGATIONS, IS_AGGREGATION } from '../Aggregation.js'

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
  while (true) {
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
  const viewHash = $query[VIEW_HASH] || hash
  const params = $query[PARAMS]
  const hasExtraResult = isExtraQuery(params)
  if (hasExtraResult) return getRaw([QUERIES, viewHash, 'extra']) !== undefined

  const isAggregate = !!$query[IS_AGGREGATION] || isAggregationQuery(params)
  if (isAggregate) {
    return isQueryReady(
      collection,
      [QUERIES, viewHash, 'ids'],
      [QUERIES, viewHash, 'docs'],
      [QUERIES, viewHash, 'extra'],
      [AGGREGATIONS, viewHash],
      true,
      false
    )
  }

  const ids = getRaw([QUERIES, viewHash, 'ids'])
  if (!Array.isArray(ids)) return false
  for (const id of ids) {
    if (id == null) continue
    if (getRaw([collection, id]) === undefined) return false
  }
  return true
}

function syncQueryDocsFromCollection ($query) {
  const params = $query[PARAMS]
  if ($query[IS_AGGREGATION] || isAggregationQuery(params) || isExtraQuery(params)) return

  const collection = $query[COLLECTION_NAME]
  const hash = $query[HASH]
  const viewHash = $query[VIEW_HASH] || hash
  const ids = getRaw([QUERIES, viewHash, 'ids'])
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

  _set([QUERIES, viewHash, 'docs'], docs)
}

function createImperativeQueryReadinessError ($query, timeoutMs) {
  const collection = $query[COLLECTION_NAME]
  const hash = $query[HASH]
  const viewHash = $query[VIEW_HASH] || hash
  const params = $query[PARAMS]
  const ids = getRaw([QUERIES, viewHash, 'ids'])
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
    Compat query did not fully materialize within ${timeoutMs}ms.
      Collection: ${collection}
      Params: ${JSON.stringify(params)}
      Hash: ${hash}
      View hash: ${viewHash}
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
