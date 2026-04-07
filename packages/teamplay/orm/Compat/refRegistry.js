const refLinks = new Map()

export function setRefLink (fromPath, toPath, fromSegments, toSegments, options = {}) {
  if (typeof fromPath !== 'string' || typeof toPath !== 'string') return
  const normalizedFromSegments = Array.isArray(fromSegments)
    ? fromSegments.map(segment => String(segment))
    : splitPath(fromPath)
  const normalizedToSegments = Array.isArray(toSegments)
    ? toSegments.map(segment => String(segment))
    : splitPath(toPath)
  refLinks.set(fromPath, {
    fromPath,
    toPath,
    fromSegments: normalizedFromSegments,
    toSegments: normalizedToSegments,
    fromRootId: options.fromRootId,
    toRootId: options.toRootId,
    mirrorOnly: !!options.mirrorOnly,
    onChange: typeof options.onChange === 'function' ? options.onChange : undefined
  })
}

export function removeRefLink (fromPath) {
  refLinks.delete(fromPath)
}

export function getRefLinks () {
  return refLinks
}

export function __resetRefLinksForTests () {
  refLinks.clear()
}

function splitPath (path) {
  return path.split('.').filter(Boolean)
}
