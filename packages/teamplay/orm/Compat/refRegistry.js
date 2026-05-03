import { GLOBAL_ROOT_ID } from '../Root.js'
import { normalizeRootId } from '../rootScope.js'
import { getRootContext, getRootContexts } from '../rootContext.js'

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
}

export function getRefLinks (rootId = GLOBAL_ROOT_ID) {
  return getRefStore(rootId) || EMPTY_MAP
}

export function * getAllRefLinks () {
  for (const context of getRootContexts()) {
    yield * context.refLinks.values()
  }
}

export function getRefRootIds () {
  return Array.from(getRootContexts())
    .filter(context => context.refLinks.size > 0)
    .map(context => context.rootId)
}

export function __resetRefLinksForTests () {
  for (const context of getRootContexts()) {
    context.resetRefs()
  }
}

function splitPath (path) {
  return path.split('.').filter(Boolean)
}

function getRefStore (rootId, create = false) {
  return getRootContext(normalizeRootId(rootId), create)?.refLinks
}
