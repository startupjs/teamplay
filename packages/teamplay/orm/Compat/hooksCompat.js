import { getRootSignal, GLOBAL_ROOT_ID } from '../Root.js'
import useSub, { useAsyncSub } from '../../react/useSub.js'
import universal$ from '../../react/universal$.js'

const $root = getRootSignal({ rootId: GLOBAL_ROOT_ID, rootFunction: universal$ })

// Hook-compatible wrapper around $() for compatibility mode.
export function useValue$ (defaultValue) {
  return $root(defaultValue)
}

// Returns [value, $signal] similar to useState, but backed by $().
export function useValue (defaultValue) {
  const $sig = useValue$(defaultValue)
  return [$sig.get(), $sig]
}

export function useModel (path) {
  if (arguments.length === 0 || path == null) return $root
  if (path && typeof path.path === 'function') return path
  if (typeof path !== 'string') throw Error('useModel() expects a string path or a signal')
  const segments = path.split('.').filter(Boolean)
  if (segments.length === 0) return $root
  let $cursor = $root
  for (const segment of segments) {
    $cursor = $cursor[segment]
  }
  return $cursor
}

export function useLocal$ (path) {
  const resolvedPath = resolveLocalPath(path)
  if (!resolvedPath) return $root
  const segments = resolvedPath.split('.').filter(Boolean)
  let $cursor = $root
  for (const segment of segments) {
    $cursor = $cursor[segment]
  }
  return $cursor
}

export function useLocal (path) {
  const $sig = useLocal$(path)
  return [$sig.get(), $sig]
}

export function useLocalDoc$ (collection, id) {
  if (collection == null) throw Error('useLocalDoc() expects a collection name')
  if (id == null) return undefined
  return $root[collection][id]
}

export function useLocalDoc (collection, id) {
  const $doc = useLocalDoc$(collection, id)
  if (!$doc) return [undefined, undefined]
  return [$doc.get(), $doc]
}

export function useSession$ (path) {
  return useLocal$(prefixLocalPath('_session', path))
}

export function useSession (path) {
  return useLocal(prefixLocalPath('_session', path))
}

export function usePage$ (path) {
  return useLocal$(prefixLocalPath('_page', path))
}

export function usePage (path) {
  return useLocal(prefixLocalPath('_page', path))
}

// Placeholder for startupjs batching API. No-op in teamplay.
export function useBatch () {}

export function useDoc$ (collection, id, options) {
  const $doc = getDocSignal(collection, id, 'useDoc')
  const normalizedOptions = options ? { ...options, async: false } : options
  return useSub($doc, undefined, normalizedOptions)
}

export function useDoc (collection, id, options) {
  const $doc = useDoc$(collection, id, options)
  return [$doc.get(), $doc]
}

// Batch variants are aliases to non-batch versions (no batching in teamplay).
export function useBatchDoc (collection, id, options) {
  return useDoc(collection, id, options)
}

export function useBatchDoc$ (collection, id, options) {
  return useDoc$(collection, id, options)
}

export function useAsyncDoc$ (collection, id, options) {
  const $doc = getDocSignal(collection, id, 'useAsyncDoc')
  return useAsyncSub($doc, undefined, options)
}

export function useAsyncDoc (collection, id, options) {
  const $doc = useAsyncDoc$(collection, id, options)
  if (!$doc) return [undefined, undefined]
  return [$doc.get(), $doc]
}

export function useQuery$ (collection, query, options) {
  const $collection = getCollectionSignal(collection, query, 'useQuery')
  const normalizedOptions = options ? { ...options, async: false } : options
  useSub($collection, normalizeQuery(query, 'useQuery'), normalizedOptions)
  return $collection
}

export function useQuery (collection, query, options) {
  const $collection = getCollectionSignal(collection, query, 'useQuery')
  const normalizedOptions = options ? { ...options, async: false } : options
  const $query = useSub($collection, normalizeQuery(query, 'useQuery'), normalizedOptions)
  return [$query.get(), $collection]
}

export function useAsyncQuery$ (collection, query, options) {
  const $collection = getCollectionSignal(collection, query, 'useAsyncQuery')
  useAsyncSub($collection, normalizeQuery(query, 'useAsyncQuery'), options)
  return $collection
}

export function useAsyncQuery (collection, query, options) {
  const $collection = getCollectionSignal(collection, query, 'useAsyncQuery')
  const $query = useAsyncSub($collection, normalizeQuery(query, 'useAsyncQuery'), options)
  if (!$query) return [undefined, $collection]
  return [$query.get(), $collection]
}

// Batch variants are aliases to non-batch versions (no batching in teamplay).
export function useBatchQuery$ (collection, query, options) {
  return useQuery$(collection, query, options)
}

export function useBatchQuery (collection, query, options) {
  return useQuery(collection, query, options)
}

export function useQueryIds (collection, ids = [], options = {}) {
  const list = Array.isArray(ids) ? ids.slice() : []
  if (options?.reverse) list.reverse()
  const [docs, $collection] = useQuery(collection, { _id: { $in: list } }, options)
  if (!docs) return [docs, $collection]
  const docsById = new Map()
  for (const doc of docs) {
    const id = doc?._id ?? doc?.id
    if (id != null) docsById.set(id, doc)
  }
  const items = list.map(id => docsById.get(id)).filter(Boolean)
  return [items, $collection]
}

export function useBatchQueryIds (collection, ids = [], options = {}) {
  return useQueryIds(collection, ids, options)
}

export function useAsyncQueryIds (collection, ids = [], options = {}) {
  const list = Array.isArray(ids) ? ids.slice() : []
  if (options?.reverse) list.reverse()
  const [docs, $collection] = useAsyncQuery(collection, { _id: { $in: list } }, options)
  if (docs == null) return [undefined, $collection]
  const docsById = new Map()
  for (const doc of docs) {
    const id = doc?._id ?? doc?.id
    if (id != null) docsById.set(id, doc)
  }
  const items = list.map(id => docsById.get(id)).filter(Boolean)
  return [items, $collection]
}

export function useQueryDoc (collection, query, options) {
  const normalized = normalizeQuery(query, 'useQueryDoc')
  const queryDoc = {
    ...normalized,
    $limit: 1,
    $sort: normalized.$sort || { createdAt: -1 }
  }
  const [docs, $collection] = useQuery(collection, queryDoc, options)
  const doc = docs && docs[0]
  const docId = doc?._id ?? doc?.id
  const $doc = docId != null ? $collection[docId] : undefined
  return [doc, $doc]
}

export function useQueryDoc$ (collection, query, options) {
  const [, $doc] = useQueryDoc(collection, query, options)
  return $doc
}

export function useBatchQueryDoc (collection, query, options) {
  return useQueryDoc(collection, query, options)
}

export function useBatchQueryDoc$ (collection, query, options) {
  return useQueryDoc$(collection, query, options)
}

export function useAsyncQueryDoc (collection, query, options) {
  const normalized = normalizeQuery(query, 'useAsyncQueryDoc')
  const queryDoc = {
    ...normalized,
    $limit: 1,
    $sort: normalized.$sort || { createdAt: -1 }
  }
  const [docs, $collection] = useAsyncQuery(collection, queryDoc, options)
  if (docs == null) return [undefined, undefined]
  const doc = docs && docs[0]
  const docId = doc?._id ?? doc?.id
  const $doc = docId != null ? $collection[docId] : undefined
  return [doc, $doc]
}

export function useAsyncQueryDoc$ (collection, query, options) {
  const [, $doc] = useAsyncQueryDoc(collection, query, options)
  return $doc
}

function resolveLocalPath (path) {
  if (path && typeof path.path === 'function') return path.path()
  if (typeof path === 'string') return path
  if (path == null) return ''
  throw Error('useLocal() expects a string path or a signal')
}

function prefixLocalPath (prefix, path) {
  if (path == null || path === '') return prefix
  let resolved = path
  if (path && typeof path.path === 'function') resolved = path.path()
  if (typeof resolved !== 'string') throw Error(`${prefix} hook expects a string path or a signal`)
  if (resolved.startsWith(prefix + '.')) return resolved
  if (resolved === prefix) return resolved
  return `${prefix}.${resolved}`
}

function getDocSignal (collection, id, hookName) {
  if (typeof collection !== 'string') {
    throw Error(`[${hookName}] collection must be a string. Got: ${collection}`)
  }
  if (id == null) {
    console.warn(`
      [${hookName}] You are trying to subscribe to an undefined document id:
        ${collection}.${id}
      Falling back to '__NULL__' document to prevent critical crash.
      You should prevent situations when the \`id\` is undefined.
    `)
    id = '__NULL__'
  }
  return $root[collection][id]
}

function getCollectionSignal (collection, query, hookName) {
  if (typeof collection !== 'string') {
    throw Error(`[${hookName}] collection must be a string. Got: ${collection}`)
  }
  if (query == null) {
    console.warn(`
      [${hookName}] Query is undefined. Got:
        ${collection}, ${query}
      Falling back to {_id: '__NON_EXISTENT__'} query to prevent critical crash.
      You should prevent situations when the \`query\` is undefined.
    `)
  }
  return $root[collection]
}

function normalizeQuery (query, hookName) {
  if (query == null) return { _id: '__NON_EXISTENT__' }
  if (typeof query !== 'object') {
    throw Error(`[${hookName}] query must be an object. Got: ${query}`)
  }
  return query
}
