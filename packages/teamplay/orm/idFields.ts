import { findModel } from './addModel.ts'
import type { PathSegment } from './types/path.ts'

export type IdField = string
export type IdFields = readonly IdField[]
export type PlainObject = Record<string, unknown>

export const DEFAULT_ID_FIELDS = ['_id'] as const

interface IdPayload extends PlainObject {
  id?: PathSegment | null
  _id?: PathSegment | null
}

interface IdFieldModel {
  ID_FIELDS?: IdFields
}

export function getIdFieldsForSegments (segments: PathSegment[]): IdFields {
  const Model = findModel(segments) as IdFieldModel | undefined
  return Model?.ID_FIELDS || DEFAULT_ID_FIELDS
}

export function isPlainObject (value: unknown): value is PlainObject {
  if (!value || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

export function injectIdFields<TValue> (
  value: TValue,
  idFields: IdFields,
  docId: PathSegment
): TValue {
  if (!isPlainObject(value)) return value
  const object = value as PlainObject
  for (const field of idFields) object[field] = docId
  return value
}

export function normalizeIdFields<TValue> (
  value: TValue,
  idFields: IdFields,
  docId: PathSegment
): TValue {
  if (!isPlainObject(value)) return value
  let next: PlainObject = value
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
  return next as TValue
}

export function stripIdFields<TValue> (
  value: TValue,
  idFields: IdFields
): TValue {
  if (!isPlainObject(value)) return value
  let next: PlainObject = value
  let changed = false
  for (const field of idFields) {
    if (!(field in next)) continue
    if (!changed) {
      next = { ...next }
      changed = true
    }
    delete next[field]
  }
  return next as TValue
}

export function resolveAddDocId (
  value: unknown,
  getDefaultId: () => string
): PathSegment {
  if (!value || typeof value !== 'object') throw Error('Signal.add() expects an object argument')
  const payload = value as IdPayload
  const hasId = payload.id != null
  const hasUnderscoreId = payload._id != null
  if (hasId && hasUnderscoreId && payload.id !== payload._id) {
    throw Error(
      `Signal.add() got conflicting "id" (${JSON.stringify(payload.id)}) and "_id" (${JSON.stringify(payload._id)})`
    )
  }
  return payload.id ?? payload._id ?? getDefaultId()
}

export function prepareAddPayload<TValue extends object> (
  value: TValue,
  idFields: IdFields,
  docId: PathSegment
): TValue {
  const payload = value as IdPayload
  if (idFields.includes('_id')) payload._id = docId
  if (idFields.includes('id')) {
    payload.id = docId
  } else if (payload.id === docId) {
    delete payload.id
  }
  return value
}

export function isPublicDocPath (segments: unknown): segments is [string, PathSegment] {
  if (!Array.isArray(segments) || segments.length !== 2) return false
  const [collection, docId] = segments
  if (typeof collection !== 'string' || !collection) return false
  if (collection[0] === '_' || collection[0] === '$') return false
  return docId != null
}

export function isIdFieldPath (
  segments: unknown,
  idFields: IdFields
): segments is [string, PathSegment, string] {
  if (!Array.isArray(segments) || segments.length !== 3) return false
  if (!isPublicDocPath(segments.slice(0, 2))) return false
  const last = segments[2]
  return typeof last === 'string' && idFields.includes(last)
}
