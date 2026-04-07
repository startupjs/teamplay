import { GLOBAL_ROOT_ID } from '../Root.js'

const refLinksByRoot = new Map()
const EMPTY_MAP = new Map()

export function setRefLink (rootId, fromPath, toPath, fromSegments, toSegments, options = {}) {
  if (typeof fromPath !== 'string' || typeof toPath !== 'string') return
  const normalizedFromSegments = Array.isArray(fromSegments)
    ? fromSegments.map(segment => String(segment))
    : splitPath(fromPath)
  const normalizedToSegments = Array.isArray(toSegments)
    ? toSegments.map(segment => String(segment))
    : splitPath(toPath)
  getRefStore(rootId, true).set(fromPath, {
    fromPath,
    toPath,
    fromSegments: normalizedFromSegments,
    toSegments: normalizedToSegments,
    fromRootId: normalizeRootId(rootId),
    toRootId: options.toRootId,
    mirrorOnly: !!options.mirrorOnly,
    onChange: typeof options.onChange === 'function' ? options.onChange : undefined
  })
}

export function removeRefLink (rootId, fromPath) {
  const store = getRefStore(rootId)
  if (!store) return
  store.delete(fromPath)
  if (!store.size) refLinksByRoot.delete(normalizeRootId(rootId))
}

export function getRefLinks (rootId = GLOBAL_ROOT_ID) {
  return getRefStore(rootId) || EMPTY_MAP
}

export function * getAllRefLinks () {
  for (const store of refLinksByRoot.values()) {
    yield * store.values()
  }
}

export function getRefRootIds () {
  return refLinksByRoot.keys()
}

export function __resetRefLinksForTests () {
  refLinksByRoot.clear()
}

function splitPath (path) {
  return path.split('.').filter(Boolean)
}

function getRefStore (rootId, create = false) {
  const normalizedRootId = normalizeRootId(rootId)
  let store = refLinksByRoot.get(normalizedRootId)
  if (!store && create) {
    store = new Map()
    refLinksByRoot.set(normalizedRootId, store)
  }
  return store
}

function normalizeRootId (rootId) {
  return rootId ?? GLOBAL_ROOT_ID
}
