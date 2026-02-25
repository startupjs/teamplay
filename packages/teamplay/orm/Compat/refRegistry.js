const refLinks = new Map()

export function setRefLink (fromPath, toPath) {
  if (typeof fromPath !== 'string' || typeof toPath !== 'string') return
  refLinks.set(fromPath, {
    fromPath,
    toPath,
    fromSegments: splitPath(fromPath),
    toSegments: splitPath(toPath)
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
