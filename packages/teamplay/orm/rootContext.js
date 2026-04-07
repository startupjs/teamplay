import { normalizeRootId } from './rootScope.js'

const ROOT_CONTEXTS = new Map()
const EMPTY_SET = new Set()
const EMPTY_MAP = new Map()
const VIEW_KIND_QUERY = 'query'
const VIEW_KIND_AGGREGATION = 'aggregation'

export default class RootContext {
  constructor (rootId) {
    this.rootId = normalizeRootId(rootId)
    this.refLinks = new Map()
    this.activeRefs = new Map()
    this.modelListeners = {
      change: new Map(),
      all: new Map()
    }
    this.queryViewHashes = new Set()
    this.aggregationViewHashes = new Set()
    this.signalHashes = new Set()
    this.directDocSubscriptions = new Map()
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

  registerSignalHash (signalHash) {
    if (signalHash == null) return
    this.signalHashes.add(signalHash)
  }

  unregisterSignalHash (signalHash) {
    if (signalHash == null) return
    this.signalHashes.delete(signalHash)
  }

  registerDirectDocSubscription (hash, segments, token) {
    if (hash == null) return
    let entry = this.directDocSubscriptions.get(hash)
    if (!entry) {
      entry = {
        segments: [...segments],
        count: 0,
        tokenCounts: new Map()
      }
      this.directDocSubscriptions.set(hash, entry)
    }
    entry.count += 1
    if (token != null) {
      entry.tokenCounts.set(token, (entry.tokenCounts.get(token) || 0) + 1)
    }
  }

  unregisterDirectDocSubscription (hash, token) {
    const entry = this.directDocSubscriptions.get(hash)
    if (!entry) return
    entry.count = Math.max(entry.count - 1, 0)
    if (token != null) {
      const nextTokenCount = (entry.tokenCounts.get(token) || 0) - 1
      if (nextTokenCount > 0) entry.tokenCounts.set(token, nextTokenCount)
      else entry.tokenCounts.delete(token)
    }
    if (entry.count === 0) this.directDocSubscriptions.delete(hash)
  }

  resetRefs () {
    this.refLinks.clear()
  }

  resetActiveRefs () {
    this.activeRefs.clear()
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

  resetSignalHashes () {
    this.signalHashes.clear()
  }

  resetDirectDocSubscriptions () {
    this.directDocSubscriptions.clear()
  }

  isRuntimeEmpty () {
    return (
      this.refLinks.size === 0 &&
      this.activeRefs.size === 0 &&
      Object.values(this.modelListeners).every(store => store.size === 0) &&
      this.queryViewHashes.size === 0 &&
      this.aggregationViewHashes.size === 0 &&
      this.signalHashes.size === 0 &&
      this.directDocSubscriptions.size === 0
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

export function registerRootOwnedSignalHash (rootId, signalHash) {
  getRootContext(rootId, true).registerSignalHash(signalHash)
}

export function getRootOwnedSignalHashes (rootId) {
  const context = getRootContext(rootId, false)
  if (!context) return EMPTY_SET
  return context.signalHashes
}

export function clearRootOwnedSignalHashes (rootId) {
  const context = getRootContext(rootId, false)
  if (!context) return
  context.resetSignalHashes()
}

export function registerRootOwnedDirectDocSubscription (rootId, hash, segments, token) {
  getRootContext(rootId, true).registerDirectDocSubscription(hash, segments, token)
}

export function unregisterRootOwnedDirectDocSubscription (rootId, hash, token) {
  const context = getRootContext(rootId, false)
  if (!context) return
  context.unregisterDirectDocSubscription(hash, token)
}

export function getRootOwnedDirectDocSubscriptions (rootId) {
  const context = getRootContext(rootId, false)
  if (!context) return EMPTY_MAP
  return context.directDocSubscriptions
}

export function clearRootOwnedDirectDocSubscriptions (rootId) {
  const context = getRootContext(rootId, false)
  if (!context) return
  context.resetDirectDocSubscriptions()
}

export function deleteRootContext (rootId) {
  ROOT_CONTEXTS.delete(normalizeRootId(rootId))
}

export function __getRootContextForTests (rootId) {
  return getRootContext(rootId, false)
}

export function __resetRootContextsForTests () {
  ROOT_CONTEXTS.clear()
}
