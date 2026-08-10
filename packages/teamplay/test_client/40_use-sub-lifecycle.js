import { createElement as el, StrictMode, Suspense } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { getRootSignal, observer, useBatchSub, useSub } from '../src/index.ts'
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

  it('keeps ready batch ownership while a sibling subscription is pending', async () => {
    const subscription = pauseQuerySubscription('slow-batch')
    try {
      const view = render(el(StaggeredBatchPage))
      await waitForContent(view.container, 'Loading')
      await wait(100)

      expect(getQueryOwnerCount('slow-batch')).toBe(1)
      expect(getQueryOwnerCount('fast-batch')).toBe(1)

      await subscription.resume()
      await waitForContent(view.container, 'Ready')
    } finally {
      await subscription.resume()
      subscription.restore()
      await waitForLeaseCleanup()
    }
  })

  it('releases pending query ownership when a suspended page unmounts', async () => {
    const subscription = pauseQuerySubscription('pending-unmount')
    try {
      const view = render(el(PendingSubscriptionPage))
      await waitFor(() => expect(getQueryOwnerCount('pending-unmount')).toBe(1))

      view.unmount()
      await wait(100)

      expect(getQueryOwnerCount('pending-unmount')).toBe(0)
    } finally {
      await subscription.resume()
      subscription.restore()
      await waitForLeaseCleanup()
    }
  })

  it('does not let a released pending lease unsubscribe a later owner when it resolves', async () => {
    const marker = 'pending-owner-handoff'
    const subscription = pauseQuerySubscription(marker)
    const Component = createPlainQueryComponent(marker)
    let firstView
    let secondView

    try {
      firstView = render(el(Component))
      await waitFor(() => expect(getQueryOwnerCount(marker)).toBe(1))

      secondView = render(el(Component))
      await waitFor(() => expect(getQueryOwnerCount(marker)).toBe(2))

      firstView.unmount()
      await waitFor(() => expect(getQueryOwnerCount(marker)).toBe(1))

      await act(async () => {
        await subscription.resume()
      })
      await waitForLeaseCleanup()

      expect(getQueryOwnerCount(marker)).toBe(1)
      await waitForContent(secondView.container, 'Ready')
      expect(secondView.container.textContent).toBe('Ready')
    } finally {
      firstView?.unmount()
      secondView?.unmount()
      await subscription.resume()
      subscription.restore()
      await waitForLeaseCleanup()
    }
  })

  it('keeps earlier query data through a chain of suspended subscriptions', async () => {
    setTestThrottling(80)
    const renderStates = []

    const Component = observer(function ChainedSubscriptionsPage () {
      const $firstQuery = useChainedQuery(0)
      useChainedQuery(1)
      useChainedQuery(2)
      useChainedQuery(3)
      useChainedQuery(4)
      useChainedQuery(5)
      const state = Array.isArray($firstQuery.get()) ? 'Ready' : 'Premature'
      renderStates.push(state)
      return el('span', {}, state)
    }, { suspenseProps: { fallback: el('span', {}, 'Loading') } })

    const view = render(el(Component))
    await waitForContent(view.container, 'Ready', { timeout: 5000 })

    expect(renderStates).not.toContain('Premature')
    expect(view.container.textContent).toBe('Ready')
  })

  it.each([
    ['useSub', false],
    ['useBatchSub', true]
  ])('keeps %s suspended until query data is materialized', async (_name, batch) => {
    const collection = `useSubMaterialization_${batch ? 'batch' : 'plain'}`
    const marker = `materialization-${batch ? 'batch' : 'plain'}`
    const materialization = delayQueryMaterialization(collection, marker)

    try {
      const PlainComponent = observer(function PlainMaterializationPage () {
        const $query = useSub($testRoot[collection], { marker }, { defer: false })
        const docs = $query.get()
        return el('span', {}, Array.isArray(docs) ? 'Ready' : 'Premature')
      }, { suspenseProps: { fallback: el('span', {}, 'Loading') } })
      const BatchComponent = observer(function BatchMaterializationPage () {
        const $query = useBatchSub($testRoot[collection], { marker }, { defer: false })
        useBatchSub()
        const docs = $query.get()
        return el('span', {}, Array.isArray(docs) ? 'Ready' : 'Premature')
      }, { suspenseProps: { fallback: el('span', {}, 'Loading') } })
      const Component = batch ? BatchComponent : PlainComponent

      const view = render(el(Component))
      await waitForContent(view.container, 'Loading')
      await wait(20)
      expect(view.container.textContent).toBe('Loading')

      await materialization.resume()
      await waitForContent(view.container, 'Ready')
    } finally {
      await materialization.resume()
      materialization.restore()
    }
  })
})

function useChainedQuery (index) {
  return useSub(
    $testRoot.useSubLeaseChainedAttempts,
    { marker: `chained-subscription-${index}` },
    { defer: false }
  )
}

function createQueryComponent (marker) {
  return observer(function QueryComponent ({ renderId }) {
    useBatchSub($testRoot[`useSubLease_${marker}`], { marker }, { defer: false })
    useBatchSub()
    return el('span', {}, `render-${renderId}`)
  })
}

function createPlainQueryComponent (marker) {
  return observer(function PlainQueryComponent () {
    const $query = useSub(
      $testRoot[`useSubLease_${marker}`],
      { marker },
      { defer: false }
    )
    return el('span', {}, Array.isArray($query.get()) ? 'Ready' : 'Premature')
  }, { suspenseProps: { fallback: el('span', {}, 'Loading') } })
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

const StaggeredBatchPage = observer(function StaggeredBatchPage () {
  useBatchSub($testRoot.useSubLeaseStaggered, { marker: 'fast-batch' }, { defer: false })
  useBatchSub($testRoot.useSubLeaseStaggered, { marker: 'slow-batch' }, { defer: false })
  useBatchSub()
  return el('span', {}, 'Ready')
}, { suspenseProps: { fallback: el('span', {}, 'Loading') } })

const PendingSubscriptionPage = observer(function PendingSubscriptionPage () {
  useBatchSub($testRoot.useSubLeasePending, { marker: 'pending-unmount' }, { defer: false })
  useBatchSub()
  return el('span', {}, 'Ready')
})

function pauseQuerySubscription (marker) {
  const queryProto = querySubscriptions.QueryClass.prototype
  const originalSubscribe = queryProto._subscribe
  let pendingPromise
  let resume

  queryProto._subscribe = function (...args) {
    if (this.params?.marker !== marker) return originalSubscribe.apply(this, args)
    if (pendingPromise) return pendingPromise

    let resumed = false
    pendingPromise = new Promise((resolve, reject) => {
      resume = () => {
        if (resumed) return
        resumed = true
        Promise.resolve(originalSubscribe.apply(this, args)).then(resolve, reject)
      }
    })
    return pendingPromise
  }

  return {
    async resume () {
      resume?.()
      await pendingPromise
    },
    restore () {
      queryProto._subscribe = originalSubscribe
    }
  }
}

function delayQueryMaterialization (collection, marker) {
  const queryProto = querySubscriptions.QueryClass.prototype
  const originalSyncRootData = queryProto._syncRootData
  let pendingPromise
  let resume

  queryProto._syncRootData = function (...args) {
    if (this.collectionName !== collection || this.params?.marker !== marker) {
      return originalSyncRootData.apply(this, args)
    }
    if (!pendingPromise) {
      pendingPromise = new Promise(resolve => {
        resume = () => {
          originalSyncRootData.apply(this, args)
          resolve()
        }
      })
    }
  }

  return {
    async resume () {
      resume?.()
      await pendingPromise
    },
    restore () {
      queryProto._syncRootData = originalSyncRootData
    }
  }
}

function getQueryOwnerCount (marker) {
  for (const ownerKey of querySubscriptions.ownerMeta.keys()) {
    if (querySubscriptions.ownerMeta.get(ownerKey)?.params?.marker !== marker) continue
    return querySubscriptions.ownerSubscribeCount.get(ownerKey) || 0
  }
  return 0
}

async function waitForContent (container, content, options) {
  await waitFor(() => expect(container.textContent).toBe(content), options)
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
