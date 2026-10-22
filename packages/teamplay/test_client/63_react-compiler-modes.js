// teamplay with the React Compiler on, in both modes of babel-plugin-teamplay's
// `reactCompiler` option (see reactCompilerTransform.cjs):
//   full:   the compiler compiles everything; $() in components becomes
//           useSignal(), and each memo scope is tracked by its own reaction
//           (src/react/compilerScopes.ts)
//   optOut: the components and hooks that use signals get 'use no memo'
// Each must behave as teamplay does without the compiler.
import { readFileSync } from 'node:fs'
import { Activity, createElement as el, Profiler, StrictMode } from 'react'
import { describe, it, afterEach, beforeEach, expect, beforeAll as before } from '@jest/globals'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { $ } from '../src/index.ts'
import { runGc, cache } from '../test/_helpers.js'
import { releaseLastEventTarget } from './helpers/releaseLastEventTarget.js'
import connect from '../src/connect/test.js'
import * as full from './helpers/cases.rc-full.jsx'
import * as optOut from './helpers/cases.rc-optout.jsx'

before(connect)
beforeEach(() => {
  expect(cache.size).toBe(1)
})
afterEach(cleanup)
afterEach(releaseLastEventTarget)
afterEach(runGc)

const COMPILED = /\b_c\(\d+\)/
let docCounter = 0
function nextDoc (value) {
  const $doc = $.session['_rcx' + (++docCounter)]
  $doc.set(value)
  return $doc
}

function renderWithCommits (Component, props) {
  const commits = []
  const result = render(el(Profiler, { id: 'case', onRender: (id, phase) => commits.push(phase) }, el(Component, props)))
  return { ...result, commits }
}

it('the fixtures of both modes are the same code', () => {
  const code = name => {
    const source = readFileSync(new URL('./helpers/' + name, import.meta.url), 'utf8')
    return source.slice(source.indexOf('import '))
  }
  expect(code('cases.rc-optout.jsx')).toBe(code('cases.rc-full.jsx'))
})

describe.each([
  ['full', full],
  ['optOut', optOut]
])('React Compiler, reactCompiler: %s', (mode, cases) => {
  it('compiles what it should', () => {
    expect(String(cases.Pure)).toMatch(COMPILED)
    if (mode === 'full') {
      expect(String(cases.useCount)).toMatch(COMPILED)
      expect(String(cases.DocCountBase)).toMatch(COMPILED)
      expect(String(cases.DocCountBase)).toMatch(/\.dirty\(/)
    } else {
      expect(String(cases.useCount)).not.toMatch(COMPILED)
      expect(String(cases.DocCountBase)).not.toMatch(COMPILED)
    }
  })

  it('(a) a compiled custom hook inside observer() returns the new value', () => {
    const $doc = nextDoc({ count: 1 })
    const { container } = render(el(cases.HookAndDirectRead, { $doc }))
    expect(container.textContent).toBe('1/1')
    act(() => { $doc.count.set(2) })
    expect(container.textContent).toBe('2/2')
    act(() => { $doc.count.set(3) })
    expect(container.textContent).toBe('3/3')
  })

  it('(b) a compiled component wrapped in observer() updates, once per change', () => {
    const $doc = nextDoc({ count: 1 })
    const { container, commits } = renderWithCommits(cases.DocCount, { $doc })
    act(() => { $doc.count.set(2) })
    expect(container.textContent).toBe('2')
    act(() => { $doc.count.set(3) })
    expect(container.textContent).toBe('3')
    expect(commits).toEqual(['mount', 'update', 'update'])
  })

  it('a read from the imported root signal updates', () => {
    const $doc = nextDoc({ count: 1 })
    const { container } = render(el(cases.RootRead, { path: $doc.path().split('.')[1] }))
    act(() => { $doc.count.set(2) })
    expect(container.textContent).toBe('2')
  })

  it('(c) a value derived from a signal updates', () => {
    const $doc = nextDoc({ items: [1, 2] })
    const { container } = render(el(cases.DocTotal, { $doc }))
    expect(container.textContent).toBe('6')
    act(() => { $doc.items.push(3) })
    expect(container.textContent).toBe('12')
  })

  it('(c) a local signal $() updates', () => {
    const { container } = render(el(cases.LocalCounter))
    expect(container.textContent).toBe('0')
    fireEvent.click(container.querySelector('button'))
    expect(container.textContent).toBe('1')
    fireEvent.click(container.querySelector('button'))
    expect(container.textContent).toBe('2')
  })

  it('(c) a computed signal $(() => ...) updates', () => {
    const $doc = nextDoc({ count: 1 })
    const { container } = render(el(cases.ComputedDouble, { $doc }))
    expect(container.textContent).toBe('2')
    act(() => { $doc.count.set(2) })
    expect(container.textContent).toBe('4')
  })

  it('(e) a memoized callback keeps its identity when the signal changes', () => {
    const $doc = nextDoc({ name: 'A' })
    const saved = []
    const onSave = name => saved.push(name)
    cases.saveEffects.runs = 0
    const { container } = render(el(cases.SaveButton, { $doc, onSave }))
    expect(container.textContent).toBe('A')
    expect(cases.saveEffects.runs).toBe(1)
    act(() => { $doc.name.set('B') })
    expect(container.textContent).toBe('B')
    expect(cases.saveEffects.runs).toBe(1)
    fireEvent.click(container.querySelector('button'))
    expect(saved).toEqual(['B'])
  })

  it('(f) a list after an early return updates', () => {
    const $doc = nextDoc({ items: [1, 2] })
    const { container } = render(el(cases.ListOrNothing, { $doc, show: true }))
    expect(container.textContent).toBe('12')
    act(() => { $doc.items.push(3) })
    expect(container.textContent).toBe('123')
  })

  it('(g) a child that is not an observer sees an object changed in place', () => {
    const $doc = nextDoc({ profile: { city: 'Kyiv' } })
    const { container } = render(el(cases.Profile, { $doc }))
    expect(container.textContent).toBe('KYIVKyiv')
    act(() => { $doc.profile.city.set('Lviv') })
    expect(container.textContent).toBe('LVIVLviv')
  })

  it('(h) a component without signals works', () => {
    const { container } = render(el(cases.Pure, { n: 2 }))
    expect(container.textContent).toBe('4')
  })

  it('scopes in a block, in a loop, and a style object update', () => {
    const $article = nextDoc({ title: 'T1', body: 'B1' })
    const $rows = nextDoc({ label: 'x' })
    const $colored = nextDoc({ color: 'red', text: 'hi' })
    const { container } = render(el('div', null,
      el(cases.Article, { $doc: $article, show: true }),
      el(cases.LabeledRows, { $doc: $rows, items: [1, 2] }),
      el(cases.Colored, { $doc: $colored })
    ))
    expect(container.textContent).toBe('T1B1' + '1:x2:x' + 'hi')
    act(() => { $article.title.set('T2') })
    act(() => { $rows.label.set('y') })
    act(() => { $colored.color.set('blue') })
    expect(container.textContent).toBe('T2B1' + '1:y2:y' + 'hi')
    expect(container.querySelector('b').style.color).toBe('blue')
    act(() => { $article.body.set('B2') })
    expect(container.textContent).toBe('T2B2' + '1:y2:y' + 'hi')
  })

  it('useSignal() keeps its signals across renders', () => {
    const $doc = nextDoc({ count: 1 })
    const { container } = render(el(cases.ExplicitHook, { $doc }))
    expect(container.textContent).toBe('0:10')
    fireEvent.click(container.querySelector('button'))
    expect(container.textContent).toBe('1:10')
    act(() => { $doc.count.set(2) })
    expect(container.textContent).toBe('1:20')
    fireEvent.click(container.querySelector('button'))
    expect(container.textContent).toBe('2:20')
  })

  it('(d) control: a component without observer() does not update', () => {
    const $doc = nextDoc({ count: 1 })
    const { container } = render(el(cases.PlainDocCount, { $doc }))
    act(() => { $doc.count.set(2) })
    expect(container.textContent).toBe('1')
  })
})

describe.each([
  ['full', full],
  ['optOut', optOut]
])('React Compiler, reactCompiler: %s, renders React discards', (mode, cases) => {
  it('a render that suspends after a scope recomputed', async () => {
    const $doc = nextDoc({ count: 1, wait: false })
    const { container } = render(el(cases.Suspending, { $doc }))
    expect(container.textContent).toBe('n=1')
    act(() => {
      $doc.count.set(2)
      $doc.wait.set(true)
    })
    await act(async () => {
      $doc.wait.set(false)
      cases.suspense.resolve()
    })
    expect(container.textContent).toBe('n=2')
  })

  // a hidden <Activity> commits its renders without running their effects
  it('a hidden <Activity>, its props and signals changed meanwhile', () => {
    const $first = nextDoc({ count: 1 })
    const $second = nextDoc({ count: 10 })
    const tree = ($doc, mode) => el(Activity, { mode }, el(cases.DocCount, { $doc }))
    const { container, rerender } = render(tree($first, 'visible'))
    expect(container.textContent).toBe('1')
    act(() => { rerender(tree($first, 'hidden')) })
    act(() => { rerender(tree($second, 'hidden')) })
    act(() => { $second.count.set(11) })
    act(() => { $second.count.set(12) })
    act(() => { rerender(tree($second, 'visible')) })
    expect(container.textContent).toBe('12')
    act(() => { $second.count.set(13) })
    expect(container.textContent).toBe('13')
  })

  it('a prop change, then a render-phase update', () => {
    const $first = nextDoc({ count: 1 })
    const $second = nextDoc({ count: 10 })
    const { container, rerender } = render(el(cases.Derived, { $doc: $first, id: 'first' }))
    act(() => { rerender(el(cases.Derived, { $doc: $second, id: 'second' })) })
    expect(container.textContent).toBe('10')
    act(() => { $second.count.set(11) })
    expect(container.textContent).toBe('11')
  })

  it('StrictMode: a prop change', () => {
    const $first = nextDoc({ count: 1 })
    const $second = nextDoc({ count: 10 })
    const tree = $doc => el(StrictMode, null, el(cases.DocCount, { $doc }))
    const { container, rerender } = render(tree($first))
    act(() => { rerender(tree($second)) })
    expect(container.textContent).toBe('10')
    act(() => { $second.count.set(11) })
    expect(container.textContent).toBe('11')
  })

  it('useMemo() and useCallback() values keep their identity through StrictMode\'s effect replay and a hidden <Activity>', () => {
    const $doc = nextDoc({ count: 1 })
    const handlers = new Set()
    const record = { press () {}, effect (onPress) { handlers.add(onPress) } }
    const tree = mode => el(StrictMode, null, el(Activity, { mode }, el(cases.Stable, { $doc, record })))
    const { container, rerender } = render(tree('visible'))
    act(() => { $doc.count.set(2) })
    expect(container.textContent).toBe('2')
    act(() => { rerender(tree('hidden')) })
    act(() => { $doc.count.set(3) })
    act(() => { rerender(tree('visible')) })
    expect(container.textContent).toBe('3')
    act(() => { $doc.count.set(4) })
    expect(container.textContent).toBe('4')
    expect(handlers.size).toBe(1)
  })

  it('an observer() given a doc\'s object, with no $-named values', () => {
    const $user = nextDoc({ name: 'A', tags: ['x'] })
    const { container } = render(el(cases.UserLine, { $user }))
    expect(container.textContent).toBe('A|x')
    act(() => { $user.tags.push('y') })
    expect(container.textContent).toBe('A|x+y')
  })

  it('a component that is not an observer, reading a signal through a helper, when its parent renders again', () => {
    const $doc = nextDoc({ count: 1 })
    const { container } = render(el(cases.CountLabelParent, { $doc }))
    expect(container.textContent).toBe('1|n1')
    act(() => { $doc.count.set(2) })
    expect(container.textContent).toBe('2|n2')
  })

  ;(mode === 'full' ? it : it.skip)('a component that is not an observer, given a doc\'s object changed in place', () => {
    const $user = nextDoc({ name: 'A', tags: ['x'] })
    const { container } = render(el(cases.UserCard, { $user }))
    expect(container.textContent).toBe('A|x')
    act(() => {
      $user.tags.push('y')
      $user.name.set('B')
    })
    expect(container.textContent).toBe('B|x+y')
  })

  it('a query a hook builds from values read outside the compiler\'s scopes', () => {
    const $authors = $.session._rcxAuthors
    $authors.set({ tenantId: 't1', tenantName: 'T1' })
    const { container } = render(el(cases.AuthorsQuery, { withTenant: true }))
    expect(container.textContent).toBe('q:t1||T1')
    act(() => { $authors.search.set('a(') })
    expect(container.textContent).toBe('q:t1|a\\(|T1')
    act(() => { $authors.tenantId.set('t2') })
    expect(container.textContent).toBe('q:t2|a\\(|T1')
    act(() => { $authors.tenantName.set('T2') })
    expect(container.textContent).toBe('q:t2|a\\(|T2')
    act(() => { $authors.search.set('b') })
    expect(container.textContent).toBe('q:t2|b|T2')
    cleanup()
    $authors.del()
  })

  it('a memoized callback that returns elements keeps its identity when a signal changes', () => {
    const $doc = nextDoc({ count: 1 })
    try {
      const { container, rerender } = render(el(cases.RenderProp, { $doc, label: 'a' }))
      expect(container.textContent).toBe('1|12|ax')
      act(() => { $doc.count.set(2) })
      expect(container.textContent).toBe('2|12|ax')
      expect(cases.renderItems.size).toBe(1)
      rerender(el(cases.RenderProp, { $doc, label: 'b' }))
      expect(container.textContent).toBe('2|12|bx')
      expect(cases.renderItems.size).toBe(2)
    } finally {
      // the callbacks share their closure with the component's: they hold $doc
      cases.renderItems.clear()
    }
  })

  it('StrictMode', () => {
    const $doc = nextDoc({ count: 1 })
    const { container } = render(el(StrictMode, null, el(cases.DocTotal, { $doc: nextDoc({ items: [1, 2] }) }), el(cases.DocCount, { $doc })))
    expect(container.textContent).toBe('61')
    act(() => { $doc.count.set(2) })
    expect(container.textContent).toBe('62')
    act(() => { $doc.count.set(3) })
    expect(container.textContent).toBe('63')
  })
})
