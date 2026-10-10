// useSuspendMemo() runs its factory again once the promise the factory threw
// settles. When that promise rejects, the factory is not run again for the
// same deps while the component keeps them: the hook throws the rejection
// from render, so the nearest error boundary catches it (the same semantics
// as useSub() of a failed subscription). New deps or a remount (an error
// boundary reset) run the factory again.
import { Component, createElement as el, Fragment } from 'react'
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { act, cleanup, render } from '@testing-library/react'
import { observer, useSuspendMemo, useSuspendMemoByKey } from '../src/index.ts'
import { __resetSuspendMemoForTests } from '../src/react/useSuspendMemo.ts'

jest.setTimeout(20000)

const wait = ms => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)) })

// a retry loop renders without end; past this many renders a test component
// throws, which ends the loop at the error boundary
const MAX_RENDERS = 30
let renders = 0

function countRender () {
  renders += 1
  if (renders > MAX_RENDERS) throw Error('render loop')
}

let consoleError
beforeEach(() => {
  renders = 0
  // React reports the errors the boundaries catch
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  consoleError.mockRestore()
  __resetSuspendMemoForTests()
})

class ErrorBoundary extends Component {
  constructor (props) {
    super(props)
    this.state = { error: undefined }
  }

  static getDerivedStateFromError (error) {
    return { error }
  }

  render () {
    if (this.state.error) return el('span', { id: this.props.id || 'result' }, 'threw ' + this.state.error.message)
    return this.props.children
  }
}

const fallback = el('span', { id: 'result' }, 'loading')

// a request that fails after a while
function failLater (message) {
  return new Promise((resolve, reject) => setTimeout(() => reject(Error(message)), 10))
}

async function waitForText (container, selector, text, timeout = 2000) {
  const start = Date.now()
  while (container.querySelector(selector)?.textContent !== text && Date.now() - start < timeout) await wait(20)
  expect(container.querySelector(selector)?.textContent).toBe(text)
}

describe('useSuspendMemo() when the promise its factory throws rejects', () => {
  it('throws the rejection to the error boundary without running the factory again', async () => {
    let calls = 0
    const Memo = observer(function Memo () {
      countRender()
      const value = useSuspendMemo(() => {
        calls += 1
        throw failLater('join failed')
      }, ['game1'])
      return el('span', { id: 'result' }, value)
    }, { suspenseProps: { fallback } })
    const { container } = render(el(ErrorBoundary, {}, el(Memo)))
    await waitForText(container, '#result', 'threw join failed')
    await wait(300)
    expect(calls).toBe(1)
    expect(container.querySelector('#result').textContent).toBe('threw join failed')
  })

  it('runs the factory again after a remount (error boundary reset), also for new deps', async () => {
    let calls = 0
    let fail = true
    const Memo = observer(function Memo ({ gameId }) {
      countRender()
      const value = useSuspendMemo(() => {
        calls += 1
        if (fail) throw failLater('join failed')
        return 'joined ' + gameId
      }, [gameId])
      return el('span', { id: 'result' }, value)
    }, { suspenseProps: { fallback } })
    const view = (attempt, gameId) => el(ErrorBoundary, { key: attempt }, el(Memo, { gameId }))
    const { container, rerender } = render(view(1, 'game1'))
    await waitForText(container, '#result', 'threw join failed')
    expect(calls).toBe(1)

    rerender(view(2, 'game1'))
    await waitForText(container, '#result', 'threw join failed')
    expect(calls).toBe(2)

    fail = false
    rerender(view(3, 'game2'))
    await waitForText(container, '#result', 'joined game2')
    expect(calls).toBe(3)
  })

  it('useSuspendMemoByKey() throws one shared rejection to every component of the key', async () => {
    let calls = 0
    const Memo = observer(function Memo () {
      countRender()
      const value = useSuspendMemoByKey('join-game1', () => {
        calls += 1
        throw failLater('join failed')
      })
      return el('span', {}, value)
    }, { suspenseProps: { fallback: el('span', {}, 'loading') } })
    const { container } = render(el(Fragment, {},
      el(ErrorBoundary, { id: 'a' }, el(Memo)),
      el(ErrorBoundary, { id: 'b' }, el(Memo))
    ))
    await waitForText(container, '#a', 'threw join failed')
    await waitForText(container, '#b', 'threw join failed')
    await wait(300)
    expect(calls).toBe(1)
  })
})
