import { aggregationSubscriptions } from './Aggregation.js'
import { docSubscriptions } from './Doc.js'
import { purgeSignalHashes } from './getSignal.ts'
import { querySubscriptions } from './Query.js'
import {
  deleteRootContext,
  getRootContext
} from './rootContext.ts'
import { isGlobalRootId, normalizeRootId } from './rootScope.ts'
import { diag, record } from '../diagnostics/state.ts'

type RootId = string | null | undefined

const PENDING_DISPOSES = new Map<string, Promise<void>>()

// `$root` is the root signal when it is still alive (explicit close()); the
// closed mark of its id lives as long as it does. The root finalizer passes
// none: the root signal is gone.
export default async function disposeRootContext (rootId: RootId, $root?: object): Promise<void> {
  const normalizedRootId = normalizeRootId(rootId)
  if (isGlobalRootId(normalizedRootId)) return
  const existing = PENDING_DISPOSES.get(normalizedRootId)
  if (existing) return existing

  if (diag.on) record('root.dispose.start', normalizedRootId)
  const pending = runDispose(normalizedRootId, $root)
  PENDING_DISPOSES.set(normalizedRootId, pending)
  try {
    await pending
  } finally {
    if (PENDING_DISPOSES.get(normalizedRootId) === pending) {
      PENDING_DISPOSES.delete(normalizedRootId)
    }
  }
}

async function runDispose (rootId: string, $root?: object): Promise<void> {
  const context = getRootContext(rootId, false)
  if (!context) return

  for (const transportHash of Array.from(context.queryRuntimeHashes)) {
    await querySubscriptions.destroyByRuntimeHash(transportHash, { rootId, force: true })
  }
  for (const transportHash of Array.from(context.aggregationRuntimeHashes)) {
    await aggregationSubscriptions.destroyByRuntimeHash(transportHash, { rootId, force: true })
  }

  await docSubscriptions.releaseRootOwnedSubscriptions(rootId)
  await docSubscriptions.releaseRootWrittenDocs(rootId)

  context.resetPrivateData()

  purgeSignalHashes(context.signalHashes)
  context.resetSignalHashes()
  context.resetDirectDocSubscriptions()
  deleteRootContext(rootId, $root)
  if (diag.on) record('root.dispose.end', rootId)
}

// For diagnostics: roots whose disposal is in progress.
export function getPendingRootDisposeCount (): number {
  return PENDING_DISPOSES.size
}

export function __resetPendingRootDisposesForTests (): void {
  PENDING_DISPOSES.clear()
}
