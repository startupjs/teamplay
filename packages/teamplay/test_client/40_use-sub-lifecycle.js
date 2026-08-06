import { createElement as el, StrictMode, Suspense } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { getRootSignal, observer, useBatchSub } from '../src/index.ts'
import { querySubscriptions } from '../src/orm/Query.js'
import { aggregationSubscriptions } from '../src/orm/Aggregation.js'
import {
  getSubscriptionGcDelay,
  setSubscriptionGcDelay
} from '../src/orm/subscriptionGcDelay.ts'
import {
  resetTestThrottling,
  setTestThrottling
} from '../src/react/useSub.ts'
import connect from '../src/connect/test.js'

beforeAll(connect)

const baselineGcDelay = getSubscriptionGcDelay()
const $testRoot = getRootSignal({ rootId: 'use-sub-lifecycle-tests' })

beforeEach(async () => {
  setSubscriptionGcDelay(20)
  await querySubscriptions.clear()
  await aggregationSubscriptions.clear()
})

afterEach(cleanup)
afterEach(async () => {
  resetTestThrottling()
  await querySubscriptions.clear()
  await aggregationSubscriptions.clear()
  setSubscriptionGcDelay(baselineGcDelay)
})

describe('useSub subscription ownership', () => {
  it('acquires a query only once across ordinary rerenders', async () => {
    const Component = createQueryComponent('rerender')
    const view = render(el(Component, { renderId: 0 }))

    await waitForContent(view.container, 'render-0')
    await waitForLeaseCleanup()

    for (let renderId = 1; renderId <= 10; renderId++) {
      view.rerender(el(Component, { renderId }))
    }
    await waitForContent(view.container, 'render-10')
    await waitForLeaseCleanup()

    expect(sum(querySubscriptions.ownerSubscribeCount.values())).toBe(1)
    expect(querySubscriptions.queries.size).toBe(1)
  })

  it('releases query ownership on every unmount without waiting for GC', async () => {
    const Component = createQueryComponent('mount-cycle')

    for (let mountId = 0; mountId < 5; mountId++) {
      const view = render(el(Component, { renderId: mountId }))
      await waitForContent(view.container, `render-${mountId}`)
      view.unmount()
      await waitForLeaseCleanup()
    }

    expect(querySubscriptions.ownerMeta.size).toBe(0)
    expect(querySubscriptions.queries.size).toBe(0)
    expect(sum(querySubscriptions.ownerSubscribeCount.values())).toBe(0)
  })

  it('releases batched aggregation ownership across repeated page unmounts', async () => {
    for (let mountId = 0; mountId < 5; mountId++) {
      const view = render(el(BatchedAggregationPage, { mountId }))
      await waitForContent(view.container, `page-${mountId}`)
      view.unmount()
      await waitForLeaseCleanup()
    }

    expect(aggregationSubscriptions.ownerMeta.size).toBe(0)
    expect(aggregationSubscriptions.queries.size).toBe(0)
    expect(sum(aggregationSubscriptions.ownerSubscribeCount.values())).toBe(0)
  })

  it('keeps its subscription through StrictMode effect replay', async () => {
    const Component = createQueryComponent('strict-mode')
    const view = render(el(StrictMode, {}, el(Component, { renderId: 1 })))

    await waitForContent(view.container, 'render-1')
    await waitForLeaseCleanup()
    expect(sum(querySubscriptions.ownerSubscribeCount.values())).toBe(1)
    expect(querySubscriptions.queries.size).toBe(1)

    view.unmount()
    await waitForLeaseCleanup()
    expect(querySubscriptions.ownerMeta.size).toBe(0)
    expect(querySubscriptions.queries.size).toBe(0)
  })

  it('keeps a shared query until its final component owner unmounts', async () => {
    const QueryComponent = createQueryComponent('shared')
    const view = render(el(SharedQueries, { QueryComponent, second: true }))

    await waitForContent(view.container, 'render-1render-2')
    await waitForLeaseCleanup()
    expect(sum(querySubscriptions.ownerSubscribeCount.values())).toBe(2)
    expect(querySubscriptions.queries.size).toBe(1)

    view.rerender(el(SharedQueries, { QueryComponent, second: false }))
    await waitForContent(view.container, 'render-1')
    await waitForLeaseCleanup()
    expect(sum(querySubscriptions.ownerSubscribeCount.values())).toBe(1)
    expect(querySubscriptions.queries.size).toBe(1)

    view.unmount()
    await waitForLeaseCleanup()
    expect(querySubscriptions.ownerMeta.size).toBe(0)
    expect(querySubscriptions.queries.size).toBe(0)
  })

  it('releases a subscription from an abandoned Suspense render', async () => {
    setTestThrottling(100)
    const Component = createQueryComponent('abandoned')
    const view = render(
      el(Suspense, { fallback: el('span', {}, 'Loading') }, el(Component, { renderId: 1 }))
    )

    await waitFor(() => {
      expect(sum(querySubscriptions.ownerSubscribeCount.values())).toBeGreaterThan(0)
    })
    view.unmount()
    await waitFor(() => {
      expect(querySubscriptions.ownerMeta.size).toBe(0)
      expect(querySubscriptions.queries.size).toBe(0)
    })
  })
})

function createQueryComponent (marker) {
  return observer(function QueryComponent ({ renderId }) {
    useBatchSub($testRoot[`useSubLease_${marker}`], { marker }, { defer: false })
    useBatchSub()
    return el('span', {}, `render-${renderId}`)
  })
}

function SharedQueries ({ QueryComponent, second }) {
  return el(
    'div',
    {},
    el(QueryComponent, { key: 'first', renderId: 1 }),
    second ? el(QueryComponent, { key: 'second', renderId: 2 }) : null
  )
}

const BatchedAggregationPage = observer(function BatchedAggregationPage ({ mountId }) {
  useBatchSub($testRoot.useSubLeaseAggregations, {
    $aggregate: [{ $match: { marker: `list-${mountId}` } }]
  }, { defer: false })
  useBatchSub($testRoot.useSubLeaseAggregations, {
    $aggregate: [{ $match: { marker: `count-${mountId}` } }]
  }, { defer: false })
  useBatchSub()
  return el('span', {}, `page-${mountId}`)
})

async function waitForContent (container, content) {
  await waitFor(() => expect(container.textContent).toBe(content))
}

async function waitForLeaseCleanup () {
  await wait(50)
}

async function wait (ms) {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, ms))
  })
}

function sum (values) {
  let total = 0
  for (const value of values) total += value || 0
  return total
}
