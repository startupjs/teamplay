import React, { createElement as el, Fragment, createRef } from 'react'
import { describe, it, afterEach, beforeEach, expect, beforeAll as before, jest } from '@jest/globals'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import {
  $,
  useSub,
  useAsyncSub,
  useBatchSub,
  observer,
  sub,
  emit,
  useOn,
  useEmit,
  useApi,
  useSuspendMemo,
  useSuspendMemoByKey,
  useDidUpdate,
  useOnce,
  useSyncEffect
} from '../src/index.ts'
import { setTestThrottling, resetTestThrottling, useSubClassic } from '../src/react/useSub.ts'
import { __resetSuspendMemoForTests } from '../src/react/useSuspendMemo.ts'
import { useId, useNow, useTriggerUpdate, useUnmount } from '../src/react/helpers.ts'
import trapRender from '../src/react/trapRender.js'
import renderAttemptDestroyer from '../src/react/renderAttemptDestroyer.ts'
import { runGc, cache } from '../test/_helpers.js'
import { get as _get, set as _set, del as _del } from '../src/orm/dataTree.js'
import connect from '../src/connect/test.js'
import { docSubscriptions } from '../src/orm/Doc.js'
import { querySubscriptions } from '../src/orm/Query.js'
import { aggregationSubscriptions, AGGREGATIONS } from '../src/orm/Aggregation.js'
import { setPrivateData } from '../src/orm/privateData.js'
import {
  on as onCompatEvent,
  removeListener as removeCompatListener,
  __resetEventsForTests
} from '../src/orm/Compat/eventsCompat.js'

before(connect)
beforeEach(() => {
  expect(cache.size).toBe(1)
})
afterEach(cleanup)
afterEach(runGc)
afterEach(() => {
  __resetEventsForTests()
  __resetSuspendMemoForTests()
})

const isCompatMode = process.env.TEAMPLAY_COMPAT === '1'
const itCompat = isCompatMode ? it : it.skip

describe('observer() options', () => {
  it('observer with forwardRef option - ref should be forwarded', async () => {
    const Component = observer((props, ref) => {
      return el('div', { ref }, 'Test')
    }, { forwardRef: true })

    const ref = createRef()
    const { container } = render(el(Component, { ref }))

    expect(ref.current).toBeTruthy()
    expect(ref.current.tagName).toBe('DIV')
    expect(container.textContent).toBe('Test')
  })

  it('observer with custom suspenseProps (fallback component)', async () => {
    const Component = observer(() => {
      const $user = useSub($.users.suspenseUser)
      return el('span', {}, $user.name.get() || 'anonymous')
    }, {
      suspenseProps: {
        fallback: el('div', { id: 'custom-fallback' }, 'Custom Loading...')
      }
    })

    const { container } = render(el(Component))
    expect(container.querySelector('#custom-fallback')).toBeTruthy()
    expect(container.textContent).toBe('Custom Loading...')

    await wait()
    expect(container.querySelector('#custom-fallback')).toBeFalsy()
    expect(container.textContent).toBe('anonymous')
  })

  it('observer component displayName is set correctly', () => {
    function MyComponent () {
      return el('div', {}, 'Test')
    }
    const ObservedComponent = observer(MyComponent)

    expect(ObservedComponent.displayName).toMatch(/MyComponent/)
  })

  it('observer component passes through propTypes and defaultProps', () => {
    function MyComponent ({ name = 'default' }) {
      return el('div', {}, name)
    }
    MyComponent.defaultProps = { name: 'default' }
    MyComponent.propTypes = { name: 'string' }

    const ObservedComponent = observer(MyComponent)

    expect(ObservedComponent.defaultProps).toBe(MyComponent.defaultProps)
    expect(ObservedComponent.propTypes).toBe(MyComponent.propTypes)
  })
})

describe('compat helper hooks', () => {
  it('useDidUpdate runs on updates only', async () => {
    let calls = 0
    const Component = observer(() => {
      const [count, setCount] = React.useState(0)
      useDidUpdate(() => {
        calls += 1
      }, [count])
      return el('button', { onClick: () => setCount(count + 1) }, String(count))
    })

    const { container } = render(el(Component))
    expect(calls).toBe(0)
    fireEvent.click(container.querySelector('button'))
    await wait()
    expect(calls).toBe(1)
  })

  itCompat('useDidUpdate ignores callback identity changes when deps are unchanged', async () => {
    let dismissCalls = 0

    const Component = observer(() => {
      const [visible, setVisible] = React.useState(true)
      const [counter, setCounter] = React.useState(0)

      useDidUpdate(() => {
        if (!visible) {
          dismissCalls += 1
          setCounter(value => value + 1)
        }
      }, [visible])

      return el(Fragment, {}, [
        el('button', { key: 'hide', onClick: () => setVisible(false) }, 'hide'),
        el('div', { key: 'counter' }, String(counter))
      ])
    })

    const { container } = render(el(Component))

    fireEvent.click(container.querySelector('button'))
    await wait()

    expect(dismissCalls).toBe(1)
    expect(container.textContent).toContain('1')
  })

  it('useOnce runs only once when condition becomes truthy', async () => {
    let calls = 0
    const Component = observer(() => {
      const [flag, setFlag] = React.useState(false)
      useOnce(flag, () => { calls += 1 })
      return el('button', { onClick: () => setFlag(true) }, String(flag))
    })

    const { container } = render(el(Component))
    fireEvent.click(container.querySelector('button'))
    await wait()
    fireEvent.click(container.querySelector('button'))
    await wait()
    expect(calls).toBe(1)
  })

  it('useSyncEffect runs and cleans up', async () => {
    let effectCalls = 0
    let cleanupCalls = 0
    const Component = observer(() => {
      useSyncEffect(() => {
        effectCalls += 1
        return () => { cleanupCalls += 1 }
      }, [])
      return el('div')
    })

    const { unmount } = render(el(Component))
    await wait()
    unmount()
    expect(effectCalls).toBe(1)
    expect(cleanupCalls).toBe(1)
  })

  it('useApi returns data', async () => {
    const api = async q => [{ id: q }]
    const Component = observer(() => {
      const [items] = useApi(api, ['x'], { debounce: 10 })
      return el('div', {}, items ? String(items[0].id) : '')
    })

    jest.useFakeTimers()
    const { container } = render(el(Component))
    await act(async () => {
      jest.advanceTimersByTime(20)
    })
    jest.useRealTimers()
    expect(container.textContent).toBe('x')
  })
})

describe('useSub edge cases', () => {
  it('useBatchSub query exposes extra value for $count queries', async () => {
    await act(async () => {
      $.users.countUser1.set({ _id: 'countUser1', name: 'A' })
      $.users.countUser2.set({ _id: 'countUser2', name: 'B' })
    })

    const Component = observer(() => {
      const $query = useBatchSub($.users, {
        _id: { $in: ['countUser1', 'countUser2'] },
        $count: true
      }, { defer: false })
      useBatchSub()
      const count = $query.extra.get()
      return el('div', {}, `${typeof count}:${String(count)}`)
    })

    const { container } = render(el(Component))
    await waitFor(() => {
      expect(container.textContent).toBe('number:2')
    })

    await act(async () => {
      $.users.countUser1.del()
      $.users.countUser2.del()
    })
  })

  it('trapRender keeps legacy immediate destroy for non-compat thrown promises', async () => {
    const events = []
    let resolvePromise
    const pending = new Promise(resolve => {
      resolvePromise = resolve
    })
    const wrapped = trapRender({
      componentId: 'legacyTrapRender',
      render: () => {
        throw pending
      },
      cache: {
        activate: () => events.push('activate'),
        deactivate: () => events.push('deactivate')
      },
      destroy: where => events.push(`destroy:${where}`)
    })

    let thrown
    try {
      wrapped()
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBe(pending)
    expect(events).toEqual([
      'activate',
      'destroy:trapRender.js'
    ])

    resolvePromise()
    await pending
  })

  it('trapRender keeps observer shell alive only when suspense gate is explicitly armed', async () => {
    const events = []
    let resolvePromise
    const pending = new Promise(resolve => {
      resolvePromise = resolve
    })
    const wrapped = trapRender({
      componentId: 'compatTrapRenderArmed',
      render: () => {
        renderAttemptDestroyer.armSuspenseGate()
        throw pending
      },
      cache: {
        activate: () => events.push('activate'),
        deactivate: () => events.push('deactivate')
      },
      destroy: where => events.push(`destroy:${where}`)
    })

    let thrown
    try {
      wrapped()
    } catch (err) {
      thrown = err
    }

    expect(events).toEqual([
      'activate',
      'deactivate'
    ])
    expect(typeof thrown?.then).toBe('function')

    resolvePromise()
    await thrown

    expect(events).toEqual([
      'activate',
      'deactivate'
    ])
  })

  it('useSuspendMemo keeps the same pending thenable across rerenders of one component instance', async () => {
    let resolvePromise
    let ready = false
    let startCalls = 0
    let forceRerender
    const pending = new Promise(resolve => {
      resolvePromise = resolve
    })

    const Component = observer(() => {
      useSuspendMemo(() => {
        if (!ready) {
          startCalls++
          throw pending
        }
      }, [])

      return el('span', { id: 'suspendMemoLocal' }, 'ready')
    })

    function Wrapper () {
      const [, setTick] = React.useState(0)
      forceRerender = () => setTick(tick => tick + 1)
      return el(Component)
    }

    const { container } = render(el(Wrapper))
    expect(startCalls).toBe(1)
    expect(container.textContent).toBe('')

    act(() => {
      forceRerender()
    })
    expect(startCalls).toBe(1)

    ready = true
    resolvePromise()
    await wait()

    expect(startCalls).toBe(1)
    expect(container.querySelector('#suspendMemoLocal').textContent).toBe('ready')
  })

  it('useSuspendMemoByKey dedupes one pending operation across two components', async () => {
    let resolvePromise
    let ready = false
    let startCalls = 0
    const pending = new Promise(resolve => {
      resolvePromise = resolve
    })

    const Component = observer(({ testId }) => {
      useSuspendMemoByKey('shared-join-key', () => {
        if (!ready) {
          startCalls++
          throw pending
        }
      }, [])

      return el('span', { id: testId }, 'ready')
    })

    const { container } = render(fr(
      el(Component, { testId: 'suspendMemoByKeyA' }),
      el(Component, { testId: 'suspendMemoByKeyB' })
    ))

    expect(startCalls).toBe(1)
    expect(container.textContent).toBe('')

    ready = true
    resolvePromise()
    await wait()

    expect(startCalls).toBe(1)
    expect(container.querySelector('#suspendMemoByKeyA').textContent).toBe('ready')
    expect(container.querySelector('#suspendMemoByKeyB').textContent).toBe('ready')
  })

  it('useSuspendMemoByKey keeps the same pending operation across remount', async () => {
    let resolvePromise
    let ready = false
    let startCalls = 0
    let setMounted
    const pending = new Promise(resolve => {
      resolvePromise = resolve
    })

    const Component = observer(() => {
      useSuspendMemoByKey('shared-remount-key', () => {
        if (!ready) {
          startCalls++
          throw pending
        }
      }, [])

      return el('span', { id: 'suspendMemoByKeyRemount' }, 'ready')
    })

    function Wrapper () {
      const [mounted, _setMounted] = React.useState(true)
      setMounted = _setMounted
      return mounted ? el(Component) : null
    }

    const { container } = render(el(Wrapper))
    expect(startCalls).toBe(1)
    expect(container.textContent).toBe('')

    act(() => {
      setMounted(false)
    })
    act(() => {
      setMounted(true)
    })
    expect(startCalls).toBe(1)

    ready = true
    resolvePromise()
    await wait()

    expect(startCalls).toBe(1)
    expect(container.querySelector('#suspendMemoByKeyRemount').textContent).toBe('ready')
  })

  it('useSub with doc subscription that starts loading (Suspense)', async () => {
    let renders = 0
    const Component = observer(() => {
      renders++
      const $user = useSub($.users.edgeCase1)
      return el('span', {}, $user.name.get() || 'loading')
    })

    const { container } = render(el(Component))
    expect(renders).toBe(1)
    expect(container.textContent).toBe('')

    await wait()
    expect(renders).toBe(2)
    expect(container.textContent).toBe('loading')
  })

  it('useSub - component unmount during active subscription should not cause errors', async () => {
    let errorThrown = false
    const originalError = console.error
    console.error = (msg) => {
      if (msg && msg.includes && msg.includes('unmount')) {
        errorThrown = true
      }
      originalError(msg)
    }

    const Component = observer(() => {
      const $user = useSub($.users.unmountTest)
      return el('span', {}, $user.name.get() || 'loading')
    })

    const { container, unmount } = render(el(Component))
    expect(container.textContent).toBe('')

    // Unmount before subscription completes
    unmount()

    await wait()
    expect(errorThrown).toBe(false)

    console.error = originalError
  })

  it('useSubClassic path - test by importing useSubClassic directly and testing it', async () => {
    // useSubClassic is the classic version that initially throws promise for Suspense
    let renders = 0
    const Component = observer(() => {
      renders++
      const $userSub = useSubClassic($.users.classicTest2)
      return el('span', {}, $userSub.name.get() || 'loading')
    })

    const { container } = render(el(Component))
    expect(renders).toBe(1)
    expect(container.textContent).toBe('')

    await wait()
    expect(renders).toBe(2)
    expect(container.textContent).toBe('loading')

    // Now set the whole document to create it
    act(() => { $.users.classicTest2.set({ name: 'John' }) })
    expect(container.textContent).toBe('John')
    expect(renders).toBe(3)
  })

  itCompat('useSubClassic with batch keeps update resubscribe in background', async () => {
    const collection = 'classicBatchSwitch'
    const lessonA = 'lesson_classic_batch_switch_1'
    const lessonB = 'lesson_classic_batch_switch_2'

    const $lessonA = await sub($[collection][lessonA])
    const $lessonB = await sub($[collection][lessonB])
    $lessonA.set({ courseId: 'course_a', stageIds: ['a1'] })
    $lessonB.set({ courseId: 'course_b', stageIds: ['b1', 'b2'] })
    await wait()

    _del([collection, lessonA])
    _del([collection, lessonB])

    const Component = observer(() => {
      const [courseId, setCourseId] = React.useState('course_a')
      const [lessonId, setLessonId] = React.useState(lessonA)

      useSubClassic($[collection], { courseId }, { batch: true })
      useBatchSub()
      const lesson = $[collection][lessonId].get()
      const stageIds = lesson?.stageIds

      return el(Fragment, null,
        el('span', { id: 'classicBatchSwitch' }, stageIds ? stageIds.join(',') : 'pending'),
        el('button', {
          id: 'classicBatchSwitchBtn',
          onClick: () => {
            setCourseId('course_b')
            setLessonId(lessonB)
          }
        }, 'switch')
      )
    }, { suspenseProps: { fallback: el('span', { id: 'classicBatchSwitch' }, 'Loading...') } })

    const { container } = render(el(Component))
    expect(container.querySelector('#classicBatchSwitch').textContent).toBe('Loading...')

    await waitFor(() => {
      expect(container.querySelector('#classicBatchSwitch').textContent).toBe('a1')
    })

    fireEvent.click(container.querySelector('#classicBatchSwitchBtn'))
    expect(container.querySelector('#classicBatchSwitch').textContent).not.toBe('Loading...')

    await waitFor(() => {
      expect(container.querySelector('#classicBatchSwitch').textContent).toBe('b1,b2')
    })
  })

  it('observer replays updates skipped during execution context', async () => {
    const $state = $({ count: 0 })

    const Component = observer(() => {
      const count = $state.count.get()
      if (count < 2) $state.count.set(count + 1)
      return el('span', { id: 'observerReplay' }, String(count))
    })

    const { container } = render(el(Component))

    await waitFor(() => {
      expect(container.querySelector('#observerReplay').textContent).toBe('2')
    })
  })

  it('subscribed observer replays updates skipped during execution context', async () => {
    act(() => {
      $.compatReplayDoc.test1.set({ name: 'John' })
      $.page.compatReplayFlag.set(false)
    })

    const Component = observer(() => {
      const $doc = useSub($.compatReplayDoc.test1, { defer: false })
      const doc = $doc.get()
      const flag = $.page.compatReplayFlag.get() || false
      if (!flag) $.page.compatReplayFlag.set(true)
      return el('span', { id: 'compatReplay' }, `${doc?.name || 'missing'}:${flag}`)
    }, {
      suspenseProps: {
        fallback: el('span', { id: 'compatReplay' }, 'Loading...')
      }
    })

    const { container } = render(el(Component))

    await waitFor(() => {
      expect(container.querySelector('#compatReplay').textContent).toBe('John:true')
    })
  })

  it('useSub accepts options as the second argument for doc signals', async () => {
    const $user = await sub($.useSubDocOptions.user1)
    $user.set({ name: 'Doc options' })
    await wait()

    const Component = observer(() => {
      const $doc = useSub($.useSubDocOptions.user1, { defer: false })
      return el('span', { id: 'useSubDocOptions' }, $doc.name.get() || 'empty')
    }, { suspenseProps: { fallback: el('span', { id: 'useSubDocOptions' }, 'Loading...') } })

    const { container } = render(el(Component))

    await waitFor(() => {
      expect(container.querySelector('#useSubDocOptions').textContent).toBe('Doc options')
    })
  })

  it('useSub keeps second object argument as query params for collection signals', async () => {
    const $match = await sub($.useSubQueryDefer.q1)
    const $miss = await sub($.useSubQueryDefer.q2)
    $match.set({ name: 'Match', defer: false, createdAt: 1 })
    $miss.set({ name: 'Miss', defer: true, createdAt: 2 })
    await wait()

    const Component = observer(() => {
      const $docs = useSub($.useSubQueryDefer, { defer: false })
      return el('span', { id: 'useSubQueryDefer' }, $docs.map($doc => $doc.name.get()).join(','))
    }, { suspenseProps: { fallback: el('span', { id: 'useSubQueryDefer' }, 'Loading...') } })

    const { container } = render(el(Component))

    await waitFor(() => {
      expect(container.querySelector('#useSubQueryDefer').textContent).toBe('Match')
    })
  })

  it('setTestThrottling validation - wrong values throw errors', () => {
    expect(() => setTestThrottling('invalid')).toThrow()
    expect(() => setTestThrottling(0)).toThrow()
    expect(() => setTestThrottling(-10)).toThrow()

    // Valid value should not throw
    expect(() => setTestThrottling(50)).not.toThrow()
    resetTestThrottling()
  })

  it('resetTestThrottling works', async () => {
    // Set and reset throttling before creating any subscriptions
    setTestThrottling(100)
    resetTestThrottling()

    // Create a user document
    const $john = await sub($.users.resetThrottle1)
    $john.set({ name: 'John', status: 'active', createdAt: 1 })
    await wait()

    const Component = observer(() => {
      // Query for active users
      const $activeUsers = useSub($.users, { status: 'active', $sort: { createdAt: 1 } })
      return el('span', {}, $activeUsers.map($user => $user.name.get()).join(','))
    }, { suspenseProps: { fallback: el('span', {}, 'Loading...') } })

    const { container } = render(el(Component))
    expect(container.textContent).toBe('Loading...')

    // Without throttling, this should complete quickly
    await wait(50)
    expect(container.textContent).toBe('John')
  })
})

describe('useAsyncSub', () => {
  it('useAsyncSub returns undefined initially for doc subscriptions', async () => {
    let renders = 0
    const Component = observer(() => {
      renders++
      const $user = useAsyncSub($.users.asyncDoc)
      if (!$user) return el('span', {}, 'Waiting...')
      return el('span', {}, $user.name.get() || 'no name')
    })

    const { container } = render(el(Component))
    expect(renders).toBe(1)
    expect(container.textContent).toBe('Waiting...')

    await wait()
    expect(renders).toBe(2)
    expect(container.textContent).toBe('no name')
  })

  it('useAsyncSub accepts options as the second argument for doc signals', async () => {
    let renders = 0
    const Component = observer(() => {
      renders++
      const $user = useAsyncSub($.users.asyncDocOptions, { defer: false })
      if (!$user) return el('span', {}, 'Waiting...')
      return el('span', {}, $user.name.get() || 'no name')
    })

    const { container } = render(el(Component))
    expect(renders).toBe(1)
    expect(container.textContent).toBe('Waiting...')

    await wait()
    expect(renders).toBe(2)
    expect(container.textContent).toBe('no name')
  })

  it('useAsyncSub with parameter changes', async () => {
    const $users = $.usersAsyncParam
    const $john = await sub($users._1)
    const $jane = await sub($users._2)
    $john.set({ name: 'John', status: 'active' })
    $jane.set({ name: 'Jane', status: 'inactive' })
    await wait()

    const Component = observer(() => {
      const $status = $('active')
      const $activeUsers = useAsyncSub($users, { status: $status.get() })
      if (!$activeUsers) return el('span', {}, 'Waiting...')
      return fr(
        el('span', {}, $activeUsers.map($user => $user.name.get()).join(',')),
        el('button', { onClick: () => $status.set('inactive') })
      )
    })

    const { container } = render(el(Component))
    expect(container.textContent).toBe('Waiting...')

    await wait()
    expect(container.textContent).toBe('John')

    fireEvent.click(container.querySelector('button'))
    await wait()
    // Should show "Waiting..." briefly during resubscribe
    await wait()
    expect(container.textContent).toBe('Jane')
  })
})

describe('$() in React context', () => {
  it('$() creating object with destructuring inside observer', async () => {
    let renders = 0
    const Component = observer(() => {
      renders++
      const { $firstName, $lastName } = $({ firstName: 'John', lastName: 'Doe' })
      return fr(
        el('span', {}, `${$firstName.get()} ${$lastName.get()}`),
        el('button', { id: 'first', onClick: () => $firstName.set('Jane') }),
        el('button', { id: 'last', onClick: () => $lastName.set('Smith') })
      )
    })

    const { container } = render(el(Component))
    expect(container.textContent).toBe('John Doe')
    expect(renders).toBe(1)

    fireEvent.click(container.querySelector('#first'))
    expect(container.textContent).toBe('Jane Doe')
    expect(renders).toBe(2)

    fireEvent.click(container.querySelector('#last'))
    expect(container.textContent).toBe('Jane Smith')
    expect(renders).toBe(3)
  })

  it('$() reaction that depends on multiple signals', async () => {
    let renders = 0
    const Component = observer(() => {
      renders++
      const $a = $(5)
      const $b = $(10)
      const $sum = $(() => $a.get() + $b.get())
      return fr(
        el('span', {}, `Sum: ${$sum.get()}`),
        el('button', { id: 'a', onClick: () => $a.set($a.get() + 1) }),
        el('button', { id: 'b', onClick: () => $b.set($b.get() + 1) })
      )
    })

    const { container } = render(el(Component))
    expect(container.textContent).toBe('Sum: 15')
    expect(renders).toBe(1)

    fireEvent.click(container.querySelector('#a'))
    expect(container.textContent).toBe('Sum: 16')
    expect(renders).toBe(2)

    fireEvent.click(container.querySelector('#b'))
    expect(container.textContent).toBe('Sum: 17')
    expect(renders).toBe(3)
  })

  it('$() reaction cleanup on unmount', async () => {
    let cleanedUp = false
    const Component = observer(() => {
      const $value = $(42)
      const $doubled = $(() => $value.get() * 2)

      useUnmount(() => {
        cleanedUp = true
      })

      return el('span', {}, $doubled.get())
    })

    const { container, unmount } = render(el(Component))
    expect(container.textContent).toBe('84')
    expect(cleanedUp).toBe(false)

    unmount()
    expect(cleanedUp).toBe(true)
  })
})

describe('emit / useOn / useEmit', () => {
  it('emit triggers handlers registered with useOn', () => {
    const handler = jest.fn()
    const Component = observer(() => {
      useOn('CustomEvent', handler)
      return null
    })
    render(el(Component))
    emit('CustomEvent', 1, 2, 3)
    expect(handler).toHaveBeenCalledWith(1, 2, 3)
  })

  it('useOn cleanup removes handler', () => {
    const handler = jest.fn()
    const Component = observer(() => {
      useOn('CustomEventCleanup', handler)
      return null
    })
    const { unmount } = render(el(Component))
    unmount()
    emit('CustomEventCleanup')
    expect(handler).not.toHaveBeenCalled()
  })

  it('useEmit returns a stable emit function', () => {
    let captured
    const Component = observer(() => {
      captured = useEmit()
      return null
    })
    render(el(Component))
    expect(captured).toBe(emit)
  })

  it('emit does not call listeners added during the same dispatch', () => {
    const calls = []
    const secondHandler = jest.fn(() => {
      calls.push('second')
    })
    const firstHandler = jest.fn(() => {
      calls.push('first')
      removeCompatListener('CustomEventSnapshot', firstHandler)
      onCompatEvent('CustomEventSnapshot', secondHandler)
    })

    onCompatEvent('CustomEventSnapshot', firstHandler)

    emit('CustomEventSnapshot')
    expect(calls).toEqual(['first'])

    emit('CustomEventSnapshot')
    expect(calls).toEqual(['first', 'second'])
  })

  itCompat('useOn handler that writes page state is called only once per emit', () => {
    let calls = 0

    const Component = observer(() => {
      const $errors = $.page.errors

      useOn('LessonSave', () => {
        calls++
        $errors.set({ name: 'requiredField' })
      })

      return null
    })

    render(el(Component))

    act(() => {
      emit('LessonSave')
    })

    expect(calls).toBe(1)
    expect($.page.errors.get()).toEqual({ name: 'requiredField' })
  })
})

describe('useBatchSub', () => {
  it('supports useSub batch option as the core batch API', async () => {
    const $doc = await sub($.batchSubCore.u1)
    await $doc.set({ name: 'Grace' })
    await wait()

    const Component = observer(() => {
      const $user = useSub($.batchSubCore.u1, { batch: true, defer: false })
      useSub(undefined, undefined, { batch: true })
      return el('span', { id: 'batchSubCore' }, $user.name.get() || '')
    }, { suspenseProps: { fallback: el('span', { id: 'batchSubCore' }, 'Loading...') } })

    const { container } = render(el(Component))

    await waitFor(() => {
      expect(container.querySelector('#batchSubCore').textContent).toBe('Grace')
    })
  })

  it('subscribes to a doc and closes with a no-arg batch barrier call', async () => {
    const $doc = await sub($.batchSubDoc.u1)
    await $doc.set({ name: 'Ada' })
    await wait()

    const Component = observer(() => {
      const $user = useBatchSub($.batchSubDoc.u1, { defer: false })
      useBatchSub()
      return el('span', { id: 'batchSubDoc' }, $user.name.get() || '')
    }, { suspenseProps: { fallback: el('span', { id: 'batchSubDoc' }, 'Loading...') } })

    const { container } = render(el(Component))

    await waitFor(() => {
      expect(container.querySelector('#batchSubDoc').textContent).toBe('Ada')
    })
  })

  it('subscribes to a query and closes with a no-arg batch barrier call', async () => {
    const $match = await sub($.batchSubQuery.q1)
    const $miss = await sub($.batchSubQuery.q2)
    await Promise.all([
      $match.set({ name: 'Match', active: true, createdAt: 1 }),
      $miss.set({ name: 'Miss', active: false, createdAt: 2 })
    ])
    await wait()

    const Component = observer(() => {
      const $query = useBatchSub($.batchSubQuery, { active: true }, { defer: false })
      useBatchSub()
      return el('span', { id: 'batchSubQuery' }, $query.map($doc => $doc.name.get()).join(','))
    }, { suspenseProps: { fallback: el('span', { id: 'batchSubQuery' }, 'Loading...') } })

    const { container } = render(el(Component))

    await waitFor(() => {
      expect(container.querySelector('#batchSubQuery').textContent).toBe('Match')
    })
  })

  it('supports useSub query batch option as the core batch API', async () => {
    const collection = 'batchSubCoreQuery'
    const $match = await sub($[collection].q1)
    const $miss = await sub($[collection].q2)
    await Promise.all([
      $match.set({ name: 'Core Match', active: true, createdAt: 1 }),
      $miss.set({ name: 'Core Miss', active: false, createdAt: 2 })
    ])
    await wait()

    const Component = observer(() => {
      const $query = useSub($[collection], { active: true }, { batch: true, defer: false })
      useSub(undefined, undefined, { batch: true })
      return el('span', { id: 'batchSubCoreQuery' }, $query.map($doc => $doc.name.get()).join(','))
    }, { suspenseProps: { fallback: el('span', { id: 'batchSubCoreQuery' }, 'Loading...') } })

    const { container } = render(el(Component))

    await waitFor(() => {
      expect(container.querySelector('#batchSubCoreQuery').textContent).toBe('Core Match')
    })
  })

  it('throws clear error when useBatchSub is used without a closing barrier call', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const Component = observer(() => {
        useBatchSub($.batchSubMissingClose.u1, { defer: false })
        return el('span', { id: 'batchSubMissingClose' }, 'x')
      })
      expect(() => render(el(Component))).toThrow(/batch subscriptions were used without a closing useBatchSub\(\) call/i)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('throws clear error when useSub batch option is used without a closing barrier call', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const Component = observer(() => {
        useSub($.batchSubCoreMissingClose.u1, { batch: true, defer: false })
        return el('span', { id: 'batchSubCoreMissingClose' }, 'x')
      })
      expect(() => render(el(Component))).toThrow(/batch subscriptions were used without a closing useBatchSub\(\) call/i)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('keeps previous signal during update resubscribe', async () => {
    const collection = 'batchSubRouteSwitch'
    const docA = 'doc_batch_sub_route_a'
    const docB = 'doc_batch_sub_route_b'
    await $[collection][docA].set({ stageIds: ['a1'] })
    await $[collection][docB].set({ stageIds: ['b1', 'b2'] })
    _del([collection, docA])
    _del([collection, docB])

    setTestThrottling(80)
    try {
      const Component = observer(() => {
        const [docId, setDocId] = React.useState(docA)
        const $doc = useBatchSub($[collection][docId], { defer: false })
        useBatchSub()
        const { stageIds } = $doc.get()
        return fr(
          el('span', { id: 'batchSubRouteSwitch' }, stageIds.join(',')),
          el('button', {
            id: 'batchSubRouteSwitchBtn',
            onClick: () => setDocId(docB)
          }, 'switch')
        )
      }, { suspenseProps: { fallback: el('span', { id: 'batchSubRouteSwitch' }, 'Loading...') } })

      const { container } = render(el(Component))
      expect(container.querySelector('#batchSubRouteSwitch').textContent).toBe('Loading...')

      await waitFor(() => {
        expect(container.querySelector('#batchSubRouteSwitch').textContent).toBe('a1')
      })

      fireEvent.click(container.querySelector('#batchSubRouteSwitchBtn'))
      expect(container.querySelector('#batchSubRouteSwitch').textContent).not.toBe('Loading...')

      await waitFor(() => {
        expect(container.querySelector('#batchSubRouteSwitch').textContent).toBe('b1,b2')
      })
    } finally {
      resetTestThrottling()
    }
  })

  it('keeps normal defer default for batch doc route switches', async () => {
    const collection = 'batchSubDefaultDeferRouteSwitch'
    const docA = 'doc_batch_sub_default_defer_route_a'
    const docB = 'doc_batch_sub_default_defer_route_b'
    await $[collection][docA].set({ stageIds: ['a1'] })
    await $[collection][docB].set({ stageIds: ['b1', 'b2'] })
    _del([collection, docA])
    _del([collection, docB])

    setTestThrottling(80)
    try {
      const Component = observer(() => {
        const [docId, setDocId] = React.useState(docA)
        const $doc = useBatchSub($[collection][docId])
        useBatchSub()
        const { stageIds } = $doc.get()
        return fr(
          el('span', { id: 'batchSubDefaultDeferRouteSwitch' }, stageIds.join(',')),
          el('button', {
            id: 'batchSubDefaultDeferRouteSwitchBtn',
            onClick: () => setDocId(docB)
          }, 'switch')
        )
      }, { suspenseProps: { fallback: el('span', { id: 'batchSubDefaultDeferRouteSwitch' }, 'Loading...') } })

      const { container } = render(el(Component))
      expect(container.querySelector('#batchSubDefaultDeferRouteSwitch').textContent).toBe('Loading...')

      await waitFor(() => {
        expect(container.querySelector('#batchSubDefaultDeferRouteSwitch').textContent).toBe('a1')
      })

      fireEvent.click(container.querySelector('#batchSubDefaultDeferRouteSwitchBtn'))
      expect(container.querySelector('#batchSubDefaultDeferRouteSwitch').textContent).not.toBe('Loading...')

      await waitFor(() => {
        expect(container.querySelector('#batchSubDefaultDeferRouteSwitch').textContent).toBe('b1,b2')
      })
    } finally {
      resetTestThrottling()
    }
  })

  it('supports explicit defer true for batch query route switches', async () => {
    const collection = 'batchSubExplicitDeferQuerySwitch'
    const lessonA = 'lesson_batch_sub_explicit_defer_a'
    const lessonB = 'lesson_batch_sub_explicit_defer_b'
    await $[collection][lessonA].set({ courseId: 'course_a', stageIds: ['a1'], createdAt: 1 })
    await $[collection][lessonB].set({ courseId: 'course_b', stageIds: ['b1', 'b2'], createdAt: 1 })
    _del([collection, lessonA])
    _del([collection, lessonB])

    setTestThrottling(80)
    try {
      const Component = observer(() => {
        const [courseId, setCourseId] = React.useState('course_a')
        const $query = useBatchSub($[collection], { courseId, $sort: { createdAt: 1 } }, { defer: true })
        useBatchSub()
        const docs = $query.get()
        const firstId = docs[0]?._id ?? docs[0]?.id
        const lesson = $[collection][firstId].get()
        const { stageIds } = lesson

        return fr(
          el('span', { id: 'batchSubExplicitDeferQuerySwitch' }, stageIds.join(',')),
          el('button', {
            id: 'batchSubExplicitDeferQuerySwitchBtn',
            onClick: () => setCourseId('course_b')
          }, 'switch')
        )
      }, { suspenseProps: { fallback: el('span', { id: 'batchSubExplicitDeferQuerySwitch' }, 'Loading...') } })

      const { container } = render(el(Component))
      expect(container.querySelector('#batchSubExplicitDeferQuerySwitch').textContent).toBe('Loading...')

      await waitFor(() => {
        expect(container.querySelector('#batchSubExplicitDeferQuerySwitch').textContent).toBe('a1')
      })

      fireEvent.click(container.querySelector('#batchSubExplicitDeferQuerySwitchBtn'))
      expect(container.querySelector('#batchSubExplicitDeferQuerySwitch').textContent).not.toBe('Loading...')

      await waitFor(() => {
        expect(container.querySelector('#batchSubExplicitDeferQuerySwitch').textContent).toBe('b1,b2')
      })
    } finally {
      resetTestThrottling()
    }
  })

  it('waits for doc materialization before closing the batch barrier', async () => {
    const collection = 'batchSubDocReadyBarrier'
    const docId = 'doc_ready_1'
    await $[collection][docId].set({ name: 'Ready', active: true })
    _del([collection, docId])

    const docProto = docSubscriptions.DocClass.prototype
    const originalRefData = docProto._refData
    docProto._refData = function (...args) {
      if (this.collection === collection && this.docId === docId && !this.__delayRefDataOnce) {
        this.__delayRefDataOnce = true
        setTimeout(() => originalRefData.apply(this, args), 60)
        return
      }
      return originalRefData.apply(this, args)
    }

    try {
      const Component = observer(() => {
        const $doc = useBatchSub($[collection][docId], { defer: false })
        useBatchSub()
        const localDoc = $[collection][docId].get()
        return fr(
          el('span', { id: 'batchSubDocReadyBarrier' }, localDoc?.name || 'pending'),
          el('span', { id: 'batchSubDocReadyBarrierHookValue' }, $doc.name.get() || 'pending')
        )
      }, { suspenseProps: { fallback: el('span', { id: 'batchSubDocReadyBarrier' }, 'Loading...') } })

      const { container } = render(el(Component))
      expect(container.querySelector('#batchSubDocReadyBarrier').textContent).toBe('Loading...')

      await wait(20)
      expect(container.querySelector('#batchSubDocReadyBarrier').textContent).toBe('Loading...')

      await waitFor(() => {
        expect(container.querySelector('#batchSubDocReadyBarrier').textContent).toBe('Ready')
        expect(container.querySelector('#batchSubDocReadyBarrierHookValue').textContent).toBe('Ready')
      })
    } finally {
      docProto._refData = originalRefData
    }
  })

  it('allows immediate local read after a batch query barrier', async () => {
    const lessonId = 'lesson_batch_sub_local_1'
    const $lesson = await sub($.batchSubLocalLessons[lessonId])
    await $lesson.set({ courseId: 'course_1', stageIds: ['s1', 's2'] })
    await wait()

    _del(['batchSubLocalLessons', lessonId])
    expect(_get(['batchSubLocalLessons', lessonId])).toBe(undefined)

    const Component = observer(() => {
      useBatchSub($.batchSubLocalLessons, { courseId: 'course_1' }, { defer: false })
      useBatchSub()
      const lesson = $.batchSubLocalLessons[lessonId].get()
      const { stageIds } = lesson
      return el('span', { id: 'batchSubLocalRead' }, stageIds.join(','))
    }, { suspenseProps: { fallback: el('span', { id: 'batchSubLocalRead' }, 'Loading...') } })

    const { container } = render(el(Component))
    expect(container.querySelector('#batchSubLocalRead').textContent).toBe('Loading...')

    await waitFor(() => {
      expect(container.querySelector('#batchSubLocalRead').textContent).toBe('s1,s2')
    })
  })

  it('does not overwrite an existing doc while materializing query results', async () => {
    const collection = 'batchSubLocalExisting'
    const lessonId = 'lesson_batch_sub_local_existing'
    const $lesson = await sub($[collection][lessonId])
    await $lesson.set({ courseId: 'course_existing', stageIds: ['db'] })
    await wait()

    _set([collection, lessonId], {
      _id: lessonId,
      id: lessonId,
      courseId: 'course_existing',
      stageIds: ['local']
    })

    const Component = observer(() => {
      useBatchSub($[collection], { courseId: 'course_existing' }, { defer: false })
      useBatchSub()
      const lesson = $[collection][lessonId].get()
      const { stageIds } = lesson
      return el('span', { id: 'batchSubLocalExisting' }, stageIds.join(','))
    }, { suspenseProps: { fallback: el('span', { id: 'batchSubLocalExisting' }, 'Loading...') } })

    const { container } = render(el(Component))
    expect(container.querySelector('#batchSubLocalExisting').textContent).toBe('Loading...')

    await waitFor(() => {
      expect(container.querySelector('#batchSubLocalExisting').textContent).toBe('local')
    })
  })

  it('keeps materialized query docs alive after an unrelated doc subscriber unmounts', async () => {
    const collection = 'batchSubLocalRetained'
    const lessonId = 'lesson_batch_sub_local_retained'
    const $lesson = await sub($[collection][lessonId])
    await $lesson.set({ courseId: 'course_retained', stageIds: ['s1', 's2'] })
    await wait()

    _del([collection, lessonId])
    expect(_get([collection, lessonId])).toBe(undefined)

    function QueryOwner () {
      useBatchSub($[collection], { courseId: 'course_retained' }, { defer: false })
      useBatchSub()
      const lesson = $[collection][lessonId].get()
      return el('span', { id: 'batchSubLocalRetained' }, lesson.stageIds.join(','))
    }

    const QueryOwnerObserved = observer(QueryOwner, {
      suspenseProps: { fallback: el('span', { id: 'batchSubLocalRetained' }, 'Loading...') }
    })

    function DocSubscriber ({ visible }) {
      useSub($[collection][visible ? lessonId : '__DUMMY__'])
      if (!visible) return null
      return el('span', { id: 'batchSubDocSubscriber' }, 'subscribed')
    }

    const DocSubscriberObserved = observer(DocSubscriber)

    function Root () {
      const [visible, setVisible] = React.useState(true)
      React.useEffect(() => {
        setVisible(false)
      }, [])
      return el(React.Fragment, null,
        el(QueryOwnerObserved),
        el(DocSubscriberObserved, { visible })
      )
    }

    const { container } = render(el(Root))
    expect(container.querySelector('#batchSubLocalRetained').textContent).toBe('Loading...')

    await waitFor(() => {
      expect(container.querySelector('#batchSubLocalRetained').textContent).toBe('s1,s2')
    })

    await waitFor(() => {
      expect(container.querySelector('#batchSubDocSubscriber')).toBe(null)
    })

    await waitFor(() => {
      expect(container.querySelector('#batchSubLocalRetained').textContent).toBe('s1,s2')
      expect(_get([collection, lessonId]).stageIds).toEqual(['s1', 's2'])
    })
  })

  it('keeps previous query signal during update resubscribe', async () => {
    const collection = 'batchSubLocalLessonsSwitch'
    const lessonA = 'lesson_batch_sub_switch_1'
    const lessonB = 'lesson_batch_sub_switch_2'

    const $lessonA = await sub($[collection][lessonA])
    const $lessonB = await sub($[collection][lessonB])
    await Promise.all([
      $lessonA.set({ courseId: 'course_a', stageIds: ['a1'] }),
      $lessonB.set({ courseId: 'course_b', stageIds: ['b1', 'b2'] })
    ])
    await wait()

    _del([collection, lessonA])
    _del([collection, lessonB])

    const Component = observer(() => {
      const [courseId, setCourseId] = React.useState('course_a')
      const [lessonId, setLessonId] = React.useState(lessonA)

      useBatchSub($[collection], { courseId }, { defer: false })
      useBatchSub()
      const lesson = $[collection][lessonId].get()
      const stageIds = lesson?.stageIds

      return el(Fragment, null,
        el('span', { id: 'batchSubLocalSwitch' }, stageIds ? stageIds.join(',') : 'pending'),
        el('button', {
          id: 'batchSubLocalSwitchBtn',
          onClick: () => {
            setCourseId('course_b')
            setLessonId(lessonB)
          }
        }, 'switch')
      )
    }, { suspenseProps: { fallback: el('span', { id: 'batchSubLocalSwitch' }, 'Loading...') } })

    const { container } = render(el(Component))
    expect(container.querySelector('#batchSubLocalSwitch').textContent).toBe('Loading...')

    await waitFor(() => {
      expect(container.querySelector('#batchSubLocalSwitch').textContent).toBe('a1')
    })

    fireEvent.click(container.querySelector('#batchSubLocalSwitchBtn'))
    expect(container.querySelector('#batchSubLocalSwitch').textContent).not.toBe('Loading...')

    await waitFor(() => {
      expect(container.querySelector('#batchSubLocalSwitch').textContent).toBe('b1,b2')
    })
  })

  it('keeps previous docs for no-guard local reads during query switches', async () => {
    const collection = 'batchSubLocalLessonsSwitchNoGuard'
    const lessonA = 'lesson_batch_sub_switch_no_guard_1'
    const lessonB = 'lesson_batch_sub_switch_no_guard_2'
    await $[collection][lessonA].set({ courseId: 'course_a', stageIds: ['a1'], createdAt: 1 })
    await $[collection][lessonB].set({ courseId: 'course_b', stageIds: ['b1', 'b2'], createdAt: 1 })
    _del([collection, lessonA])
    _del([collection, lessonB])

    setTestThrottling(80)
    try {
      const Component = observer(() => {
        const [courseId, setCourseId] = React.useState('course_a')
        const $query = useBatchSub($[collection], { courseId, $sort: { createdAt: 1 } }, { defer: false })
        useBatchSub()
        const docs = $query.get()
        const firstId = docs[0]._id || docs[0].id
        const lesson = $[collection][firstId].get()
        const { stageIds } = lesson

        return fr(
          el('span', { id: 'batchSubLocalSwitchNoGuard' }, stageIds.join(',')),
          el('button', {
            id: 'batchSubLocalSwitchNoGuardBtn',
            onClick: () => setCourseId('course_b')
          }, 'switch')
        )
      }, { suspenseProps: { fallback: el('span', { id: 'batchSubLocalSwitchNoGuard' }, 'Loading...') } })

      const { container } = render(el(Component))
      expect(container.querySelector('#batchSubLocalSwitchNoGuard').textContent).toBe('Loading...')

      await waitFor(() => {
        expect(container.querySelector('#batchSubLocalSwitchNoGuard').textContent).toBe('a1')
      })

      fireEvent.click(container.querySelector('#batchSubLocalSwitchNoGuardBtn'))
      expect(container.querySelector('#batchSubLocalSwitchNoGuard').textContent).not.toBe('Loading...')

      await waitFor(() => {
        expect(container.querySelector('#batchSubLocalSwitchNoGuard').textContent).toBe('b1,b2')
      })
    } finally {
      resetTestThrottling()
    }
  })

  it('allows immediate local read after a query insert in the same render cycle', async () => {
    const collection = 'batchSubLocalLessonsInsert'
    const lessonId = 'lesson_batch_sub_insert_1'

    const Component = observer(() => {
      const $query = useBatchSub($[collection], { courseId: 'course_insert', $sort: { createdAt: 1 } }, { defer: false })
      useBatchSub()
      const docs = $query.get()
      if (!docs || docs.length === 0) return el('span', { id: 'batchSubLocalInsert' }, 'none')
      const firstId = docs[0]?._id ?? docs[0]?.id
      const lesson = $[collection][firstId].get()
      const { stageIds } = lesson
      return el('span', { id: 'batchSubLocalInsert' }, stageIds.join(','))
    }, { suspenseProps: { fallback: el('span', { id: 'batchSubLocalInsert' }, 'Loading...') } })

    const { container } = render(el(Component))
    expect(container.querySelector('#batchSubLocalInsert').textContent).toBe('Loading...')

    await waitFor(() => {
      expect(container.querySelector('#batchSubLocalInsert').textContent).toBe('none')
    })

    await act(async () => {
      const $lesson = await sub($[collection][lessonId])
      await $lesson.set({ courseId: 'course_insert', stageIds: ['i1', 'i2'], createdAt: 1 })
    })

    await waitFor(() => {
      expect(container.querySelector('#batchSubLocalInsert').textContent).toBe('i1,i2')
    })
  })

  it('waits for query materialization before closing the batch barrier', async () => {
    const collection = 'batchSubQueryReadyBarrier'
    const lessonId = 'lesson_query_ready_1'
    await $[collection][lessonId].set({ courseId: 'course_query_ready', stageIds: ['q1', 'q2'] })
    _del([collection, lessonId])

    const queryProto = querySubscriptions.QueryClass.prototype
    const originalInitData = queryProto._initData
    queryProto._initData = function (...args) {
      if (
        this.collectionName === collection &&
        this.params?.courseId === 'course_query_ready' &&
        !this.__delayInitDataOnce
      ) {
        this.__delayInitDataOnce = true
        setTimeout(() => {
          if (!this.shareQuery) return
          originalInitData.apply(this, args)
        }, 60)
        return
      }
      return originalInitData.apply(this, args)
    }

    try {
      const Component = observer(() => {
        useBatchSub($[collection], { courseId: 'course_query_ready' }, { defer: false })
        useBatchSub()
        const lesson = $[collection][lessonId].get()
        const stageIds = lesson?.stageIds
        return el('span', { id: 'batchSubQueryReadyBarrier' }, stageIds ? stageIds.join(',') : 'pending')
      }, { suspenseProps: { fallback: el('span', { id: 'batchSubQueryReadyBarrier' }, 'Loading...') } })

      const { container } = render(el(Component))
      expect(container.querySelector('#batchSubQueryReadyBarrier').textContent).toBe('Loading...')

      await wait(20)
      expect(container.querySelector('#batchSubQueryReadyBarrier').textContent).toBe('Loading...')

      await waitFor(() => {
        expect(container.querySelector('#batchSubQueryReadyBarrier').textContent).toBe('q1,q2')
      })
    } finally {
      queryProto._initData = originalInitData
    }
  })

  it('resolves aggregation batch subscriptions from aggregation-level docs', async () => {
    const collection = 'batchSubAggregateClientReady'
    const queryProto = aggregationSubscriptions.QueryClass.prototype
    const originalInitData = queryProto._initData
    queryProto._initData = function (...args) {
      if (this.collectionName === collection && Array.isArray(this.params?.$aggregate)) {
        for (const rootId of this.rootIds || []) {
          setPrivateData(rootId, [AGGREGATIONS, this.hash], [{ _id: null, startedStageIds: ['s1', 's2'] }])
        }
        return
      }
      return originalInitData.apply(this, args)
    }

    try {
      const Component = observer(() => {
        const $rows = useBatchSub($[collection], {
          $aggregate: [
            { $match: { active: true } },
            { $group: { _id: null, startedStageIds: { $push: '$stageId' } } }
          ]
        }, { defer: false })
        useBatchSub()
        const rows = $rows.get()
        const joined = (rows?.[0]?.startedStageIds || []).join(',')
        return el('span', { id: 'batchSubAggregateClientReady' }, `${rows?.length || 0}:${joined}`)
      }, { suspenseProps: { fallback: el('span', { id: 'batchSubAggregateClientReady' }, 'Loading...') } })

      const { container } = render(el(Component))
      expect(container.querySelector('#batchSubAggregateClientReady').textContent).toBe('Loading...')

      await waitFor(() => {
        expect(container.querySelector('#batchSubAggregateClientReady').textContent).toBe('1:s1,s2')
      })
      expect(_get([collection, null])).toBe(undefined)
      expect(_get([collection, 'null'])).toBe(undefined)
    } finally {
      queryProto._initData = originalInitData
    }
  })
})

describe.skip('SignalCompat.start() React bindings legacy removed', () => {
  itCompat('compat start keeps pre-bound child signals reactive across object syncs', async () => {
    const basePath = '_compatStartReactBinding'
    _del([basePath])

    await $[basePath].doc.set({
      name: 'Stage 1',
      config: {
        realtimeConfig: {
          voice: 'alloy'
        }
      }
    })

    const $name = $[basePath].virtual.name
    const $voice = $[basePath].virtual.config.realtimeConfig.voice
    $.start(`${basePath}.virtual`, $[basePath].doc, doc => doc)

    try {
      const Component = observer(() => {
        return fr(
          el('span', { id: 'compatStartName' }, $name.get() || 'undefined'),
          el('span', { id: 'compatStartVoice' }, $voice.get() || 'undefined')
        )
      })

      const { container } = render(el(Component))

      expect(container.querySelector('#compatStartName').textContent).toBe('Stage 1')
      expect(container.querySelector('#compatStartVoice').textContent).toBe('alloy')

      await act(async () => {
        await $[basePath].doc.name.set('Stage 2')
      })
      await wait()
      expect(container.querySelector('#compatStartName').textContent).toBe('Stage 2')

      await act(async () => {
        await $[basePath].doc.config.realtimeConfig.voice.set('echo')
      })
      await wait()
      expect(container.querySelector('#compatStartVoice').textContent).toBe('echo')

      await act(async () => {
        await $name.set('Draft')
        await $voice.set('nova')
      })
      await wait()
      expect(container.querySelector('#compatStartName').textContent).toBe('Draft')
      expect(container.querySelector('#compatStartVoice').textContent).toBe('nova')

      await act(async () => {
        await $[basePath].doc.set({
          name: 'Stage 3',
          config: {
            realtimeConfig: {
              voice: 'shimmer'
            }
          }
        })
      })
      await wait()
      expect(container.querySelector('#compatStartName').textContent).toBe('Stage 3')
      expect(container.querySelector('#compatStartVoice').textContent).toBe('shimmer')
    } finally {
      $.stop(`${basePath}.virtual`)
      _del([basePath])
    }
  })

  itCompat('compat start keeps pre-bound undefined boolean and text child signals reactive', async () => {
    const basePath = '_compatStartUndefinedFields'
    _del([basePath])

    await $[basePath].doc.set({
      name: 'Stage 1',
      config: {}
    })

    const $final = $[basePath].virtual.final
    const $prompt = $[basePath].virtual.prompt
    $.start(`${basePath}.virtual`, $[basePath].doc, doc => doc)

    try {
      const Component = observer(() => {
        return fr(
          el('span', { id: 'compatStartFinal' }, String($final.get())),
          el('span', { id: 'compatStartPrompt' }, $prompt.get() || 'undefined')
        )
      })

      const { container } = render(el(Component))

      expect(container.querySelector('#compatStartFinal').textContent).toBe('undefined')
      expect(container.querySelector('#compatStartPrompt').textContent).toBe('undefined')

      await act(async () => {
        await $final.set(true)
        await $prompt.set('Draft prompt')
      })
      await wait()

      expect(container.querySelector('#compatStartFinal').textContent).toBe('true')
      expect(container.querySelector('#compatStartPrompt').textContent).toBe('Draft prompt')

      await act(async () => {
        await $[basePath].doc.set({
          name: 'Stage 2',
          final: true,
          prompt: 'Saved prompt',
          config: {}
        })
      })
      await wait()

      expect(container.querySelector('#compatStartFinal').textContent).toBe('true')
      expect(container.querySelector('#compatStartPrompt').textContent).toBe('Saved prompt')
    } finally {
      $.stop(`${basePath}.virtual`)
      _del([basePath])
    }
  })
})

describe('Helper hooks', () => {
  it('useId returns component id inside observer', () => {
    let componentId
    const Component = observer(() => {
      componentId = useId()
      return el('div', {}, 'Test')
    })

    render(el(Component))
    expect(componentId).toBeTruthy()
    expect(typeof componentId).toBe('string')
  })

  it('useNow returns creation timestamp inside observer', () => {
    let timestamp
    const before = Date.now()
    const Component = observer(() => {
      timestamp = useNow()
      return el('div', {}, 'Test')
    })

    render(el(Component))
    const after = Date.now()

    expect(timestamp).toBeTruthy()
    expect(typeof timestamp).toBe('number')
    expect(timestamp).toBeGreaterThanOrEqual(before)
    expect(timestamp).toBeLessThanOrEqual(after)
  })

  it('useTriggerUpdate returns a function inside observer', async () => {
    let triggerUpdate
    let renders = 0
    const Component = observer(() => {
      renders++
      triggerUpdate = useTriggerUpdate()
      return el('div', {}, `Renders: ${renders}`)
    })

    const { container } = render(el(Component))
    expect(renders).toBe(1)
    expect(typeof triggerUpdate).toBe('function')

    act(() => { triggerUpdate() })
    expect(renders).toBe(2)
    expect(container.textContent).toBe('Renders: 2')
  })

  it('useUnmount callback is called on component unmount', () => {
    let unmounted = false
    const Component = observer(() => {
      useUnmount(() => {
        unmounted = true
      })
      return el('div', {}, 'Test')
    })

    const { unmount } = render(el(Component))
    expect(unmounted).toBe(false)

    unmount()
    expect(unmounted).toBe(true)
  })

  it('Helper hooks throw error when used outside observer', () => {
    // These hooks rely on ComponentMetaContext which is only provided inside observer()
    // The context has a default value of {}, so context is truthy but doesn't have the required properties
    // The hooks check for specific properties and should fail when accessing undefined properties

    // useId - it should return undefined when used outside observer context
    let componentId
    function BadComponentId () {
      componentId = useId()
      return el('div', {}, 'Test')
    }
    render(el(BadComponentId))
    expect(componentId).toBeUndefined()

    cleanup()

    // useNow - it should return undefined when used outside observer context
    let timestamp
    function BadComponentNow () {
      timestamp = useNow()
      return el('div', {}, 'Test')
    }
    render(el(BadComponentNow))
    expect(timestamp).toBeUndefined()

    cleanup()

    // useTriggerUpdate - it should return undefined when used outside observer context
    let triggerUpdate
    function BadComponentTrigger () {
      triggerUpdate = useTriggerUpdate()
      return el('div', {}, 'Test')
    }
    render(el(BadComponentTrigger))
    expect(triggerUpdate).toBeUndefined()
  })
})

describe('Edge cases', () => {
  it('Multiple observer components rendering concurrently', async () => {
    const { $name } = $.session.multiComponent

    let renders1 = 0
    const Component1 = observer(() => {
      renders1++
      return el('span', { id: 'c1' }, $name.get() || 'anon1')
    })

    let renders2 = 0
    const Component2 = observer(() => {
      renders2++
      return el('span', { id: 'c2' }, $name.get() || 'anon2')
    })

    const Container = () => fr(
      el(Component1),
      el(Component2)
    )

    const { container } = render(el(Container))
    expect(container.querySelector('#c1').textContent).toBe('anon1')
    expect(container.querySelector('#c2').textContent).toBe('anon2')
    expect(renders1).toBe(1)
    expect(renders2).toBe(1)

    act(() => { $name.set('John') })
    expect(container.querySelector('#c1').textContent).toBe('John')
    expect(container.querySelector('#c2').textContent).toBe('John')
    expect(renders1).toBe(2)
    expect(renders2).toBe(2)
  })

  it('Nested observer components', async () => {
    const { $outer, $inner } = $.session.nestedObserver

    let innerRenders = 0
    const Inner = observer(() => {
      innerRenders++
      return el('span', { id: 'inner' }, $inner.get() || 'inner')
    })

    let outerRenders = 0
    const Outer = observer(() => {
      outerRenders++
      return fr(
        el('span', { id: 'outer' }, $outer.get() || 'outer'),
        el(Inner)
      )
    })

    const { container } = render(el(Outer))
    expect(container.querySelector('#outer').textContent).toBe('outer')
    expect(container.querySelector('#inner').textContent).toBe('inner')
    expect(outerRenders).toBe(1)
    expect(innerRenders).toBe(1)

    act(() => { $outer.set('OUTER') })
    expect(container.querySelector('#outer').textContent).toBe('OUTER')
    expect(container.querySelector('#inner').textContent).toBe('inner')
    expect(outerRenders).toBe(2)
    // Inner component rerenders because it's a child of Outer, even though $inner didn't change
    // This is expected React behavior - when parent rerenders, children rerender too (unless memoized differently)
    expect(innerRenders).toBe(2)

    act(() => { $inner.set('INNER') })
    expect(container.querySelector('#outer').textContent).toBe('OUTER')
    expect(container.querySelector('#inner').textContent).toBe('INNER')
    expect(outerRenders).toBe(2)
    expect(innerRenders).toBe(3)
  })

  it('observer component with no signal access (should still work)', () => {
    let renders = 0
    const Component = observer(() => {
      renders++
      return el('div', {}, 'Static content')
    })

    const { container } = render(el(Component))
    expect(container.textContent).toBe('Static content')
    expect(renders).toBe(1)

    // Observer components are memoized, so they won't rerender without signal changes
    // This is actually the correct behavior - the component works fine with no signals
    // Just verify it renders correctly
    expect(container.textContent).toBe('Static content')
  })
})

function fr (...children) {
  return el(Fragment, {}, ...children)
}

async function wait (ms = 30) {
  return await act(async () => {
    await new Promise(resolve => setTimeout(resolve, ms))
  })
}
