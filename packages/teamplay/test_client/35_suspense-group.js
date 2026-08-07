import { createElement as el, Suspense } from 'react'
import { afterEach, beforeAll, describe, expect, it } from '@jest/globals'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import {
  $,
  observer,
  SuspenseGroup,
  useBatchSub,
  useNow,
  useSub,
  useSuspendMemo,
  useSuspenseGroupScheduleUpdate
} from '../src/index.ts'
import connect from '../src/connect/test.js'
import { runGc } from '../test/_helpers.js'

beforeAll(connect)
afterEach(cleanup)
afterEach(runGc)

describe('SuspenseGroup', () => {
  it('registers any observer thenable with the group retry coordinator', async () => {
    const retries = []
    const thenable = {
      then (onFulfilled) {
        retries.push(onFulfilled)
      }
    }
    let ready = false

    const Child = observer(() => {
      if (!ready) throw thenable
      return el('div', { 'data-testid': 'arbitrary-content' }, 'Ready')
    })

    const { container } = render(
      el(SuspenseGroup, {
        fallback: el('div', { 'data-testid': 'group-fallback' }, 'Loading')
      }, el(Child))
    )

    expect(container.querySelector('[data-testid="group-fallback"]')).toBeTruthy()
    expect(retries.length).toBeGreaterThanOrEqual(2)

    await act(async () => {
      ready = true
      retries[0]()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(container.querySelector('[data-testid="arbitrary-content"]')).toBeTruthy()
    })
  })

  it('keeps the default observer boundary unchanged outside a group', () => {
    const blocker = new Promise(() => {})
    const Child = observer(() => {
      throw blocker
    })

    const { container } = render(
      el(Suspense, {
        fallback: el('div', { 'data-testid': 'outer-fallback' }, 'Outer')
      }, el(Child))
    )

    expect(container.querySelector('[data-testid="outer-fallback"]')).toBeFalsy()
    expect(container.textContent).toBe('')
  })

  it('keeps a query keyed by useNow stable outside a group', async () => {
    const timestamps = new Set()

    const Child = observer(() => {
      const now = useNow()
      timestamps.add(now)
      if (timestamps.size > 1) {
        throw Error('useNow changed before the observer subscription committed')
      }
      useBatchSub($.observerStableNow, { marker: now }, { defer: false })
      useBatchSub()
      return el('div', { 'data-testid': 'observer-query-content' }, 'Ready')
    })

    const { container } = render(el(Child))

    await waitFor(() => {
      expect(container.querySelector('[data-testid="observer-query-content"]')).toBeTruthy()
    })
    expect(timestamps.size).toBe(1)
  })

  it('retries suspended children when a registered promise settles', async () => {
    const wake = deferred()
    const blocker = new Promise(() => {})
    let ready = false

    const Child = observer(() => {
      const scheduleUpdate = useSuspenseGroupScheduleUpdate()
      scheduleUpdate(wake.promise)
      if (!ready) throw blocker
      return el('div', { 'data-testid': 'content' }, 'Ready')
    })

    const { container } = render(
      el(SuspenseGroup, {
        fallback: el('div', { 'data-testid': 'group-fallback' }, 'Loading')
      }, el(Child))
    )

    expect(container.querySelector('[data-testid="group-fallback"]')).toBeTruthy()

    await act(async () => {
      ready = true
      wake.resolve()
      await wake.promise
    })

    await waitFor(() => {
      expect(container.querySelector('[data-testid="content"]')).toBeTruthy()
    })
    expect(container.querySelector('[data-testid="group-fallback"]')).toBeFalsy()
  })

  it('groups an initial useSub subscription under the shared fallback', async () => {
    const Child = observer(() => {
      useSub($.suspenseGroupDoc.missing, { defer: false })
      return el('div', { 'data-testid': 'document-content' }, 'Document ready')
    })

    const { container } = render(
      el(SuspenseGroup, {
        fallback: el('div', { 'data-testid': 'group-fallback' }, 'Loading')
      }, el(Child))
    )

    expect(container.querySelector('[data-testid="group-fallback"]')).toBeTruthy()

    await waitFor(() => {
      expect(container.querySelector('[data-testid="document-content"]')).toBeTruthy()
    })
    expect(container.querySelector('[data-testid="group-fallback"]')).toBeFalsy()
  })

  it('groups a useBatchSub barrier under the shared fallback', async () => {
    const Child = observer(() => {
      useBatchSub($.suspenseGroupBatch.missing, { defer: false })
      useBatchSub()
      return el('div', { 'data-testid': 'batch-content' }, 'Batch ready')
    })

    const { container } = render(
      el(SuspenseGroup, {
        fallback: el('div', { 'data-testid': 'group-fallback' }, 'Loading')
      }, el(Child))
    )

    expect(container.querySelector('[data-testid="group-fallback"]')).toBeTruthy()

    await waitFor(() => {
      expect(container.querySelector('[data-testid="batch-content"]')).toBeTruthy()
    })
    expect(container.querySelector('[data-testid="group-fallback"]')).toBeFalsy()
  })

  it('keeps useNow stable across uncommitted group retries', async () => {
    const wake = deferred()
    const timestamps = new Set()
    let ready = false

    const Child = observer(() => {
      timestamps.add(useNow())
      const scheduleUpdate = useSuspenseGroupScheduleUpdate()
      scheduleUpdate(wake.promise)
      if (!ready) throw wake.promise
      return el('div', { 'data-testid': 'stable-now-content' }, 'Ready')
    })

    const { container } = render(
      el(SuspenseGroup, {
        fallback: el('div', { 'data-testid': 'group-fallback' }, 'Loading')
      }, el(Child))
    )

    await act(async () => {
      ready = true
      wake.resolve()
      await wake.promise
    })

    await waitFor(() => {
      expect(container.querySelector('[data-testid="stable-now-content"]')).toBeTruthy()
    })
    expect(timestamps.size).toBe(1)
  })

  it('keeps a query keyed by useNow stable while the group is suspended', async () => {
    const timestamps = new Set()

    const Child = observer(() => {
      const now = useNow()
      timestamps.add(now)
      if (timestamps.size > 1) {
        throw Error('useNow changed before the grouped subscription committed')
      }
      useBatchSub($.suspenseGroupStableNow, { marker: now }, { defer: false })
      useBatchSub()
      return el('div', { 'data-testid': 'stable-query-content' }, 'Ready')
    })

    const { container } = render(
      el(SuspenseGroup, {
        fallback: el('div', { 'data-testid': 'group-fallback' }, 'Loading')
      }, el(Child))
    )

    await waitFor(() => {
      expect(container.querySelector('[data-testid="stable-query-content"]')).toBeTruthy()
    })
    expect(timestamps.size).toBe(1)
  })

  it('groups useSuspendMemo under the shared fallback', async () => {
    const pending = deferred()
    let ready = false
    const Child = observer(() => {
      useSuspendMemo(() => {
        if (!ready) throw pending.promise
      }, [])
      return el('div', { 'data-testid': 'memo-content' }, 'Memo ready')
    })

    const { container } = render(
      el(SuspenseGroup, {
        fallback: el('div', { 'data-testid': 'group-fallback' }, 'Loading')
      }, el(Child))
    )

    expect(container.querySelector('[data-testid="group-fallback"]')).toBeTruthy()

    await act(async () => {
      ready = true
      pending.resolve()
      await pending.promise
    })

    await waitFor(() => {
      expect(container.querySelector('[data-testid="memo-content"]')).toBeTruthy()
    })
    expect(container.querySelector('[data-testid="group-fallback"]')).toBeFalsy()
  })

  it('does not suspend when a useSuspendMemo factory returns a Promise', () => {
    const returnedPromise = Promise.resolve('value')
    let memoValue
    const Child = observer(() => {
      memoValue = useSuspendMemo(() => returnedPromise, [])
      return el('div', { 'data-testid': 'returned-promise-content' }, 'Rendered')
    })

    const { container } = render(
      el(SuspenseGroup, {
        fallback: el('div', { 'data-testid': 'group-fallback' }, 'Loading')
      }, el(Child))
    )

    expect(memoValue).toBe(returnedPromise)
    expect(container.querySelector('[data-testid="returned-promise-content"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="group-fallback"]')).toBeFalsy()
  })

  it('keeps an explicitly configured observer fallback', () => {
    const blocker = new Promise(() => {})
    const Child = observer(() => {
      throw blocker
    }, {
      suspenseProps: {
        fallback: el('div', { 'data-testid': 'custom-fallback' }, 'Custom')
      }
    })

    const { container } = render(
      el(SuspenseGroup, {
        fallback: el('div', { 'data-testid': 'group-fallback' }, 'Group')
      }, el(Child))
    )

    expect(container.querySelector('[data-testid="custom-fallback"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="group-fallback"]')).toBeFalsy()
  })

  it('retries when a registered promise rejects', async () => {
    const wake = deferred()
    const blocker = new Promise(() => {})
    let ready = false

    const Child = observer(() => {
      const scheduleUpdate = useSuspenseGroupScheduleUpdate()
      scheduleUpdate(wake.promise)
      if (!ready) throw blocker
      return el('div', { 'data-testid': 'recovered' }, 'Recovered')
    })

    const { container } = render(
      el(SuspenseGroup, { fallback: el('div', {}, 'Loading') }, el(Child))
    )

    await act(async () => {
      ready = true
      wake.reject(new Error('expected test rejection'))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(container.querySelector('[data-testid="recovered"]')).toBeTruthy()
    })
  })
})

function deferred () {
  let resolveDeferred
  let rejectDeferred
  const promise = new Promise((resolve, reject) => {
    resolveDeferred = resolve
    rejectDeferred = reject
  })
  return {
    promise,
    resolve: resolveDeferred,
    reject: rejectDeferred
  }
}
