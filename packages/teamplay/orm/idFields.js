import { findModel } from './addModel.js'

export const DEFAULT_ID_FIELDS = ['_id']

export function getIdFieldsForSegments (segments) {
  const Model = findModel(segments)
  return Model?.ID_FIELDS || DEFAULT_ID_FIELDS
}

export function isPlainObject (value) {
  if (!value || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

export function injectIdFields (value, idFields, docId) {
  if (!isPlainObject(value)) return value
  for (const field of idFields) value[field] = docId
  return value
}

export function normalizeIdFields (value, idFields, docId) {
  if (!isPlainObject(value)) return value
  let next = value
  let changed = false
  for (const field of idFields) {
    if (!(field in next)) continue
    if (next[field] === docId) continue
    if (!changed) {
      next = { ...next }
      changed = true
    }
    next[field] = docId
  }
  return next
}

export function stripIdFields (value, idFields) {
  if (!isPlainObject(value)) return value
  let next = value
  let changed = false
  for (const field of idFields) {
    if (!(field in next)) continue
    if (!changed) {
      next = { ...next }
      changed = true
    }
    delete next[field]
  }
  return next
}

export function resolveAddDocId (value, getDefaultId) {
  if (!value || typeof value !== 'object') throw Error('Signal.add() expects an object argument')
  const hasId = value.id != null
  const hasUnderscoreId = value._id != null
  if (hasId && hasUnderscoreId && value.id !== value._id) {
    throw Error(
      `Signal.add() got conflicting "id" (${JSON.stringify(value.id)}) and "_id" (${JSON.stringify(value._id)})`
    )
  }
  return value.id ?? value._id ?? getDefaultId()
}

export function prepareAddPayload (value, idFields, docId) {
  if (idFields.includes('_id')) value._id = docId
  if (idFields.includes('id')) {
    value.id = docId
  } else if (value.id === docId) {
    delete value.id
  }
  return value
}

export function isPublicDocPath (segments) {
  if (!Array.isArray(segments) || segments.length !== 2) return false
  const [collection, docId] = segments
  if (typeof collection !== 'string' || !collection) return false
  if (collection[0] === '_' || collection[0] === '$') return false
  return docId != null
}

export function isIdFieldPath (segments, idFields) {
  if (!Array.isArray(segments) || segments.length !== 3) return false
  if (!isPublicDocPath(segments.slice(0, 2))) return false
  const last = segments[2]
  return idFields.includes(last)
}
