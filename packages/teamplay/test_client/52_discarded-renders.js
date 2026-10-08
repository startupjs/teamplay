// Observer render attempts that React discards before they mount (a Suspense
// boundary that is unmounted while still showing its fallback, abandoned
// concurrent renders) must not keep anything alive or owned: their wrappers,
// reactions, caches, $() values and useSub() leases, including leases that
// were acquired synchronously because the data was already loaded.
import { createElement as el, Suspense } from 'react'
import { afterEach, beforeAll, describe, expect, it } from '@jest/globals'
import { act, cleanup, render } from '@testing-library/react'
import { $, diagnostics, observer, sub, unsub, useSub, __DEBUG_SIGNALS_CACHE__ as signalsCache } from '../src/index.ts'
import { docSubscriptions } from '../src/orm/Doc.js'
import { querySubscriptions } from '../src/orm/Query.js'
import { getConnection } from '../src/orm/connection.ts'
import { getSubscriptionGcDelay, setSubscriptionGcDelay } from '../src/orm/subscriptionGcDelay.ts'
import { runGc } from '../test/_helpers.js'
import connect from '../src/connect/test.js'

const COLLECTION = 'discardedRenderDocs'
const baselineGcDelay = getSubscriptionGcDelay()
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
// useSub() keeps an uncommitted lease this long before releasing it
const LEASE_HOLD_MS = 1000
// Suspends for longer than the page stays mounted (React keeps the boundary
// reachable from the thrown promise until it settles).
let pendingLoad
function slowLoad () {
  pendingLoad ??= wait(150).then(() => { pendingLoad = undefined })
  return pendingLoad
}

beforeAll(async () => {
  connect()
  for (const id of ['a', 'b', 'c']) {
    const doc = getConnection().get(COLLECTION, id)
    await new Promise((resolve, reject) => doc.fetch(err => err ? reject(err) : resolve()))
    if (doc.type == null) await new Promise((resolve, reject) => doc.create({ name: id, kind: 'k' }, err => err ? reject(err) : resolve()))
  }
})
afterEach(cleanup)
afterEach(async () => {
  diagnostics.disable()
  setSubscriptionGcDelay(0)
  await docSubscriptions.flushPendingDestroys()
  await querySubscriptions.flushPendingDestroys()
  setSubscriptionGcDelay(baselineGcDelay)
})

function ownerCount (collection) {
  let count = 0
  for (const record of docSubscriptions.ownerRecords.values()) {
    if (record.segments?.[0] === collection) count += record.fetchCount + record.subscribeCount
  }
  for (const record of querySubscriptions.ownerRecords.values()) {
    if (record.collectionName === collection) count += record.fetchCount + record.subscribeCount
  }
  return count
}

function NeverReady () {
  throw slowLoad()
}

describe('observer render attempts discarded before mount', () => {
  it('release useSub() leases acquired synchronously', async () => {
    setSubscriptionGcDelay(20)
    diagnostics.enable()
    // already loaded: useSub() returns the signal synchronously
    const $held = await sub($[COLLECTION].a)
    const $heldQuery = await sub($[COLLECTION], { kind: 'k' })
    const before = ownerCount(COLLECTION)
    const Reader = observer(function SyncReader () {
      const $doc = useSub($[COLLECTION].a)
      const $query = useSub($[COLLECTION], { kind: 'k' })
      return el('span', {}, $doc.name.get() + $query.getIds().length)
    })
    const view = render(el(Suspense, { fallback: el('span', {}, 'Loading') }, el(Reader), el(NeverReady)))
    expect(view.container.textContent).toBe('Loading')
    expect(ownerCount(COLLECTION)).toBeGreaterThan(before)
    view.unmount()
    await act(async () => { await wait(LEASE_HOLD_MS + 200) })
    await runGc()
    expect(ownerCount(COLLECTION)).toBe(before)
    expect(diagnostics.snapshot().react.leases.tracked).toBe(0)
    await unsub($held)
    await unsub($heldQuery)
  })

  it('leave no wrappers, reactions, leases, owners or signals behind', async () => {
    setSubscriptionGcDelay(20)
    await runGc()
    diagnostics.enable()
    const cacheSize = signalsCache.size
    const before = ownerCount(COLLECTION)
    const Item = observer(function DiscardedItem ({ id }) {
      const { $draft } = $({ draft: id })
      const $doc = useSub($[COLLECTION][id])
      return el('i', {}, $doc.name.get() + $draft.get())
    })
    const List = observer(function DiscardedList () {
      const $query = useSub($[COLLECTION], { kind: 'k' })
      return el('div', {}, $query.getIds().map(id => el(Item, { key: id, id })))
    })
    for (let i = 0; i < 8; i++) {
      const view = render(el(Suspense, { fallback: el('span', {}, 'Loading') }, el(List), el(NeverReady)))
      await act(async () => { await wait(30) })
      expect(view.container.textContent).toBe('Loading')
      view.unmount()
    }
    await act(async () => { await wait(LEASE_HOLD_MS + 200) })
    await runGc()
    await act(async () => { await wait(50) })
    await runGc()
    const react = diagnostics.snapshot().react
    // no wrapper is alive (mounted or not) and none was collected with its
    // destroy callbacks pending
    expect(react.adms.subscribed + react.adms.neverSubscribed).toBe(0)
    expect(react.adms.collectedWithoutDestroy).toBe(0)
    expect(react.observers.tracked).toBe(0)
    expect(react.leases.tracked).toBe(0)
    expect(ownerCount(COLLECTION)).toBe(before)
    expect(signalsCache.size).toBe(cacheSize)
  }, 20000)
})
