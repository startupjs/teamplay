import { observable, raw } from '@nx-js/observer-util'
import jsonDiff from 'json0-ot-diff'
import diffMatchPatch from 'diff-match-patch'
import { getConnection } from './connection.js'
import setDiffDeep from '../utils/setDiffDeep.js'
import { getIdFieldsForSegments, stripIdFields } from './idFields.js'
import { emitModelChange, isModelEventsEnabled } from './Compat/modelEvents.js'

const ALLOW_PARTIAL_DOC_CREATION = false

export const dataTreeRaw = {}
const dataTree = observable(dataTreeRaw)

function shouldEmitModelEvents (tree) {
  return tree === dataTree && isModelEventsEnabled()
}

function emitModelEvent (segments, prevValue, meta, tree = dataTree) {
  if (!shouldEmitModelEvents(tree)) return
  const value = getRaw(segments)
  emitModelChange(segments, value, prevValue, meta)
}

export function get (segments, tree = dataTree) {
  let dataNode = tree
  for (const segment of segments) {
    if (dataNode == null) return dataNode
    dataNode = dataNode[segment]
  }
  return dataNode
}

export function getRaw (segments) {
  return get(segments, dataTreeRaw)
}

export function set (segments, value, tree = dataTree) {
  const shouldEmit = shouldEmitModelEvents(tree)
  const prevValue = shouldEmit ? getRaw(segments) : undefined
  let dataNode = tree
  let dataNodeRaw = raw(tree)
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]
    if (dataNode[segment] == null) {
      // if next segment is a number, it means that we are in the array
      if (typeof segments[i + 1] === 'number') dataNode[segment] = []
      else dataNode[segment] = {}
    }
    dataNode = dataNode[segment]
    dataNodeRaw = dataNodeRaw[segment]
  }
  const key = segments[segments.length - 1]
  // handle adding out of bounds empty element to the array
  if (value == null && Array.isArray(dataNodeRaw) && key >= dataNodeRaw.length) {
    // inject new undefined elements to the end of the array
    dataNode.splice(dataNodeRaw.length, key - dataNodeRaw.length + 1,
      ...Array(key - dataNodeRaw.length + 1).fill(undefined))
    return
  }
  // handle when the value didn't change
  if (value === dataNodeRaw[key]) return
  // handle setting undefined value
  if (value == null) {
    if (Array.isArray(dataNodeRaw)) {
      // if parent is an array -- we set array element to undefined
      // IMPORTANT: JSON serialization will replace `undefined` with `null`
      //            so if the data will go to the server, it will be serialized as `null`.
      //            And when it comes back from the server it will be still `null`.
      //            This can lead to confusion since when you set `undefined` the value
      //            might end up becoming `null` for seemingly no reason (like in this case).
      dataNode[key] = undefined
    } else {
      // if parent is an object -- we completely delete the property.
      // Deleting the property is better for the JSON serialization
      // since JSON does not have `undefined` values and replaces them with `null`.
      delete dataNode[key]
    }
    emitModelEvent(segments, prevValue, { op: 'set' }, tree)
    return
  }
  // instead of just setting the new value `dataNode[key] = value` we want
  // to deeply update it to prevent unnecessary reactivity triggers.
  const newValue = setDiffDeep(dataNode[key], value)
  // handle case when the value couldn't be updated in place and is completely new
  // (we just set it to this value)
  if (dataNode[key] !== newValue) dataNode[key] = newValue
  emitModelEvent(segments, prevValue, { op: 'set' }, tree)
}

// Like set(), but always assigns the value without equality checks or delete-on-null behavior
export function setReplace (segments, value, tree = dataTree) {
  const shouldEmit = shouldEmitModelEvents(tree)
  const prevValue = shouldEmit ? getRaw(segments) : undefined
  let dataNode = tree
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]
    if (dataNode[segment] == null) {
      // if next segment is a number, it means that we are in the array
      if (typeof segments[i + 1] === 'number') dataNode[segment] = []
      else dataNode[segment] = {}
    }
    dataNode = dataNode[segment]
  }
  const key = segments[segments.length - 1]
  dataNode[key] = value
  emitModelEvent(segments, prevValue, { op: 'setReplace' }, tree)
}

export function del (segments, tree = dataTree) {
  const shouldEmit = shouldEmitModelEvents(tree)
  const prevValue = shouldEmit ? getRaw(segments) : undefined
  let dataNode = tree
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]
    if (dataNode[segment] == null) return
    dataNode = dataNode[segment]
  }
  if (Array.isArray(dataNode)) {
    // remove the element from the array
    const index = segments[segments.length - 1]
    if (index >= dataNode.length) return
    dataNode.splice(index, 1)
  } else {
    // remove the property from the object
    const key = segments[segments.length - 1]
    if (!Object.prototype.hasOwnProperty.call(dataNode, key)) return
    delete dataNode[key]
  }
  emitModelEvent(segments, prevValue, { op: 'del' }, tree)
}

export async function setPublicDoc (segments, value, deleteValue = false) {
  if (segments.length === 0) throw Error(ERRORS.publicDoc(segments))
  if (segments.length === 1) {
    // set multiple documents at the same time
    if (typeof value !== 'object') throw Error(ERRORS.notObjectCollection(segments, value))
    for (const docId in value) {
      await setPublicDoc([segments[0], docId], value[docId])
    }
  }
  const [collection, docId] = segments
  if (typeof docId === 'number') throw Error(ERRORS.publicDocIdNumber(segments))
  if (docId === 'undefined') throw Error(ERRORS.publicDocIdUndefined(segments))
  if (!(collection && docId)) throw Error(ERRORS.publicDoc(segments))
  const idFields = getIdFieldsForSegments([collection, docId])
  if (segments.length >= 3 && idFields.includes(segments[segments.length - 1])) return
  const doc = getConnection().get(collection, docId)
  if (!doc.data && deleteValue) throw Error(ERRORS.deleteNonExistentDoc(segments))
  // make sure that the value is not observable to not trigger extra reads. And clone it
  value = raw(value)
  if (value == null) {
    value = undefined
  } else {
    value = JSON.parse(JSON.stringify(value))
    value = stripIdFields(value, idFields)
  }
  if (segments.length === 2 && !doc.data) {
    // > create a new doc. Full doc data is provided
    if (typeof value !== 'object') throw Error(ERRORS.notObject(segments, value))
    const newDoc = value
    return new Promise((resolve, reject) => {
      doc.create(newDoc, err => err ? reject(err) : resolve())
    })
  } else if (!doc.data) {
    // >> create a new doc. Partial doc data is provided (subpath)
    // NOTE: We throw an error when trying to set a subpath on a non-existing doc
    //       to prevent potential mistakes. In future we might allow it though.
    if (!ALLOW_PARTIAL_DOC_CREATION) throw Error(ERRORS.partialDocCreation(segments, value))
    const newDoc = {}
    set(segments.slice(2), value, newDoc)
    return new Promise((resolve, reject) => {
      doc.create(newDoc, err => err ? reject(err) : resolve())
    })
  } else if (segments.length === 2 && (deleteValue || value == null)) {
    // > delete doc
    return new Promise((resolve, reject) => {
      doc.del(err => err ? reject(err) : resolve())
    })
  } else if (segments.length === 2) {
    // > modify existing doc. Full doc modification
    if (typeof value !== 'object') throw Error(ERRORS.notObject(segments, value))
    const oldDoc = stripIdFields(getRaw([collection, docId]), idFields)
    const diff = jsonDiff(oldDoc, value, diffMatchPatch)
    return new Promise((resolve, reject) => {
      doc.submitOp(diff, err => err ? reject(err) : resolve())
    })
  } else {
    // > modify existing doc. Partial doc modification
    const oldDoc = getRaw([collection, docId])
    const newDoc = JSON.parse(JSON.stringify(oldDoc))
    if (deleteValue) {
      del(segments.slice(2), newDoc)
    } else {
      set(segments.slice(2), value, newDoc)
    }
    const diff = jsonDiff(oldDoc, newDoc, diffMatchPatch)
    return new Promise((resolve, reject) => {
      doc.submitOp(diff, err => err ? reject(err) : resolve())
    })
  }
}

export async function setPublicDocReplace (segments, value) {
  if (segments.length === 0) throw Error(ERRORS.publicDoc(segments))
  if (segments.length === 1) {
    // set multiple documents at the same time
    if (typeof value !== 'object') throw Error(ERRORS.notObjectCollection(segments, value))
    for (const docId in value) {
      await setPublicDocReplace([segments[0], docId], value[docId])
    }
  }
  const [collection, docId] = segments
  if (typeof docId === 'number') throw Error(ERRORS.publicDocIdNumber(segments))
  if (docId === 'undefined') throw Error(ERRORS.publicDocIdUndefined(segments))
  if (!(collection && docId)) throw Error(ERRORS.publicDoc(segments))
  const idFields = getIdFieldsForSegments([collection, docId])
  if (segments.length >= 3 && idFields.includes(segments[segments.length - 1])) return
  const doc = getConnection().get(collection, docId)
  // make sure that the value is not observable to not trigger extra reads. And clone it
  value = raw(value)
  if (value != null) {
    value = JSON.parse(JSON.stringify(value))
    value = stripIdFields(value, idFields)
  }

  if (!doc.data) {
    if (segments.length === 2) {
      // > create a new doc. Full doc data is provided
      if (typeof value !== 'object') throw Error(ERRORS.notObject(segments, value))
      const newDoc = value
      return new Promise((resolve, reject) => {
        doc.create(newDoc, err => err ? reject(err) : resolve())
      })
    }
    // >> create a new doc. Partial doc data is provided (subpath)
    // NOTE: We throw an error when trying to set a subpath on a non-existing doc
    //       to prevent potential mistakes. In future we might allow it though.
    if (!ALLOW_PARTIAL_DOC_CREATION) throw Error(ERRORS.partialDocCreation(segments, value))
    const newDoc = {}
    setReplace(segments.slice(2), value, newDoc)
    return new Promise((resolve, reject) => {
      doc.create(newDoc, err => err ? reject(err) : resolve())
    })
  }

  const relativePath = segments.slice(2)
  const previous = getRaw(segments)
  const normalizedPrevious = normalizeUndefined(stripIdFields(previous, idFields))
  const normalizedValue = normalizeUndefined(value)
  let op
  if (relativePath.length === 0) {
    op = [{ p: [], od: normalizedPrevious, oi: normalizedValue }]
  } else if (typeof relativePath[relativePath.length - 1] === 'number') {
    op = [{ p: relativePath, ld: normalizedPrevious, li: normalizedValue }]
  } else {
    op = [{ p: relativePath, od: normalizedPrevious, oi: normalizedValue }]
  }
  return new Promise((resolve, reject) => {
    doc.submitOp(op, err => err ? reject(err) : resolve())
  })
}

function normalizeUndefined (value) {
  return value === undefined ? null : value
}

function normalizeValueForOp (value) {
  let result = raw(value)
  if (result != null && typeof result === 'object') result = JSON.parse(JSON.stringify(result))
  return result
}

function getArrayNode (segments, tree = dataTree, create = true) {
  let dataNode = tree
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    if (dataNode[segment] == null) {
      if (!create) return
      const next = segments[i + 1]
      dataNode[segment] = typeof next === 'number' ? [] : {}
    }
    dataNode = dataNode[segment]
  }
  if (dataNode == null) return
  if (!Array.isArray(dataNode)) {
    throw Error(`Expected array at ${segments.join('.')}`)
  }
  return dataNode
}

export function arrayPush (segments, value, tree = dataTree) {
  const arr = getArrayNode(segments, tree, true)
  const index = arr.length
  const result = arr.push(value)
  emitModelEvent(segments.concat(index), undefined, { op: 'arrayPush', index }, tree)
  return result
}

export function arrayUnshift (segments, value, tree = dataTree) {
  const arr = getArrayNode(segments, tree, true)
  const result = arr.unshift(value)
  emitModelEvent(segments.concat(0), undefined, { op: 'arrayUnshift', index: 0 }, tree)
  return result
}

export function arrayInsert (segments, index, values, tree = dataTree) {
  const arr = getArrayNode(segments, tree, true)
  const inserted = Array.isArray(values) ? values : [values]
  arr.splice(index, 0, ...inserted)
  for (let i = 0; i < inserted.length; i++) {
    emitModelEvent(segments.concat(index + i), undefined, { op: 'arrayInsert', index: index + i }, tree)
  }
  return arr.length
}

export function arrayPop (segments, tree = dataTree) {
  const arr = getArrayNode(segments, tree, true)
  if (!arr.length) return
  const index = arr.length - 1
  const previous = arr.pop()
  emitModelEvent(segments.concat(index), previous, { op: 'arrayPop', index }, tree)
  return previous
}

export function arrayShift (segments, tree = dataTree) {
  const arr = getArrayNode(segments, tree, true)
  if (!arr.length) return
  const previous = arr.shift()
  emitModelEvent(segments.concat(0), previous, { op: 'arrayShift', index: 0 }, tree)
  return previous
}

export function arrayRemove (segments, index, howMany = 1, tree = dataTree) {
  const arr = getArrayNode(segments, tree, true)
  const removed = arr.splice(index, howMany)
  for (let i = 0; i < removed.length; i++) {
    emitModelEvent(segments.concat(index + i), removed[i], { op: 'arrayRemove', index: index + i, howMany }, tree)
  }
  return removed
}

export function arrayMove (segments, from, to, howMany = 1, tree = dataTree) {
  const arr = getArrayNode(segments, tree, true)
  const prevValue = shouldEmitModelEvents(tree) ? arr.slice() : undefined
  const len = arr.length
  if (from < 0) from += len
  if (to < 0) to += len
  const moved = arr.splice(from, howMany)
  arr.splice(to, 0, ...moved)
  emitModelEvent(segments, prevValue, { op: 'arrayMove', from, to, howMany }, tree)
  return moved
}

export async function incrementPublic (segments, byNumber) {
  if (segments.length === 0) throw Error(ERRORS.publicDoc(segments))
  const [collection, docId] = segments
  if (typeof docId === 'number') throw Error(ERRORS.publicDocIdNumber(segments))
  if (docId === 'undefined') throw Error(ERRORS.publicDocIdUndefined(segments))
  if (!(collection && docId)) throw Error(ERRORS.publicDoc(segments))
  const doc = getConnection().get(collection, docId)
  const relativePath = segments.slice(2)
  const op = [{ p: relativePath, na: byNumber }]
  return new Promise((resolve, reject) => {
    doc.submitOp(op, err => err ? reject(err) : resolve())
  })
}

export async function arrayPushPublic (segments, value) {
  const arr = getRaw(segments) || []
  const index = arr.length
  return arrayInsertPublic(segments, index, [value])
}

export async function arrayUnshiftPublic (segments, value) {
  return arrayInsertPublic(segments, 0, [value])
}

export async function arrayInsertPublic (segments, index, values) {
  if (segments.length === 0) throw Error(ERRORS.publicDoc(segments))
  const [collection, docId] = segments
  if (typeof docId === 'number') throw Error(ERRORS.publicDocIdNumber(segments))
  if (docId === 'undefined') throw Error(ERRORS.publicDocIdUndefined(segments))
  if (!(collection && docId)) throw Error(ERRORS.publicDoc(segments))
  const doc = getConnection().get(collection, docId)
  const inserted = Array.isArray(values) ? values : [values]
  const baseLength = (getRaw(segments) || []).length
  const relativePath = segments.slice(2)
  let i = index
  const op = inserted.map(value => ({
    p: relativePath.concat(i++),
    li: normalizeUndefined(normalizeValueForOp(value))
  }))
  return new Promise((resolve, reject) => {
    doc.submitOp(op, err => err ? reject(err) : resolve(baseLength + inserted.length))
  })
}

export async function arrayPopPublic (segments) {
  const arr = getRaw(segments) || []
  if (!arr.length) return
  const index = arr.length - 1
  const value = arr[index]
  await arrayRemovePublic(segments, index, 1)
  return value
}

export async function arrayShiftPublic (segments) {
  const arr = getRaw(segments) || []
  if (!arr.length) return
  const value = arr[0]
  await arrayRemovePublic(segments, 0, 1)
  return value
}

export async function arrayRemovePublic (segments, index, howMany = 1) {
  if (segments.length === 0) throw Error(ERRORS.publicDoc(segments))
  const [collection, docId] = segments
  if (typeof docId === 'number') throw Error(ERRORS.publicDocIdNumber(segments))
  if (docId === 'undefined') throw Error(ERRORS.publicDocIdUndefined(segments))
  if (!(collection && docId)) throw Error(ERRORS.publicDoc(segments))
  const doc = getConnection().get(collection, docId)
  const arr = getRaw(segments) || []
  const removed = arr.slice(index, index + howMany)
  const op = removed.map(value => ({ p: segments.slice(2).concat(index), ld: normalizeUndefined(value) }))
  return new Promise((resolve, reject) => {
    doc.submitOp(op, err => err ? reject(err) : resolve(removed))
  })
}

export async function arrayMovePublic (segments, from, to, howMany = 1) {
  if (segments.length === 0) throw Error(ERRORS.publicDoc(segments))
  const [collection, docId] = segments
  if (typeof docId === 'number') throw Error(ERRORS.publicDocIdNumber(segments))
  if (docId === 'undefined') throw Error(ERRORS.publicDocIdUndefined(segments))
  if (!(collection && docId)) throw Error(ERRORS.publicDoc(segments))
  const doc = getConnection().get(collection, docId)
  const arr = getRaw(segments) || []
  const len = arr.length
  if (from < 0) from += len
  if (to < 0) to += len
  const moved = arr.slice(from, from + howMany)
  const op = []
  for (let i = 0; i < howMany; i++) {
    op.push({ p: segments.slice(2).concat(from < to ? from : from + howMany - 1), lm: from < to ? to + howMany - 1 : to })
  }
  return new Promise((resolve, reject) => {
    doc.submitOp(op, err => err ? reject(err) : resolve(moved))
  })
}

export function stringInsertLocal (segments, index, text, tree = dataTree) {
  let dataNode = tree
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]
    if (dataNode[segment] == null) {
      dataNode[segment] = typeof segments[i + 1] === 'number' ? [] : {}
    }
    dataNode = dataNode[segment]
  }
  const key = segments[segments.length - 1]
  const previous = dataNode[key]
  if (previous == null) {
    dataNode[key] = text
    emitModelEvent(segments, previous, { op: 'stringInsert', index }, tree)
    return previous
  }
  if (typeof previous !== 'string') {
    throw Error(`Expected string at ${segments.join('.')}`)
  }
  dataNode[key] = previous.slice(0, index) + text + previous.slice(index)
  emitModelEvent(segments, previous, { op: 'stringInsert', index }, tree)
  return previous
}

export function stringRemoveLocal (segments, index, howMany, tree = dataTree) {
  let dataNode = tree
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]
    if (dataNode[segment] == null) return
    dataNode = dataNode[segment]
  }
  const key = segments[segments.length - 1]
  const previous = dataNode[key]
  if (previous == null) return previous
  if (typeof previous !== 'string') {
    throw Error(`Expected string at ${segments.join('.')}`)
  }
  dataNode[key] = previous.slice(0, index) + previous.slice(index + howMany)
  emitModelEvent(segments, previous, { op: 'stringRemove', index, howMany }, tree)
  return previous
}

export async function stringInsertPublic (segments, index, text) {
  if (segments.length === 0) throw Error(ERRORS.publicDoc(segments))
  const [collection, docId] = segments
  if (typeof docId === 'number') throw Error(ERRORS.publicDocIdNumber(segments))
  if (docId === 'undefined') throw Error(ERRORS.publicDocIdUndefined(segments))
  if (!(collection && docId)) throw Error(ERRORS.publicDoc(segments))
  const doc = getConnection().get(collection, docId)
  const relativePath = segments.slice(2)
  const previous = getRaw(segments)
  if (previous == null) {
    await setPublicDocReplace(segments, text)
    return previous
  }
  if (typeof previous !== 'string') throw Error(`Expected string at ${segments.join('.')}`)
  const op = [{ p: relativePath.concat(index), si: text }]
  return new Promise((resolve, reject) => {
    doc.submitOp(op, err => err ? reject(err) : resolve(previous))
  })
}

export async function stringRemovePublic (segments, index, howMany) {
  if (segments.length === 0) throw Error(ERRORS.publicDoc(segments))
  const [collection, docId] = segments
  if (typeof docId === 'number') throw Error(ERRORS.publicDocIdNumber(segments))
  if (docId === 'undefined') throw Error(ERRORS.publicDocIdUndefined(segments))
  if (!(collection && docId)) throw Error(ERRORS.publicDoc(segments))
  const doc = getConnection().get(collection, docId)
  const relativePath = segments.slice(2)
  const previous = getRaw(segments)
  if (previous == null) return previous
  if (typeof previous !== 'string') throw Error(`Expected string at ${segments.join('.')}`)
  const removed = previous.slice(index, index + howMany)
  const op = [{ p: relativePath.concat(index), sd: removed }]
  return new Promise((resolve, reject) => {
    doc.submitOp(op, err => err ? reject(err) : resolve(previous))
  })
}

export default dataTree

const ERRORS = {
  publicDoc: segments => `Public doc should have collection and docId. Got: ${segments}`,
  nonExistingDoc: segments => `
    Trying to modify a non-existing doc ${segments}.
    Make sure you have subscribed to the doc before modifying it OR creating it.
  `,
  notObject: (segments, value) => `
    Trying to set a non-object value to a public doc ${segments}.
    Value: ${value}
  `,
  notObjectCollection: (segments, value) => `
    Trying to set multiple documents for the collection but the value passed is not an object.
    Path: ${segments}
    Value: ${value}
  `,
  publicDocIdNumber: segments => `
    Public doc id must be a string. Got a number: ${segments}
  `,
  deleteNonExistentDoc: segments => `
    Trying to delete data from a non-existing doc ${segments}.
    Make sure that the document exists and you are subscribed to it
    before trying to delete anything from it or the doc itself.
  `,
  publicDocIdUndefined: segments => `
    Trying to modify a public document with the id 'undefined'.
    It's most likely a bug in your code and the variable you are using to store
    the document id is not initialized correctly.
    Got path: ${segments}
  `,
  partialDocCreation: (segments, value) => `
    Can't set a value to a subpath of a document which doesn't exist.

    You have probably forgotten to subscribe to the document.
    You MUST subscribe to an existing document with 'sub()' before trying to modify it.

    If instead you want to create a new document, you must provide the full data for it
    and set it for the $.collection.docId signal.

    Path: ${segments}
    Value: ${value}
  `
}
