import isPlainObject from 'lodash/isPlainObject.js'

function isReactLike (value) {
  return !!(value && typeof value === 'object' && typeof value.$$typeof === 'symbol')
}

function canDeepMutateObject (existing, updated) {
  if (!isPlainObject(existing) || !isPlainObject(updated)) return false
  if (isReactLike(existing) || isReactLike(updated)) return false
  return true
}

export default function setDiffDeep (existing, updated) {
  // Handle primitive types, null, and type mismatches
  if (existing === null || updated === null ||
      typeof existing !== 'object' || typeof updated !== 'object' ||
      Array.isArray(existing) !== Array.isArray(updated)) {
    return updated
  }

  // If the referenced value is the same it means that nothing has changed
  // so we just return the original reference
  if (existing === updated) return existing

  if (isReactLike(existing) || isReactLike(updated)) return updated

  // Handle arrays
  if (Array.isArray(updated)) {
    try {
      if (!Reflect.set(existing, 'length', updated.length)) return updated
      for (let i = 0; i < updated.length; i++) {
        const nextValue = setDiffDeep(existing[i], updated[i])
        if (!Reflect.set(existing, i, nextValue)) return updated
      }
      return existing
    } catch {
      return updated
    }
  }

  // Handle non-plain objects - just return them as-is to fully overwrite
  // and don't try to update an old object in-place
  if (!canDeepMutateObject(existing, updated)) return updated

  // Handle objects
  try {
    for (const key of Object.keys(existing)) {
      if (!(key in updated) && !Reflect.deleteProperty(existing, key)) return updated
    }
    for (const key of Object.keys(updated)) {
      const nextValue = setDiffDeep(existing[key], updated[key])
      if (!Reflect.set(existing, key, nextValue)) return updated
    }
    return existing
  } catch {
    return updated
  }
}
