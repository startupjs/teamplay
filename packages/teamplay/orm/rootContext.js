import { normalizeRootId } from './rootScope.js'

const ROOT_CONTEXTS = new Map()
const EMPTY_SET = new Set()
const VIEW_KIND_QUERY = 'query'
const VIEW_KIND_AGGREGATION = 'aggregation'

export default class RootContext {
  constructor (rootId) {
    this.rootId = normalizeRootId(rootId)
    this.refLinks = new Map()
    this.modelListeners = {
      change: new Map(),
      all: new Map()
    }
    this.queryViewHashes = new Set()
    this.aggregationViewHashes = new Set()
  }

  getModelEventStore (eventName, create = false) {
    let store = this.modelListeners[eventName]
    if (!store && create) {
      store = new Map()
      this.modelListeners[eventName] = store
    }
    return store
  }

  getViewHashes (kind) {
    switch (kind) {
      case VIEW_KIND_QUERY:
        return this.queryViewHashes
      case VIEW_KIND_AGGREGATION:
        return this.aggregationViewHashes
      default:
        throw Error(`Unsupported root-owned view kind: ${kind}`)
    }
  }

  registerView (kind, viewHash) {
    if (viewHash == null) return
    this.getViewHashes(kind).add(viewHash)
  }

  unregisterView (kind, viewHash) {
    if (viewHash == null) return
    this.getViewHashes(kind).delete(viewHash)
  }

  resetRefs () {
    this.refLinks.clear()
  }

  resetModelListeners () {
    for (const store of Object.values(this.modelListeners)) {
      store.clear()
    }
  }

  resetViews () {
    this.queryViewHashes.clear()
    this.aggregationViewHashes.clear()
  }

  isRuntimeEmpty () {
    return (
      this.refLinks.size === 0 &&
      Object.values(this.modelListeners).every(store => store.size === 0) &&
      this.queryViewHashes.size === 0 &&
      this.aggregationViewHashes.size === 0
    )
  }
}

export function getRootContext (rootId, create = true) {
  const normalizedRootId = normalizeRootId(rootId)
  let context = ROOT_CONTEXTS.get(normalizedRootId)
  if (!context && create) {
    context = new RootContext(normalizedRootId)
    ROOT_CONTEXTS.set(normalizedRootId, context)
  }
  return context
}

export function getRootContexts () {
  return ROOT_CONTEXTS.values()
}

export function registerRootOwnedView (rootId, kind, viewHash) {
  getRootContext(rootId, true).registerView(kind, viewHash)
}

export function unregisterRootOwnedView (rootId, kind, viewHash) {
  const context = getRootContext(rootId, false)
  if (!context) return
  context.unregisterView(kind, viewHash)
}

export function getRootOwnedViewHashes (rootId, kind) {
  const context = getRootContext(rootId, false)
  if (!context) return EMPTY_SET
  return context.getViewHashes(kind)
}

export function __getRootContextForTests (rootId) {
  return getRootContext(rootId, false)
}

export function __resetRootContextsForTests () {
  ROOT_CONTEXTS.clear()
}
