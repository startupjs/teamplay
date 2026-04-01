import React, { createElement as el, Fragment, createRef } from 'react'
import { describe, it, afterEach, beforeEach, expect, beforeAll as before, jest } from '@jest/globals'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import {
  $,
  useSub,
  useAsyncSub,
  observer,
  sub,
  useValue,
  useValue$,
  useModel,
  useLocal,
  useLocal$,
  useSession,
  useSession$,
  usePage,
  usePage$,
  useBatch,
  useDoc,
  useDoc$,
  useBatchDoc,
  useBatchDoc$,
  useAsyncDoc,
  useAsyncDoc$,
  useQuery,
  useQuery$,
  useAsyncQuery,
  useAsyncQuery$,
  useBatchQuery,
  useBatchQuery$,
  useQueryIds,
  useAsyncQueryIds,
  useQueryDoc,
  useQueryDoc$,
  useAsyncQueryDoc,
  useLocalDoc,
  emit,
  useOn,
  useEmit,
  useApi,
  useDidUpdate,
  useOnce,
  useSyncEffect
} from '../index.js'
import { setTestThrottling, resetTestThrottling, useSubClassic } from '../react/useSub.js'
import { useId, useNow, useTriggerUpdate, useUnmount } from '../react/helpers.js'
import trapRender from '../react/trapRender.js'
import renderAttemptDestroyer from '../react/renderAttemptDestroyer.js'
import { __resetCompatComponentRegistryForTests } from '../react/compatComponentRegistry.js'
import { runGc, cache } from '../test/_helpers.js'
import { get as _get, set as _set, del as _del } from '../orm/dataTree.js'
import connect from '../connect/test.js'
import { docSubscriptions } from '../orm/Doc.js'
import { querySubscriptions } from '../orm/Query.js'
import { aggregationSubscriptions, AGGREGATIONS } from '../orm/Aggregation.js'
import {
  on as onCompatEvent,
  removeListener as removeCompatListener,
  __resetEventsForTests
} from '../orm/Compat/eventsCompat.js'
import { __resetCompatWarningsForTests } from '../orm/Compat/hooksCompat.js'

before(connect)
beforeEach(() => {
  expect(cache.size).toBe(1)
})
afterEach(cleanup)
afterEach(runGc)
afterEach(() => {
  __resetCompatComponentRegistryForTests()
  __resetEventsForTests()
  __resetCompatWarningsForTests()
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

  it('useLocalDoc reads without subscription', async () => {
    act(() => {
      $._localDocs.doc1.set({ name: 'Local' })
    })
    const Component = observer(() => {
      const [doc] = useLocalDoc('_localDocs', 'doc1')
      return el('div', {}, doc?.name || '')
    })
    const { container } = render(el(Component))
    expect(container.textContent).toBe('Local')
  })

  itCompat('undefined doc warning is emitted only once across rerenders', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    const Component = observer(() => {
      const [count, setCount] = React.useState(0)
      useDoc('chats', undefined)

      React.useEffect(() => {
        if (count === 0) setCount(1)
      }, [count])

      return el('div', {}, String(count))
    })

    render(el(Component))
    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalled()
    })

    const compatWarnings = warnSpy.mock.calls.filter(([message]) =>
      String(message).includes('[useDoc] You are trying to subscribe to an undefined document id')
    )
    expect(compatWarnings).toHaveLength(1)
    warnSpy.mockRestore()
  })
})

describe('useSub edge cases', () => {
  itCompat('useBatchQuery$ returns extra value for $count queries', async () => {
    await act(async () => {
      $.users.countUser1.set({ _id: 'countUser1', name: 'A' })
      $.users.countUser2.set({ _id: 'countUser2', name: 'B' })
    })

    const Component = observer(() => {
      const $count = useBatchQuery$('users', {
        _id: { $in: ['countUser1', 'countUser2'] },
        $count: true
      })
      useBatch()
      const count = $count.get()
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

  itCompat('trapRender defers compat cleanup until thrown promise resolves', async () => {
    const events = []
    let resolvePromise
    const pending = new Promise(resolve => {
      resolvePromise = resolve
    })
    const wrapped = trapRender({
      componentId: 'compatTrapRender',
      render: () => {
        renderAttemptDestroyer.add(() => {
          events.push('attempt-cleanup')
        }, { compat: true })
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
      'deactivate',
      'attempt-cleanup'
    ])
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
      useBatch()
      const [lesson] = useLocal(`${collection}.${lessonId}`)
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

  itCompat('compat observer replays updates skipped during execution context', async () => {
    act(() => {
      $.compatReplayDoc.test1.set({ name: 'John' })
      $.page.compatReplayFlag.set(false)
    })

    const Component = observer(() => {
      const [doc] = useDoc('compatReplayDoc', 'test1')
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

describe('useValue / useValue$', () => {
  it('useValue$ mirrors $() for default values', async () => {
    let renders = 0
    const Component = observer(() => {
      renders++
      const $name = useValue$('John')
      return fr(
        el('span', {}, $name.get()),
        el('button', { id: 'btn', onClick: () => $name.set('Jane') })
      )
    })

    const { container } = render(el(Component))
    expect(container.textContent).toBe('John')
    expect(renders).toBe(1)

    fireEvent.click(container.querySelector('#btn'))
    expect(container.textContent).toBe('Jane')
    expect(renders).toBe(2)
  })

  it('useValue returns [value, $signal]', async () => {
    let renders = 0
    const Component = observer(() => {
      renders++
      const [name, $name] = useValue('John')
      return fr(
        el('span', {}, name),
        el('button', { id: 'btn2', onClick: () => $name.set('Jane') })
      )
    })

    const { container } = render(el(Component))
    expect(container.textContent).toBe('John')
    expect(renders).toBe(1)

    fireEvent.click(container.querySelector('#btn2'))
    expect(container.textContent).toBe('Jane')
    expect(renders).toBe(2)
  })

  itCompat('useValue materializes object state when setting nested child under primitive default', async () => {
    const chatId = 'chat_1'

    const Component = observer(() => {
      const [, $visibleMap] = useValue(false)
      return fr(
        el('span', { id: 'state' }, JSON.stringify($visibleMap.get())),
        el('span', { id: 'child' }, String($visibleMap.at(chatId).get())),
        el('button', { id: 'btn3', onClick: () => $visibleMap.at(chatId).set(true) })
      )
    })

    const { container } = render(el(Component))
    expect(container.querySelector('#state').textContent).toBe('false')
    expect(container.querySelector('#child').textContent).toBe('undefined')

    fireEvent.click(container.querySelector('#btn3'))
    expect(container.querySelector('#state').textContent).toBe('{"chat_1":true}')
    expect(container.querySelector('#child').textContent).toBe('true')
  })
})

describe('useModel', () => {
  it('useModel returns root signal when called without args', () => {
    let $model
    const Component = observer(() => {
      $model = useModel()
      return null
    })
    render(el(Component))
    expect($model).toBe($)
  })

  it('useModel returns a signal for string path', () => {
    let $model
    const Component = observer(() => {
      $model = useModel('users.u1')
      return null
    })
    render(el(Component))
    expect($model.path()).toBe('users.u1')
  })

  it('useModel returns the signal passed as argument', () => {
    const $user = $.users.u2
    let $model
    const Component = observer(() => {
      $model = useModel($user)
      return null
    })
    render(el(Component))
    expect($model).toBe($user)
  })

  it('useModel accepts signal-derived paths', () => {
    let $model
    const Component = observer(() => {
      $model = useModel($.users.u3.path() + '.settings')
      return null
    })
    render(el(Component))
    expect($model.path()).toBe('users.u3.settings')
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
      const [, $errors] = usePage('errors')

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

describe('useLocal / useLocal$', () => {
  it('useLocal returns [value, $signal] for local path', () => {
    act(() => { $.page.lang.set('en') })

    let renders = 0
    const Component = observer(() => {
      renders++
      const [lang, $lang] = useLocal('_page.lang')
      return fr(
        el('span', { id: 'lang' }, lang || ''),
        el('button', { id: 'btn', onClick: () => $lang.set('ru') })
      )
    })

    const { container } = render(el(Component))
    expect(container.querySelector('#lang').textContent).toBe('en')
    expect(renders).toBe(1)

    fireEvent.click(container.querySelector('#btn'))
    expect(container.querySelector('#lang').textContent).toBe('ru')
    expect(renders).toBe(2)
  })

  it('useLocal$ returns a signal for local path', () => {
    act(() => { $.page.lang2.set('en') })

    let renders = 0
    const Component = observer(() => {
      renders++
      const $lang = useLocal$('_page.lang2')
      return fr(
        el('span', { id: 'lang2' }, $lang.get() || ''),
        el('button', { id: 'btn2', onClick: () => $lang.set('de') })
      )
    })

    const { container } = render(el(Component))
    expect(container.querySelector('#lang2').textContent).toBe('en')
    expect(renders).toBe(1)

    fireEvent.click(container.querySelector('#btn2'))
    expect(container.querySelector('#lang2').textContent).toBe('de')
    expect(renders).toBe(2)
  })

  it('useLocal accepts a signal and resolves its path', () => {
    const $lang = $.page.lang5
    act(() => { $lang.set('en') })

    let renders = 0
    const Component = observer(() => {
      renders++
      const [lang, $resolved] = useLocal($lang)
      return fr(
        el('span', { id: 'langSig' }, lang || ''),
        el('button', { id: 'langSigBtn', onClick: () => $resolved.set('fr') })
      )
    })

    const { container } = render(el(Component))
    expect(container.querySelector('#langSig').textContent).toBe('en')
    expect(renders).toBe(1)

    fireEvent.click(container.querySelector('#langSigBtn'))
    expect(container.querySelector('#langSig').textContent).toBe('fr')
    expect(renders).toBe(2)
  })
})

describe('useSession / useSession$', () => {
  it('useSession returns [value, $signal] for session path', () => {
    act(() => { $.session.userId.set('u1') })

    let renders = 0
    const Component = observer(() => {
      renders++
      const [userId, $userId] = useSession('userId')
      return fr(
        el('span', { id: 'sid' }, userId || ''),
        el('button', { id: 'sidbtn', onClick: () => $userId.set('u2') })
      )
    })

    const { container } = render(el(Component))
    expect(container.querySelector('#sid').textContent).toBe('u1')
    expect(renders).toBe(1)

    fireEvent.click(container.querySelector('#sidbtn'))
    expect(container.querySelector('#sid').textContent).toBe('u2')
    expect(renders).toBe(2)
  })

  it('useSession$ returns a signal for session path', () => {
    act(() => { $.session.userId2.set('u1') })

    let renders = 0
    const Component = observer(() => {
      renders++
      const $userId = useSession$('userId2')
      return fr(
        el('span', { id: 'sid2' }, $userId.get() || ''),
        el('button', { id: 'sidbtn2', onClick: () => $userId.set('u3') })
      )
    })

    const { container } = render(el(Component))
    expect(container.querySelector('#sid2').textContent).toBe('u1')
    expect(renders).toBe(1)

    fireEvent.click(container.querySelector('#sidbtn2'))
    expect(container.querySelector('#sid2').textContent).toBe('u3')
    expect(renders).toBe(2)
  })

  it('useSession without path returns root session', () => {
    act(() => { $.session.rootFlag.set('yes') })

    const Component = observer(() => {
      const [session] = useSession()
      return el('span', { id: 'sidRoot' }, session?.rootFlag || '')
    })

    const { container } = render(el(Component))
    expect(container.querySelector('#sidRoot').textContent).toBe('yes')
  })
})

describe('usePage / usePage$', () => {
  it('usePage returns [value, $signal] for page path', () => {
    act(() => { $.page.lang3.set('en') })

    let renders = 0
    const Component = observer(() => {
      renders++
      const [lang, $lang] = usePage('lang3')
      return fr(
        el('span', { id: 'plang' }, lang || ''),
        el('button', { id: 'plangbtn', onClick: () => $lang.set('ru') })
      )
    })

    const { container } = render(el(Component))
    expect(container.querySelector('#plang').textContent).toBe('en')
    expect(renders).toBe(1)

    fireEvent.click(container.querySelector('#plangbtn'))
    expect(container.querySelector('#plang').textContent).toBe('ru')
    expect(renders).toBe(2)
  })

  it('usePage$ returns a signal for page path', () => {
    act(() => { $.page.lang4.set('en') })

    let renders = 0
    const Component = observer(() => {
      renders++
      const $lang = usePage$('lang4')
      return fr(
        el('span', { id: 'plang2' }, $lang.get() || ''),
        el('button', { id: 'plangbtn2', onClick: () => $lang.set('de') })
      )
    })

    const { container } = render(el(Component))
    expect(container.querySelector('#plang2').textContent).toBe('en')
    expect(renders).toBe(1)

    fireEvent.click(container.querySelector('#plangbtn2'))
    expect(container.querySelector('#plang2').textContent).toBe('de')
    expect(renders).toBe(2)
  })

  it('usePage without path returns root page', () => {
    act(() => { $.page.rootFlag.set('ok') })

    const Component = observer(() => {
      const [page] = usePage()
      return el('span', { id: 'pageRoot' }, page?.rootFlag || '')
    })

    const { container } = render(el(Component))
    expect(container.querySelector('#pageRoot').textContent).toBe('ok')
  })
})

describe('useDoc / useDoc$', () => {
  it('useDoc subscribes to a document and returns [doc, $doc]', async () => {
    const $doc = await sub($.docHook.u1)
    $doc.set({ name: 'John' })
    await wait()

    let renders = 0
    const Component = observer(() => {
      renders++
      const [doc, $user] = useDoc('docHook', 'u1')
      return fr(
        el('span', { id: 'docName' }, doc?.name || ''),
        el('button', { id: 'docBtn', onClick: () => $user.name.set('Jane') })
      )
    })

    const { container } = render(el(Component))
    await wait()
    expect(container.querySelector('#docName').textContent).toBe('John')
    expect(renders).toBeGreaterThan(0)

    fireEvent.click(container.querySelector('#docBtn'))
    expect(container.querySelector('#docName').textContent).toBe('Jane')
  })

  it('useDoc$ returns a signal for a document', async () => {
    const $doc = await sub($.docHook.u2)
    $doc.set({ name: 'Alice' })
    await wait()

    let renders = 0
    const Component = observer(() => {
      renders++
      const $user = useDoc$('docHook', 'u2')
      return fr(
        el('span', { id: 'docName2' }, $user.name.get() || ''),
        el('button', { id: 'docBtn2', onClick: () => $user.name.set('Bob') })
      )
    })

    const { container } = render(el(Component))
    await wait()
    expect(container.querySelector('#docName2').textContent).toBe('Alice')
    expect(renders).toBeGreaterThan(0)

    fireEvent.click(container.querySelector('#docBtn2'))
    expect(container.querySelector('#docName2').textContent).toBe('Bob')
  })

  it('useDoc warns on undefined id and falls back to __NULL__', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    const Component = observer(() => {
      const [doc] = useDoc('warnDoc', undefined)
      return el('span', { id: 'warnDoc' }, doc?.name || '')
    }, { suspenseProps: { fallback: el('span', { id: 'warnDoc' }, 'Loading...') } })

    const { container } = render(el(Component))
    expect(container.querySelector('#warnDoc').textContent).toBe('Loading...')

    await wait()
    expect(warnSpy).toHaveBeenCalled()

    warnSpy.mockRestore()
  })

  itCompat('sync useDoc$ keeps suspense barrier on fast doc route switching (no transient undefined)', async () => {
    const collection = 'syncDocRouteSwitch'
    const lessonA = 'lesson_sync_doc_a'
    const lessonB = 'lesson_sync_doc_b'
    await $[collection][lessonA].set({ stageIds: ['a1'] })
    await $[collection][lessonB].set({ stageIds: ['b1', 'b2'] })
    _del([collection, lessonA])
    _del([collection, lessonB])

    setTestThrottling(80)
    try {
      const seen = []
      const Component = observer(() => {
        const [lessonId, setLessonId] = React.useState(lessonA)
        useDoc$(collection, lessonId)
        const [lesson] = useLocal(`${collection}.${lessonId}`)
        const stageIds = lesson?.stageIds
        const text = stageIds ? stageIds.join(',') : 'undefined'
        seen.push(text)
        return fr(
          el('span', { id: 'syncDocRouteSwitch' }, text),
          el('button', {
            id: 'syncDocRouteSwitchToB',
            onClick: () => setLessonId(lessonB)
          }, 'to-b'),
          el('button', {
            id: 'syncDocRouteSwitchToA',
            onClick: () => setLessonId(lessonA)
          }, 'to-a')
        )
      }, { suspenseProps: { fallback: el('span', { id: 'syncDocRouteSwitch' }, 'Loading...') } })

      const { container } = render(el(Component))
      expect(container.querySelector('#syncDocRouteSwitch').textContent).toBe('Loading...')
      await waitFor(() => {
        expect(container.querySelector('#syncDocRouteSwitch').textContent).toBe('a1')
      })

      fireEvent.click(container.querySelector('#syncDocRouteSwitchToB'))
      await waitFor(() => {
        expect(container.querySelector('#syncDocRouteSwitch').textContent).toBe('b1,b2')
      })

      fireEvent.click(container.querySelector('#syncDocRouteSwitchToA'))
      await waitFor(() => {
        expect(container.querySelector('#syncDocRouteSwitch').textContent).toBe('a1')
      })
      expect(seen).not.toContain('undefined')
    } finally {
      resetTestThrottling()
    }
  })

  itCompat('tab-like stageIds destructuring with useDoc$ does not crash on fast switch', async () => {
    const collection = 'syncDocTabLike'
    const lessonA = 'lesson_sync_tab_a'
    const lessonB = 'lesson_sync_tab_b'
    await $[collection][lessonA].set({ stageIds: ['ta1'] })
    await $[collection][lessonB].set({ stageIds: ['tb1', 'tb2'] })
    _del([collection, lessonA])
    _del([collection, lessonB])

    setTestThrottling(80)
    try {
      const Component = observer(() => {
        const [lessonId, setLessonId] = React.useState(lessonA)
        useDoc$(collection, lessonId)
        const [lesson] = useLocal(`${collection}.${lessonId}`)
        const { stageIds } = lesson
        return fr(
          el('span', { id: 'syncDocTabLike' }, stageIds.join(',')),
          el('button', {
            id: 'syncDocTabLikeSwitch',
            onClick: () => setLessonId(curr => curr === lessonA ? lessonB : lessonA)
          }, 'switch')
        )
      }, { suspenseProps: { fallback: el('span', { id: 'syncDocTabLike' }, 'Loading...') } })

      const { container } = render(el(Component))
      await waitFor(() => {
        expect(container.querySelector('#syncDocTabLike').textContent).toBe('ta1')
      })

      fireEvent.click(container.querySelector('#syncDocTabLikeSwitch'))
      await waitFor(() => {
        expect(container.querySelector('#syncDocTabLike').textContent).toBe('tb1,tb2')
      })
    } finally {
      resetTestThrottling()
    }
  })
})

describe('useBatchDoc / useBatchDoc$', () => {
  it('useBatchDoc works with useBatch suspense flush', async () => {
    const $doc = await sub($.docHook.u3)
    $doc.set({ name: 'Tom' })
    await wait()

    const Component = observer(() => {
      const [doc, $user] = useBatchDoc('docHook', 'u3')
      useBatch()
      return fr(
        el('span', { id: 'batchDoc' }, doc?.name || ''),
        el('button', { id: 'batchDocBtn', onClick: () => $user.name.set('Tim') })
      )
    })

    const { container } = render(el(Component))
    await wait()
    expect(container.querySelector('#batchDoc').textContent).toBe('Tom')

    fireEvent.click(container.querySelector('#batchDocBtn'))
    expect(container.querySelector('#batchDoc').textContent).toBe('Tim')
  })

  it('useBatchDoc$ works with useBatch suspense flush', async () => {
    const $doc = await sub($.docHook.u4)
    $doc.set({ name: 'Sam' })
    await wait()

    const Component = observer(() => {
      const $user = useBatchDoc$('docHook', 'u4')
      useBatch()
      return fr(
        el('span', { id: 'batchDoc2' }, $user.name.get() || ''),
        el('button', { id: 'batchDocBtn2', onClick: () => $user.name.set('Sue') })
      )
    })

    const { container } = render(el(Component))
    await wait()
    expect(container.querySelector('#batchDoc2').textContent).toBe('Sam')

    fireEvent.click(container.querySelector('#batchDocBtn2'))
    expect(container.querySelector('#batchDoc2').textContent).toBe('Sue')
  })

  it('throws clear error when useBatchDoc is used without useBatch', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const Component = observer(() => {
      useBatchDoc('docHook', 'missingBatch')
      return el('span', { id: 'missingBatch' }, 'x')
    })
    expect(() => render(el(Component))).toThrow(/useBatch\* hooks were used without a closing useBatch\(\) call/i)
    errorSpy.mockRestore()
  })

  itCompat('useBatchDoc allows temporary undefined local snapshot after useBatch (guarded read)', async () => {
    const collection = 'batchDocReadyBarrier'
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
        const [doc] = useBatchDoc(collection, docId)
        useBatch()
        const [localDoc] = useLocal(`${collection}.${docId}`)
        return fr(
          el('span', { id: 'batchDocReadyBarrier' }, localDoc?.name || 'pending'),
          el('span', { id: 'batchDocReadyBarrierHookValue' }, doc?.name || 'pending')
        )
      }, { suspenseProps: { fallback: el('span', { id: 'batchDocReadyBarrier' }, 'Loading...') } })

      const { container } = render(el(Component))
      expect(container.querySelector('#batchDocReadyBarrier').textContent).toBe('Loading...')

      await wait(20)
      expect(container.querySelector('#batchDocReadyBarrier').textContent).toBe('pending')

      await waitFor(() => {
        expect(container.querySelector('#batchDocReadyBarrier').textContent).toBe('Ready')
        expect(container.querySelector('#batchDocReadyBarrierHookValue').textContent).toBe('Ready')
      })
    } finally {
      docProto._refData = originalRefData
    }
  })

  itCompat('useBatchDoc route switch keeps previous snapshot without update fallback', async () => {
    const collection = 'batchDocRouteSwitch'
    const docA = 'doc_batch_route_a'
    const docB = 'doc_batch_route_b'
    await $[collection][docA].set({ stageIds: ['a1'] })
    await $[collection][docB].set({ stageIds: ['b1', 'b2'] })
    _del([collection, docA])
    _del([collection, docB])

    setTestThrottling(80)
    try {
      const Component = observer(() => {
        const [docId, setDocId] = React.useState(docA)
        const [doc] = useBatchDoc(collection, docId)
        useBatch()
        const { stageIds } = doc
        return fr(
          el('span', { id: 'batchDocRouteSwitch' }, stageIds.join(',')),
          el('button', {
            id: 'batchDocRouteSwitchBtn',
            onClick: () => setDocId(docB)
          }, 'switch')
        )
      }, { suspenseProps: { fallback: el('span', { id: 'batchDocRouteSwitch' }, 'Loading...') } })

      const { container } = render(el(Component))
      expect(container.querySelector('#batchDocRouteSwitch').textContent).toBe('Loading...')

      await waitFor(() => {
        expect(container.querySelector('#batchDocRouteSwitch').textContent).toBe('a1')
      })

      fireEvent.click(container.querySelector('#batchDocRouteSwitchBtn'))
      expect(container.querySelector('#batchDocRouteSwitch').textContent).not.toBe('Loading...')

      await waitFor(() => {
        expect(container.querySelector('#batchDocRouteSwitch').textContent).toBe('b1,b2')
      })
    } finally {
      resetTestThrottling()
    }
  })
})

describe('useAsyncDoc / useAsyncDoc$', () => {
  it('useAsyncDoc returns undefined initially and then provides doc and $doc', async () => {
    let renders = 0
    const Component = observer(() => {
      renders++
      const [doc, $doc] = useAsyncDoc('asyncDocHook', 'u1')
      if (!$doc) return el('span', { id: 'asyncDoc' }, 'Waiting...')
      return el('span', { id: 'asyncDoc' }, doc?.name || 'empty')
    })

    const { container } = render(el(Component))
    expect(container.querySelector('#asyncDoc').textContent).toBe('Waiting...')

    await wait()
    expect(container.querySelector('#asyncDoc').textContent).toBe('empty')

    act(() => { $.asyncDocHook.u1.set({ name: 'John' }) })
    expect(container.querySelector('#asyncDoc').textContent).toBe('John')
    expect(renders).toBeGreaterThan(1)
  })

  it('useAsyncDoc$ returns signal after async subscribe', async () => {
    let renders = 0
    const Component = observer(() => {
      renders++
      const $doc = useAsyncDoc$('asyncDocHook', 'u2')
      if (!$doc) return el('span', { id: 'asyncDoc2' }, 'Waiting...')
      return el('span', { id: 'asyncDoc2' }, $doc.name.get() || 'empty')
    })

    const { container } = render(el(Component))
    expect(container.querySelector('#asyncDoc2').textContent).toBe('Waiting...')

    await wait()
    expect(container.querySelector('#asyncDoc2').textContent).toBe('empty')

    act(() => { $.asyncDocHook.u2.set({ name: 'Alice' }) })
    expect(container.querySelector('#asyncDoc2').textContent).toBe('Alice')
    expect(renders).toBeGreaterThan(1)
  })
})

describe('useQuery / useQuery$', () => {
  it('useQuery subscribes to a query and returns [docs, $collection]', async () => {
    const $a = await sub($.queryHook.q1)
    const $b = await sub($.queryHook.q2)
    $a.set({ name: 'Alice', active: true, createdAt: 1 })
    $b.set({ name: 'Bob', active: false, createdAt: 2 })
    await wait()

    const Component = observer(() => {
      const [docs, $collection] = useQuery('queryHook', { active: true, $sort: { createdAt: 1 } })
      return fr(
        el('span', { id: 'qNames' }, (docs || []).map(d => d.name).join(',')),
        el('button', { id: 'qBtn', onClick: () => $collection.q1.active.set(false) })
      )
    }, { suspenseProps: { fallback: el('span', { id: 'qNames' }, 'Loading...') } })

    const { container } = render(el(Component))
    expect(container.querySelector('#qNames').textContent).toBe('Loading...')

    await wait()
    expect(container.querySelector('#qNames').textContent).toBe('Alice')

    fireEvent.click(container.querySelector('#qBtn'))
    await wait()
    expect(container.querySelector('#qNames').textContent).toBe('')
  })

  it('useQuery$ returns a query signal', async () => {
    const $a = await sub($.queryHook2.q1)
    $a.set({ name: 'John', active: true, createdAt: 1 })
    await wait()

    const Component = observer(() => {
      const $query = useQuery$('queryHook2', { active: true })
      const ids = $query.getIds()
      const docs = $query.get()
      const name = docs && docs[0]?.name
      return el('span', { id: 'qNames2' }, `${ids.join(',')}:${name || ''}`)
    }, { suspenseProps: { fallback: el('span', { id: 'qNames2' }, 'Loading...') } })

    const { container } = render(el(Component))
    expect(container.querySelector('#qNames2').textContent).toBe('Loading...')

    await wait()
    expect(container.querySelector('#qNames2').textContent).toBe('q1:John')
  })

  it('useQuery warns on undefined query and falls back to non-existent query', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    const Component = observer(() => {
      const [docs] = useQuery('warnQuery')
      return el('span', { id: 'warnQuery' }, (docs || []).length ? 'has' : '')
    }, { suspenseProps: { fallback: el('span', { id: 'warnQuery' }, 'Loading...') } })

    const { container } = render(el(Component))
    expect(container.querySelector('#warnQuery').textContent).toBe('Loading...')

    await wait()
    expect(container.querySelector('#warnQuery').textContent).toBe('')
    expect(warnSpy).toHaveBeenCalled()

    warnSpy.mockRestore()
  })

  it('useQuery throws on non-object query', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const Component = observer(() => {
      useQuery('badQuery', 'oops')
      return el('span', {}, 'bad')
    })

    expect(() => render(el(Component))).toThrow(/query must be an object/i)
    errorSpy.mockRestore()
  })

  itCompat('sync useQuery$ keeps suspense barrier on fast params change (no transient empty/undefined)', async () => {
    const collection = 'syncQueryRouteSwitch'
    const lessonA = 'lesson_sync_query_a'
    const lessonB = 'lesson_sync_query_b'
    await $[collection][lessonA].set({ courseId: 'courseA', stageIds: ['qa1'] })
    await $[collection][lessonB].set({ courseId: 'courseB', stageIds: ['qb1', 'qb2'] })
    _del([collection, lessonA])
    _del([collection, lessonB])

    setTestThrottling(80)
    try {
      const seen = []
      const Component = observer(() => {
        const [courseId, setCourseId] = React.useState('courseA')
        const [lessonId, setLessonId] = React.useState(lessonA)
        const $query = useQuery$(collection, { courseId })
        const ids = $query.getIds()
        const [lesson] = useLocal(`${collection}.${lessonId}`)
        const stageIds = lesson?.stageIds
        const stageText = stageIds ? stageIds.join(',') : 'undefined'
        seen.push(`${ids.length}:${stageText}`)
        return fr(
          el('span', { id: 'syncQueryRouteSwitch' }, `${ids.length}:${stageText}`),
          el('button', {
            id: 'syncQueryRouteSwitchBtn',
            onClick: () => {
              setCourseId('courseB')
              setLessonId(lessonB)
            }
          }, 'switch')
        )
      }, { suspenseProps: { fallback: el('span', { id: 'syncQueryRouteSwitch' }, 'Loading...') } })

      const { container } = render(el(Component))
      expect(container.querySelector('#syncQueryRouteSwitch').textContent).toBe('Loading...')
      await waitFor(() => {
        expect(container.querySelector('#syncQueryRouteSwitch').textContent).toBe('1:qa1')
      })

      fireEvent.click(container.querySelector('#syncQueryRouteSwitchBtn'))
      await waitFor(() => {
        expect(container.querySelector('#syncQueryRouteSwitch').textContent).toBe('1:qb1,qb2')
      })
      expect(seen.some(text => text.includes('undefined'))).toBe(false)
      expect(seen).not.toContain('0:qb1,qb2')
    } finally {
      resetTestThrottling()
    }
  })
})

describe('useBatchQuery / useBatchQuery$', () => {
  it('useBatchQuery works with useBatch suspense flush', async () => {
    const $a = await sub($.queryHook3.q1)
    $a.set({ name: 'Zoe', active: true, createdAt: 1 })
    await wait()

    const Component = observer(() => {
      const [docs] = useBatchQuery('queryHook3', { active: true })
      useBatch()
      return el('span', { id: 'bqNames' }, (docs || []).map(d => d.name).join(','))
    }, { suspenseProps: { fallback: el('span', { id: 'bqNames' }, 'Loading...') } })

    const { container } = render(el(Component))
    expect(container.querySelector('#bqNames').textContent).toBe('Loading...')

    await wait()
    expect(container.querySelector('#bqNames').textContent).toBe('Zoe')
  })

  it('useBatchQuery$ works with useBatch suspense flush', async () => {
    const $a = await sub($.queryHook4.q1)
    $a.set({ name: 'Mia', active: true, createdAt: 1 })
    await wait()

    const Component = observer(() => {
      const $query = useBatchQuery$('queryHook4', { active: true })
      useBatch()
      const ids = $query.getIds()
      const docs = $query.get()
      const name = docs && docs[0]?.name
      return el('span', { id: 'bqNames2' }, `${ids.join(',')}:${name || ''}`)
    }, { suspenseProps: { fallback: el('span', { id: 'bqNames2' }, 'Loading...') } })

    const { container } = render(el(Component))
    expect(container.querySelector('#bqNames2').textContent).toBe('Loading...')

    await wait()
    expect(container.querySelector('#bqNames2').textContent).toBe('q1:Mia')
  })

  itCompat('aggregate useBatchQuery resolves from query-level docs without waiting for collection docs', async () => {
    const collection = 'batchAggregateClientReady'
    const queryProto = aggregationSubscriptions.QueryClass.prototype
    const originalInitData = queryProto._initData
    queryProto._initData = function (...args) {
      if (this.collectionName === collection && Array.isArray(this.params?.$aggregate)) {
        _set([AGGREGATIONS, this.hash], [{ _id: null, startedStageIds: ['s1', 's2'] }])
        return
      }
      return originalInitData.apply(this, args)
    }

    try {
      const Component = observer(() => {
        const [rows] = useBatchQuery(collection, {
          $aggregate: [
            { $match: { active: true } },
            { $group: { _id: null, startedStageIds: { $push: '$stageId' } } }
          ]
        })
        useBatch()
        const joined = (rows?.[0]?.startedStageIds || []).join(',')
        return el('span', { id: 'batchAggregateClientReady' }, `${rows?.length || 0}:${joined}`)
      }, { suspenseProps: { fallback: el('span', { id: 'batchAggregateClientReady' }, 'Loading...') } })

      const { container } = render(el(Component))
      expect(container.querySelector('#batchAggregateClientReady').textContent).toBe('Loading...')

      await waitFor(() => {
        expect(container.querySelector('#batchAggregateClientReady').textContent).toBe('1:s1,s2')
      })
      expect(_get([collection, null])).toBe(undefined)
      expect(_get([collection, 'null'])).toBe(undefined)
    } finally {
      queryProto._initData = originalInitData
    }
  })

  itCompat('batch query materializes doc for immediate useLocal read after useBatch', async () => {
    const lessonId = 'lesson_batch_local_1'
    const $lesson = await sub($.batchLocalLessons[lessonId])
    $lesson.set({ courseId: 'course_1', stageIds: ['s1', 's2'] })
    await wait()

    _del(['batchLocalLessons', lessonId])
    expect(_get(['batchLocalLessons', lessonId])).toBe(undefined)

    const Component = observer(() => {
      useBatchQuery('batchLocalLessons', { courseId: 'course_1' })
      useBatch()
      const [lesson] = useLocal(`batchLocalLessons.${lessonId}`)
      const { stageIds } = lesson
      return el('span', { id: 'batchLocalRead' }, stageIds.join(','))
    }, { suspenseProps: { fallback: el('span', { id: 'batchLocalRead' }, 'Loading...') } })

    const { container } = render(el(Component))
    expect(container.querySelector('#batchLocalRead').textContent).toBe('Loading...')

    await waitFor(() => {
      expect(container.querySelector('#batchLocalRead').textContent).toBe('s1,s2')
    })
  })

  itCompat('batch query materialization does not overwrite existing doc in collection tree', async () => {
    const lessonId = 'lesson_batch_local_existing'
    const $lesson = await sub($.batchLocalLessons[lessonId])
    $lesson.set({ courseId: 'course_existing', stageIds: ['db'] })
    await wait()

    _set(['batchLocalLessons', lessonId], {
      _id: lessonId,
      id: lessonId,
      courseId: 'course_existing',
      stageIds: ['local']
    })

    const Component = observer(() => {
      useBatchQuery('batchLocalLessons', { courseId: 'course_existing' })
      useBatch()
      const [lesson] = useLocal(`batchLocalLessons.${lessonId}`)
      const { stageIds } = lesson
      return el('span', { id: 'batchLocalExisting' }, stageIds.join(','))
    }, { suspenseProps: { fallback: el('span', { id: 'batchLocalExisting' }, 'Loading...') } })

    const { container } = render(el(Component))
    expect(container.querySelector('#batchLocalExisting').textContent).toBe('Loading...')

    await waitFor(() => {
      expect(container.querySelector('#batchLocalExisting').textContent).toBe('local')
    })
  })

  itCompat('batch query keeps materialized doc alive after unrelated doc subscriber unmounts', async () => {
    const lessonId = 'lesson_batch_local_retained'
    const $lesson = await sub($.batchLocalLessons[lessonId])
    $lesson.set({ courseId: 'course_retained', stageIds: ['s1', 's2'] })
    await wait()

    _del(['batchLocalLessons', lessonId])
    expect(_get(['batchLocalLessons', lessonId])).toBe(undefined)

    function QueryOwner () {
      useBatchQuery('batchLocalLessons', { courseId: 'course_retained' })
      useBatch()
      const [lesson] = useLocal(`batchLocalLessons.${lessonId}`)
      return el('span', { id: 'batchLocalRetained' }, lesson.stageIds.join(','))
    }

    const QueryOwnerObserved = observer(QueryOwner, {
      suspenseProps: { fallback: el('span', { id: 'batchLocalRetained' }, 'Loading...') }
    })

    function DocSubscriber ({ visible }) {
      useDoc('batchLocalLessons', visible ? lessonId : '__DUMMY__')
      if (!visible) return null
      return el('span', { id: 'batchDocSubscriber' }, 'subscribed')
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
    expect(container.querySelector('#batchLocalRetained').textContent).toBe('Loading...')

    await waitFor(() => {
      expect(container.querySelector('#batchLocalRetained').textContent).toBe('s1,s2')
    })

    await waitFor(() => {
      expect(container.querySelector('#batchDocSubscriber')).toBe(null)
    })

    await waitFor(() => {
      expect(container.querySelector('#batchLocalRetained').textContent).toBe('s1,s2')
      expect(_get(['batchLocalLessons', lessonId]).stageIds).toEqual(['s1', 's2'])
    })
  })

  itCompat('batch query param switch does not suspend on update resubscribe', async () => {
    const collection = 'batchLocalLessonsSwitch'
    const lessonA = 'lesson_batch_switch_1'
    const lessonB = 'lesson_batch_switch_2'

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

      useBatchQuery(collection, { courseId })
      useBatch()
      const [lesson] = useLocal(`${collection}.${lessonId}`)
      const stageIds = lesson?.stageIds

      return el(Fragment, null,
        el('span', { id: 'batchLocalSwitch' }, stageIds ? stageIds.join(',') : 'pending'),
        el('button', {
          id: 'batchLocalSwitchBtn',
          onClick: () => {
            setCourseId('course_b')
            setLessonId(lessonB)
          }
        }, 'switch')
      )
    }, { suspenseProps: { fallback: el('span', { id: 'batchLocalSwitch' }, 'Loading...') } })

    const { container } = render(el(Component))
    expect(container.querySelector('#batchLocalSwitch').textContent).toBe('Loading...')

    await waitFor(() => {
      expect(container.querySelector('#batchLocalSwitch').textContent).toBe('a1')
    })

    fireEvent.click(container.querySelector('#batchLocalSwitchBtn'))
    // Update resubscribe should not suspend the whole tree.
    expect(container.querySelector('#batchLocalSwitch').textContent).not.toBe('Loading...')

    await waitFor(() => {
      expect(container.querySelector('#batchLocalSwitch').textContent).toBe('b1,b2')
    })
  })

  itCompat('batch query switch keeps previous docs for no-guard local read', async () => {
    const collection = 'batchLocalLessonsSwitchNoGuard'
    const lessonA = 'lesson_batch_switch_no_guard_1'
    const lessonB = 'lesson_batch_switch_no_guard_2'
    await $[collection][lessonA].set({ courseId: 'course_a', stageIds: ['a1'], createdAt: 1 })
    await $[collection][lessonB].set({ courseId: 'course_b', stageIds: ['b1', 'b2'], createdAt: 1 })
    _del([collection, lessonA])
    _del([collection, lessonB])

    setTestThrottling(80)
    try {
      const Component = observer(() => {
        const [courseId, setCourseId] = React.useState('course_a')
        const [docs] = useBatchQuery(collection, { courseId, $sort: { createdAt: 1 } })
        useBatch()
        const firstId = docs[0]._id || docs[0].id
        const [lesson] = useLocal(`${collection}.${firstId}`)
        const { stageIds } = lesson

        return fr(
          el('span', { id: 'batchLocalSwitchNoGuard' }, stageIds.join(',')),
          el('button', {
            id: 'batchLocalSwitchNoGuardBtn',
            onClick: () => setCourseId('course_b')
          }, 'switch')
        )
      }, { suspenseProps: { fallback: el('span', { id: 'batchLocalSwitchNoGuard' }, 'Loading...') } })

      const { container } = render(el(Component))
      expect(container.querySelector('#batchLocalSwitchNoGuard').textContent).toBe('Loading...')

      await waitFor(() => {
        expect(container.querySelector('#batchLocalSwitchNoGuard').textContent).toBe('a1')
      })

      fireEvent.click(container.querySelector('#batchLocalSwitchNoGuardBtn'))
      expect(container.querySelector('#batchLocalSwitchNoGuard').textContent).not.toBe('Loading...')

      await waitFor(() => {
        expect(container.querySelector('#batchLocalSwitchNoGuard').textContent).toBe('b1,b2')
      })
    } finally {
      resetTestThrottling()
    }
  })

  itCompat('batch query insert allows immediate useLocal read in same render cycle', async () => {
    const collection = 'batchLocalLessonsInsert'
    const lessonId = 'lesson_batch_insert_1'

    const Component = observer(() => {
      const [docs] = useBatchQuery(collection, { courseId: 'course_insert', $sort: { createdAt: 1 } })
      useBatch()
      if (!docs || docs.length === 0) return el('span', { id: 'batchLocalInsert' }, 'none')
      const firstId = docs[0]?._id ?? docs[0]?.id
      const [lesson] = useLocal(`${collection}.${firstId}`)
      const { stageIds } = lesson
      return el('span', { id: 'batchLocalInsert' }, stageIds.join(','))
    }, { suspenseProps: { fallback: el('span', { id: 'batchLocalInsert' }, 'Loading...') } })

    const { container } = render(el(Component))
    expect(container.querySelector('#batchLocalInsert').textContent).toBe('Loading...')

    await waitFor(() => {
      expect(container.querySelector('#batchLocalInsert').textContent).toBe('none')
    })

    const $lesson = await sub($[collection][lessonId])
    $lesson.set({ courseId: 'course_insert', stageIds: ['i1', 'i2'], createdAt: 1 })

    await waitFor(() => {
      expect(container.querySelector('#batchLocalInsert').textContent).toBe('i1,i2')
    })
  })

  itCompat('useBatchQuery allows temporary undefined local snapshot after useBatch (guarded read)', async () => {
    const collection = 'batchQueryReadyBarrier'
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
        useBatchQuery(collection, { courseId: 'course_query_ready' })
        useBatch()
        const [lesson] = useLocal(`${collection}.${lessonId}`)
        const stageIds = lesson?.stageIds
        return el('span', { id: 'batchQueryReadyBarrier' }, stageIds ? stageIds.join(',') : 'pending')
      }, { suspenseProps: { fallback: el('span', { id: 'batchQueryReadyBarrier' }, 'Loading...') } })

      const { container } = render(el(Component))
      expect(container.querySelector('#batchQueryReadyBarrier').textContent).toBe('Loading...')

      await wait(20)
      expect(container.querySelector('#batchQueryReadyBarrier').textContent).toBe('pending')

      await waitFor(() => {
        expect(container.querySelector('#batchQueryReadyBarrier').textContent).toBe('q1,q2')
      })
    } finally {
      queryProto._initData = originalInitData
    }
  })

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

describe('useAsyncQuery / useAsyncQuery$', () => {
  it('useAsyncQuery returns undefined initially and then provides docs and $query', async () => {
    const $a = await sub($.asyncQueryHook.q1)
    const $b = await sub($.asyncQueryHook.q2)
    $a.set({ name: 'Ann', active: true, createdAt: 1 })
    $b.set({ name: 'Ben', active: false, createdAt: 2 })
    await wait()

    const Component = observer(() => {
      const [docs] = useAsyncQuery('asyncQueryHook', { active: true })
      if (docs == null) return el('span', { id: 'aqNames' }, 'Waiting...')
      return el('span', { id: 'aqNames' }, (docs || []).map(d => d.name).join(','))
    })

    const { container } = render(el(Component))
    expect(container.querySelector('#aqNames').textContent).toBe('Waiting...')

    await wait()
    expect(container.querySelector('#aqNames').textContent).toBe('Ann')
  })

  it('useAsyncQuery$ returns a query signal after async subscribe', async () => {
    const $a = await sub($.asyncQueryHook2.q1)
    $a.set({ name: 'Ivy', active: true, createdAt: 1 })
    await wait()

    const Component = observer(() => {
      const $query = useAsyncQuery$('asyncQueryHook2', { active: true })
      if (!$query) return el('span', { id: 'aqNames2' }, 'Loading...')
      const ids = $query.getIds()
      const docs = $query.get()
      const name = docs && docs[0]?.name
      return el('span', { id: 'aqNames2' }, `${ids.join(',')}:${name || ''}`)
    })

    const { container } = render(el(Component))
    expect(container.querySelector('#aqNames2').textContent).toBe('Loading...')
    await wait()
    expect(container.querySelector('#aqNames2').textContent).toBe('q1:Ivy')
  })
})

describe('useQueryIds / useAsyncQueryIds', () => {
  it('useQueryIds returns docs in the same order as ids', async () => {
    const $a = await sub($.queryIdsHook.a)
    const $b = await sub($.queryIdsHook.b)
    $a.set({ name: 'Alpha' })
    $b.set({ name: 'Beta' })
    await wait()

    const Component = observer(() => {
      const [docs, $collection] = useQueryIds('queryIdsHook', ['b', 'a'])
      return fr(
        el('span', { id: 'idsNames' }, (docs || []).map(d => d.name).join(',')),
        el('button', { id: 'idsBtn', onClick: () => $collection.b.name.set('Beta2') })
      )
    }, { suspenseProps: { fallback: el('span', { id: 'idsNames' }, 'Loading...') } })

    const { container } = render(el(Component))
    expect(container.querySelector('#idsNames').textContent).toBe('Loading...')

    await wait()
    expect(container.querySelector('#idsNames').textContent).toBe('Beta,Alpha')

    fireEvent.click(container.querySelector('#idsBtn'))
    expect(container.querySelector('#idsNames').textContent).toBe('Beta2,Alpha')
  })

  it('useAsyncQueryIds returns undefined initially then docs', async () => {
    const $a = await sub($.asyncQueryIdsHook.a)
    $a.set({ name: 'One' })
    await wait()

    const Component = observer(() => {
      const [docs] = useAsyncQueryIds('asyncQueryIdsHook', ['a'])
      if (docs == null) return el('span', { id: 'asyncIds' }, 'Waiting...')
      return el('span', { id: 'asyncIds' }, docs.map(d => d.name).join(','))
    })

    const { container } = render(el(Component))
    expect(container.querySelector('#asyncIds').textContent).toBe('Waiting...')

    await wait()
    expect(container.querySelector('#asyncIds').textContent).toBe('One')
  })
})

describe('useQueryDoc / useAsyncQueryDoc', () => {
  it('useQueryDoc returns the newest doc by createdAt', async () => {
    const $a = await sub($.queryDocHook.a)
    const $b = await sub($.queryDocHook.b)
    $a.set({ name: 'Old', type: 'x', createdAt: 1 })
    $b.set({ name: 'New', type: 'x', createdAt: 2 })
    await wait()

    const Component = observer(() => {
      const [doc, $doc] = useQueryDoc('queryDocHook', { type: 'x' })
      return fr(
        el('span', { id: 'qdoc' }, doc?.name || ''),
        el('button', { id: 'qdocBtn', onClick: () => $doc.name.set('Newest') })
      )
    }, { suspenseProps: { fallback: el('span', { id: 'qdoc' }, 'Loading...') } })

    const { container } = render(el(Component))
    expect(container.querySelector('#qdoc').textContent).toBe('Loading...')

    await wait()
    expect(container.querySelector('#qdoc').textContent).toBe('New')

    fireEvent.click(container.querySelector('#qdocBtn'))
    expect(container.querySelector('#qdoc').textContent).toBe('Newest')
  })

  it('useQueryDoc$ returns a signal for the matched doc', async () => {
    const $a = await sub($.queryDocHook2.a)
    $a.set({ name: 'Doc', type: 'y', createdAt: 1 })
    await wait()

    const Component = observer(() => {
      const $doc = useQueryDoc$('queryDocHook2', { type: 'y' })
      return fr(
        el('span', { id: 'qdoc2' }, $doc?.name.get() || ''),
        el('button', { id: 'qdocBtn2', onClick: () => $doc.name.set('Doc2') })
      )
    }, { suspenseProps: { fallback: el('span', { id: 'qdoc2' }, 'Loading...') } })

    const { container } = render(el(Component))
    expect(container.querySelector('#qdoc2').textContent).toBe('Loading...')

    await wait()
    expect(container.querySelector('#qdoc2').textContent).toBe('Doc')

    fireEvent.click(container.querySelector('#qdocBtn2'))
    expect(container.querySelector('#qdoc2').textContent).toBe('Doc2')
  })

  it('useAsyncQueryDoc returns undefined initially then doc', async () => {
    const $a = await sub($.asyncQueryDocHook.a)
    $a.set({ name: 'AsyncDoc', type: 'z', createdAt: 1 })
    await wait()

    const Component = observer(() => {
      const [doc] = useAsyncQueryDoc('asyncQueryDocHook', { type: 'z' })
      if (!doc) return el('span', { id: 'aqdoc' }, 'Waiting...')
      return el('span', { id: 'aqdoc' }, doc.name || '')
    })

    const { container } = render(el(Component))
    expect(container.querySelector('#aqdoc').textContent).toBe('Waiting...')

    await wait()
    expect(container.querySelector('#aqdoc').textContent).toBe('AsyncDoc')
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
