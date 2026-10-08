// Transport lifecycle shared by the doc, query and aggregation subscription
// managers (DocSubscriptions and QuerySubscriptions).
//
// Owners are counted exactly: releasing the last owner removes it at once.
// The ShareDB transport, however, outlives its owners for the subscription GC
// delay (racer's "unload delay"): while an ownerless entry has a pending GC
// destroy, a live ('subscribe') transport stays subscribed, so a new owner
// arriving in that window adopts it synchronously with no wire traffic. When
// the pending destroy fires it reconciles the transport to 'idle'.
//
// Fetch transports never linger: a completed fetch has no update stream, so
// reusing it would serve stale data.

const SETTLED = Promise.resolve()

export function getActiveTransportMode (entry) {
  return entry?.runtime?.activeTransportMode ?? entry?.mode ?? 'idle'
}

// `desiredMode` comes from the real owners. `lingering` means the entry has no
// owners but a pending GC destroy.
export function getTransportTargetMode (desiredMode, entry, lingering) {
  if (desiredMode !== 'idle') return desiredMode
  return lingering && getActiveTransportMode(entry) === 'subscribe' ? 'subscribe' : 'idle'
}

// Nothing is in flight and the active transport already matches the target.
export function isTransportSettled (entry, targetMode) {
  return !!entry &&
    entry.phase === 'stable' &&
    !entry.reconcilePromise &&
    getActiveTransportMode(entry) === targetMode
}

// A new owner can join this transport without waiting: it is settled in a
// non-idle mode, so its runtime already holds the data.
export function canJoinTransport (entry, targetMode) {
  return targetMode !== 'idle' && !!entry?.runtime && isTransportSettled(entry, targetMode)
}

// Drives `manager.reconcileTransportNow(key, settle)` behind the entry's phase
// gate. A settled entry is left untouched (no 'transition' flip), so a release
// that changes nothing on the wire never makes a following sub() asynchronous.
// The loop calls `settle()` in the same tick as its final check, so a caller
// arriving right after the loop exits starts a new pass instead of joining a
// finished one (lost wakeup).
export function reconcileEntryTransport (manager, key) {
  const entry = manager.getOrCreateEntry(key)
  const targetMode = entry.targetMode = manager.getTargetTransportMode(key)
  if (entry.phase === 'transition' && entry.reconcilePromise) return entry.reconcilePromise
  if (isTransportSettled(entry, targetMode)) {
    manager.deleteEntryIfEmpty(key)
    return SETTLED
  }
  const next = Promise.resolve().then(() => manager.reconcileTransportNow(key, settle))
  function settle () {
    const currentEntry = manager.entries.get(key)
    if (currentEntry?.reconcilePromise !== next) return
    currentEntry.reconcilePromise = null
    currentEntry.phase = 'stable'
  }
  entry.phase = 'transition'
  entry.reconcilePromise = next
  return next.finally(() => {
    settle()
    manager.deleteEntryIfEmpty(key)
  })
}

// Owner counts are kept per acquiring signal ("token"), so that the finalizer
// of a garbage-collected signal releases only what that signal acquired. An
// owner key (root + path) can be shared by a newer signal of the same path.
export function createOwnerTokenCounts () {
  return new Map() // token -> { fetchCount, subscribeCount }
}

// Returns true when the token is new for this owner (register its finalizer).
export function addOwnerToken (tokens, token, intent) {
  let counts = tokens.get(token)
  const isNew = !counts
  if (isNew) {
    counts = { fetchCount: 0, subscribeCount: 0 }
    tokens.set(token, counts)
  }
  counts[getIntentCountKey(intent)] += 1
  return isNew
}

// Releases one `intent` count, preferably from `token`; a release through
// another signal object of the same path falls back to any token holding that
// intent. Returns { token, emptied } for the token that was charged.
export function removeOwnerToken (tokens, token, intent) {
  const key = getIntentCountKey(intent)
  let chargedToken = token
  let counts = tokens.get(token)
  if (!(counts?.[key] > 0)) {
    counts = undefined
    for (const [candidate, candidateCounts] of tokens) {
      if (candidateCounts[key] > 0) {
        chargedToken = candidate
        counts = candidateCounts
        break
      }
    }
  }
  if (!counts) return { token: undefined, emptied: false }
  counts[key] -= 1
  const emptied = counts.fetchCount + counts.subscribeCount === 0
  if (emptied) tokens.delete(chargedToken)
  return { token: chargedToken, emptied }
}

function getIntentCountKey (intent) {
  return intent === 'fetch' ? 'fetchCount' : 'subscribeCount'
}
