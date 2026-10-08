import { createElement as el, StrictMode, Suspense } from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { $, diagnostics, observer, useSub } from '../src/index.ts'
import { docSubscriptions } from '../src/orm/Doc.js'
import { getConnection } from '../src/orm/connection.ts'
import { getSubscriptionGcDelay, setSubscriptionGcDelay } from '../src/orm/subscriptionGcDelay.ts'
import { resetTestThrottling, setTestThrottling } from '../src/react/useSub.ts'
import { runGc, cache } from '../test/_helpers.js'
import connect from '../src/connect/test.js'

const COLLECTION = 'diagnosticsClientDocs'
const baselineGcDelay = getSubscriptionGcDelay()

beforeAll(async () => {
  connect()
  await createDoc('d1', { name: 'first' })
  await createDoc('d2', { name: 'second' })
})
beforeEach(() => {
  // Not 0: useSub() releases uncommitted leases after min(gcDelay, 50) ms and a
  // 0 ms grace can race React's Suspense retry commit (see the report).
  setSubscriptionGcDelay(50)
  diagnostics.enable({ trace: true, stacks: true })
  diagnostics.resetCounters()
  diagnostics.clearTrace()
})
afterEach(cleanup)
afterEach(async () => {
  resetTestThrottling()
  diagnostics.disable()
  await runGc()
  setSubscriptionGcDelay(baselineGcDelay)
})
afterAll(() => diagnostics.disable())

describe('diagnostics: React layer', () => {
  it('exposes the API on the global __teamplay__ object next to DEBUG', () => {
    expect(window.__teamplay__.diagnostics).toBe(diagnostics)
    expect(typeof window.__teamplay__.DEBUG).toBe('object')
    diagnostics.disable()
    expect(window.__teamplay__.diagnostics).toBeUndefined()
  })

  it('tracks useSub() leases, observer wrappers and reactions through mount and unmount', async () => {
    const Component = observer(function DiagnosedUser ({ id }) {
      const $user = useSub($[COLLECTION][id])
      return el('span', {}, $user.name.get())
    })
    const view = render(el(Component, { id: 'd1' }))
    await waitForContent(view.container, 'first')

    let snapshot = diagnostics.snapshot({ details: true })
    expect(snapshot.react.leases.tracked).toBe(1)
    expect(snapshot.react.leases.committed).toBe(1)
    expect(snapshot.react.leases.uncommitted).toBe(0)
    expect(snapshot.react.leases.churnByDesc[`doc ${COLLECTION}.d1`]).toBe(1)
    expect(snapshot.react.adms.subscribed).toBeGreaterThanOrEqual(1)
    expect(snapshot.react.adms.cacheKeys.subscriptionLease).toBe(1)
    expect(snapshot.react.observers.byName.DiagnosedUser).toBe(1)
    expect(snapshot.react.observers.withoutMountedWrapper).toBe(0)
    expect(snapshot.docs.byCollection[COLLECTION]).toBe(1)

    // re-subscribing to another doc replaces the lease
    view.rerender(el(Component, { id: 'd2' }))
    await waitForContent(view.container, 'second')
    await wait(50)
    await docSubscriptions.flushPendingDestroys()
    snapshot = diagnostics.snapshot()
    expect(snapshot.react.leases.tracked).toBe(1)
    expect(snapshot.react.leases.churnByDesc[`doc ${COLLECTION}.d2`]).toBe(1)
    expect(snapshot.docs.byCollection[COLLECTION]).toBe(1)

    view.unmount()
    await wait(50)
    await docSubscriptions.flushPendingDestroys()
    snapshot = diagnostics.snapshot()
    expect(snapshot.react.leases.tracked).toBe(0)
    expect(snapshot.react.adms.tracked).toBe(0)
    expect(snapshot.react.observers.tracked).toBe(0)
    expect(snapshot.docs.byCollection[COLLECTION]).toBeUndefined()

    const counters = diagnostics.getCounters()
    expect(counters['react.lease.create']).toBeGreaterThanOrEqual(2)
    expect((counters['react.lease.release'] || 0) + (counters['react.lease.releaseUncommitted'] || 0)).toBe(counters['react.lease.create'])
    expect(counters['react.adm.create']).toBe(counters['react.adm.destroy'])
    const leaseEvents = diagnostics.getTrace({ type: 'react.lease' })
    expect(leaseEvents.map(event => event.type)).toEqual(expect.arrayContaining(['react.lease.create', 'react.lease.commit', 'react.lease.release']))
    expect(typeof leaseEvents[0].stack).toBe('string')
    expect(diagnostics.checkLeaks().findings.filter(finding => finding.code.startsWith('react.'))).toEqual([])
  })

  it('releases leases of a Suspense render that never committed', async () => {
    setTestThrottling(100)
    const Component = observer(function SlowUser () {
      const $user = useSub($[COLLECTION].d1)
      return el('span', {}, $user.name.get())
    })
    const view = render(el(Suspense, { fallback: el('span', {}, 'Loading') }, el(Component)))
    await waitFor(() => expect(diagnostics.snapshot().react.leases.uncommitted).toBe(1))
    view.unmount()
    await waitFor(() => expect(diagnostics.snapshot().react.leases.tracked).toBe(0))
    await wait(150)
    await docSubscriptions.flushPendingDestroys()
    const snapshot = diagnostics.snapshot()
    expect(snapshot.react.pollers.active).toBe(0)
    expect(snapshot.docs.byCollection[COLLECTION]).toBeUndefined()
    expect(diagnostics.checkLeaks().findings.filter(finding => finding.severity === 'error')).toEqual([])
  })

  it('accounts for every live observer reaction after StrictMode mounts (mounted or reported as orphaned)', async () => {
    const Component = observer(function StrictUser () {
      const $user = useSub($[COLLECTION].d1)
      return el('span', {}, $user.name.get())
    })
    for (let i = 0; i < 3; i++) {
      const view = render(el(StrictMode, {}, el(Component)))
      await waitForContent(view.container, 'first')
      view.unmount()
      await wait(50)
    }
    await runGc()
    const snapshot = diagnostics.snapshot({ details: true })
    const counters = diagnostics.getCounters()
    const alive = counters['react.observer.create'] - counters['react.observer.destroy']
    // Nothing is mounted any more: whatever reaction is still alive must be reported.
    expect(snapshot.react.observers.tracked).toBe(alive)
    expect(snapshot.react.observers.orphaned).toBe(alive)
    const finding = diagnostics.checkLeaks().findings.find(item => item.code === 'react.orphanObservers')
    expect(finding?.count ?? 0).toBe(alive)
  })

  it('does not keep signals or subscriptions alive', async () => {
    const hash = JSON.stringify([COLLECTION, 'd1'])
    await runGc()
    const cacheSize = cache.size
    const Component = observer(function GcUser () {
      const $user = useSub($[COLLECTION].d1)
      return el('span', {}, $user.name.get())
    })
    const view = render(el(Component))
    await waitForContent(view.container, 'first')
    diagnostics.snapshot({ details: true })
    diagnostics.checkLeaks()
    view.unmount()
    await wait(50)
    await runGc()
    expect(docSubscriptions.docs.has(hash)).toBe(false)
    expect(cache.size).toBe(cacheSize)
  })
})

async function createDoc (id, data) {
  const doc = getConnection().get(COLLECTION, id)
  await new Promise((resolve, reject) => doc.fetch(err => err ? reject(err) : resolve()))
  if (doc.type != null) return
  await new Promise((resolve, reject) => doc.create(data, err => err ? reject(err) : resolve()))
}

async function waitForContent (container, content) {
  await waitFor(() => expect(container.textContent).toBe(content))
}

async function wait (ms) {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, ms))
  })
}
