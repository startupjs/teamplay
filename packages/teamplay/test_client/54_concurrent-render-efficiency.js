// Observers that mount in a concurrent render (a transition, a Suspense
// retry, the deferred render of useSub()'s useDeferredValue) render before
// their wrapper subscribes to React (useSyncExternalStore subscribes after
// the commit). React yields to the event loop during such a render, so an
// update can reach a wrapper that has rendered but not subscribed yet. It
// must re-render that one observer after it subscribes; it must not change
// the snapshot React rendered: React checks the snapshots of a concurrent
// render before committing it and, if one changed, renders the whole root
// again synchronously, discarding every component mounting in it (each is
// rendered again from scratch, with a new wrapper, reaction and useSub()
// leases).
//
// The tests run without act(): act() renders a transition without yielding.
import { createElement as el, startTransition, Suspense, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals'
import { $, observer, useScheduleUpdate } from '../src/index.ts'
import connect from '../src/connect/test.js'

const COUNT = 30
// the item whose first render arms the update
const TRIGGER_INDEX = 10
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

// React yields every 5 ms: 1 ms per item makes it yield several times
// before it reaches the last item
function busyWait (ms) {
  const end = performance.now() + ms
  while (performance.now() < end) {} // eslint-disable-line no-empty
}

let previousActEnvironment
beforeAll(() => {
  connect()
  previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.IS_REACT_ACT_ENVIRONMENT = false
})
afterAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
})

function createStats ({ armed }) {
  return { renders: 0, mounts: 0, armed, triggered: false, rendersAtTrigger: undefined }
}

function createList (Item, stats) {
  return function List () {
    const items = []
    for (let i = 0; i < COUNT; i++) items.push(el(Item, { key: i, index: i, stats }))
    return el('div', {}, items)
  }
}

// the update arrived after the first item rendered and before the last
function expectUpdateDuringRender (stats) {
  expect(stats.rendersAtTrigger).toBeGreaterThan(TRIGGER_INDEX)
  expect(stats.rendersAtTrigger).toBeLessThan(COUNT)
}

async function renderInTransition (Item) {
  const stats = createStats({ armed: true })
  const container = document.createElement('div')
  const root = createRoot(container)
  startTransition(() => root.render(el(createList(Item, stats))))
  // until React commits and runs the effects (and the re-render they cause)
  await wait(300)
  expectUpdateDuringRender(stats)
  return { container, root, stats }
}

// The items mount when React retries a Suspense boundary (a retry is a
// concurrent render) after a sibling's promise settles.
async function renderInSuspenseRetry (Item) {
  const stats = createStats({ armed: false })
  let loaded = false
  let resolveLoad
  const load = new Promise(resolve => { resolveLoad = resolve })
  function Gate () {
    if (!loaded) throw load
    return null
  }
  const container = document.createElement('div')
  const root = createRoot(container)
  root.render(el(Suspense, { fallback: el('b', {}, 'Loading') }, el(createList(Item, stats)), el(Gate)))
  await wait(100)
  expect(container.textContent).toBe('Loading')
  // count only the retry (React rendered the items before, to suspend and
  // to prerender them)
  Object.assign(stats, createStats({ armed: true }))
  loaded = true
  resolveLoad()
  await wait(300)
  expectUpdateDuringRender(stats)
  return { container, root, stats }
}

// Counts render attempts and mounts of an item (a mount that React discards
// before committing it counts as well). `trigger` runs once, in a microtask
// queued by the first armed render of the item at TRIGGER_INDEX: when React
// yields (the items before it are rendered already) and before it renders
// the last item.
function useItemStats (stats, index, trigger) {
  stats.renders++
  useState(() => { stats.mounts++ })
  if (stats.armed && index === TRIGGER_INDEX && !stats.triggered) {
    stats.triggered = true
    queueMicrotask(() => {
      stats.rendersAtTrigger = stats.renders
      trigger()
    })
  }
  busyWait(1)
}

describe('observers that mount in a concurrent render', () => {
  it('a signal change during the render re-renders only the observer that read it', async () => {
    const { $value } = $.session._concurrentMountSignal
    $value.set('initial')
    const Item = observer(function SignalItem ({ index, stats }) {
      useItemStats(stats, index, () => $value.set('changed'))
      return el('i', {}, index === 0 ? $value.get() : '.')
    })
    const { container, root, stats } = await renderInTransition(Item)
    expect(container.textContent).toBe('changed' + '.'.repeat(COUNT - 1))
    // every item mounted once, and only the first one rendered again
    expect(stats.mounts).toBe(COUNT)
    expect(stats.renders).toBe(COUNT + 1)
    root.unmount()
  })

  it('a scheduled update settling during the render re-renders only the observer that scheduled it', async () => {
    let resolveScheduled
    const scheduled = new Promise(resolve => { resolveScheduled = resolve })
    let hasScheduled = false
    const Item = observer(function ScheduledItem ({ index, stats }) {
      const scheduleUpdate = useScheduleUpdate()
      useItemStats(stats, index, () => resolveScheduled())
      if (index === 0 && !hasScheduled) {
        hasScheduled = true
        scheduleUpdate(scheduled)
      }
      return el('i', {}, '.')
    })
    const { container, root, stats } = await renderInTransition(Item)
    expect(container.textContent).toBe('.'.repeat(COUNT))
    expect(stats.mounts).toBe(COUNT)
    expect(stats.renders).toBe(COUNT + 1)
    root.unmount()
  })

  it('a signal change during a Suspense retry re-renders only the observer that read it', async () => {
    const { $value } = $.session._concurrentRetrySignal
    $value.set('initial')
    const Item = observer(function RetryItem ({ index, stats }) {
      useItemStats(stats, index, () => $value.set('changed'))
      return el('i', {}, index === 0 ? $value.get() : '.')
    })
    const { container, root, stats } = await renderInSuspenseRetry(Item)
    expect(container.textContent).toBe('changed' + '.'.repeat(COUNT - 1))
    expect(stats.mounts).toBe(COUNT)
    expect(stats.renders).toBe(COUNT + 1)
    root.unmount()
  })
})
