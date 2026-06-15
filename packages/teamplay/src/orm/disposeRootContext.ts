import { aggregationSubscriptions } from './Aggregation.js'
import { docSubscriptions } from './Doc.js'
import { purgeSignalHashes } from './getSignal.ts'
import { querySubscriptions } from './Query.js'
import {
  deleteRootContext,
  getRootContext
} from './rootContext.ts'
import { isGlobalRootId, normalizeRootId } from './rootScope.ts'

type RootId = string | null | undefined

const PENDING_DISPOSES = new Map<string, Promise<void>>()

export default async function disposeRootContext (rootId: RootId): Promise<void> {
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

async function runDispose (rootId: string): Promise<void> {
  const context = getRootContext(rootId, false)
  if (!context) return

  context.resetModelListeners()

  for (const transportHash of Array.from(context.queryRuntimeHashes)) {
    await querySubscriptions.destroyByRuntimeHash(transportHash, { rootId, force: true })
  }
  for (const transportHash of Array.from(context.aggregationRuntimeHashes)) {
    await aggregationSubscriptions.destroyByRuntimeHash(transportHash, { rootId, force: true })
  }

  await docSubscriptions.releaseRootOwnedSubscriptions(rootId)

  context.resetPrivateData()

  purgeSignalHashes(context.signalHashes)
  context.resetSignalHashes()
  context.resetDirectDocSubscriptions()
  deleteRootContext(rootId)
}

export function __resetPendingRootDisposesForTests (): void {
  PENDING_DISPOSES.clear()
}
