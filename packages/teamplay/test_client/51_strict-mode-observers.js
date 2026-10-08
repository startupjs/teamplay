// Renders that React discards before commit (StrictMode's double render, or
// any abandoned render attempt) must not leave observer reactions connected
// to the observables they read, and a mounted observer must stay reactive
// after StrictMode replays its effects (mount, unmount, mount).
import { createElement as el, StrictMode } from 'react'
import { afterEach, beforeAll, describe, expect, it } from '@jest/globals'
import { act, cleanup, render } from '@testing-library/react'
import { $, diagnostics, observer } from '../src/index.ts'
import { runGc } from '../test/_helpers.js'
import connect from '../src/connect/test.js'

beforeAll(connect)
afterEach(cleanup)
afterEach(() => diagnostics.disable())

function aliveReactions () {
  const counters = diagnostics.getCounters()
  return (counters['react.observer.create'] || 0) - (counters['react.observer.destroy'] || 0)
}

describe('observer() under StrictMode', () => {
  it('leaves no reaction behind after mount/unmount cycles', async () => {
    diagnostics.enable()
    const $name = $.session.strictObserverLeak
    $name.set('a')
    const Component = observer(function StrictLeak () {
      return el('span', {}, $name.get())
    })
    for (let i = 0; i < 3; i++) {
      const view = render(el(StrictMode, {}, el(Component)))
      expect(view.container.textContent).toBe(i === 0 ? 'a' : 'b' + (i - 1))
      act(() => { $name.set('b' + i) })
      expect(view.container.textContent).toBe('b' + i)
      view.unmount()
    }
    await runGc()
    expect(aliveReactions()).toBe(0)
    expect(diagnostics.snapshot().react.observers.tracked).toBe(0)
  })

  it('stays reactive once discarded renders are collected', async () => {
    diagnostics.enable()
    const $name = $.session.strictObserverReactive
    $name.set('a')
    let renders = 0
    const Component = observer(function StrictReactive () {
      renders++
      return el('span', {}, $name.get())
    })
    const view = render(el(StrictMode, {}, el(Component)))
    expect(view.container.textContent).toBe('a')
    await act(async () => { await runGc() })
    expect(aliveReactions()).toBe(1)
    const before = renders
    act(() => { $name.set('b') })
    expect(view.container.textContent).toBe('b')
    expect(renders).toBeGreaterThan(before)
    view.unmount()
  })
})
