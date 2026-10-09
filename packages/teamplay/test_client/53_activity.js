// React 19.2's <Activity mode="hidden"> runs the effect cleanups of a subtree
// it keeps mounted (unsubscribes useSyncExternalStore, releases useSub()
// leases) and runs the effects again when it shows the subtree. An observer
// must come back from that fully: reactive, without re-acquiring its
// subscriptions on every render, and with its scheduled updates (a
// re-subscribe that resolves later) still re-rendering it. Skipped on React
// 19.0 and 19.1, which have no <Activity>.
import '../src/diagnostics/index.ts' // 'teamplay/diagnostics' first, as an app does
import * as React from 'react'
import { afterEach, beforeAll, describe, expect, it } from '@jest/globals'
import { act, cleanup, render } from '@testing-library/react'
import { $, diagnostics, observer, useSub } from '../src/index.ts'
import { docSubscriptions } from '../src/orm/Doc.js'
import { querySubscriptions } from '../src/orm/Query.js'
import { getConnection } from '../src/orm/connection.ts'
import { getSubscriptionGcDelay, setSubscriptionGcDelay } from '../src/orm/subscriptionGcDelay.ts'
import connect from '../src/connect/test.js'

const { createElement: el, Activity } = React
const describeActivity = Activity ? describe : describe.skip
const COLLECTION = 'activityDocs'
const baselineGcDelay = getSubscriptionGcDelay()
const wait = ms => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)) })

beforeAll(async () => {
  connect()
  for (const [id, kind] of [['a', 'first'], ['b', 'second']]) {
    const doc = getConnection().get(COLLECTION, id)
    await new Promise((resolve, reject) => doc.fetch(err => err ? reject(err) : resolve()))
    if (doc.type == null) await new Promise((resolve, reject) => doc.create({ name: id, kind }, err => err ? reject(err) : resolve()))
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

function ownerCount () {
  let count = 0
  for (const record of docSubscriptions.ownerRecords.values()) {
    if (record.segments?.[0] === COLLECTION) count += record.fetchCount + record.subscribeCount
  }
  for (const record of querySubscriptions.ownerRecords.values()) {
    if (record.collectionName === COLLECTION) count += record.fetchCount + record.subscribeCount
  }
  return count
}

function leaseCreates () {
  return diagnostics.getCounters()['react.lease.create'] || 0
}

describeActivity('observer() inside <Activity>', () => {
  it('is reactive after it is shown again and keeps its subscription lease across renders', async () => {
    diagnostics.enable()
    const $label = $.session.activityLabel
    $label.set('x')
    const Reader = observer(function ActivityReader () {
      const $doc = useSub($[COLLECTION].a)
      return el('span', {}, $doc.name.get() + ':' + $label.get())
    })
    const App = ({ mode }) => el(Activity, { mode }, el(Reader))
    const view = render(el(App, { mode: 'visible' }))
    await wait(30)
    expect(view.container.textContent).toBe('a:x')
    expect(ownerCount()).toBe(1)

    view.rerender(el(App, { mode: 'hidden' }))
    // past the task on which an unsubscribed observer wrapper is destroyed
    await wait(30)
    expect(ownerCount()).toBe(0)

    view.rerender(el(App, { mode: 'visible' }))
    await wait(30)
    expect(view.container.textContent).toBe('a:x')
    expect(ownerCount()).toBe(1)

    const before = leaseCreates()
    act(() => { $label.set('y') })
    act(() => { $label.set('z') })
    await wait(30)
    expect(view.container.textContent).toBe('a:z')
    // the same lease serves every render
    expect(leaseCreates()).toBe(before)

    view.unmount()
    await wait(1200)
    expect(ownerCount()).toBe(0)
  }, 10000)

  it('re-renders on a re-subscribe that becomes ready after it is shown again', async () => {
    const $kind = $.session.activityKind
    $kind.set('first')
    const Reader = observer(function ActivityQueryReader () {
      // a re-subscribe suspends until the next query result is loaded
      const $docs = useSub($[COLLECTION], { kind: $kind.get() }, { defer: false })
      return el('span', {}, $docs.map($doc => $doc.name.get()).join(','))
    })
    const App = ({ mode }) => el(Activity, { mode }, el(Reader))
    const view = render(el(App, { mode: 'visible' }))
    await wait(30)
    expect(view.container.textContent).toBe('a')

    view.rerender(el(App, { mode: 'hidden' }))
    await wait(30)
    view.rerender(el(App, { mode: 'visible' }))
    await wait(30)
    expect(view.container.textContent).toBe('a')

    act(() => { $kind.set('second') })
    await wait(100)
    expect(view.container.textContent).toBe('b')
  }, 10000)
})
