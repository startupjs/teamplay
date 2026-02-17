import { createElement as el, Fragment } from 'react'
import { describe, it, afterEach, beforeEach, expect, beforeAll as before } from '@jest/globals'
import { act, cleanup, render } from '@testing-library/react'
import { $, useSub, observer, sub, aggregation } from '../index.js'
import { docSubscriptions } from '../orm/Doc.js'
import { querySubscriptions } from '../orm/Query.js'
import { aggregationSubscriptions } from '../orm/Aggregation.js'
import { runGc, cache } from '../test/_helpers.js'
import connect from '../connect/test.js'

before(connect)
beforeEach(() => {
  expect(cache.size).toBe(1)
})
afterEach(cleanup)
afterEach(runGc)

function fr (...children) {
  return el(Fragment, {}, ...children)
}

async function wait (ms = 30) {
  return await act(async () => {
    await new Promise(resolve => setTimeout(resolve, ms))
  })
}

describe('GC cleanup: doc subscriptions', () => {
  it('doc subscription is cleaned up after unmount + GC', async () => {
    const Component = observer(() => {
      const $user = useSub($.gcDoc1.d1)
      return el('span', {}, $user.name.get() || 'empty')
    })
    const { container, unmount } = render(el(Component))
    await wait()
    expect(container.textContent).toBe('empty')

    const initialDocsSize = docSubscriptions.docs.size
    const initialSubCountSize = docSubscriptions.subCount.size
    expect(initialDocsSize).toBeGreaterThanOrEqual(1)
    expect(initialSubCountSize).toBeGreaterThanOrEqual(1)

    unmount()
    await runGc()

    expect(docSubscriptions.docs.size).toBeLessThan(initialDocsSize)
    expect(docSubscriptions.subCount.size).toBeLessThan(initialSubCountSize)
  })
})

describe('GC cleanup: query subscriptions', () => {
  it('query subscription is cleaned up after unmount + GC', async () => {
    const $john = await sub($.gcQuery1.q1)
    $john.set({ name: 'John', status: 'active' })
    await wait()

    const Component = observer(() => {
      const $users = useSub($.gcQuery1, { status: 'active' })
      return el('span', {}, $users.map($u => $u.name.get()).join(','))
    }, { suspenseProps: { fallback: el('span', {}, 'Loading...') } })

    const { container, unmount } = render(el(Component))
    await wait()
    expect(container.textContent).toBe('John')

    const initialQueriesSize = querySubscriptions.queries.size
    const initialSubCountSize = querySubscriptions.subCount.size
    expect(initialQueriesSize).toBeGreaterThanOrEqual(1)

    unmount()
    await runGc()

    expect(querySubscriptions.queries.size).toBeLessThan(initialQueriesSize)
    expect(querySubscriptions.subCount.size).toBeLessThan(initialSubCountSize)
  })
})

describe('GC cleanup: aggregation subscriptions', () => {
  it('aggregation subscription is cleaned up after unmount + GC', async () => {
    const collection = 'gcAgg1'
    const $item = await sub($[collection].a1)
    $item.set({ name: 'Item1', active: true })
    await wait()

    const $$agg = aggregation(({ active }) => [{ $match: { active } }])
    const Component = observer(() => {
      const $items = useSub($$agg, { $collection: collection, active: true })
      return el('span', {}, $items.get()?.length ?? 'loading')
    }, { suspenseProps: { fallback: el('span', {}, 'Loading...') } })

    const { container, unmount } = render(el(Component))
    await wait()
    expect(container.textContent).not.toBe('Loading...')

    const initialQueriesSize = aggregationSubscriptions.queries.size
    const initialSubCountSize = aggregationSubscriptions.subCount.size
    expect(initialQueriesSize).toBeGreaterThanOrEqual(1)

    unmount()
    await runGc()

    expect(aggregationSubscriptions.queries.size).toBeLessThan(initialQueriesSize)
    expect(aggregationSubscriptions.subCount.size).toBeLessThan(initialSubCountSize)
  })
})

describe('GC cleanup: signal cache', () => {
  it('signal cache returns to baseline after unmount + GC', async () => {
    const initialCacheSize = cache.size

    const Component = observer(() => {
      const $user = useSub($.gcCache1.c1)
      return el('span', {}, $user.name.get() || 'empty')
    })
    const { unmount } = render(el(Component))
    await wait()

    expect(cache.size).toBeGreaterThan(initialCacheSize)

    unmount()
    await runGc()

    expect(cache.size).toBe(initialCacheSize)
  })
})

describe('GC cleanup: shared doc subscription - partial unmount', () => {
  it('shared doc subscription stays active when only one component unmounts', async () => {
    const Component1 = observer(() => {
      const $user = useSub($.gcShared1.s1)
      return el('span', { id: 'c1' }, $user.name.get() || 'empty1')
    })
    const Component2 = observer(() => {
      const $user = useSub($.gcShared1.s1)
      return el('span', { id: 'c2' }, $user.name.get() || 'empty2')
    })

    const result1 = render(el(Component1))
    const result2 = render(el(Component2))
    await wait()

    const docsAfterMount = docSubscriptions.docs.size

    // Unmount only one
    result1.unmount()
    await runGc()

    // Subscription should still be active because Component2 holds a reference
    expect(docSubscriptions.docs.size).toBe(docsAfterMount)

    // Unmount second
    result2.unmount()
    await runGc()

    // Now it should be cleaned up
    expect(docSubscriptions.docs.size).toBeLessThan(docsAfterMount)
  })
})

describe('GC cleanup: shared query subscription - partial unmount', () => {
  it('shared query stays active when only one component unmounts', async () => {
    const $john = await sub($.gcSharedQ1.sq1)
    $john.set({ name: 'John', role: 'admin' })
    await wait()

    const Component1 = observer(() => {
      const $users = useSub($.gcSharedQ1, { role: 'admin' })
      return el('span', { id: 'c1' }, $users.map($u => $u.name.get()).join(','))
    }, { suspenseProps: { fallback: el('span', {}, 'Loading...') } })

    const Component2 = observer(() => {
      const $users = useSub($.gcSharedQ1, { role: 'admin' })
      return el('span', { id: 'c2' }, $users.map($u => $u.name.get()).join(','))
    }, { suspenseProps: { fallback: el('span', {}, 'Loading...') } })

    const result1 = render(el(Component1))
    const result2 = render(el(Component2))
    await wait()

    const queriesAfterMount = querySubscriptions.queries.size

    // Unmount only one
    result1.unmount()
    await runGc()

    // Query subscription should still be active
    expect(querySubscriptions.queries.size).toBe(queriesAfterMount)

    // Unmount second
    result2.unmount()
    await runGc()

    // Now it should be cleaned up
    expect(querySubscriptions.queries.size).toBeLessThan(queriesAfterMount)
  })
})

describe('GC cleanup: repeated mount/unmount cycles', () => {
  it('repeated doc mount/unmount - no memory leaks', async () => {
    const initialDocsSize = docSubscriptions.docs.size
    const initialSubCountSize = docSubscriptions.subCount.size

    for (let i = 0; i < 3; i++) {
      const docId = `cycle_${i}`
      const Component = observer(() => {
        const $user = useSub($.gcCycle1[docId])
        return el('span', {}, $user.name.get() || 'empty')
      })
      const { unmount } = render(el(Component))
      await wait()
      unmount()
      cleanup()
      await runGc()
    }

    expect(docSubscriptions.docs.size).toBe(initialDocsSize)
    expect(docSubscriptions.subCount.size).toBe(initialSubCountSize)
  })

  it('repeated query mount/unmount - no memory leaks', async () => {
    for (let i = 0; i < 3; i++) {
      const $item = await sub($.gcCycleQ1[`cq_${i}`])
      $item.set({ name: `Item${i}`, level: i })
    }
    await wait()

    const initialQueriesSize = querySubscriptions.queries.size
    const initialSubCountSize = querySubscriptions.subCount.size

    for (let i = 0; i < 3; i++) {
      const Component = observer(() => {
        const $items = useSub($.gcCycleQ1, { level: i })
        return el('span', {}, $items.map($u => $u.name.get()).join(','))
      }, { suspenseProps: { fallback: el('span', {}, 'Loading...') } })
      const { unmount } = render(el(Component))
      await wait()
      unmount()
      cleanup()
      await runGc()
    }

    expect(querySubscriptions.queries.size).toBe(initialQueriesSize)
    expect(querySubscriptions.subCount.size).toBe(initialSubCountSize)
  })

  it('repeated aggregation mount/unmount - no memory leaks', async () => {
    const collection = 'gcCycleA1'
    for (let i = 0; i < 3; i++) {
      const $item = await sub($[collection][`ca_${i}`])
      $item.set({ name: `AggItem${i}`, score: i * 10 })
    }
    await wait()

    const initialQueriesSize = aggregationSubscriptions.queries.size
    const initialSubCountSize = aggregationSubscriptions.subCount.size

    for (let i = 0; i < 3; i++) {
      const minScore = i * 10
      const $$agg = aggregation(({ minScore }) => [{ $match: { score: { $gte: minScore } } }])
      const Component = observer(() => {
        const $items = useSub($$agg, { $collection: collection, minScore })
        return el('span', {}, String($items.get()?.length ?? 'loading'))
      }, { suspenseProps: { fallback: el('span', {}, 'Loading...') } })
      const { unmount } = render(el(Component))
      await wait()
      unmount()
      cleanup()
      await runGc()
    }

    expect(aggregationSubscriptions.queries.size).toBe(initialQueriesSize)
    expect(aggregationSubscriptions.subCount.size).toBe(initialSubCountSize)
  })
})

describe('GC cleanup: switching subscription targets', () => {
  it('switching doc subscription target cleans up old subscription', async () => {
    const initialDocs = docSubscriptions.docs.size

    const Component = observer(({ docId }) => {
      const $user = useSub($.gcSwitch1[docId])
      return el('span', {}, $user.name.get() || 'empty')
    })

    const { rerender, unmount } = render(el(Component, { docId: 'sw1' }))
    await wait()

    expect(docSubscriptions.docs.size).toBeGreaterThan(initialDocs)

    // Switch to a different doc
    rerender(el(Component, { docId: 'sw2' }))
    await wait()
    // Run GC to clean up the old subscription signal that is no longer referenced
    await runGc()

    // After switching and GC, the new doc should be subscribed.
    // The old one should eventually be cleaned up.
    // Due to useDeferredValue, the old signal may linger briefly,
    // so we do an additional wait + GC cycle.
    await wait()
    await runGc()

    unmount()
    await runGc()

    // Everything cleaned up after full unmount
    expect(docSubscriptions.docs.size).toBe(initialDocs)
  })

  it('switching query params cleans up old query subscription', async () => {
    const $john = await sub($.gcSwitchQ1.sq1)
    const $jane = await sub($.gcSwitchQ1.sq2)
    $john.set({ name: 'John', team: 'alpha' })
    $jane.set({ name: 'Jane', team: 'beta' })
    await wait()

    const Component = observer(({ team }) => {
      const $users = useSub($.gcSwitchQ1, { team })
      return el('span', {}, $users.map($u => $u.name.get()).join(','))
    }, { suspenseProps: { fallback: el('span', {}, 'Loading...') } })

    const { container, rerender, unmount } = render(el(Component, { team: 'alpha' }))
    await wait()
    expect(container.textContent).toBe('John')

    const queriesAfterFirst = querySubscriptions.queries.size

    // Switch to different query params
    rerender(el(Component, { team: 'beta' }))
    await wait()
    await runGc()

    // Old query cleaned up, new one active - count should stay the same
    expect(querySubscriptions.queries.size).toBe(queriesAfterFirst)
    expect(container.textContent).toBe('Jane')

    unmount()
    await runGc()

    expect(querySubscriptions.queries.size).toBeLessThan(queriesAfterFirst)
  })
})

describe('GC cleanup: mixed subscription types in one component', () => {
  it('all subscription types clean up on unmount', async () => {
    const collection = 'gcMixed1'
    const $$agg = aggregation(({ active }) => [{ $match: { active } }])

    // Record baseline before any subscriptions
    const initialDocs = docSubscriptions.docs.size
    const initialQueries = querySubscriptions.queries.size
    const initialAggs = aggregationSubscriptions.queries.size

    // Setup data inside the component to avoid creating subscriptions outside
    const Component = observer(() => {
      const $doc = useSub($[collection].m1)
      const $query = useSub($[collection], { active: true })
      const $agg = useSub($$agg, { $collection: collection, active: true })
      return fr(
        el('span', { id: 'doc' }, $doc.name.get() || 'empty'),
        el('span', { id: 'query' }, String($query.map($u => $u.name.get()).join(','))),
        el('span', { id: 'agg' }, String($agg.get()?.length ?? 'loading'))
      )
    }, { suspenseProps: { fallback: el('span', {}, 'Loading...') } })

    const { unmount } = render(el(Component))
    await wait()

    // After rendering, all subscription types should have new entries
    expect(docSubscriptions.docs.size).toBeGreaterThan(initialDocs)
    expect(querySubscriptions.queries.size).toBeGreaterThan(initialQueries)
    expect(aggregationSubscriptions.queries.size).toBeGreaterThan(initialAggs)

    unmount()
    await runGc()

    expect(docSubscriptions.docs.size).toBe(initialDocs)
    expect(querySubscriptions.queries.size).toBe(initialQueries)
    expect(aggregationSubscriptions.queries.size).toBe(initialAggs)
  })
})

describe('GC cleanup: rapid mount/unmount', () => {
  it('immediate unmount before subscription completes does not leak', async () => {
    const initialDocsSize = docSubscriptions.docs.size
    const initialSubCountSize = docSubscriptions.subCount.size

    const Component = observer(() => {
      const $user = useSub($.gcRapid1.r1)
      return el('span', {}, $user.name.get() || 'empty')
    })

    // Render and immediately unmount without waiting for subscription
    const { unmount } = render(el(Component))
    unmount()
    await wait()
    await runGc()

    expect(docSubscriptions.docs.size).toBe(initialDocsSize)
    expect(docSubscriptions.subCount.size).toBe(initialSubCountSize)
  })
})
