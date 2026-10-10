// A subscription the server denies (access rules) makes sub() reject with the
// ShareDB error. useSub() and its variants throw that error from render once
// the subscription fails, so the nearest error boundary catches it (React's
// data-fetching semantics), instead of suspending forever. The failed target
// is not subscribed again while the component keeps it (no retry loop); a
// remount (an error boundary reset) or another target subscribes again.
import { Component, createElement as el, Fragment, useLayoutEffect } from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { $, observer, sub, useAsyncSub, useBatchSub, useSub } from '../src/index.ts'
import { getConnection } from '../src/orm/connection.ts'
import { setForceDefer } from '../src/react/forceDefer.ts'
import { querySubscriptions } from '../src/orm/Query.js'
import { docSubscriptions } from '../src/orm/Doc.js'
import { setSubscriptionGcDelay } from '../src/orm/subscriptionGcDelay.ts'
import connect from '../src/connect/test.js'

const DENIED = 'deniedSubGames'
const ALLOWED = 'allowedSubGames'
const DENIED_QUERY = { kind: 'denied' }
const attempts = { [DENIED]: 0 }
// A retry loop renders the component without end (before the fix: about
// 160,000 renders a second behind the fallback). Past this many renders a
// test component throws, which ends the loop at the error boundary.
const MAX_RENDERS = 30
let renders = 0

function countRender () {
  renders += 1
  if (renders > MAX_RENDERS) throw Error('render loop')
}

jest.setTimeout(20000)

const wait = ms => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)) })

// created through another connection, so the tested one has no copy of them
function createDoc (connection, collection, id, data) {
  const doc = connection.get(collection, id)
  return new Promise((resolve, reject) => doc.create(data, err => err ? reject(err) : resolve()))
}

beforeAll(async () => {
  connect()
  const backend = getConnection().agent.backend
  // what @teamplay/sharedb-access does when a read rule denies a doc
  backend.use('readSnapshots', (request, next) => {
    if (request.collection !== DENIED || request.snapshots.length === 0) return next()
    attempts[DENIED] += 1
    const err = Error(`403: read denied for ${DENIED}`)
    err.code = 'ERR_ACCESS_DENY_READ'
    next(err)
  })
  const writer = backend.connect()
  await createDoc(writer, DENIED, 'd1', { kind: 'denied', name: 'D1' })
  await createDoc(writer, DENIED, 'd2', { kind: 'denied', name: 'D2' })
  await createDoc(writer, ALLOWED, 'a1', { kind: 'allowed', name: 'A1', deniedId: 'd1' })
  await createDoc(writer, ALLOWED, 'a2', { kind: 'allowed', name: 'A2', deniedId: 'd2' })
  writer.close()
})

let consoleError
let consoleWarn
let previousGcDelay
beforeEach(() => {
  attempts[DENIED] = 0
  renders = 0
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
  consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {})
  previousGcDelay = setSubscriptionGcDelay(200)
})
afterEach(async () => {
  cleanup()
  setForceDefer(null)
  consoleError.mockRestore()
  consoleWarn.mockRestore()
  setSubscriptionGcDelay(previousGcDelay)
  // let lease releases and transport graces run out between tests
  await wait(300)
})
afterAll(() => setSubscriptionGcDelay(null))

class ErrorBoundary extends Component {
  constructor (props) {
    super(props)
    this.state = { error: undefined }
  }

  static getDerivedStateFromError (error) {
    return { error }
  }

  render () {
    if (this.state.error) {
      return el('span', { id: 'result' }, 'threw ' + (this.state.error.code || this.state.error.message))
    }
    return this.props.children
  }
}

const fallback = el('span', { id: 'result' }, 'loading')

async function waitForResult (container, text, timeout = 2000) {
  const start = Date.now()
  while (container.querySelector('#result')?.textContent !== text && Date.now() - start < timeout) await wait(20)
  expect(container.querySelector('#result')?.textContent).toBe(text)
}

// teamplay warns (React itself reports the error it throws with console.error)
function teamplayFailureLogs () {
  const isFailureLog = args => String(args[0]).startsWith('[teamplay] useSub()')
  expect(consoleError.mock.calls.filter(isFailureLog)).toEqual([])
  return consoleWarn.mock.calls.filter(isFailureLog)
}

function expectNoDeniedSubscriptions () {
  for (const [hash, entry] of querySubscriptions.entries) {
    if (hash.includes(DENIED)) expect({ hash, owners: entry.owners.size, runtime: !!entry.runtime }).toEqual({ hash, owners: 0, runtime: false })
  }
  for (const [hash, entry] of docSubscriptions.entries) {
    if (hash.includes(DENIED)) expect({ hash, owners: entry.owners.size, runtime: !!entry.runtime }).toEqual({ hash, owners: 0, runtime: false })
  }
}

describe('a subscription the server denies', () => {
  it('sub() rejects with the access error', async () => {
    await expect(sub($[DENIED], DENIED_QUERY)).rejects.toMatchObject({ code: 'ERR_ACCESS_DENY_READ' })
    await expect(sub($[DENIED].d1)).rejects.toMatchObject({ code: 'ERR_ACCESS_DENY_READ' })
  })

  for (const [name, useTarget] of [
    ['useSub() of a query', () => useSub($[DENIED], DENIED_QUERY)],
    ['useSub() of a doc', () => useSub($[DENIED].d1)],
    ['useAsyncSub() of a query', () => useAsyncSub($[DENIED], DENIED_QUERY)],
    ['useAsyncSub() of a doc', () => useAsyncSub($[DENIED].d1)],
    ['useBatchSub() of a query', () => {
      const $games = useBatchSub($[DENIED], DENIED_QUERY)
      useBatchSub($[ALLOWED].a1)
      useBatchSub()
      return $games
    }],
    ['useBatchSub() of a doc', () => {
      useBatchSub($[ALLOWED].a1)
      const $game = useBatchSub($[DENIED].d1)
      useBatchSub()
      return $game
    }]
  ]) {
    it(`${name} throws the error to the error boundary, once, and logs it once`, async () => {
      const Games = observer(function Games () {
        countRender()
        const $target = useTarget()
        return el('span', { id: 'result' }, $target ? 'loaded' : 'pending')
      }, { suspenseProps: { fallback } })
      const { container } = render(el(ErrorBoundary, {}, el(Games)))
      await waitForResult(container, 'threw ERR_ACCESS_DENY_READ')

      // no retry loop: the denied target is not subscribed again
      const rendersAfterError = renders
      await wait(1500)
      expect(container.querySelector('#result')?.textContent).toBe('threw ERR_ACCESS_DENY_READ')
      expect(attempts[DENIED]).toBe(1)
      expect(renders).toBe(rendersAfterError)
      expect(teamplayFailureLogs()).toHaveLength(1)
      expect(String(teamplayFailureLogs()[0][0])).toContain(DENIED)
      expectNoDeniedSubscriptions()
    })
  }

  it('a re-subscribe to a denied doc in a chain throws to the error boundary (deferred by default)', async () => {
    const Chain = observer(function Chain () {
      countRender()
      const $allowedId = $('a1')
      const $allowed = useSub($[ALLOWED][$allowedId.get()])
      const $denied = useSub($[DENIED][$allowed.deniedId.get()])
      return el(Fragment, {},
        el('span', { id: 'result' }, $denied.name.get()),
        el('button', { id: 'switch', onClick: () => $allowedId.set('a2') })
      )
    }, { suspenseProps: { fallback } })
    const { container } = render(el(ErrorBoundary, {}, el(Chain)))
    await waitForResult(container, 'threw ERR_ACCESS_DENY_READ')
    await wait(1200)
    expect(attempts[DENIED]).toBe(1)
    expectNoDeniedSubscriptions()
  })

  for (const mode of ['deferred', 'forceDefer', 'defer: false']) {
    it(`switching a committed useSub() to a denied target throws to the error boundary (${mode})`, async () => {
      if (mode === 'forceDefer') setForceDefer(true)
      const options = mode === 'deferred' ? undefined : { defer: false }
      const commits = []
      const Games = observer(function Games () {
        countRender()
        const $kind = $('allowed')
        const kind = $kind.get()
        const $games = useSub($[kind === 'allowed' ? ALLOWED : DENIED], { kind }, options)
        const text = 'loaded ' + $games.getIds().length
        useLayoutEffect(() => { commits.push(text) })
        return el(Fragment, {},
          el('span', { id: 'result' }, text),
          el('button', { id: 'switch', onClick: () => $kind.set('denied') })
        )
      }, { suspenseProps: { fallback } })
      const { container } = render(el(ErrorBoundary, {}, el(Games)))
      await waitForResult(container, 'loaded 2')

      fireEvent.click(container.querySelector('#switch'))
      await waitForResult(container, 'threw ERR_ACCESS_DENY_READ')
      await wait(1200)
      expect(attempts[DENIED]).toBe(1)
      // only the committed state, never a partial one
      expect(new Set(commits)).toEqual(new Set(['loaded 2']))
      expectNoDeniedSubscriptions()
    })
  }

  it('a remount (error boundary reset) subscribes again; another target loads', async () => {
    const Games = observer(function Games ({ collection, kind }) {
      countRender()
      const $games = useSub($[collection], { kind })
      return el('span', { id: 'result' }, 'loaded ' + $games.getIds().length)
    }, { suspenseProps: { fallback } })
    const view = (attempt, collection, kind) => el(ErrorBoundary, { key: attempt }, el(Games, { collection, kind }))
    const { container, rerender } = render(view(1, DENIED, 'denied'))
    await waitForResult(container, 'threw ERR_ACCESS_DENY_READ')
    expect(attempts[DENIED]).toBe(1)

    // the same target after a reset: one more attempt, the same error
    rerender(view(2, DENIED, 'denied'))
    await waitForResult(container, 'threw ERR_ACCESS_DENY_READ')
    await wait(1200)
    expect(attempts[DENIED]).toBe(2)

    // another target after a reset loads
    rerender(view(3, ALLOWED, 'allowed'))
    await waitForResult(container, 'loaded 2')
    expect(attempts[DENIED]).toBe(2)
    expectNoDeniedSubscriptions()
  })
})
