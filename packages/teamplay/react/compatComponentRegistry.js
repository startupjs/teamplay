const compatComponentIds = new Set()

export function markCompatComponent (componentId) {
  if (!componentId) return
  compatComponentIds.add(componentId)
}

export function unmarkCompatComponent (componentId) {
  if (!componentId) return
  compatComponentIds.delete(componentId)
}

export function isCompatComponent (componentId) {
  if (!componentId) return false
  return compatComponentIds.has(componentId)
}

export function __resetCompatComponentRegistryForTests () {
  compatComponentIds.clear()
}
