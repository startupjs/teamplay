const compatComponentIds = new Set<string>()

export function markCompatComponent (componentId: string | undefined): void {
  if (!componentId) return
  compatComponentIds.add(componentId)
}

export function unmarkCompatComponent (componentId: string | undefined): void {
  if (!componentId) return
  compatComponentIds.delete(componentId)
}

export function isCompatComponent (componentId: string | undefined): boolean {
  if (!componentId) return false
  return compatComponentIds.has(componentId)
}

export function __resetCompatComponentRegistryForTests (): void {
  compatComponentIds.clear()
}
