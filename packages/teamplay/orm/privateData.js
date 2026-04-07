import { getRootContext } from './rootContext.js'
import { getPrivateDataSegments, isPrivateCollectionSegments } from './rootScope.js'

export function getPrivateDataRoot (rootId, create = false) {
  return getRootContext(rootId, create)?.getPrivateDataRoot()
}

export function getPrivateData (rootId, logicalSegments) {
  if (!isPrivateCollectionSegments(logicalSegments)) return undefined
  return getRootContext(rootId, false)?.getPrivateDataAt(getPrivateDataSegments(logicalSegments))
}

export function setPrivateData (rootId, logicalSegments, value) {
  if (!isPrivateCollectionSegments(logicalSegments)) {
    throw Error('setPrivateData expects private collection segments')
  }
  getRootContext(rootId, true).setPrivateDataAt(getPrivateDataSegments(logicalSegments), value)
}

export function delPrivateData (rootId, logicalSegments) {
  if (!isPrivateCollectionSegments(logicalSegments)) return
  getRootContext(rootId, false)?.delPrivateDataAt(getPrivateDataSegments(logicalSegments))
}

export function getPrivateDataSnapshot (rootId) {
  return cloneValue(getPrivateDataRoot(rootId, false) || {})
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
