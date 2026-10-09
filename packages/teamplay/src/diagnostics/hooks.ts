// The always-loaded part of diagnostics. Everything else lives behind
// 'teamplay/diagnostics' and ships only in bundles that import it.
//
// teamplay's runtime imports only this module: the `diag` object with the
// master switch `diag.on` and the hook functions (diag.record(),
// diag.noteLeaseCreated(), ...) that hook sites call behind `if (diag.on)`.
// Until 'teamplay/diagnostics' is loaded the switch is off and the hook
// functions do not exist; loading it adds them and fills the `diagnostics` API
// object below (install.ts, index.ts). The switch can only turn on after
// that, so a hook site never calls a missing function. Keep this module tiny:
// it is in every bundle.
import type { DiagnosticsHooks } from './install.ts'
import type { DiagnosticsApi } from './index.ts'

export interface DiagSwitch {
  /** Master switch. Checked by every hook site. */
  on: boolean
  // The fields below are set by the full implementation (state.ts).
  /** Ring buffer recording. */
  trace: boolean
  /** Stack capture for traced events. */
  stacks: boolean
  traceSize: number
  enabledAt: number
  /** True when a startup flag enabled diagnostics as 'teamplay/diagnostics' loaded. */
  enabledAtStartup: boolean
  /** Name of the FinalizationRegistry whose callback is running right now. */
  finalizing: string | undefined
}

/** The switch, plus the hook functions 'teamplay/diagnostics' adds. Call them only behind `if (diag.on)`. */
export const diag = { on: false } as DiagSwitch & DiagnosticsHooks

/**
 * The diagnostics API object. Until 'teamplay/diagnostics' is loaded only
 * isEnabled() and disable() exist and enable() throws; loading it fills in
 * the rest (the same object is exported from both entries). The function
 * aliases (enableDiagnostics, ...) are exported by 'teamplay/diagnostics' only.
 */
export const diagnostics = {
  isEnabled: () => diag.on,
  disable () {},
  enable () {
    throw Error("[teamplay] diagnostics are not loaded: import 'teamplay/diagnostics' (see the Diagnostics guide)")
  }
} as Partial<DiagnosticsApi> as DiagnosticsApi
