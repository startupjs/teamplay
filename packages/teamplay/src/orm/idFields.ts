import { findModel } from './addModel.ts'
import type { PathSegment } from './types/path.ts'

export type IdField = string
export type IdFields = readonly IdField[]
export type PlainObject = Record<string, unknown>
export interface TeamplayRuntimeConfig {
  idFields?: IdFields | null
}

export const DEFAULT_ID_FIELDS = ['_id'] as const
export const TEAMPLAY_RUNTIME_CONFIG_SYMBOL = Symbol.for('teamplay.runtimeConfig')

interface IdPayload extends PlainObject {
}

interface IdFieldModel {
  ID_FIELDS?: IdFields
}

export function getIdFieldsForSegments (segments: PathSegment[]): IdFields {
  const Model = findModel(segments) as IdFieldModel | undefined
  return Model?.ID_FIELDS || getDefaultIdFields()
}

export function configureTeamplay ({
  idFields
}: TeamplayRuntimeConfig = {}): void {
  if (arguments.length === 0) return
  const config = getGlobalRuntimeConfig(true)
  const options = (arguments[0] || {}) as TeamplayRuntimeConfig
  if (Object.prototype.hasOwnProperty.call(options, 'idFields')) {
    config.idFields = idFields == null
      ? DEFAULT_ID_FIELDS
      : normalizeIdFieldsConfig(idFields)
  }
}

export function getTeamplayConfig (): Required<TeamplayRuntimeConfig> {
  return {
    idFields: getDefaultIdFields()
  }
}

export function getDefaultIdFields (): IdFields {
  const config = getGlobalRuntimeConfig(false)
  if (!config || !Object.prototype.hasOwnProperty.call(config, 'idFields')) {
    return DEFAULT_ID_FIELDS
  }
  if (config.idFields == null) return DEFAULT_ID_FIELDS
  const normalized = normalizeIdFieldsConfig(config.idFields)
  config.idFields = normalized
  return normalized
}

export function setDefaultIdFields (idFields: IdFields = DEFAULT_ID_FIELDS): void {
  getGlobalRuntimeConfig(true).idFields = normalizeIdFieldsConfig(idFields)
}

export function __resetTeamplayConfigForTests (): void {
  delete getGlobalRuntimeConfigHolder()[TEAMPLAY_RUNTIME_CONFIG_SYMBOL]
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
  idFields: IdFields,
  getDefaultId: () => string
): PathSegment {
  if (!value || typeof value !== 'object') throw Error('Signal.add() expects an object argument')
  const payload = value as IdPayload
  const entries = getAddIdEntries(payload, idFields)
  const [firstEntry] = entries
  const conflictEntry = firstEntry && entries.find(entry => entry.value !== firstEntry.value)
  if (firstEntry && conflictEntry) {
    throw Error(
      `Signal.add() got conflicting "${firstEntry.field}" (${JSON.stringify(firstEntry.value)}) ` +
      `and "${conflictEntry.field}" (${JSON.stringify(conflictEntry.value)}) id fields`
    )
  }
  return firstEntry?.value ?? getDefaultId()
}

export function prepareAddPayload<TValue extends object> (
  value: TValue,
  idFields: IdFields,
  docId: PathSegment
): TValue {
  const payload = value as IdPayload
  for (const field of idFields) payload[field] = docId
  for (const field of LEGACY_ADD_ID_FIELDS) {
    if (idFields.includes(field)) continue
    if (payload[field] === docId) delete payload[field]
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

function normalizeIdFieldsConfig (idFields: IdFields): IdFields {
  if (!Array.isArray(idFields)) {
    throw Error('Teamplay idFields config must be an array of field names')
  }
  const normalized: string[] = []
  for (const field of idFields) {
    if (typeof field !== 'string' || field.length === 0) {
      throw Error('Teamplay idFields config must contain only non-empty string field names')
    }
    if (!normalized.includes(field)) normalized.push(field)
  }
  if (normalized.length === 0) {
    throw Error('Teamplay idFields config must contain at least one field name')
  }
  return Object.freeze(normalized)
}

function getAddIdEntries (
  payload: IdPayload,
  idFields: IdFields
): Array<{ field: string, value: PathSegment }> {
  const fields = uniqueFields([...LEGACY_ADD_ID_FIELDS, ...idFields])
  const entries: Array<{ field: string, value: PathSegment }> = []
  for (const field of fields) {
    const value = payload[field]
    if (value == null) continue
    entries.push({ field, value: value as PathSegment })
  }
  return entries
}

function uniqueFields (fields: readonly string[]): string[] {
  const result: string[] = []
  for (const field of fields) {
    if (!result.includes(field)) result.push(field)
  }
  return result
}

function getGlobalRuntimeConfig (
  create: false
): TeamplayRuntimeConfig | undefined
function getGlobalRuntimeConfig (
  create?: true
): TeamplayRuntimeConfig
function getGlobalRuntimeConfig (create = true): TeamplayRuntimeConfig | undefined {
  const holder = getGlobalRuntimeConfigHolder()
  let config = holder[TEAMPLAY_RUNTIME_CONFIG_SYMBOL]
  if (config == null && create) {
    config = {}
    holder[TEAMPLAY_RUNTIME_CONFIG_SYMBOL] = config
  }
  if (config != null && (!isPlainObject(config))) {
    throw Error('Teamplay runtime config must be an object')
  }
  return config
}

function getGlobalRuntimeConfigHolder (): Record<symbol, TeamplayRuntimeConfig | undefined> {
  return globalThis as typeof globalThis & Record<symbol, TeamplayRuntimeConfig | undefined>
}

const LEGACY_ADD_ID_FIELDS = ['id', '_id'] as const
