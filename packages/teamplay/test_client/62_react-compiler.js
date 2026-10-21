// The React Compiler is not supported: it caches values read from signals.
// These tests pin what it does to teamplay code (see the fixtures and
// docs/guide/react-integration.md#react-compiler), and that 'use no memo'
// opts a hook or a component out.
import { createElement as el, Profiler, useState } from 'react'
import { describe, it, afterEach, beforeEach, expect, beforeAll as before } from '@jest/globals'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { $ } from '../src/index.ts'
import { runGc, cache } from '../test/_helpers.js'
import { releaseLastEventTarget } from './helpers/releaseLastEventTarget.js'
import connect from '../src/connect/test.js'
import {
  useCount,
  useCountNoMemo,
  HookAndDirectRead,
  NoMemoHookAndDirectRead,
  DocCountBase,
  DocCount,
  InlineDocCount,
  DocCountNoMemo,
  RootRead,
  DocTotal,
  LocalCounter,
  ComputedDouble,
  PlainDocCount
} from './helpers/cases.react-compiler.jsx'

before(connect)
beforeEach(() => {
  expect(cache.size).toBe(1)
})
afterEach(cleanup)
afterEach(releaseLastEventTarget)
afterEach(runGc)

const COMPILED = /\b_c\(\d+\)/

describe('React Compiler', () => {
  it('compiles custom hooks and components declared on their own', () => {
    expect(String(useCount)).toMatch(COMPILED)
    expect(String(DocCountBase)).toMatch(COMPILED)
    expect(String(useCountNoMemo)).not.toMatch(COMPILED)
  })

  it('a compiled custom hook keeps returning the old value inside observer()', () => {
    const $doc = $.session._rc1
    $doc.set({ count: 1 })
    const { container } = render(el(HookAndDirectRead, { $doc }))
    expect(container.textContent).toBe('1/1')

    act(() => { $doc.count.set(2) })
    // the direct read re-renders the component, the hook returns its cache
    expect(container.textContent).toBe('1/2')
  })

  it("a hook marked 'use no memo' returns the new value", () => {
    const $doc = $.session._rc2
    $doc.set({ count: 1 })
    const { container } = render(el(NoMemoHookAndDirectRead, { $doc }))
    act(() => { $doc.count.set(2) })
    expect(container.textContent).toBe('2/2')
  })

  it('a compiled component wrapped in observer() does not update, then stops re-rendering', () => {
    const $doc = $.session._rc3
    $doc.set({ count: 1 })
    const commits = []
    const onRender = (id, phase) => commits.push(phase)
    const { container } = render(el(Profiler, { id: 'DocCount', onRender }, el(DocCount, { $doc })))
    expect(container.textContent).toBe('1')

    act(() => { $doc.count.set(2) })
    expect(container.textContent).toBe('1')
    // the cached render skipped $doc.count.get(), so observer() no longer tracks it
    act(() => { $doc.count.set(3) })
    expect(container.textContent).toBe('1')
    expect(commits).toEqual(['mount', 'update'])
  })

  it('a function passed inline to observer() is not compiled and updates', () => {
    const $doc = $.session._rc4
    $doc.set({ count: 1 })
    const { container } = render(el(InlineDocCount, { $doc }))
    act(() => { $doc.count.set(2) })
    expect(container.textContent).toBe('2')
  })

  it("a component marked 'use no memo' updates", () => {
    const $doc = $.session._rc5
    $doc.set({ count: 1 })
    const { container } = render(el(DocCountNoMemo, { $doc }))
    act(() => { $doc.count.set(2) })
    expect(container.textContent).toBe('2')
  })

  it('a read from the imported root signal is cached for the life of the component', () => {
    $.session._rc6.set({ count: 1 })
    const { container } = render(el(RootRead, { path: '_rc6' }))
    act(() => { $.session._rc6.count.set(2) })
    expect(container.textContent).toBe('1')
  })

  it('a value derived from a signal does not update', () => {
    const $doc = $.session._rc7
    $doc.set({ items: [1, 2] })
    const { container } = render(el(DocTotal, { $doc }))
    expect(container.textContent).toBe('6')
    act(() => { $doc.items.push(3) })
    expect(container.textContent).toBe('6')
  })

  it('a local signal $() does not update', () => {
    const { container } = render(el(LocalCounter))
    expect(container.textContent).toBe('0')
    fireEvent.click(container.querySelector('button'))
    expect(container.textContent).toBe('0')
  })

  it('a computed signal $(() => ...) does not update', () => {
    const $doc = $.session._rc8
    $doc.set({ count: 1 })
    const { container } = render(el(ComputedDouble, { $doc }))
    expect(container.textContent).toBe('2')
    act(() => { $doc.count.set(2) })
    expect(container.textContent).toBe('2')
  })

  it('a component without observer() does not update, compiled or not', () => {
    const $doc = $.session._rc9
    $doc.set({ count: 1 })
    let rerender
    function Parent () {
      const [tick, setTick] = useState(0)
      rerender = () => setTick(tick + 1)
      return el(PlainDocCount, { $doc })
    }
    const { container } = render(el(Parent))
    act(() => { $doc.count.set(2) })
    expect(container.textContent).toBe('1')
    // an uncompiled parent re-renders it, and the compiled child returns its cache
    act(() => { rerender() })
    expect(container.textContent).toBe('1')
  })
})
