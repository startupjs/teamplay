// Many sibling fields that suspend on their own query subscriptions, with slow
// renders. React 19 holds the commit of a Suspense retry for up to 300 ms after
// the last fallback (FALLBACK_THROTTLE_MS) and does not throttle under act(),
// so this test renders with createRoot outside act(). If an uncommitted
// render attempt's lease is released while React holds the commit, the next
// render must re-acquire the subscription without suspending again; before
// transport grace, the release tore the ShareDB query down and the page looped
// subscribe/unsubscribe (LMS raised MAX_UNCOMMITTED_LEASE_GRACE_MS to 1000 ms
// to hide it). React 18 did not hold the commit, so only React 19 reproduces
// the original failure.
import { createElement as el, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from '@jest/globals'
import { getRootSignal, observer, useSub } from '../src/index.ts'
import { querySubscriptions } from '../src/orm/Query.js'
import { getSubscriptionGcDelay, setSubscriptionGcDelay } from '../src/orm/subscriptionGcDelay.ts'
import { getConnection } from '../src/orm/connection.ts'
import connect from '../src/connect/test.js'

beforeAll(connect)

const baselineGcDelay = getSubscriptionGcDelay()
const $root = getRootSignal({ rootId: 'uncommitted-lease-churn' })
const FIELDS = 12
const RENDER_COST_MS = 15
const GC_DELAY_MS = 1000

afterEach(async () => {
  setSubscriptionGcDelay(0)
  await querySubscriptions.flushPendingDestroys()
  await querySubscriptions.clear()
  setSubscriptionGcDelay(baselineGcDelay)
})

// Staggers when each field's subscription becomes ready.
function staggerSubscriptions (stepMs) {
  const proto = querySubscriptions.QueryClass.prototype
  const original = proto._subscribe
  proto._subscribe = async function (...args) {
    const field = this.params?.field
    if (typeof field === 'number') await wait(20 + field * stepMs)
    return original.apply(this, args)
  }
  return () => { proto._subscribe = original }
}

function wait (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('uncommitted lease release under a held Suspense commit', () => {
  it('renders every field without re-subscribing', async () => {
    setSubscriptionGcDelay(GC_DELAY_MS)
    const restoreSubscriptions = staggerSubscriptions(40)
    const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
    globalThis.IS_REACT_ACT_ENVIRONMENT = false
    const wire = { qs: 0, qu: 0 }
    const onSend = message => { if (message.a in wire) wire[message.a] += 1 }
    const container = document.createElement('div')
    const reactRoot = createRoot(container)

    const Field = observer(function Field ({ i }) {
      const busyUntil = Date.now() + RENDER_COST_MS
      while (Date.now() < busyUntil) {} // eslint-disable-line no-empty
      const $query = useSub($root.uncommittedLeaseChurn, { field: i }, { defer: false })
      return el('span', {}, Array.isArray($query.get()) ? '.' : '?')
    }, { suspenseProps: { fallback: el('span', {}, 'L') } })
    const fields = Array.from({ length: FIELDS }, (_, i) => el(Field, { key: i, i }))
    const expected = '.'.repeat(FIELDS)

    getConnection().on('send', onSend)
    try {
      reactRoot.render(el(Suspense, { fallback: el('span', {}, 'Loading') }, fields))
      const startedAt = Date.now()
      while (container.textContent !== expected && Date.now() - startedAt < 8000) await wait(10)
      expect(container.textContent).toBe(expected)
      expect(wire).toEqual({ qs: FIELDS, qu: 0 })

      // Past the GC delay: every mounted field still owns its subscription.
      await wait(GC_DELAY_MS + 200)
      expect(container.textContent).toBe(expected)
      expect(wire.qu).toBe(0)
      expect(sum(querySubscriptions.ownerSubscribeCount.values())).toBe(FIELDS)
    } finally {
      getConnection().off('send', onSend)
      reactRoot.unmount()
      restoreSubscriptions()
      globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    }
  }, 20000)
})

function sum (values) {
  let total = 0
  for (const value of values) total += value || 0
  return total
}
