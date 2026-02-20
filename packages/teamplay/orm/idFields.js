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

export function isIdFieldPath (segments, idFields) {
  if (segments.length < 3) return false
  const last = segments[segments.length - 1]
  return idFields.includes(last)
}
