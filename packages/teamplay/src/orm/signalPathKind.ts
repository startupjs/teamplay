export function isPublicCollection (collectionName: unknown): collectionName is string {
  if (!collectionName) return false
  return typeof collectionName === 'string' && !isPrivateCollection(collectionName)
}

export function isPrivateCollection (collectionName: unknown): collectionName is string {
  if (!collectionName) return false
  return typeof collectionName === 'string' && /^[_$]/.test(collectionName)
}
