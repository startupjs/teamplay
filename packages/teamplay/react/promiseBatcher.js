let active = false
let promises = []
let checks = new Map()

const READINESS_POLL_INTERVAL_MS = 16
const READINESS_WARN_AFTER_MS = 1000

export function activate () {
  active = true
}

export function add (promise) {
  if (!promise || typeof promise.then !== 'function') return
  promises.push(promise)
}

export function addCheck (check) {
  if (!check || typeof check.isReady !== 'function') return
  const key = check.key ?? Symbol('batch-check')
  checks.set(key, { ...check, key })
}

export function getPromiseAll () {
  const pendingPromises = promises
  const pendingChecks = Array.from(checks.values())
  const hasPromises = pendingPromises.length > 0
  const hasChecks = pendingChecks.length > 0
  const result = !hasPromises && !hasChecks
    ? null
    : hasPromises || !areChecksReady(pendingChecks)
      ? waitForBatchReady(pendingPromises, pendingChecks)
      : null
  reset()
  return result
}

export function isActive () {
  return active
}

export function reset () {
  active = false
  promises = []
  checks = new Map()
}

async function waitForBatchReady (pendingPromises, pendingChecks) {
  if (pendingPromises.length > 0) await Promise.all(pendingPromises)
  // Let microtasks flush after subscription promises resolve so tree writes become visible.
  await Promise.resolve()
  await waitForChecksReady(pendingChecks)
}

async function waitForChecksReady (pendingChecks) {
  if (pendingChecks.length === 0) return
  let warned = false
  const startedAt = Date.now()
  while (true) {
    const notReadyChecks = getNotReadyChecks(pendingChecks)
    if (notReadyChecks.length === 0) return
    if (!warned && isDevMode() && Date.now() - startedAt >= READINESS_WARN_AFTER_MS) {
      warned = true
      warnAboutChecksDelay(notReadyChecks)
    }
    await delay(READINESS_POLL_INTERVAL_MS)
  }
}

function areChecksReady (pendingChecks) {
  if (pendingChecks.length === 0) return true
  return getNotReadyChecks(pendingChecks).length === 0
}

function getNotReadyChecks (pendingChecks) {
  const notReady = []
  for (const check of pendingChecks) {
    if (!isCheckReady(check)) notReady.push(check)
  }
  return notReady
}

function isCheckReady (check) {
  try {
    return !!check.isReady()
  } catch (err) {
    if (isThenable(err)) return false
    throw err
  }
}

function warnAboutChecksDelay (checks) {
  const details = checks.map(check => {
    let state
    try {
      state = typeof check.getState === 'function' ? check.getState() : undefined
    } catch (err) {
      state = isThenable(err) ? 'suspended' : `state-error: ${err?.message || err}`
    }
    return {
      type: check.type || 'unknown',
      key: String(check.key),
      details: check.details,
      state
    }
  })
  console.warn('[teamplay] useBatch() is waiting for data materialization checks.', details)
}

function isDevMode () {
  if (typeof process === 'undefined' || !process?.env) return true
  return process.env.NODE_ENV !== 'production'
}

function isThenable (value) {
  return !!value && typeof value.then === 'function'
}

function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
