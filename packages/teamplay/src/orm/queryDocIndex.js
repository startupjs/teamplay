// The query runtimes that have each doc in their results (the docs they
// retain, deleted ones included). When the data-tree object of a doc is
// replaced (deleted, created again, loaded anew), Doc.js and dataTree.js call
// refreshQueryDocs() so each query lists the results that exist with their
// current data, as their doc signals read them: a deleted doc leaves the
// lists, a doc created again comes back. Entries live exactly as long as the
// query retains the doc.
const QUERIES_BY_DOC = new Map() // collection -> Map<docId, Set<query runtime>>

export function addQueryDoc (collection, docId, query) {
  let byId = QUERIES_BY_DOC.get(collection)
  if (!byId) QUERIES_BY_DOC.set(collection, byId = new Map())
  let queries = byId.get(docId)
  if (!queries) byId.set(docId, queries = new Set())
  queries.add(query)
}

export function removeQueryDoc (collection, docId, query) {
  const byId = QUERIES_BY_DOC.get(collection)
  const queries = byId?.get(docId)
  if (!queries?.delete(query) || queries.size > 0) return
  byId.delete(docId)
  if (byId.size === 0) QUERIES_BY_DOC.delete(collection)
}

export function refreshQueryDocs (collection, docId) {
  const queries = QUERIES_BY_DOC.get(collection)?.get(docId)
  if (!queries) return
  for (const query of queries) query.refreshDoc()
}

// For tests and diagnostics: how many docs of the collection queries list.
export function getQueryDocIndexSize (collection) {
  return QUERIES_BY_DOC.get(collection)?.size ?? 0
}
