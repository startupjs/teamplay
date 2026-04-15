import { observable, raw } from '@nx-js/observer-util'
import jsonDiff from 'json0-ot-diff'
import diffMatchPatch from 'diff-match-patch'
import { getConnection } from './connection.js'
import setDiffDeep from '../utils/setDiffDeep.js'
import { getIdFieldsForSegments, injectIdFields, stripIdFields, isPlainObject, isIdFieldPath } from './idFields.js'
import { emitModelChange, isModelEventsEnabled } from './Compat/modelEvents.js'
import { isSilentContextActive } from './Compat/silentContext.js'
import { isCompatEnv } from './compatEnv.js'
import { isMissingShareDoc } from './missingDoc.js'
import {
  getLogicalRootSnapshot as getLogicalRootSnapshotFromTree
} from './rootScope.js'
import { getRootContext } from './rootContext.js'
export { isPrivateCollectionSegments } from './rootScope.js'

const ALLOW_PARTIAL_DOC_CREATION = false

export const dataTreeRaw = {}
const dataTree = observable(dataTreeRaw)

function getWritableTree (tree) {
  if (isSilentContextActive()) return getTreeRaw(tree)
  return tree
}

function getTreeRaw (tree) {
  if (tree === dataTree) return dataTreeRaw
  return raw(tree) || tree
}

function shouldEmitModelEvents (tree, eventContext) {
  return (tree === dataTree || eventContext?.rootId != null) &&
    isModelEventsEnabled() &&
    !isSilentContextActive()
}

function emitModelEvent (segments, prevValue, meta, tree = dataTree, eventContext) {
  if (!shouldEmitModelEvents(tree, eventContext)) return
  const treeRaw = getTreeRaw(tree)
  const value = get(segments, treeRaw)
  const logicalSegments = eventContext?.logicalSegments || segments
  const modelEventMeta = eventContext?.rootId != null
    ? { ...meta, rootId: eventContext.rootId }
    : meta
  emitModelChange(logicalSegments, value, prevValue, modelEventMeta)
}

export function resolveStorageSegments (rootId, logicalSegments) {
  return logicalSegments
}

export function getLogicalRootSnapshot (rootId, tree = dataTree) {
  const privateDataRoot = getRootContext(rootId, false)?.getPrivateDataRoot()
  return getLogicalRootSnapshotFromTree(rootId, tree, privateDataRoot)
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

export function set (segments, value, tree = dataTree, eventContext) {
  const writableTree = getWritableTree(tree)
  const shouldEmit = shouldEmitModelEvents(tree, eventContext)
  const prevValue = shouldEmit ? get(segments, getTreeRaw(tree)) : undefined
  let dataNode = writableTree
  let dataNodeRaw = getTreeRaw(writableTree)
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]
    const nextSegment = segments[i + 1]
    const currentValue = dataNodeRaw?.[segment]
    if (currentValue == null || typeof currentValue !== 'object') {
      // if next segment is a number, it means that we are in the array
      if (typeof nextSegment === 'number') dataNode[segment] = []
      else dataNode[segment] = {}
    }
    dataNode = dataNode[segment]
    dataNodeRaw = getTreeRaw(dataNode)
  }
  const key = segments[segments.length - 1]
  const keyExists = hasOwnDataKey(dataNodeRaw, key)
  // Preserve racer local semantics: assigning undefined creates/keeps the slot/key
  // instead of deleting it, and sparse array writes keep holes intact.
  if (keyExists && value === dataNodeRaw[key]) return
  if (value == null || typeof value !== 'object') {
    dataNode[key] = value
    emitModelEvent(segments, prevValue, { op: 'set' }, tree, eventContext)
    return
  }
  // instead of just setting the new value `dataNode[key] = value` we want
  // to deeply update it to prevent unnecessary reactivity triggers.
  const newValue = setDiffDeep(dataNode[key], value)
  // handle case when the value couldn't be updated in place and is completely new
  // (we just set it to this value)
  if (dataNode[key] !== newValue) dataNode[key] = newValue
  emitModelEvent(segments, prevValue, { op: 'set' }, tree, eventContext)
}

function hasOwnDataKey (node, key) {
  if (node == null) return false
  if (Array.isArray(node)) return key in node
  return Object.prototype.hasOwnProperty.call(node, key)
}

// Like set(), but always assigns the value without equality checks or delete-on-null behavior
export function setReplace (segments, value, tree = dataTree, eventContext) {
  const writableTree = getWritableTree(tree)
  const shouldEmit = shouldEmitModelEvents(tree, eventContext)
  const prevValue = shouldEmit ? get(segments, getTreeRaw(tree)) : undefined
  let dataNode = writableTree
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]
    const nextSegment = segments[i + 1]
    const currentValue = dataNode[segment]
    if (currentValue == null || typeof currentValue !== 'object') {
      // if next segment is a number, it means that we are in the array
      if (typeof nextSegment === 'number') dataNode[segment] = []
      else dataNode[segment] = {}
    }
    dataNode = dataNode[segment]
  }
  const key = segments[segments.length - 1]
  dataNode[key] = value
  emitModelEvent(segments, prevValue, { op: 'setReplace' }, tree, eventContext)
}

export function del (segments, tree = dataTree, eventContext) {
  const writableTree = getWritableTree(tree)
  const shouldEmit = shouldEmitModelEvents(tree, eventContext)
  const prevValue = shouldEmit ? get(segments, getTreeRaw(tree)) : undefined
  let dataNode = writableTree
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
  emitModelEvent(segments, prevValue, { op: 'del' }, tree, eventContext)
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
  if (isIdFieldPath(segments, idFields)) return
  const doc = getConnection().get(collection, docId)
  let docState = resolvePublicDocState({ collection, docId, doc, idFields, hydrateCompatDocData: true })
  if (!docState.exists && segments.length > 2) {
    docState = await resolvePublicDocStateWithCompatFetchFallback({
      collection,
      docId,
      doc,
      idFields,
      hydrateCompatDocData: true
    })
  }
  if (!docState.exists && deleteValue) throw Error(ERRORS.deleteNonExistentDoc(segments))
  // make sure that the value is not observable to not trigger extra reads. And clone it
  value = raw(value)
  if (value == null) {
    value = undefined
  } else {
    value = JSON.parse(JSON.stringify(value))
    // Only strip doc identity fields when writing the whole doc.
    // Nested payloads like `fields.fieldId.media = { id: ... }` must preserve
    // their own `id/_id` keys.
    if (segments.length === 2) value = stripIdFields(value, idFields)
  }
  if (segments.length === 2 && !docState.exists) {
    // > create a new doc. Full doc data is provided
    if (typeof value !== 'object') throw Error(ERRORS.notObject(segments, value))
    const newDoc = value
    return createPublicDocAndHydrateLocal({
      doc,
      collection,
      docId,
      newDoc,
      idFields
    })
  } else if (!docState.exists) {
    // >> create a new doc. Partial doc data is provided (subpath)
    // NOTE: We throw an error when trying to set a subpath on a non-existing doc
    //       to prevent potential mistakes. In future we might allow it though.
    if (!ALLOW_PARTIAL_DOC_CREATION) throw Error(ERRORS.partialDocCreation(segments, value))
    const newDoc = {}
    set(segments.slice(2), value, newDoc)
    return createPublicDocAndHydrateLocal({
      doc,
      collection,
      docId,
      newDoc,
      idFields
    })
  } else if (segments.length === 2 && (deleteValue || value == null)) {
    // > delete doc
    return new Promise((resolve, reject) => {
      doc.del(err => err ? reject(err) : resolve())
    })
  } else if (segments.length === 2) {
    // > modify existing doc. Full doc modification
    if (typeof value !== 'object') throw Error(ERRORS.notObject(segments, value))
    const oldDoc = stripIdFields(docState.snapshot || {}, idFields)
    const diff = jsonDiff(oldDoc, value, diffMatchPatch)
    return new Promise((resolve, reject) => {
      doc.submitOp(diff, err => err ? reject(err) : resolve())
    })
  } else {
    // > modify existing doc. Partial doc modification
    const oldDoc = docState.snapshot || {}
    const newDoc = JSON.parse(JSON.stringify(oldDoc))
    if (deleteValue) {
      del(segments.slice(2), newDoc)
    } else {
      set(segments.slice(2), normalizeUndefined(value), newDoc)
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
  if (isIdFieldPath(segments, idFields)) return
  const doc = getConnection().get(collection, docId)
  let docState = resolvePublicDocState({ collection, docId, doc, idFields, hydrateCompatDocData: true })
  if (!docState.exists && segments.length > 2) {
    docState = await resolvePublicDocStateWithCompatFetchFallback({
      collection,
      docId,
      doc,
      idFields,
      hydrateCompatDocData: true
    })
  }
  // make sure that the value is not observable to not trigger extra reads. And clone it
  value = raw(value)
  if (value != null) {
    value = JSON.parse(JSON.stringify(value))
    // Same contract as setPublicDoc(): only doc-root writes should strip the
    // identity fields of the target document itself.
    if (segments.length === 2) value = stripIdFields(value, idFields)
  }

  if (!docState.exists) {
    if (segments.length === 2) {
      // > create a new doc. Full doc data is provided
      if (typeof value !== 'object') throw Error(ERRORS.notObject(segments, value))
      const newDoc = value
      return createPublicDocAndHydrateLocal({
        doc,
        collection,
        docId,
        newDoc,
        idFields
      })
    }
    // >> create a new doc. Partial doc data is provided (subpath)
    // NOTE: We throw an error when trying to set a subpath on a non-existing doc
    //       to prevent potential mistakes. In future we might allow it though.
    if (!ALLOW_PARTIAL_DOC_CREATION) throw Error(ERRORS.partialDocCreation(segments, value))
    const newDoc = {}
    setReplace(segments.slice(2), value, newDoc)
    return createPublicDocAndHydrateLocal({
      doc,
      collection,
      docId,
      newDoc,
      idFields
    })
  }

  const relativePath = segments.slice(2)
  // json0 direct replace ops require every ancestor container to already exist.
  // Racer-like compat set, however, materializes missing/primitive parents while
  // descending into the path. Fall back to the older diff-based path when the
  // direct op would target a non-existent/non-object ancestor.
  if (!canApplyDirectReplaceOp(docState.snapshot || {}, relativePath)) {
    return setPublicDoc(segments, value)
  }
  const previous = getRaw(segments)
  const normalizedPrevious = normalizeUndefined(
    relativePath.length === 0 ? stripIdFields(previous, idFields) : previous
  )
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
    doc.submitOp(op, err => {
      if (err) return reject(err)
      syncLocalDocAfterPublicWrite({
        collection,
        docId,
        doc,
        idFields,
        relativePath
      })
      resolve()
    })
  })
}

async function createPublicDocAndHydrateLocal ({
  doc,
  collection,
  docId,
  newDoc,
  idFields
}) {
  await new Promise((resolve, reject) => {
    doc.create(newDoc, err => err ? reject(err) : resolve())
  })

  // In compatibility mode we must allow immediate subpath writes after create()
  // even when the ShareDB snapshot hasn't been loaded via subscribe/fetch yet.
  if (isCompatEnv() && doc?.data == null) {
    const localDoc = JSON.parse(JSON.stringify(newDoc || {}))
    if (isPlainObject(localDoc)) injectIdFields(localDoc, idFields, docId)
    setReplace([collection, docId], localDoc)
    // Keep ShareDB doc shape consistent for same-tick setPublicDoc checks.
    doc.data = localDoc
    return
  }

  ensureLocalDocSyncedWithShareDoc({ collection, docId, doc, idFields })
}

function resolvePublicDocState ({
  collection,
  docId,
  doc,
  idFields,
  hydrateCompatDocData = false
}) {
  ensureLocalDocSyncedWithShareDoc({ collection, docId, doc, idFields })

  if (isMissingShareDoc(doc)) {
    return { exists: false, snapshot: undefined, source: 'none' }
  }

  if (doc?.data != null) {
    return {
      exists: true,
      snapshot: getRaw([collection, docId]) ?? raw(doc.data),
      source: 'share'
    }
  }

  const localSnapshot = getRaw([collection, docId])
  if (!(isCompatEnv() && localSnapshot != null)) {
    return { exists: false, snapshot: undefined, source: 'none' }
  }

  // In compat mode local raw data can be the source of truth between create/add
  // and later subpath mutations even if ShareDB doc.data is currently empty.
  if (hydrateCompatDocData) {
    doc.data = localSnapshot
  }

  return { exists: true, snapshot: localSnapshot, source: 'local' }
}

async function resolvePublicDocStateWithCompatFetchFallback ({
  collection,
  docId,
  doc,
  idFields,
  hydrateCompatDocData = false
}) {
  let docState = resolvePublicDocState({ collection, docId, doc, idFields, hydrateCompatDocData })
  if (docState.exists || !isCompatEnv()) return docState

  await new Promise((resolve, reject) => {
    doc.fetch(err => err ? reject(err) : resolve())
  })

  docState = resolvePublicDocState({ collection, docId, doc, idFields, hydrateCompatDocData })
  return docState
}

function ensureLocalDocSyncedWithShareDoc ({
  collection,
  docId,
  doc,
  idFields
}) {
  if (isMissingShareDoc(doc)) return
  if (doc?.data == null) return
  if (isPlainObject(doc.data)) injectIdFields(doc.data, idFields, docId)
  const shared = raw(doc.data)
  if (getRaw([collection, docId]) === shared) return
  setReplace([collection, docId], shared)
}

function syncLocalDocAfterPublicWrite ({
  collection,
  docId,
  doc,
  idFields,
  relativePath = []
}) {
  if (!Array.isArray(relativePath) || relativePath.length === 0) {
    ensureLocalDocSyncedWithShareDoc({ collection, docId, doc, idFields })
    return
  }
  if (isMissingShareDoc(doc)) return
  if (doc?.data == null) return
  const shared = raw(doc.data)
  const nextValue = get(relativePath, shared)
  setReplace([collection, docId, ...relativePath], clonePublicLocalSyncValue(nextValue))
}

function clonePublicLocalSyncValue (value) {
  const rawValue = raw(value)
  if (rawValue == null || typeof rawValue !== 'object') return rawValue
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(rawValue)
  }
  return JSON.parse(JSON.stringify(rawValue))
}

function normalizeUndefined (value) {
  return value === undefined ? null : value
}

function canApplyDirectReplaceOp (docSnapshot, relativePath) {
  if (relativePath.length === 0) return true
  let node = docSnapshot
  for (let i = 0; i < relativePath.length - 1; i++) {
    if (node == null || typeof node !== 'object') return false
    node = node[relativePath[i]]
  }
  return node != null && typeof node === 'object'
}

function normalizeValueForOp (value) {
  let result = raw(value)
  if (result != null && typeof result === 'object') result = JSON.parse(JSON.stringify(result))
  return result
}

function getArrayNode (segments, tree = dataTree, create = true) {
  let dataNode = getWritableTree(tree)
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    if (dataNode[segment] == null) {
      if (!create) return
      // Array mutators target the final segment as an array itself.
      // If the path is missing, initialize that final node to [].
      if (i === segments.length - 1) {
        dataNode[segment] = []
        dataNode = dataNode[segment]
        continue
      }
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

export function arrayPush (segments, value, tree = dataTree, eventContext) {
  const arr = getArrayNode(segments, tree, true)
  const index = arr.length
  const result = arr.push(value)
  emitModelEvent(segments.concat(index), undefined, { op: 'arrayPush', index }, tree, eventContext)
  return result
}

export function arrayUnshift (segments, value, tree = dataTree, eventContext) {
  const arr = getArrayNode(segments, tree, true)
  const result = arr.unshift(value)
  emitModelEvent(segments.concat(0), undefined, { op: 'arrayUnshift', index: 0 }, tree, eventContext)
  return result
}

export function arrayInsert (segments, index, values, tree = dataTree, eventContext) {
  const arr = getArrayNode(segments, tree, true)
  const inserted = Array.isArray(values) ? values : [values]
  arr.splice(index, 0, ...inserted)
  for (let i = 0; i < inserted.length; i++) {
    emitModelEvent(segments.concat(index + i), undefined, { op: 'arrayInsert', index: index + i }, tree, eventContext)
  }
  return arr.length
}

export function arrayPop (segments, tree = dataTree, eventContext) {
  const arr = getArrayNode(segments, tree, true)
  if (!arr.length) return
  const index = arr.length - 1
  const previous = arr.pop()
  emitModelEvent(segments.concat(index), previous, { op: 'arrayPop', index }, tree, eventContext)
  return previous
}

export function arrayShift (segments, tree = dataTree, eventContext) {
  const arr = getArrayNode(segments, tree, true)
  if (!arr.length) return
  const previous = arr.shift()
  emitModelEvent(segments.concat(0), previous, { op: 'arrayShift', index: 0 }, tree, eventContext)
  return previous
}

export function arrayRemove (segments, index, howMany = 1, tree = dataTree, eventContext) {
  const arr = getArrayNode(segments, tree, true)
  const removed = arr.splice(index, howMany)
  for (let i = 0; i < removed.length; i++) {
    emitModelEvent(segments.concat(index + i), removed[i], { op: 'arrayRemove', index: index + i, howMany }, tree, eventContext)
  }
  return removed
}

export function arrayMove (segments, from, to, howMany = 1, tree = dataTree, eventContext) {
  const arr = getArrayNode(segments, tree, true)
  const prevValue = shouldEmitModelEvents(tree, eventContext) ? arr.slice() : undefined
  const len = arr.length
  if (from < 0) from += len
  if (to < 0) to += len
  const moved = arr.splice(from, howMany)
  arr.splice(to, 0, ...moved)
  emitModelEvent(segments, prevValue, { op: 'arrayMove', from, to, howMany }, tree, eventContext)
  return moved
}

export async function incrementPublic (segments, byNumber) {
  if (segments.length === 0) throw Error(ERRORS.publicDoc(segments))
  const [collection, docId] = segments
  if (typeof docId === 'number') throw Error(ERRORS.publicDocIdNumber(segments))
  if (docId === 'undefined') throw Error(ERRORS.publicDocIdUndefined(segments))
  if (!(collection && docId)) throw Error(ERRORS.publicDoc(segments))
  const doc = getConnection().get(collection, docId)
  const idFields = getIdFieldsForSegments([collection, docId])
  const docState = await resolvePublicDocStateWithCompatFetchFallback({
    collection,
    docId,
    doc,
    idFields,
    hydrateCompatDocData: true
  })
  if (!docState.exists) throw Error(ERRORS.nonExistingDoc(segments))
  const current = getRaw(segments)
  if (current == null) {
    // Align with Racer's RemoteDoc.increment(): if the document exists but the
    // target path is missing/null, initialize the path with the increment value
    // instead of emitting a numeric-add op against a non-existing path.
    await setPublicDoc(segments, byNumber)
    return
  }
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
  const idFields = getIdFieldsForSegments([collection, docId])
  const docState = await resolvePublicDocStateWithCompatFetchFallback({
    collection,
    docId,
    doc,
    idFields,
    hydrateCompatDocData: true
  })
  if (!docState.exists) throw Error(ERRORS.nonExistingDoc(segments))
  let current = getRaw(segments)
  if (current == null) {
    // Ensure the array path exists before inserting
    await setPublicDoc(segments, [])
    current = getRaw(segments)
  }
  if (current != null && !Array.isArray(current)) {
    throw Error(`Expected array at ${segments.join('.')}`)
  }
  const inserted = Array.isArray(values) ? values : [values]
  const baseLength = (current || []).length
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
  const idFields = getIdFieldsForSegments([collection, docId])
  const docState = await resolvePublicDocStateWithCompatFetchFallback({
    collection,
    docId,
    doc,
    idFields,
    hydrateCompatDocData: true
  })
  if (!docState.exists) throw Error(ERRORS.nonExistingDoc(segments))
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
  const idFields = getIdFieldsForSegments([collection, docId])
  const docState = await resolvePublicDocStateWithCompatFetchFallback({
    collection,
    docId,
    doc,
    idFields,
    hydrateCompatDocData: true
  })
  if (!docState.exists) throw Error(ERRORS.nonExistingDoc(segments))
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

export function stringInsertLocal (segments, index, text, tree = dataTree, eventContext) {
  let dataNode = getWritableTree(tree)
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
    emitModelEvent(segments, previous, { op: 'stringInsert', index }, tree, eventContext)
    return previous
  }
  if (typeof previous !== 'string') {
    throw Error(`Expected string at ${segments.join('.')}`)
  }
  dataNode[key] = previous.slice(0, index) + text + previous.slice(index)
  emitModelEvent(segments, previous, { op: 'stringInsert', index }, tree, eventContext)
  return previous
}

export function stringRemoveLocal (segments, index, howMany, tree = dataTree, eventContext) {
  let dataNode = getWritableTree(tree)
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
  emitModelEvent(segments, previous, { op: 'stringRemove', index, howMany }, tree, eventContext)
  return previous
}

export async function stringInsertPublic (segments, index, text) {
  if (segments.length === 0) throw Error(ERRORS.publicDoc(segments))
  const [collection, docId] = segments
  if (typeof docId === 'number') throw Error(ERRORS.publicDocIdNumber(segments))
  if (docId === 'undefined') throw Error(ERRORS.publicDocIdUndefined(segments))
  if (!(collection && docId)) throw Error(ERRORS.publicDoc(segments))
  const doc = getConnection().get(collection, docId)
  const idFields = getIdFieldsForSegments([collection, docId])
  const docState = await resolvePublicDocStateWithCompatFetchFallback({
    collection,
    docId,
    doc,
    idFields,
    hydrateCompatDocData: true
  })
  if (!docState.exists) throw Error(ERRORS.nonExistingDoc(segments))
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
  const idFields = getIdFieldsForSegments([collection, docId])
  const docState = await resolvePublicDocStateWithCompatFetchFallback({
    collection,
    docId,
    doc,
    idFields,
    hydrateCompatDocData: true
  })
  if (!docState.exists) throw Error(ERRORS.nonExistingDoc(segments))
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
