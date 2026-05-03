import { getRefLinks } from './refRegistry.js'
import { GLOBAL_ROOT_ID } from '../Root.js'

export const REF_TARGET = Symbol.for('teamplay.compat.refTarget')

export function resolveRefSignalSafe ($signal, maxDepth = 32) {
  let current = $signal
  const seen = new Set()
  for (let i = 0; i < maxDepth; i++) {
    if (!current) return undefined
    const next = current[REF_TARGET]
    if (!next) return current
    if (seen.has(current)) return undefined
    seen.add(current)
    current = next
  }
  return undefined
}

export function resolveRefSegmentsSafe (segments, rootId = GLOBAL_ROOT_ID, maxDepth = 32) {
  if (!Array.isArray(segments) || segments.length === 0) return undefined
  let current = [...segments]
  const visited = new Set([toPathKey(current)])
  let changed = false

  for (let i = 0; i < maxDepth; i++) {
    const link = findBestMatchingLink(current, rootId)
    if (!link) return changed ? current : undefined
    const suffix = current.slice(link.fromSegments.length)
    const next = link.toSegments.concat(suffix)
    const key = toPathKey(next)
    if (visited.has(key)) return undefined
    visited.add(key)
    current = next
    changed = true
  }
  return undefined
}

function findBestMatchingLink (segments, rootId) {
  let best
  for (const link of getRefLinks(rootId).values()) {
    if (link.mirrorOnly) continue
    if (!isPathPrefix(link.fromSegments, segments)) continue
    if (!best || link.fromSegments.length > best.fromSegments.length) {
      best = link
    }
  }
  return best
}

function isPathPrefix (prefixSegments, fullSegments) {
  if (prefixSegments.length > fullSegments.length) return false
  for (let i = 0; i < prefixSegments.length; i++) {
    if (prefixSegments[i] !== String(fullSegments[i])) return false
  }
  return true
}

function toPathKey (segments) {
  return segments.map(segment => String(segment)).join('.')
}
