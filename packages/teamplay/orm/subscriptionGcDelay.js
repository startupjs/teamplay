import { isCompatEnv } from './compatEnv.js'

const DEFAULT_COMPAT_SUBSCRIPTION_GC_DELAY = 300
const DEFAULT_SUBSCRIPTION_GC_DELAY = 0

let subscriptionGcDelay = getDefaultSubscriptionGcDelay()

export function getSubscriptionGcDelay () {
  return subscriptionGcDelay
}

export function setSubscriptionGcDelay (ms) {
  if (ms == null) {
    subscriptionGcDelay = getDefaultSubscriptionGcDelay()
    return subscriptionGcDelay
  }
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) {
    throw Error('setSubscriptionGcDelay() expects a non-negative finite number')
  }
  subscriptionGcDelay = ms
  return subscriptionGcDelay
}

export function getDefaultSubscriptionGcDelay () {
  return isCompatEnv()
    ? DEFAULT_COMPAT_SUBSCRIPTION_GC_DELAY
    : DEFAULT_SUBSCRIPTION_GC_DELAY
}

export function __resetSubscriptionGcDelayForTests () {
  subscriptionGcDelay = getDefaultSubscriptionGcDelay()
}
