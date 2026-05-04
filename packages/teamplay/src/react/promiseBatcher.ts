let active = false
let promises: Array<PromiseLike<unknown>> = []
let checks = new Map<unknown, BatchReadinessCheck>()

const READINESS_POLL_INTERVAL_MS = 16
const READINESS_WARN_AFTER_MS = 1000

export interface BatchReadinessCheck {
  key?: unknown
  type?: string
  details?: unknown
  isReady: () => boolean
  getState?: () => unknown
}

export function activate (): void {
  active = true
}

export function add (promise: PromiseLike<unknown> | null | undefined): void {
  if (!promise || typeof promise.then !== 'function') return
  promises.push(promise)
}

export function addCheck (check: BatchReadinessCheck | null | undefined): void {
  if (!check || typeof check.isReady !== 'function') return
  const key = check.key ?? Symbol('batch-check')
  checks.set(key, { ...check, key })
}

export function getPromiseAll (): Promise<void> | null {
  const pendingPromises = promises
  const pendingChecks = Array.from(checks.values())
  const hasPromises = pendingPromises.length > 0
  // Checks are a materialization barrier for initial batch subscriptions.
  // If there were no subscription promises in this render, we are in update mode
  // and should not suspend the whole subtree.
  const result = hasPromises
    ? waitForBatchReady(pendingPromises, pendingChecks)
    : null
  reset()
  return result
}

export function isActive (): boolean {
  return active
}

export function reset (): void {
  active = false
  promises = []
  checks = new Map()
}

async function waitForBatchReady (
  pendingPromises: Array<PromiseLike<unknown>>,
  pendingChecks: BatchReadinessCheck[]
): Promise<void> {
  if (pendingPromises.length > 0) await Promise.all(pendingPromises)
  // Let microtasks flush after subscription promises resolve so tree writes become visible.
  await Promise.resolve()
  await waitForChecksReady(pendingChecks)
}

async function waitForChecksReady (pendingChecks: BatchReadinessCheck[]): Promise<void> {
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

function getNotReadyChecks (pendingChecks: BatchReadinessCheck[]): BatchReadinessCheck[] {
  const notReady: BatchReadinessCheck[] = []
  for (const check of pendingChecks) {
    if (!isCheckReady(check)) notReady.push(check)
  }
  return notReady
}

function isCheckReady (check: BatchReadinessCheck): boolean {
  try {
    return !!check.isReady()
  } catch (err) {
    if (isThenable(err)) return false
    throw err
  }
}

function warnAboutChecksDelay (checks: BatchReadinessCheck[]): void {
  const details = checks.map(check => {
    let state: unknown
    try {
      state = typeof check.getState === 'function' ? check.getState() : undefined
    } catch (err) {
      state = isThenable(err) ? 'suspended' : `state-error: ${getErrorMessage(err)}`
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

function isDevMode (): boolean {
  const processLike = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process
  if (!processLike?.env) return true
  return processLike.env.NODE_ENV !== 'production'
}

function isThenable (value: unknown): value is PromiseLike<unknown> {
  return !!value &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
}

function getErrorMessage (err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function delay (ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
