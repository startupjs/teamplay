// LMS app root (Root/useGlobalInit.js): one useBatchSub() group subscribes a
// query and then a doc that the query already returns (and so retains). The
// group must commit without churning the doc subscription. Under teamplay-next
// (uncommitted leases released on the next task) the doc's direct owner was
// released while the query retained the doc; its own transport had no grace,
// so it was unsubscribed at once, and the next render had to subscribe it
// again and suspend: in LMS one hook churned ~51k leases in 45 s and the page
// stayed on Loading. Here a gate after the group delays React's retry past
// that release, which LMS pages hit by being busy.
import '../src/diagnostics/index.ts' // 'teamplay/diagnostics' first, as an app does
import { createElement as el, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from '@jest/globals'
import { getRootSignal, observer, useBatchSub, diagnostics } from '../src/index.ts'
import { docSubscriptions } from '../src/orm/Doc.js'
import { querySubscriptions } from '../src/orm/Query.js'
import { getSubscriptionGcDelay, setSubscriptionGcDelay } from '../src/orm/subscriptionGcDelay.ts'
import { getConnection } from '../src/orm/connection.ts'
import connect from '../src/connect/test.js'

const USERS = 'retainedBatchUsers'
const RIGHTS = 'retainedBatchRights'
const GATE_MS = 60
const baselineGcDelay = getSubscriptionGcDelay()
let counter = 0

beforeAll(connect)
afterEach(async () => {
  diagnostics.disable()
  setSubscriptionGcDelay(0)
  await docSubscriptions.flushPendingDestroys()
  await querySubscriptions.flushPendingDestroys()
  await querySubscriptions.clear()
  await docSubscriptions.clear()
  setSubscriptionGcDelay(baselineGcDelay)
})

function wait (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function createDoc (collection, id, data) {
  const doc = getConnection().get(collection, id)
  await new Promise((resolve, reject) => doc.fetch(err => err ? reject(err) : resolve()))
  if (doc.type == null) await new Promise((resolve, reject) => doc.create(data, err => err ? reject(err) : resolve()))
}

describe('useBatchSub() group with a query and a doc it returns', () => {
  it.each([3000, 0])('commits without churning the doc subscription (gc delay %i ms)', async gcDelay => {
    setSubscriptionGcDelay(gcDelay)
    diagnostics.enable()
    const userId = 'user' + ++counter
    await createDoc(USERS, userId, { name: 'Ada' })
    await createDoc(RIGHTS, 'global_' + userId, { scope: 'global', entity: 'user', entityId: userId, admin: true })
    const $root = getRootSignal({ rootId: 'retained-batch-' + counter })
    const wire = { s: 0, u: 0 }
    const onSend = message => {
      if (message.c === RIGHTS && message.d === 'global_' + userId && message.a in wire) wire[message.a] += 1
    }
    let gate
    let renders = 0
    const App = observer(function App () {
      renders++
      const $user = useBatchSub($root[USERS][userId], { defer: false })
      useBatchSub($root[RIGHTS], { scope: 'global', entity: 'user', entityId: userId }, { defer: false })
      const $rights = useBatchSub($root[RIGHTS]['global_' + userId], { defer: false })
      // the first attempt is held past the release of its uncommitted leases
      gate ??= wait(GATE_MS).then(() => { gate.open = true })
      if (!gate.open) throw gate
      useBatchSub()
      return el('span', {}, $user.name.get() + ':' + $rights.admin.get())
    })

    const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
    globalThis.IS_REACT_ACT_ENVIRONMENT = false
    const container = document.createElement('div')
    const reactRoot = createRoot(container)
    getConnection().on('send', onSend)
    try {
      reactRoot.render(el(Suspense, { fallback: el('span', {}, 'Loading') }, el(App)))
      const startedAt = Date.now()
      // bounded: a livelock churns hundreds of leases per second
      while (container.textContent !== 'Ada:true' && Date.now() - startedAt < 3000) {
        if (renders > 200) break
        await wait(10)
      }
      expect(container.textContent).toBe('Ada:true')
      await wait(100)
      expect(wire).toEqual({ s: 1, u: 0 })
      expect(renders).toBeLessThan(10)
      // with a GC delay of 0 an uncommitted lease is released on the next task;
      // a commit React holds re-acquires it synchronously (bounded, no wire)
      expect(diagnostics.getCounters()['react.lease.create']).toBeLessThan(gcDelay ? 10 : 20)
    } finally {
      getConnection().off('send', onSend)
      reactRoot.unmount()
      globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
      await $root.close()
    }
  }, 20000)
})
