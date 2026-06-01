import { getRootSignal, GLOBAL_ROOT_ID } from '../Root.ts'
import useSub, { useAsyncSub } from '../../react/useSub.ts'
import universal$ from '../../react/universal$.ts'
import * as promiseBatcher from '../../react/promiseBatcher.ts'
import { isCompatEnv } from '../compatEnv.js'
import { isQueryReady } from './queryReadiness.js'

const $root = getRootSignal({ rootId: GLOBAL_ROOT_ID, rootFunction: universal$ })
const emittedCompatWarnings = new Set()

export function useBatch () {
  const promise = promiseBatcher.getPromiseAll()
  if (promise) throw promise
}

export function useBatchDoc (collection, id, options) {
  const $doc = useBatchDoc$(collection, id, options)
  if (!$doc) return [undefined, undefined]
  return [$doc.get(), $doc]
}

export function useBatchDoc$ (collection, id, _options) {
  const $doc = getDocSignal(collection, id, 'useBatchDoc')
  const options = _options ? { ..._options, ...BATCH_SUB_OPTIONS } : BATCH_SUB_OPTIONS
  return useSub($doc, undefined, options)
}

function useSubscribedQuery (collection, query, options, hookName, subscribe) {
  const normalizedQuery = normalizeQuery(query, hookName)
  const $collection = getCollectionSignal(collection, query, hookName)
  const $query = subscribe($collection, normalizedQuery, options)
  return {
    normalizedQuery,
    $collection,
    $query: getExtraQuerySignal($query, normalizedQuery)
  }
}

function getExtraQuerySignal ($query, normalizedQuery) {
  if (!$query) return $query
  return isExtraQuery(normalizedQuery) ? $query.extra : $query
}

function useSyncQueryResult (collection, query, options, hookName) {
  const normalizedOptions = normalizeSyncSubOptions(options)
  const { $collection, $query } = useSubscribedQuery(collection, query, normalizedOptions, hookName, useSub)
  return [$query.get(), $collection]
}

function useAsyncQueryResult (collection, query, options, hookName) {
  const { $collection, $query } = useSubscribedQuery(collection, query, options, hookName, useAsyncSub)
  if (!$query) return [undefined, $collection]
  return [$query.get(), $collection]
}

export function useBatchQuery$ (collection, query, _options) {
  const options = normalizeBatchSubOptions(_options)
  const { $query } = useSubscribedQuery(collection, query, options, 'useBatchQuery', useSub)
  return $query
}

export function useBatchQuery (collection, query, _options) {
  const options = normalizeBatchSubOptions(_options)
  const { $collection, $query } = useSubscribedQuery(collection, query, options, 'useBatchQuery', useSub)
  if (!$query) return [undefined, $collection]
  return [$query.get(), $collection]
}

export function useQueryIds (collection, ids = [], options = {}) {
  const list = Array.isArray(ids) ? ids.slice() : []
  if (options?.reverse) list.reverse()
  const [docs, $collection] = useSyncQueryResult(collection, { _id: { $in: list } }, options, 'useQueryIds')
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
  const list = Array.isArray(ids) ? ids.slice() : []
  if (options?.reverse) list.reverse()
  const [docs, $collection] = useBatchQuery(collection, { _id: { $in: list } }, options)
  if (!docs) return [docs, $collection]
  const docsById = new Map()
  for (const doc of docs) {
    const id = doc?._id ?? doc?.id
    if (id != null) docsById.set(id, doc)
  }
  const items = list.map(id => docsById.get(id)).filter(Boolean)
  return [items, $collection]
}

export function useAsyncQueryIds (collection, ids = [], options = {}) {
  const list = Array.isArray(ids) ? ids.slice() : []
  if (options?.reverse) list.reverse()
  const [docs, $collection] = useAsyncQueryResult(collection, { _id: { $in: list } }, options, 'useAsyncQueryIds')
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
  const [docs, $collection] = useSyncQueryResult(collection, queryDoc, options, 'useQueryDoc')
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
  const normalized = normalizeQuery(query, 'useBatchQueryDoc')
  const queryDoc = {
    ...normalized,
    $limit: 1,
    $sort: normalized.$sort || { createdAt: -1 }
  }
  const [docs, $collection] = useBatchQuery(collection, queryDoc, options)
  if (!docs) return [undefined, undefined]
  const doc = docs && docs[0]
  const docId = doc?._id ?? doc?.id
  const $doc = docId != null ? $collection[docId] : undefined
  return [doc, $doc]
}

export function useBatchQueryDoc$ (collection, query, options) {
  const [, $doc] = useBatchQueryDoc(collection, query, options)
  return $doc
}

export function useAsyncQueryDoc (collection, query, options) {
  const normalized = normalizeQuery(query, 'useAsyncQueryDoc')
  const queryDoc = {
    ...normalized,
    $limit: 1,
    $sort: normalized.$sort || { createdAt: -1 }
  }
  const [docs, $collection] = useAsyncQueryResult(collection, queryDoc, options, 'useAsyncQueryDoc')
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

function getDocSignal (collection, id, hookName) {
  if (typeof collection !== 'string') {
    throw Error(`[${hookName}] collection must be a string. Got: ${collection}`)
  }
  if (id == null) {
    warnCompatOnce(`doc:${hookName}:${collection}:${id}`, `
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
    warnCompatOnce(`query:${hookName}:${collection}`, `
      [${hookName}] Query is undefined. Got:
        ${collection}, ${query}
      Falling back to {_id: '__NON_EXISTENT__'} query to prevent critical crash.
      You should prevent situations when the \`query\` is undefined.
    `)
  }
  return $root[collection]
}

function warnCompatOnce (key, message) {
  if (emittedCompatWarnings.has(key)) return
  emittedCompatWarnings.add(key)
  console.warn(message)
}

export function __resetCompatWarningsForTests () {
  emittedCompatWarnings.clear()
}

function normalizeQuery (query, hookName) {
  if (query == null) return { _id: '__NON_EXISTENT__' }
  if (typeof query !== 'object') {
    throw Error(`[${hookName}] query must be an object. Got: ${query}`)
  }
  return query
}

function isExtraQuery (query) {
  if (!query || typeof query !== 'object') return false
  return !!(
    query.$count ||
    query.$queryName ||
    query.$aggregationName
  )
}

const BATCH_SUB_OPTIONS = Object.freeze({
  async: false,
  batch: true,
  // Batch hooks are a hard suspense barrier. Deferred params can skip the barrier
  // on route transitions and cause immediate reads from stale/empty local nodes.
  defer: false
})

function normalizeSyncSubOptions (options) {
  if (!isCompatEnv()) {
    return options ? { ...options, async: false } : options
  }
  return {
    ...(options || {}),
    async: false,
    // Compat sync hooks are strict by design: no deferred snapshots between route/tab switches.
    defer: false
  }
}

function normalizeBatchSubOptions (options) {
  return options ? { ...options, ...BATCH_SUB_OPTIONS } : BATCH_SUB_OPTIONS
}

export const __COMPAT_BATCH_READY__ = {
  isQueryReady
}
