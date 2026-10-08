// useSub() must commit without re-subscribing in a loop when an uncommitted
// render attempt's lease is released before React commits its retry:
// - with setSubscriptionGcDelay(0) there is no transport grace to rejoin, and
// - when another owner only fetches the doc, releasing the lease's subscribe
//   downgraded the transport at once (no grace for downgrades).
// Both used to loop subscribe/unsubscribe on the wire and never render.
// Renders with createRoot outside act() (see 46_uncommitted-lease-churn.js).
import { createElement as el, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from '@jest/globals'
import { getRootSignal, observer, sub, unsub, useSub } from '../src/index.ts'
import { act, render } from '@testing-library/react'
import { docSubscriptions } from '../src/orm/Doc.js'
import { querySubscriptions } from '../src/orm/Query.js'
import { getSubscriptionGcDelay, setSubscriptionGcDelay } from '../src/orm/subscriptionGcDelay.ts'
import { getConnection } from '../src/orm/connection.ts'
import connect from '../src/connect/test.js'

beforeAll(connect)

const baselineGcDelay = getSubscriptionGcDelay()
const $root = getRootSignal({ rootId: 'use-sub-no-resubscribe-loop' })
const FIELDS = 12
const RENDER_COST_MS = 15

afterEach(async () => {
  setSubscriptionGcDelay(0)
  await docSubscriptions.flushPendingDestroys()
  await querySubscriptions.flushPendingDestroys()
  await querySubscriptions.clear()
  setSubscriptionGcDelay(baselineGcDelay)
})

function wait (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

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

function recordWire (actions, docId) {
  const wire = Object.fromEntries(actions.map(action => [action, 0]))
  const onSend = message => {
    if (docId != null && message.d !== docId) return
    if (message.a in wire) wire[message.a] += 1
  }
  getConnection().on('send', onSend)
  return { wire, stop: () => getConnection().off('send', onSend) }
}

async function renderOutsideAct (element, expected, timeoutMs = 8000) {
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.IS_REACT_ACT_ENVIRONMENT = false
  const container = document.createElement('div')
  const reactRoot = createRoot(container)
  reactRoot.render(element)
  const startedAt = Date.now()
  while (container.textContent !== expected && Date.now() - startedAt < timeoutMs) await wait(10)
  return {
    container,
    unmount () {
      reactRoot.unmount()
      globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    }
  }
}

describe('useSub() does not loop re-subscribing', () => {
  it('renders sibling query fields with setSubscriptionGcDelay(0)', async () => {
    setSubscriptionGcDelay(0)
    const restoreSubscriptions = staggerSubscriptions(40)
    const { wire, stop } = recordWire(['qs', 'qu'])
    const Field = observer(function Field ({ i }) {
      const busyUntil = Date.now() + RENDER_COST_MS
      while (Date.now() < busyUntil) {} // eslint-disable-line no-empty
      const $query = useSub($root.noResubscribeLoop, { field: i }, { defer: false })
      return el('span', {}, Array.isArray($query.get()) ? '.' : '?')
    }, { suspenseProps: { fallback: el('span', {}, 'L') } })
    const fields = Array.from({ length: FIELDS }, (_, i) => el(Field, { key: i, i }))
    const expected = '.'.repeat(FIELDS)
    const view = await renderOutsideAct(el(Suspense, { fallback: el('span', {}, 'Loading') }, fields), expected)
    try {
      expect(view.container.textContent).toBe(expected)
      expect(wire).toEqual({ qs: FIELDS, qu: 0 })
      await wait(1200)
      expect(wire.qu).toBe(0)
      let owned = 0
      for (const count of querySubscriptions.ownerSubscribeCount.values()) owned += count || 0
      expect(owned).toBe(FIELDS)
    } finally {
      stop()
      view.unmount()
      restoreSubscriptions()
    }
  }, 20000)

  it.each([0, 1000])('renders a doc another owner only fetched (gc delay %i ms)', async gcDelay => {
    setSubscriptionGcDelay(gcDelay)
    const id = 'fetched' + gcDelay
    const doc = getConnection().get('noResubscribeLoopDocs', id)
    await new Promise((resolve, reject) => doc.fetch(err => err ? reject(err) : resolve()))
    if (doc.type == null) await new Promise((resolve, reject) => doc.create({ name: 'ready' }, err => err ? reject(err) : resolve()))
    const $fetched = await sub($root.noResubscribeLoopDocs[id], { mode: 'fetch' })
    const { wire, stop } = recordWire(['s', 'u', 'f'], id)
    let renders = 0
    const Reader = observer(function Reader () {
      renders++
      const $doc = useSub($root.noResubscribeLoopDocs[id])
      return el('span', {}, $doc.name.get())
    })
    const view = await renderOutsideAct(el(Reader), 'ready', 3000)
    try {
      expect(view.container.textContent).toBe('ready')
      // one upgrade from the fetch to a subscription (ShareDB has no unfetch, so
      // the upgrade sends 'u' before 's'), and no downgrade/upgrade cycles
      expect(wire).toEqual({ s: 1, u: 1, f: 0 })
      expect(renders).toBeLessThan(10)
      await wait(gcDelay + 100)
      expect(wire).toEqual({ s: 1, u: 1, f: 0 })
    } finally {
      stop()
      view.unmount()
      await unsub($fetched)
    }
  }, 20000)

  // The minimum grace is only for render attempts React did not commit: a
  // committed lease released on unmount keeps zero-delay teardown immediate.
  it('tears a committed lease down at once on unmount with setSubscriptionGcDelay(0)', async () => {
    setSubscriptionGcDelay(0)
    const id = 'committed-zero'
    const doc = getConnection().get('noResubscribeLoopDocs', id)
    await new Promise((resolve, reject) => doc.fetch(err => err ? reject(err) : resolve()))
    if (doc.type == null) await new Promise((resolve, reject) => doc.create({ name: 'ready' }, err => err ? reject(err) : resolve()))
    const hash = JSON.stringify(['noResubscribeLoopDocs', id])
    const Reader = observer(function Reader () {
      const $doc = useSub($root.noResubscribeLoopDocs[id])
      return el('span', {}, $doc.name.get())
    })
    const view = render(el(Reader))
    await act(async () => { await wait(50) })
    expect(view.container.textContent).toBe('ready')
    expect(docSubscriptions.entries.get(hash)?.mode).toBe('subscribe')
    view.unmount()
    await act(async () => { await wait(20) })
    expect(docSubscriptions.entries.has(hash)).toBe(false)
    expect(getConnection().get('noResubscribeLoopDocs', id).subscribed).toBe(false)
  })
})
