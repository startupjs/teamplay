const DEFAULT_SUBSCRIPTION_GC_DELAY = 3000
// the same symbol as TEAMPLAY_RUNTIME_CONFIG_SYMBOL (orm/idFields.ts), which
// imports this module
const RUNTIME_CONFIG_SYMBOL = Symbol.for('teamplay.runtimeConfig')

// set by setSubscriptionGcDelay(); without it the runtime config decides,
// read on every call so that it applies whenever the app sets it
let subscriptionGcDelay: number | undefined

export function getSubscriptionGcDelay (): number {
  return subscriptionGcDelay ?? getDefaultSubscriptionGcDelay()
}

export function setSubscriptionGcDelay (ms?: number | null): number {
  if (ms == null) {
    subscriptionGcDelay = undefined
    return getSubscriptionGcDelay()
  }
  assertSubscriptionGcDelay(ms, 'setSubscriptionGcDelay()')
  subscriptionGcDelay = ms
  return subscriptionGcDelay
}

// `subscriptionGcDelay` of the runtime config
// (globalThis[Symbol.for('teamplay.runtimeConfig')], configureTeamplay()), or
// 3000 ms
export function getDefaultSubscriptionGcDelay (): number {
  const config = (globalThis as Record<symbol, { subscriptionGcDelay?: unknown } | undefined>)[RUNTIME_CONFIG_SYMBOL]
  const ms = config?.subscriptionGcDelay
  if (ms == null) return DEFAULT_SUBSCRIPTION_GC_DELAY
  assertSubscriptionGcDelay(ms, 'Teamplay runtime config subscriptionGcDelay')
  return ms
}

export function assertSubscriptionGcDelay (ms: unknown, where: string): asserts ms is number {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) {
    throw Error(`${where} expects a non-negative finite number`)
  }
}

export function __resetSubscriptionGcDelayForTests (): void {
  subscriptionGcDelay = undefined
}
