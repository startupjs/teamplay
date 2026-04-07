import { aggregationSubscriptions } from './Aggregation.js'
import { docSubscriptions } from './Doc.js'
import { dataTreeRaw, del as _del } from './dataTree.js'
import { purgeSignalHashes } from './getSignal.js'
import { querySubscriptions } from './Query.js'
import {
  deleteRootContext,
  getRootContext
} from './rootContext.js'
import { ROOTS_BUCKET, isGlobalRootId, normalizeRootId } from './rootScope.js'

const PENDING_DISPOSES = new Map()

export default async function disposeRootContext (rootId) {
  const normalizedRootId = normalizeRootId(rootId)
  if (isGlobalRootId(normalizedRootId)) return
  const existing = PENDING_DISPOSES.get(normalizedRootId)
  if (existing) return existing

  const pending = runDispose(normalizedRootId)
  PENDING_DISPOSES.set(normalizedRootId, pending)
  try {
    await pending
  } finally {
    if (PENDING_DISPOSES.get(normalizedRootId) === pending) {
      PENDING_DISPOSES.delete(normalizedRootId)
    }
  }
}

async function runDispose (rootId) {
  const context = getRootContext(rootId, false)
  if (!context) return

  stopActiveRefs(context)
  context.resetRefs()
  context.resetModelListeners()

  for (const viewHash of Array.from(context.queryViewHashes)) {
    await querySubscriptions.destroyByViewHash(viewHash, { force: true })
  }
  for (const viewHash of Array.from(context.aggregationViewHashes)) {
    await aggregationSubscriptions.destroyByViewHash(viewHash, { force: true })
  }

  await docSubscriptions.releaseRootOwnedSubscriptions(rootId)

  _del([ROOTS_BUCKET, rootId], dataTreeRaw)

  purgeSignalHashes(context.signalHashes)
  context.resetSignalHashes()
  context.resetDirectDocSubscriptions()
  deleteRootContext(rootId)
}

function stopActiveRefs (context) {
  for (const entry of context.activeRefs.values()) {
    try {
      entry?.stop?.()
    } catch (err) {
      console.error(err)
    }
  }
  context.resetActiveRefs()
}

export function __resetPendingRootDisposesForTests () {
  PENDING_DISPOSES.clear()
}
