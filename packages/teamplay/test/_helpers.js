import { before, beforeEach, afterEach } from 'mocha'
import { strict as assert } from 'node:assert'
import { __DEBUG_SIGNALS_CACHE__ as signalsCache } from '../src/index.ts'
import { docSubscriptions } from '../src/orm/Doc.js'
import { querySubscriptions } from '../src/orm/Query.js'
import { getSubscriptionGcDelay, setSubscriptionGcDelay } from '../src/orm/subscriptionGcDelay.ts'

// the cache is not getting cleared if we just call global.gc()
// so we need to wait for the next tick before and after calling it.
//
// Since some signals depend on the parent signals, we need to wait for the next gc cycle
// to make sure that the parent signal is not in use anymore and clear it too.
// Sometimes even more than 2 cycles of GC are required to cleanup everything.
//
// Here is how many GC iterations are required to cleanup different things:
//   - $ signal: 1
//       const $game = $.games[gameId]
//   - $() simple value: 1
//       const $value = $(42)
//   - $() object value with destructuring: 2
//       const { $firstName, $lastName } = $({ firstName: 'John', lastName: 'Smith' })
//   - $() reaction: 4
//       const { $firstName, $lastName } = $({ firstName: 'John', lastName: 'Smith' })
//       const $fullName = $(() => $firstName.get() + ' ' + $lastName.get())
const DELAY = 5
const GC_ITERATIONS = 4
export async function runGc (iterations = GC_ITERATIONS) {
  const prevSubscriptionGcDelay = getSubscriptionGcDelay()
  // Tests expect eager cleanup after GC regardless of the configured default delay.
  setSubscriptionGcDelay(0)
  try {
    await delay()
    for (let i = 0; i < iterations; i++) {
      global.gc()
      await delay()
      await docSubscriptions.flushPendingDestroys()
      await querySubscriptions.flushPendingDestroys()
    }
    // Finalizers are not guaranteed to run in the same turn. Do two extra settle cycles
    // while delay=0 so late GC callbacks don't leave pending destroy timers.
    for (let i = 0; i < 2; i++) {
      await delay()
      global.gc()
      await delay()
      await docSubscriptions.flushPendingDestroys()
      await querySubscriptions.flushPendingDestroys()
    }
  } finally {
    setSubscriptionGcDelay(prevSubscriptionGcDelay)
  }
}

export { signalsCache as cache }

async function delay () {
  await new Promise(resolve => setTimeout(resolve, DELAY))
}

export function afterEachTestGc () {
  let cacheSize

  before(async () => {
    await runGc()
  })

  beforeEach(async () => {
    cacheSize = signalsCache.size
  })

  afterEach(async () => {
    await runGc()
    assert.equal(signalsCache.size, cacheSize, 'signals cache size should be back to original')
  })
}
