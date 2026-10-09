// Livelock guard: if a hook keeps re-acquiring the same target from
// uncommitted render attempts (any re-subscribe path that cannot join the
// released transport synchronously), it stops releasing its uncommitted lease
// and reports react.lease.reacquireLoop, so the component still commits.
import '../src/diagnostics/index.ts' // 'teamplay/diagnostics' first, as an app does
import { createElement as el, Suspense } from 'react'
import { afterEach, beforeAll, describe, expect, it } from '@jest/globals'
import { getRootSignal, observer, useSub, diagnostics } from '../src/index.ts'
import { docSubscriptions } from '../src/orm/Doc.js'
import { getSubscriptionGcDelay, setSubscriptionGcDelay } from '../src/orm/subscriptionGcDelay.ts'
import { getConnection } from '../src/orm/connection.ts'
import connect from '../src/connect/test.js'

const baselineGcDelay = getSubscriptionGcDelay()
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

let createRoot

beforeAll(async () => {
  connect()
  // Make React's scheduler use setTimeout (as when neither setImmediate nor
  // MessageChannel exists): a Suspense retry then runs after the 0 ms release
  // of the uncommitted lease that was scheduled first, every time, which is
  // the order a busy page produces. React DOM is loaded only for this file.
  const saved = { setImmediate: globalThis.setImmediate, MessageChannel: globalThis.MessageChannel }
  globalThis.setImmediate = undefined
  globalThis.MessageChannel = undefined
  try {
    ;({ createRoot } = await import('react-dom/client'))
  } finally {
    Object.assign(globalThis, saved)
  }
})
afterEach(async () => {
  diagnostics.disable()
  setSubscriptionGcDelay(0)
  await docSubscriptions.flushPendingDestroys()
  setSubscriptionGcDelay(baselineGcDelay)
})

describe('useSub() re-acquire loop guard', () => {
  it('commits when every re-subscribe is asynchronous', async () => {
    setSubscriptionGcDelay(0)
    diagnostics.enable()
    const doc = getConnection().get('leaseGuardDocs', 'a')
    await new Promise((resolve, reject) => doc.fetch(err => err ? reject(err) : resolve()))
    if (doc.type == null) await new Promise((resolve, reject) => doc.create({ name: 'ready' }, err => err ? reject(err) : resolve()))
    // force the slow path: no acquisition can join synchronously
    const original = docSubscriptions.subscribe
    docSubscriptions.subscribe = function (...args) {
      return Promise.resolve(original.apply(this, args)).then(() => wait(5))
    }
    const $root = getRootSignal({ rootId: 'lease-reacquire-guard' })
    const Reader = observer(function Reader () {
      const $doc = useSub($root.leaseGuardDocs.a, { defer: false })
      return el('span', {}, $doc.name.get())
    })
    const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
    globalThis.IS_REACT_ACT_ENVIRONMENT = false
    const container = document.createElement('div')
    const reactRoot = createRoot(container)
    try {
      reactRoot.render(el(Suspense, { fallback: el('span', {}, 'Loading') }, el(Reader)))
      const startedAt = Date.now()
      while (container.textContent !== 'ready' && Date.now() - startedAt < 3000) await wait(10)
      expect(container.textContent).toBe('ready')
      const leases = diagnostics.getCounters()['react.lease.create']
      expect(leases).toBeLessThanOrEqual(12)
      // the loop happens whenever the retry follows the release (always when
      // this file runs alone); the guard then reports it
      if (leases >= 10) {
        const finding = diagnostics.checkLeaks().findings.find(item => item.code === 'react.lease.reacquireLoop')
        expect(finding?.severity).toBe('warn')
      }
    } finally {
      docSubscriptions.subscribe = original
      reactRoot.unmount()
      globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
      await $root.close()
    }
  }, 10000)
})
