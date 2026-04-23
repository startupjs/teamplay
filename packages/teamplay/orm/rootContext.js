import { observable } from '@nx-js/observer-util'
import { normalizeRootId } from './rootScope.js'
import { getDefaultFetchOnly } from './connection.ts'

const ROOT_CONTEXTS = new Map()
const CLOSED_ROOT_CONTEXTS = new Set()
const EMPTY_SET = new Set()
const EMPTY_MAP = new Map()
const RUNTIME_KIND_QUERY = 'query'
const RUNTIME_KIND_AGGREGATION = 'aggregation'

export default class RootContext {
  constructor (rootId, { fetchOnly } = {}) {
    this.rootId = normalizeRootId(rootId)
    this.fetchOnly = fetchOnly == null ? getDefaultFetchOnly() : !!fetchOnly
    this.privateDataRaw = {}
    this.privateData = observable(this.privateDataRaw)
    this.refLinks = new Map()
    this.activeRefs = new Map()
    this.modelListeners = {
      change: new Map(),
      all: new Map()
    }
    this.queryRuntimeHashes = new Set()
    this.aggregationRuntimeHashes = new Set()
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

  getFetchOnly () {
    return !!this.fetchOnly
  }

  setFetchOnly (value) {
    this.fetchOnly = !!value
  }

  getPrivateDataRoot () {
    return this.privateData
  }

  getPrivateDataRawRoot () {
    return this.privateDataRaw
  }

  getPrivateDataAt (segments) {
    return getPath(segments, this.privateData)
  }

  getPrivateDataRawAt (segments) {
    return getPath(segments, this.privateDataRaw)
  }

  setPrivateDataAt (segments, value) {
    setPath(segments, value, this.privateData)
  }

  delPrivateDataAt (segments) {
    delPath(segments, this.privateData)
  }

  getRuntimeHashes (kind) {
    switch (kind) {
      case RUNTIME_KIND_QUERY:
        return this.queryRuntimeHashes
      case RUNTIME_KIND_AGGREGATION:
        return this.aggregationRuntimeHashes
      default:
        throw Error(`Unsupported root-owned runtime kind: ${kind}`)
    }
  }

  registerRuntime (kind, runtimeHash) {
    if (runtimeHash == null) return
    this.getRuntimeHashes(kind).add(runtimeHash)
  }

  unregisterRuntime (kind, runtimeHash) {
    if (runtimeHash == null) return
    this.getRuntimeHashes(kind).delete(runtimeHash)
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

  resetRuntimeHashes () {
    this.queryRuntimeHashes.clear()
    this.aggregationRuntimeHashes.clear()
  }

  resetPrivateData () {
    this.privateDataRaw = {}
    this.privateData = observable(this.privateDataRaw)
  }

  resetSignalHashes () {
    this.signalHashes.clear()
  }

  resetDirectDocSubscriptions () {
    this.directDocSubscriptions.clear()
  }

  isRuntimeEmpty () {
    return (
      isPlainObjectEmpty(this.privateData) &&
      this.refLinks.size === 0 &&
      this.activeRefs.size === 0 &&
      Object.values(this.modelListeners).every(store => store.size === 0) &&
      this.queryRuntimeHashes.size === 0 &&
      this.aggregationRuntimeHashes.size === 0 &&
      this.signalHashes.size === 0 &&
      this.directDocSubscriptions.size === 0
    )
  }
}

export function getRootContext (rootId, create = true, options = {}) {
  const normalizedRootId = normalizeRootId(rootId)
  if (create && CLOSED_ROOT_CONTEXTS.has(normalizedRootId)) return undefined
  let context = ROOT_CONTEXTS.get(normalizedRootId)
  if (!context && create) {
    context = new RootContext(normalizedRootId, options)
    ROOT_CONTEXTS.set(normalizedRootId, context)
  }
  return context
}

export function getRootContexts () {
  return ROOT_CONTEXTS.values()
}

export function registerRootOwnedRuntime (rootId, kind, runtimeHash) {
  getRootContext(rootId, true).registerRuntime(kind, runtimeHash)
}

export function unregisterRootOwnedRuntime (rootId, kind, runtimeHash) {
  const context = getRootContext(rootId, false)
  if (!context) return
  context.unregisterRuntime(kind, runtimeHash)
}

export function getRootOwnedRuntimeHashes (rootId, kind) {
  const context = getRootContext(rootId, false)
  if (!context) return EMPTY_SET
  return context.getRuntimeHashes(kind)
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
  const normalizedRootId = normalizeRootId(rootId)
  ROOT_CONTEXTS.delete(normalizedRootId)
  CLOSED_ROOT_CONTEXTS.add(normalizedRootId)
}

export function reviveRootContext (rootId) {
  CLOSED_ROOT_CONTEXTS.delete(normalizeRootId(rootId))
}

export function isRootContextClosed (rootId) {
  return CLOSED_ROOT_CONTEXTS.has(normalizeRootId(rootId))
}

export function __getRootContextForTests (rootId) {
  return getRootContext(rootId, false)
}

export function __resetRootContextsForTests () {
  ROOT_CONTEXTS.clear()
  CLOSED_ROOT_CONTEXTS.clear()
}

function getPath (segments, dataNode) {
  for (const segment of segments) {
    if (dataNode == null) return dataNode
    dataNode = dataNode[segment]
  }
  return dataNode
}

function setPath (segments, value, tree) {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw Error('setPrivateDataAt requires a non-empty segments array')
  }
  let dataNode = tree
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]
    const next = dataNode[segment]
    if (next == null || typeof next !== 'object') {
      dataNode[segment] = {}
    }
    dataNode = dataNode[segment]
  }
  dataNode[segments[segments.length - 1]] = value
}

function delPath (segments, tree) {
  if (!Array.isArray(segments) || segments.length === 0) return
  const parents = []
  let dataNode = tree
  for (let i = 0; i < segments.length - 1; i++) {
    if (dataNode == null) return
    parents.push([dataNode, segments[i]])
    dataNode = dataNode[segments[i]]
  }
  if (dataNode == null) return
  delete dataNode[segments[segments.length - 1]]
  for (let i = parents.length - 1; i >= 0; i--) {
    const [parent, segment] = parents[i]
    if (!isPlainObjectEmpty(parent[segment])) break
    delete parent[segment]
  }
}

function isPlainObjectEmpty (value) {
  return value != null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0
}
