export function isMissingShareDoc (doc) {
  return !!doc && doc.type === null && doc.version === 0
}
