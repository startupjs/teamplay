import { getRootContext } from './rootContext.js'
import { getPrivateDataSegments, isPrivateCollectionSegments } from './rootScope.js'
import {
  arrayInsert as _arrayInsert,
  arrayMove as _arrayMove,
  arrayPop as _arrayPop,
  arrayPush as _arrayPush,
  arrayRemove as _arrayRemove,
  arrayShift as _arrayShift,
  arrayUnshift as _arrayUnshift,
  del as _del,
  set as _set,
  setReplace as _setReplace,
  stringInsertLocal as _stringInsertLocal,
  stringRemoveLocal as _stringRemoveLocal
} from './dataTree.js'

export function getPrivateDataRoot (rootId, create = false) {
  return getRootContext(rootId, create)?.getPrivateDataRoot()
}

export function getPrivateDataRawRoot (rootId, create = false) {
  return getRootContext(rootId, create)?.getPrivateDataRawRoot()
}

export function getPrivateData (rootId, logicalSegments, raw = false) {
  if (!isPrivateCollectionSegments(logicalSegments)) return undefined
  const context = getRootContext(rootId, !raw)
  if (!context) return undefined
  return raw
    ? context.getPrivateDataRawAt(getPrivateDataSegments(logicalSegments))
    : context.getPrivateDataAt(getPrivateDataSegments(logicalSegments))
}

export function setPrivateData (rootId, logicalSegments, value) {
  if (!isPrivateCollectionSegments(logicalSegments)) {
    throw Error('setPrivateData expects private collection segments')
  }
  const context = getRootContext(rootId, true)
  const segments = getPrivateDataSegments(logicalSegments)
  _set(segments, value, context.getPrivateDataRoot(), getModelEventContext(rootId, logicalSegments))
}

export function setReplacePrivateData (rootId, logicalSegments, value) {
  if (!isPrivateCollectionSegments(logicalSegments)) {
    throw Error('setReplacePrivateData expects private collection segments')
  }
  const context = getRootContext(rootId, true)
  const segments = getPrivateDataSegments(logicalSegments)
  _setReplace(segments, value, context.getPrivateDataRoot(), getModelEventContext(rootId, logicalSegments))
}

export function delPrivateData (rootId, logicalSegments) {
  if (!isPrivateCollectionSegments(logicalSegments)) return
  const context = getRootContext(rootId, false)
  if (!context) return
  const segments = getPrivateDataSegments(logicalSegments)
  _del(segments, context.getPrivateDataRoot(), getModelEventContext(rootId, logicalSegments))
  pruneEmptyPrivateParents(context.getPrivateDataRoot(), context.getPrivateDataRawRoot(), segments)
}

export function arrayPushPrivateData (rootId, logicalSegments, value) {
  const context = getRequiredPrivateContext(rootId, logicalSegments, 'arrayPushPrivateData')
  return _arrayPush(getPrivateDataSegments(logicalSegments), value, context.getPrivateDataRoot(), getModelEventContext(rootId, logicalSegments))
}

export function arrayUnshiftPrivateData (rootId, logicalSegments, value) {
  const context = getRequiredPrivateContext(rootId, logicalSegments, 'arrayUnshiftPrivateData')
  return _arrayUnshift(getPrivateDataSegments(logicalSegments), value, context.getPrivateDataRoot(), getModelEventContext(rootId, logicalSegments))
}

export function arrayInsertPrivateData (rootId, logicalSegments, index, values) {
  const context = getRequiredPrivateContext(rootId, logicalSegments, 'arrayInsertPrivateData')
  return _arrayInsert(getPrivateDataSegments(logicalSegments), index, values, context.getPrivateDataRoot(), getModelEventContext(rootId, logicalSegments))
}

export function arrayPopPrivateData (rootId, logicalSegments) {
  const context = getRequiredPrivateContext(rootId, logicalSegments, 'arrayPopPrivateData')
  return _arrayPop(getPrivateDataSegments(logicalSegments), context.getPrivateDataRoot(), getModelEventContext(rootId, logicalSegments))
}

export function arrayShiftPrivateData (rootId, logicalSegments) {
  const context = getRequiredPrivateContext(rootId, logicalSegments, 'arrayShiftPrivateData')
  return _arrayShift(getPrivateDataSegments(logicalSegments), context.getPrivateDataRoot(), getModelEventContext(rootId, logicalSegments))
}

export function arrayRemovePrivateData (rootId, logicalSegments, index, howMany = 1) {
  const context = getRequiredPrivateContext(rootId, logicalSegments, 'arrayRemovePrivateData')
  return _arrayRemove(getPrivateDataSegments(logicalSegments), index, howMany, context.getPrivateDataRoot(), getModelEventContext(rootId, logicalSegments))
}

export function arrayMovePrivateData (rootId, logicalSegments, from, to, howMany = 1) {
  const context = getRequiredPrivateContext(rootId, logicalSegments, 'arrayMovePrivateData')
  return _arrayMove(getPrivateDataSegments(logicalSegments), from, to, howMany, context.getPrivateDataRoot(), getModelEventContext(rootId, logicalSegments))
}

export function stringInsertPrivateData (rootId, logicalSegments, index, text) {
  const context = getRequiredPrivateContext(rootId, logicalSegments, 'stringInsertPrivateData')
  return _stringInsertLocal(getPrivateDataSegments(logicalSegments), index, text, context.getPrivateDataRoot(), getModelEventContext(rootId, logicalSegments))
}

export function stringRemovePrivateData (rootId, logicalSegments, index, howMany) {
  const context = getRequiredPrivateContext(rootId, logicalSegments, 'stringRemovePrivateData')
  return _stringRemoveLocal(getPrivateDataSegments(logicalSegments), index, howMany, context.getPrivateDataRoot(), getModelEventContext(rootId, logicalSegments))
}

export function getPrivateDataSnapshot (rootId) {
  return cloneValue(getPrivateDataRoot(rootId, false) || {})
}

function getRequiredPrivateContext (rootId, logicalSegments, methodName) {
  if (!isPrivateCollectionSegments(logicalSegments)) {
    throw Error(`${methodName} expects private collection segments`)
  }
  return getRootContext(rootId, true)
}

function getModelEventContext (rootId, logicalSegments) {
  return {
    rootId,
    logicalSegments: getPrivateDataSegments(logicalSegments)
  }
}

function cloneValue (value) {
  if (Array.isArray(value)) return value.map(cloneValue)
  if (value && typeof value === 'object') {
    const cloned = {}
    for (const key of Object.keys(value)) cloned[key] = cloneValue(value[key])
    return cloned
  }
  return value
}

function pruneEmptyPrivateParents (tree, treeRaw, segments) {
  if (!Array.isArray(segments) || segments.length < 2) return
  const parents = []
  let node = tree
  let nodeRaw = treeRaw
  for (let i = 0; i < segments.length - 1; i++) {
    if (node == null || nodeRaw == null) return
    parents.push([node, nodeRaw, segments[i]])
    node = node[segments[i]]
    nodeRaw = nodeRaw[segments[i]]
  }
  for (let i = parents.length - 1; i >= 0; i--) {
    const [parent, parentRaw, segment] = parents[i]
    const valueRaw = parentRaw?.[segment]
    if (!isPlainObjectEmpty(valueRaw)) break
    delete parent[segment]
  }
}

function isPlainObjectEmpty (value) {
  return value != null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0
}
