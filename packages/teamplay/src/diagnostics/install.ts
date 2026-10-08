// Installs the full diagnostics implementation into the always-loaded switch
// (adds the hook functions to `diag`, hooks.ts) and applies the startup flags.
//
// index.ts imports this module before anything else, and it imports no
// teamplay runtime module itself. So when 'teamplay/diagnostics' is loaded
// before 'teamplay' (the app's first import, or the Node entry), the hooks
// and the counting FinalizationRegistry wrapper are in place before any
// teamplay registry, signal or subscription exists, and a startup flag
// switches diagnostics on before the runtime does anything.
import {
  diag,
  now,
  applyOptions,
  readStartupOptions,
  record,
  addIncident,
  objectId,
  describeSubTarget,
  noteLeaseCreated,
  noteLeaseCommitted,
  noteLeaseReleased,
  noteAdmCreated,
  noteAdmSubscribed,
  noteAdmDestroyed,
  noteAdmCollected,
  noteObserverCreated,
  noteObserverDestroyed,
  noteReactionCreated,
  noteReactionDisposed,
  noteSubRecordAdded,
  noteUnsubRecords,
  pollerStart,
  pollerEnd,
  type DiagnosticsOptions
} from './state.ts'
import { createTrackedFinalizationRegistry } from './finalization.ts'

const implementation = {
  record,
  addIncident,
  objectId,
  describeSubTarget,
  noteLeaseCreated,
  noteLeaseCommitted,
  noteLeaseReleased,
  noteAdmCreated,
  noteAdmSubscribed,
  noteAdmDestroyed,
  noteAdmCollected,
  noteObserverCreated,
  noteObserverDestroyed,
  noteReactionCreated,
  noteReactionDisposed,
  noteSubRecordAdded,
  noteUnsubRecords,
  pollerStart,
  pollerEnd,
  createFinalizationRegistry: createTrackedFinalizationRegistry
}

export type DiagnosticsHooks = typeof implementation

Object.assign(diag, implementation)

/** Switch diagnostics on while teamplay is still loading (counters only; instrumentation follows in index.ts). */
export function startDiagnostics (options: DiagnosticsOptions = {}): void {
  if (!diag.on) {
    diag.on = true
    diag.enabledAt = now()
    diag.enabledAtStartup = true
  }
  applyOptions(options)
}

// globalThis.__TEAMPLAY_DIAGNOSTICS__ or TEAMPLAY_DIAGNOSTICS (env).
const startupOptions = readStartupOptions()
if (startupOptions) startDiagnostics(startupOptions)
