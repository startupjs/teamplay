// forceDefer: useSub() and observer() ignore `defer: false` and always defer
// a re-subscription (see useSubDeferred()). No React import: the runtime
// config (orm/idFields.ts, the 'teamplay/config' entry) reads it too.

// the same symbol as TEAMPLAY_RUNTIME_CONFIG_SYMBOL (orm/idFields.ts), which
// imports this module
const RUNTIME_CONFIG_SYMBOL = Symbol.for('teamplay.runtimeConfig')

// set by setForceDefer(); without it the runtime config decides, read on every
// call so that it applies whenever the app sets it
let forceDefer: boolean | undefined

export function getForceDefer (): boolean {
  return forceDefer ?? getDefaultForceDefer()
}

// true: ignore `defer: false` everywhere; false: respect it, whatever the
// runtime config says; null: back to the runtime config. Returns the value in
// effect. A mounted useSub() picks it up on its next render.
export function setForceDefer (value?: boolean | null): boolean {
  if (value == null) {
    forceDefer = undefined
    return getForceDefer()
  }
  assertForceDefer(value, 'setForceDefer()')
  forceDefer = value
  return forceDefer
}

// `forceDefer` of the runtime config (globalThis[Symbol.for('teamplay.runtimeConfig')],
// configureTeamplay()), or false
export function getDefaultForceDefer (): boolean {
  const config = (globalThis as Record<symbol, { forceDefer?: unknown } | undefined>)[RUNTIME_CONFIG_SYMBOL]
  const value = config?.forceDefer
  if (value == null) return false
  assertForceDefer(value, 'Teamplay runtime config forceDefer')
  return value
}

export function assertForceDefer (value: unknown, where: string): asserts value is boolean {
  if (typeof value !== 'boolean') throw Error(`${where} expects a boolean`)
}

export function __resetForceDeferForTests (): void {
  forceDefer = undefined
}
