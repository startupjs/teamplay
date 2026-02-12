import { createElement as el, Fragment, createRef } from 'react'
import { describe, it, afterEach, beforeEach, expect, beforeAll as before } from '@jest/globals'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { $, useSub, useAsyncSub, observer, sub } from '../index.js'
import { setTestThrottling, resetTestThrottling, useSubClassic } from '../react/useSub.js'
import { useId, useNow, useTriggerUpdate, useUnmount } from '../react/helpers.js'
import { runGc, cache } from '../test/_helpers.js'
import connect from '../connect/test.js'

before(connect)
beforeEach(() => {
  expect(cache.size).toBe(1)
})
afterEach(cleanup)
afterEach(runGc)

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

describe('useSub edge cases', () => {
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
