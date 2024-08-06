import isPlainObject from 'lodash/isPlainObject.js'

export default function setDiffDeep (existing, updated) {
  // Handle primitive types, null, and type mismatches
  if (existing === null || updated === null ||
      typeof existing !== 'object' || typeof updated !== 'object' ||
      Array.isArray(existing) !== Array.isArray(updated)) {
    return updated
  }

  // Handle arrays
  if (Array.isArray(updated)) {
    existing.length = updated.length
    for (let i = 0; i < updated.length; i++) {
      existing[i] = setDiffDeep(existing[i], updated[i])
    }
    return existing
  }

  // Handle non-plain objects - just return them as-is to fully overwrite
  // and don't try to update an old object in-place
  if (!isPlainObject(updated)) {
    return updated
  }

  // Handle objects
  for (const key in existing) {
    if (!(key in updated)) {
      delete existing[key]
    }
  }
  for (const key in updated) {
    existing[key] = setDiffDeep(existing[key], updated[key])
  }
  return existing
}
