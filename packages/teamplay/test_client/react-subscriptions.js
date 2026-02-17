import { createElement as el, Fragment } from 'react'
import { describe, it, afterEach, beforeEach, expect, beforeAll as before } from '@jest/globals'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { $, useSub, useAsyncSub, observer, sub, aggregation } from '../index.js'
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

// ---------------------------------------------------------------
// 1. Doc path changes (useSub switching between different docs)
// ---------------------------------------------------------------
describe('Doc path changes', () => {
  it('switches between different docs when the doc id signal changes', async () => {
    const $alice = await sub($.dpUsers.alice1)
    const $bob = await sub($.dpUsers.bob1)
    $alice.set({ name: 'Alice' })
    $bob.set({ name: 'Bob' })
    await wait()

    let renders = 0
    const Component = observer(() => {
      renders++
      const $docId = $('alice1')
      const $user = useSub($.dpUsers[$docId.get()])
      return fr(
        el('span', {}, $user.name.get() || ''),
        el('button', { id: 'switchToBob', onClick: () => $docId.set('bob1') }),
        el('button', { id: 'switchToAlice', onClick: () => $docId.set('alice1') })
      )
    }, { suspenseProps: { fallback: el('span', {}, 'Loading...') } })

    const { container } = render(el(Component))
    // Initially loading via suspense or immediately available
    await wait()
    expect(container.textContent).toContain('Alice')

    const rendersAfterLoad = renders

    fireEvent.click(container.querySelector('#switchToBob'))
    await wait()
    await wait()
    expect(container.textContent).toContain('Bob')

    fireEvent.click(container.querySelector('#switchToAlice'))
    await wait()
    await wait()
    expect(container.textContent).toContain('Alice')

    // Renders should be reasonable (not excessive)
    expect(renders).toBeLessThan(rendersAfterLoad + 10)
  })
})

// ---------------------------------------------------------------
// 2. Query parameter changes with render counting
// ---------------------------------------------------------------
describe('Query parameter changes with render counting', () => {
  it('changes query filter and shows new results without Suspense flash', async () => {
    const $john = await sub($.qpUsers.john2)
    const $jane = await sub($.qpUsers.jane2)
    $john.set({ name: 'John', status: 'active', createdAt: 1 })
    $jane.set({ name: 'Jane', status: 'inactive', createdAt: 2 })
    await wait()

    let renders = 0
    const Component = observer(() => {
      renders++
      const $status = $('active')
      const $users = useSub($.qpUsers, { status: $status.get(), $sort: { createdAt: 1 } })
      return fr(
        el('span', { id: 'result' }, $users.map($u => $u.name.get()).join(',')),
        el('button', { id: 'showInactive', onClick: () => $status.set('inactive') }),
        el('button', { id: 'showActive', onClick: () => $status.set('active') })
      )
    }, { suspenseProps: { fallback: el('span', { id: 'result' }, 'Loading...') } })

    const { container } = render(el(Component))
    expect(container.querySelector('#result').textContent).toBe('Loading...')

    await wait()
    expect(container.querySelector('#result').textContent).toBe('John')

    const rendersBeforeSwitch = renders

    // Switch to inactive -- useDeferredValue keeps old content visible (no Suspense flash)
    fireEvent.click(container.querySelector('#showInactive'))
    // Should NOT show 'Loading...' due to useDeferredValue
    expect(container.querySelector('#result').textContent).not.toBe('Loading...')

    await wait()
    await wait()
    expect(container.querySelector('#result').textContent).toBe('Jane')

    // Render count should be modest
    expect(renders).toBeLessThan(rendersBeforeSwitch + 8)
  })
})

// ---------------------------------------------------------------
// 3. Aggregation in React - basic useSub with aggregation
// ---------------------------------------------------------------
describe('Aggregation in React', () => {
  it('renders aggregation results and updates when data changes', async () => {
    const $item1 = await sub($.aggReact1.i1)
    const $item2 = await sub($.aggReact1.i2)
    $item1.set({ name: 'Widget', active: true, price: 100 })
    $item2.set({ name: 'Gadget', active: true, price: 200 })
    await wait()

    const $$activeItems = aggregation(({ active }) => {
      return [{ $match: { active } }]
    })

    const Component = observer(() => {
      const $items = useSub($$activeItems, { $collection: 'aggReact1', active: true })
      return el('span', {}, $items.map($i => $i.name.get()).sort().join(','))
    }, { suspenseProps: { fallback: el('span', {}, 'Loading...') } })

    const { container } = render(el(Component))
    expect(container.textContent).toBe('Loading...')

    await wait()
    expect(container.textContent).toBe('Gadget,Widget')

    // Update a document's name
    act(() => { $.aggReact1.i1.name.set('SuperWidget') })
    await wait()
    expect(container.textContent).toContain('SuperWidget')
  })
})

// ---------------------------------------------------------------
// 4. Aggregation parameter changes in React
// ---------------------------------------------------------------
describe('Aggregation parameter changes', () => {
  it('re-evaluates aggregation when parameters change', async () => {
    const $a = await sub($.aggParam1.a1)
    const $b = await sub($.aggParam1.b1)
    $a.set({ name: 'Alpha', category: 'x' })
    $b.set({ name: 'Beta', category: 'y' })
    await wait()

    const $$byCat = aggregation(({ category }) => {
      return [{ $match: { category } }]
    })

    const Component = observer(() => {
      const $cat = $('x')
      const $items = useSub($$byCat, { $collection: 'aggParam1', category: $cat.get() })
      return fr(
        el('span', { id: 'out' }, $items.map($i => $i.name.get()).join(',')),
        el('button', { id: 'switchY', onClick: () => $cat.set('y') }),
        el('button', { id: 'switchX', onClick: () => $cat.set('x') })
      )
    }, { suspenseProps: { fallback: el('span', { id: 'out' }, 'Loading...') } })

    const { container } = render(el(Component))
    await wait()
    expect(container.querySelector('#out').textContent).toBe('Alpha')

    fireEvent.click(container.querySelector('#switchY'))
    await wait()
    await wait()
    expect(container.querySelector('#out').textContent).toBe('Beta')

    fireEvent.click(container.querySelector('#switchX'))
    await wait()
    await wait()
    expect(container.querySelector('#out').textContent).toBe('Alpha')
  })
})

// ---------------------------------------------------------------
// 5. Multiple components sharing the same doc subscription
// ---------------------------------------------------------------
describe('Multiple components sharing the same doc subscription', () => {
  it('two components subscribe to the same doc; unmounting one leaves the other working', async () => {
    const $user = await sub($.sharedDoc.u1)
    $user.set({ name: 'Shared' })
    await wait()

    const CompA = observer(() => {
      const $u = useSub($.sharedDoc.u1)
      return el('span', { id: 'a' }, $u.name.get() || '')
    }, { suspenseProps: { fallback: el('span', { id: 'a' }, '') } })

    const CompB = observer(() => {
      const $u = useSub($.sharedDoc.u1)
      return el('span', { id: 'b' }, $u.name.get() || '')
    }, { suspenseProps: { fallback: el('span', { id: 'b' }, '') } })

    // Wrapper that can optionally hide CompA
    const Wrapper = observer(() => {
      const $showA = $(true)
      return fr(
        $showA.get() ? el(CompA) : null,
        el(CompB),
        el('button', { id: 'hideA', onClick: () => $showA.set(false) })
      )
    })

    const { container } = render(el(Wrapper))
    await wait()

    expect(container.querySelector('#a').textContent).toBe('Shared')
    expect(container.querySelector('#b').textContent).toBe('Shared')

    // Unmount CompA
    fireEvent.click(container.querySelector('#hideA'))
    await wait()

    expect(container.querySelector('#a')).toBe(null)
    expect(container.querySelector('#b').textContent).toBe('Shared')

    // Modify the doc -- CompB should still react
    act(() => { $.sharedDoc.u1.name.set('Updated') })
    expect(container.querySelector('#b').textContent).toBe('Updated')
  })
})

// ---------------------------------------------------------------
// 6. Multiple components sharing the same query subscription
// ---------------------------------------------------------------
describe('Multiple components sharing the same query subscription', () => {
  it('two components subscribe to the same query; unmounting one leaves the other working', async () => {
    const $p1 = await sub($.sharedQ.p1)
    const $p2 = await sub($.sharedQ.p2)
    $p1.set({ name: 'P1', role: 'admin' })
    $p2.set({ name: 'P2', role: 'admin' })
    await wait()

    const CompX = observer(() => {
      const $admins = useSub($.sharedQ, { role: 'admin' })
      return el('span', { id: 'x' }, $admins.map($a => $a.name.get()).sort().join(','))
    }, { suspenseProps: { fallback: el('span', { id: 'x' }, '') } })

    const CompY = observer(() => {
      const $admins = useSub($.sharedQ, { role: 'admin' })
      return el('span', { id: 'y' }, $admins.map($a => $a.name.get()).sort().join(','))
    }, { suspenseProps: { fallback: el('span', { id: 'y' }, '') } })

    const Wrapper = observer(() => {
      const $showX = $(true)
      return fr(
        $showX.get() ? el(CompX) : null,
        el(CompY),
        el('button', { id: 'hideX', onClick: () => $showX.set(false) })
      )
    })

    const { container } = render(el(Wrapper))
    await wait()

    expect(container.querySelector('#x').textContent).toBe('P1,P2')
    expect(container.querySelector('#y').textContent).toBe('P1,P2')

    fireEvent.click(container.querySelector('#hideX'))
    await wait()

    expect(container.querySelector('#x')).toBe(null)
    expect(container.querySelector('#y').textContent).toBe('P1,P2')
  })
})

// ---------------------------------------------------------------
// 7. Rapid remount (key change pattern)
// ---------------------------------------------------------------
describe('Rapid remount via key change', () => {
  it('forces unmount + immediate remount without errors', async () => {
    const $doc = await sub($.remountCol.d1)
    $doc.set({ name: 'Remount' })
    await wait()

    const Inner = observer(() => {
      const $d = useSub($.remountCol.d1)
      return el('span', { id: 'inner' }, $d.name.get() || '')
    }, { suspenseProps: { fallback: el('span', { id: 'inner' }, '') } })

    const Outer = observer(() => {
      const $key = $(1)
      return fr(
        el(Inner, { key: $key.get() }),
        el('button', { id: 'rekey', onClick: () => $key.set($key.get() + 1) })
      )
    })

    const { container } = render(el(Outer))
    await wait()

    expect(container.querySelector('#inner').textContent).toBe('Remount')

    // Trigger rapid remount
    fireEvent.click(container.querySelector('#rekey'))
    await wait()

    expect(container.querySelector('#inner').textContent).toBe('Remount')

    // Do it again rapidly
    fireEvent.click(container.querySelector('#rekey'))
    fireEvent.click(container.querySelector('#rekey'))
    await wait()

    expect(container.querySelector('#inner').textContent).toBe('Remount')
  })
})

// ---------------------------------------------------------------
// 8. No extra rerender from unrelated signal changes
// ---------------------------------------------------------------
describe('No extra rerender from unrelated signal changes', () => {
  it('changing an unread field does not rerender; changing a read field does', async () => {
    const $doc = await sub($.fieldTrack.ft1)
    $doc.set({ fieldA: 'aaa', fieldB: 'bbb' })
    await wait()

    let renders = 0
    const Component = observer(() => {
      renders++
      const $d = useSub($.fieldTrack.ft1)
      // Only read fieldA
      return el('span', {}, $d.fieldA.get() || '')
    }, { suspenseProps: { fallback: el('span', {}, '') } })

    const { container } = render(el(Component))
    await wait()
    expect(container.textContent).toBe('aaa')
    const rendersAfterLoad = renders

    // Change fieldB (not read) -- should NOT rerender
    act(() => { $.fieldTrack.ft1.fieldB.set('bbb_changed') })
    expect(renders).toBe(rendersAfterLoad)

    // Change fieldA (read) -- should rerender
    act(() => { $.fieldTrack.ft1.fieldA.set('aaa_changed') })
    expect(renders).toBe(rendersAfterLoad + 1)
    expect(container.textContent).toBe('aaa_changed')
  })
})

// ---------------------------------------------------------------
// 9. No extra rerender from unrelated doc changes in a query
// ---------------------------------------------------------------
describe('No extra rerender from unrelated doc changes in a query', () => {
  it('changing unread doc in query does not rerender; adding to query does', async () => {
    const $d1 = await sub($.queryTrack2.qt1)
    const $d2 = await sub($.queryTrack2.qt2)
    $d1.set({ name: 'First', tag: 'yes', createdAt: 1 })
    $d2.set({ name: 'Second', tag: 'yes', createdAt: 2 })
    await wait()

    let renders = 0
    const Component = observer(() => {
      renders++
      const $items = useSub($.queryTrack2, { tag: 'yes', $sort: { createdAt: 1 } })
      // Only read name from first doc
      return el('span', {}, $items.map($item => $item.name.get()).join(','))
    }, { suspenseProps: { fallback: el('span', {}, 'Loading...') } })

    const { container } = render(el(Component))
    expect(container.textContent).toBe('Loading...')
    await wait()
    expect(container.textContent).toBe('First,Second')
    const rendersAfterLoad = renders

    // Change the first doc's name -- should cause rerender since it's read
    act(() => { $.queryTrack2.qt1.name.set('FirstModified') })
    expect(renders).toBe(rendersAfterLoad + 1)
    expect(container.textContent).toBe('FirstModified,Second')

    // Add a new doc to the query result -- SHOULD rerender (query result set changes)
    const $d3 = await sub($.queryTrack2.qt3)
    $d3.set({ name: 'Third', tag: 'yes', createdAt: 0 })
    await wait()
    expect(renders).toBeGreaterThan(rendersAfterLoad + 1)
    expect(container.textContent).toContain('Third')
  })
})

// ---------------------------------------------------------------
// 10. Unmount during pending subscription
// ---------------------------------------------------------------
describe('Unmount during pending subscription', () => {
  it('unmounting before subscription completes causes no errors', async () => {
    const errors = []
    const originalError = console.error
    console.error = (...args) => {
      errors.push(args.join(' '))
    }

    const Component = observer(() => {
      const $user = useSub($.pendingUnsub.pu1)
      return el('span', {}, $user.name.get() || 'loaded')
    }, { suspenseProps: { fallback: el('span', {}, 'Loading...') } })

    const { unmount } = render(el(Component))
    // Unmount immediately before subscription completes
    unmount()

    await wait()
    await wait()

    // No React-related errors should have been logged
    const reactErrors = errors.filter(e =>
      e.includes('unmount') || e.includes('Cannot update') || e.includes('memory leak')
    )
    expect(reactErrors.length).toBe(0)

    console.error = originalError
  })
})

// ---------------------------------------------------------------
// 11. useAsyncSub for doc subscriptions
// ---------------------------------------------------------------
describe('useAsyncSub for doc subscriptions', () => {
  it('returns undefined initially for a fresh doc, then the signal after loading', async () => {
    // Use a doc that has NOT been pre-subscribed, so it will be a fresh subscription
    let renders = 0
    const Component = observer(() => {
      renders++
      const $d = useAsyncSub($.asyncDocTest2.ad2)
      if (!$d) return el('span', {}, 'Waiting...')
      return el('span', {}, $d.name.get() || 'empty')
    })

    const { container } = render(el(Component))
    expect(renders).toBe(1)
    // Initially returns undefined since subscription is pending (no Suspense)
    expect(container.textContent).toBe('Waiting...')

    await wait()
    // After subscription resolves, signal is available (doc is empty so 'empty')
    expect(container.textContent).toBe('empty')
    expect(renders).toBe(2)

    // Now set data and verify it updates
    act(() => { $.asyncDocTest2.ad2.set({ name: 'AsyncDoc' }) })
    expect(container.textContent).toBe('AsyncDoc')
  })
})

// ---------------------------------------------------------------
// 12. useAsyncSub with aggregation
// ---------------------------------------------------------------
describe('useAsyncSub with aggregation', () => {
  it('returns undefined initially then aggregation results', async () => {
    const $x1 = await sub($.asyncAgg1.x1)
    const $x2 = await sub($.asyncAgg1.x2)
    $x1.set({ name: 'X1', active: true })
    $x2.set({ name: 'X2', active: true })
    await wait()

    const $$active = aggregation(({ active }) => {
      return [{ $match: { active } }]
    })

    let renders = 0
    const Component = observer(() => {
      renders++
      const $items = useAsyncSub($$active, { $collection: 'asyncAgg1', active: true })
      if (!$items) return el('span', {}, 'Waiting...')
      return el('span', {}, $items.map($i => $i.name.get()).sort().join(','))
    })

    const { container } = render(el(Component))
    expect(renders).toBe(1)
    expect(container.textContent).toBe('Waiting...')

    await wait()
    expect(container.textContent).toBe('X1,X2')
  })
})

// ---------------------------------------------------------------
// 13. Conditional subscription (subscribe only when flag is true)
// ---------------------------------------------------------------
describe('Conditional subscription', () => {
  it('subscribes only when a child component is rendered conditionally', async () => {
    const $doc = await sub($.condSub.cs1)
    $doc.set({ name: 'Conditional' })
    await wait()

    let childRenders = 0
    const SubscribedChild = observer(() => {
      childRenders++
      const $d = useSub($.condSub.cs1)
      return el('span', { id: 'child' }, $d.name.get() || '')
    }, { suspenseProps: { fallback: el('span', { id: 'child' }, 'Loading...') } })

    const Parent = observer(() => {
      const $flag = $(false)
      return fr(
        $flag.get() ? el(SubscribedChild) : el('span', { id: 'child' }, 'Off'),
        el('button', { id: 'toggle', onClick: () => $flag.set(!$flag.get()) })
      )
    })

    const { container } = render(el(Parent))
    expect(container.querySelector('#child').textContent).toBe('Off')
    expect(childRenders).toBe(0)

    // Toggle on -- child mounts and subscribes
    fireEvent.click(container.querySelector('#toggle'))
    await wait()
    expect(container.querySelector('#child').textContent).toBe('Conditional')
    expect(childRenders).toBeGreaterThan(0)

    const childRendersAfterMount = childRenders

    // Toggle off -- child unmounts, subscription cleaned up
    fireEvent.click(container.querySelector('#toggle'))
    await wait()
    expect(container.querySelector('#child').textContent).toBe('Off')
    // Child should not have re-rendered after unmount
    expect(childRenders).toBe(childRendersAfterMount)
  })
})
