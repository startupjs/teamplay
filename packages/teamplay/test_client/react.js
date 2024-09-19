import { createElement as el, Fragment } from 'react'
import { describe, it, afterEach, beforeEach, expect, beforeAll as before } from '@jest/globals'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { $, useSub, useAsyncSub, observer, sub } from '../index.js'
import { setTestThrottling, resetTestThrottling } from '../react/useSub.js'
import { runGc, cache } from '../test/_helpers.js'
import connect from '../connect/test.js'

before(connect)
beforeEach(() => {
  expect(cache.size).toBe(1)
})
afterEach(cleanup)
afterEach(runGc)

describe('observer', () => {
  it('react to signal changes', async () => {
    const { $name } = $.session._1
    expect(cache.size).toBe(4)
    await runGc()
    expect(cache.size).toBe(2)
    let renders = 0
    const Component = observer(() => {
      renders++
      return el('span', {}, $name.get() || 'anonymous')
    })
    const { container } = render(el(Component))
    expect(container.textContent).toBe('anonymous')
    expect(renders).toBe(1)

    act(() => { $name.set('John') })
    expect(container.textContent).toBe('John')
    expect(renders).toBe(2)

    await wait()
    await runGc()
    expect(renders).toBe(2)
    expect(cache.size).toBe(2)
  })

  it('does not react to signal changes when not wrapped in observer', async () => {
    expect(cache.size).toBe(1)
    const { $name } = $.session._2
    let renders = 0
    const Component = () => {
      renders++
      return el('span', {}, $name.get() || 'anonymous')
    }
    const { container } = render(el(Component))
    expect(container.textContent).toBe('anonymous')
    expect(renders).toBe(1)

    act(() => { $name.set('John') })
    expect(container.textContent).toBe('anonymous')
    expect(renders).toBe(1)
    await runGc()
    expect(cache.size).toBe(2)
  })

  it('batches multiple updates into one render', async () => {
    const { $name, $surname } = $.session._3
    let renders = 0
    const Component = observer(() => {
      renders++
      return fr(
        el('span', {}, $name.get() || 'Anon'),
        ' ',
        el('span', {}, $surname.get() || 'Anonymous')
      )
    })
    const { container } = render(el(Component))
    expect(container.textContent).toBe('Anon Anonymous')
    expect(renders).toBe(1)

    act(() => {
      $name.set('John')
      $surname.set('Smith')
    })
    expect(container.textContent).toBe('John Smith')
    expect(renders).toBe(2)

    await wait()
    expect(renders).toBe(2)
  })
})

describe('$() function for creating values', () => {
  it('creates a value signal with a default value and reuses it on next render', async () => {
    let renders = 0
    const Component = observer(() => {
      renders++
      const $name = $('John')
      return fr(
        el('span', {}, $name.get()),
        el('button', { onClick: () => $name.set('Jane') })
      )
    })
    expect(cache.size).toBe(1)
    const { container } = render(el(Component))
    {
      expect(cache.size).toBe(3)
      const keys = cache._getKeys()
      expect(keys[0]).toMatch(/private.*\$local.*get/) // .get() method
      expect(keys[1]).toMatch(/private.*\$local/) // $name and $('John') are the same signal
      expect(keys[2]).toMatch(/root/) // $ root signal
    }
    await runGc()
    {
      expect(cache.size).toBe(2) // only root and $name are left
      const keys = cache._getKeys()
      expect(keys[0]).toMatch(/private.*\$local/) // $name
      expect(keys[1]).toMatch(/root/) // $ root signal
    }
    expect(container.textContent).toBe('John')
    expect(renders).toBe(1)

    fireEvent.click(container.querySelector('button'))
    expect(container.textContent).toBe('Jane')
    expect(renders).toBe(2)

    await wait()
    expect(renders).toBe(2)
  })

  it('handles undefined and null values correctly. Null is treated as undefined on .set()', () => {
    let $value
    const Component = observer(() => {
      $value = $(undefined)
      return el('span', {}, $value.get() === undefined ? 'undefined' : $value.get())
    })
    const { container, rerender } = render(el(Component))
    expect(container.textContent).toBe('undefined')

    act(() => { $value.set(null) })
    rerender(el(Component))
    expect(container.textContent).toBe('undefined')

    act(() => { $value.set('defined') })
    rerender(el(Component))
    expect(container.textContent).toBe('defined')
  })
})

describe('$() function for creating reactions', () => {
  it('create reaction from global signals and update dependent values', async () => {
    let renders = 0
    const { $name, $surname, $age, $hasAge } = $.session.reactionTest1
    const Component = observer(() => {
      renders++
      const $fullName = $(() => `${$name.get() || 'Anon'} ${$surname.get() || 'Anonymous'}${$hasAge.get() ? (' ' + $age.get()) : ''}`)
      return fr(
        el('span', {}, $fullName.get()),
        el('button', { id: 'fullName', onClick: () => { $name.set('John'); $surname.set('Smith') } }),
        el('button', { id: 'age', onClick: () => $age.set(($age.get() || 20) + 1) }),
        el('button', { id: 'hasAge', onClick: () => $hasAge.set(!$hasAge.get()) })
      )
    })
    const { container } = render(el(Component))
    expect(container.textContent).toBe('Anon Anonymous')
    expect(renders).toBe(1)

    fireEvent.click(container.querySelector('#fullName'))
    expect(container.textContent).toBe('John Smith')
    expect(renders).toBe(2)

    await wait()
    expect(renders).toBe(2)

    // check that .set() on its own doesn\'t trigger rerender
    // and that since $age.get() is not initially accessed in the reaction,
    // it doesn\'t trigger rerender either
    fireEvent.click(container.querySelector('#age'))
    expect(container.textContent).toBe('John Smith')
    expect(renders).toBe(2)

    await wait()
    expect(renders).toBe(2)

    // after $hasAge has change to true, the $age.get() is accessed in the reaction
    // and should be tracked afterwards
    fireEvent.click(container.querySelector('#hasAge'))
    expect(container.textContent).toBe('John Smith 21')
    expect(renders).toBe(3)

    // changing $age should trigger rerender now since it's accessed in the reaction
    fireEvent.click(container.querySelector('#age'))
    expect(container.textContent).toBe('John Smith 22')
    expect(renders).toBe(4)

    await wait()
    expect(renders).toBe(4)

    // changing $hasAge to false should stop tracking $age
    fireEvent.click(container.querySelector('#hasAge'))
    expect(container.textContent).toBe('John Smith')
    expect(renders).toBe(5)

    // changing $age should not trigger rerenders anymore
    fireEvent.click(container.querySelector('#age'))
    expect(container.textContent).toBe('John Smith')
    expect(renders).toBe(5)

    await wait()
    expect(renders).toBe(5)
  })

  it('create reaction from local use$() signals and update dependent values', async () => {
    // same as the previous test, but with local signals (created in the component itself)
    let renders = 0
    const Component = observer(() => {
      renders++
      const { $name, $surname, $age, $hasAge } = $()
      const $fullName = $(() => `${$name.get() || 'Anon'} ${$surname.get() || 'Anonymous'}${$hasAge.get() ? (' ' + $age.get()) : ''}`)
      return fr(
        el('span', {}, $fullName.get()),
        el('button', { id: 'fullName', onClick: () => { $name.set('John'); $surname.set('Smith') } }),
        el('button', { id: 'age', onClick: () => $age.set(($age.get() || 20) + 1) }),
        el('button', { id: 'hasAge', onClick: () => $hasAge.set(!$hasAge.get()) })
      )
    })
    const { container } = render(el(Component))
    expect(container.textContent).toBe('Anon Anonymous')
    expect(renders).toBe(1)

    fireEvent.click(container.querySelector('#fullName'))
    expect(container.textContent).toBe('John Smith')
    expect(renders).toBe(2)

    await wait()
    expect(renders).toBe(2)

    // check that .set() on its own doesn\'t trigger rerender
    // and that since $age.get() is not initially accessed in the reaction,
    // it doesn\'t trigger rerender either
    fireEvent.click(container.querySelector('#age'))
    expect(container.textContent).toBe('John Smith')
    expect(renders).toBe(2)

    await wait()
    expect(renders).toBe(2)

    // after $hasAge has change to true, the $age.get() is accessed in the reaction
    // and should be tracked afterwards
    fireEvent.click(container.querySelector('#hasAge'))
    expect(container.textContent).toBe('John Smith 21')
    expect(renders).toBe(3)

    // changing $age should trigger rerender now since it's accessed in the reaction
    fireEvent.click(container.querySelector('#age'))
    expect(container.textContent).toBe('John Smith 22')
    expect(renders).toBe(4)

    await wait()
    expect(renders).toBe(4)

    // changing $hasAge to false should stop tracking $age
    fireEvent.click(container.querySelector('#hasAge'))
    expect(container.textContent).toBe('John Smith')
    expect(renders).toBe(5)

    // changing $age should not trigger rerenders anymore
    fireEvent.click(container.querySelector('#age'))
    expect(container.textContent).toBe('John Smith')
    expect(renders).toBe(5)

    await wait()
    expect(renders).toBe(5)
  })
})

describe('useSub() for subscribing to documents', () => {
  it('subscribes to a document and rerenders on changes', async () => {
    let renders = 0
    const Component = observer(() => {
      renders++
      const $user = useSub($.users._1)
      return fr(
        el('span', {}, $user.name.get() || 'anonymous'),
        el('button', { id: 'doc', onClick: () => $user.set({ name: 'John' }) }),
        el('button', { id: 'name', onClick: () => $user.name.set('Jane') })
      )
    })
    const { container } = render(el(Component))
    expect(renders).toBe(1)
    expect(container.textContent).toBe('')

    await wait()
    expect(renders).toBe(2)
    expect(container.textContent).toBe('anonymous')

    fireEvent.click(container.querySelector('#doc'))
    expect(renders).toBe(3)
    expect(container.textContent).toBe('John')

    fireEvent.click(container.querySelector('#name'))
    expect(renders).toBe(4)
    expect(container.textContent).toBe('Jane')

    await wait()
    expect(renders).toBe(4)

    act(() => { $.users._1.name.set('Alice') })
    expect(renders).toBe(5)
    expect(container.textContent).toBe('Alice')

    await wait()
    expect(renders).toBe(5)
  })
})

describe('useSub() for subscribing to queries', () => {
  it('subscribe to query and rerender on query data changes', async () => {
    // TODO: without sub() doing $jane.set({}) and then again $jane.set({}) will not work and should throw an error
    //       (right now it tries to execute const newDoc = JSON.parse(JSON.stringify(oldDoc)) and fails)
    const $john = await sub($.users._1)
    const $jane = await sub($.users._2)
    $john.set({ name: 'John', status: 'active', createdAt: 1 })
    $jane.set({ name: 'Jane', status: 'inactive', createdAt: 2 })
    await wait()
    let renders = 0
    const Component = observer(() => {
      renders++
      const $activeUsers = useSub($.users, { status: 'active', $sort: { createdAt: 1 } })
      return el('span', {}, $activeUsers.map($user => $user.name.get()).join(','))
    }, { suspenseProps: { fallback: el('span', {}, 'Loading...') } })
    const { container } = render(el(Component))
    expect(renders).toBe(1)
    expect(container.textContent).toBe('Loading...')

    await wait()
    expect(renders).toBe(2)
    expect(container.textContent).toBe('John')
    expect($john.status.get()).toBe('active')
    expect($jane.status.get()).toBe('inactive')

    act(() => { $.users._2.status.set('active') })
    expect(container.textContent).toBe('John')
    await wait()
    expect(renders).toBe(3)
    expect(container.textContent).toBe('John,Jane')

    act(() => { $.users._1.status.set('inactive') })
    expect(container.textContent).toBe('John,Jane')
    await wait()
    expect(renders).toBe(4)
    expect(container.textContent).toBe('Jane')

    await wait()
    expect(renders).toBe(4)
  })

  it("handles query parameter changes. Should NOT show Suspense's 'Loading...' text on resubscribe", async () => {
    // TODO: without sub() doing $jane.set({}) and then again $jane.set({}) will not work and should throw an error
    //       (right now it tries to execute const newDoc = JSON.parse(JSON.stringify(oldDoc)) and fails)
    const $users = $.users2
    const $john = await sub($users._1)
    const $jane = await sub($users._2)
    $john.set({ name: 'John', status: 'active', createdAt: 1 })
    $jane.set({ name: 'Jane', status: 'inactive', createdAt: 2 })
    await wait()
    setTestThrottling(100)
    const throttledWait = () => wait(130)
    let renders = 0
    const Component = observer(() => {
      renders++
      const $status = $()
      const $activeUsers = useSub($users, { status: $status.get(), $sort: { createdAt: 1 } })
      return fr(
        el('span', {}, $activeUsers.map($user => $user.name.get()).join(',')),
        el('button', { id: 'active', onClick: () => $status.set('active') }),
        el('button', { id: 'inactive', onClick: () => $status.set('inactive') })
      )
    }, { suspenseProps: { fallback: el('span', {}, 'Loading...') } })
    const { container } = render(el(Component))
    expect(renders).toBe(1)
    expect(container.textContent).toBe('Loading...')

    await throttledWait()
    expect(renders).toBe(2)
    expect(container.textContent).toBe('John,Jane')

    fireEvent.click(container.querySelector('#active'))
    expect(renders).toBe(3)
    expect(container.textContent).toBe('John,Jane')
    await wait()
    expect(renders).toBe(3)
    expect(container.textContent).toBe('John,Jane')
    await throttledWait()
    expect(renders).toBe(4)
    expect(container.textContent).toBe('John')

    await wait()
    expect(renders).toBe(4)

    fireEvent.click(container.querySelector('#inactive'))
    expect(renders).toBe(5)
    expect(container.textContent).toBe('John')
    await throttledWait()
    expect(renders).toBe(6)
    expect(container.textContent).toBe('Jane')

    await throttledWait()
    expect(renders).toBe(6)
    resetTestThrottling()
  })
})

describe('useAsyncSub()', () => {
  it('initially returns undefined, handles query parameter changes, should NOT show Suspense', async () => {
    // TODO: without sub() doing $jane.set({}) and then again $jane.set({}) will not work and should throw an error
    //       (right now it tries to execute const newDoc = JSON.parse(JSON.stringify(oldDoc)) and fails)
    const $users = $.usersAsync
    const $john = await sub($users._1)
    const $jane = await sub($users._2)
    $john.set({ name: 'John', status: 'active', createdAt: 1 })
    $jane.set({ name: 'Jane', status: 'inactive', createdAt: 2 })
    await wait()
    setTestThrottling(100)
    const throttledWait = () => wait(130)
    let renders = 0
    const Component = observer(() => {
      renders++
      const $status = $()
      const $activeUsers = useAsyncSub($users, { status: $status.get(), $sort: { createdAt: 1 } })
      if (!$activeUsers) return el('span', {}, 'Waiting for users to load...')
      return fr(
        el('span', {}, $activeUsers.map($user => $user.name.get()).join(',')),
        el('button', { id: 'active', onClick: () => $status.set('active') }),
        el('button', { id: 'inactive', onClick: () => $status.set('inactive') })
      )
    }, { suspenseProps: { fallback: el('span', {}, 'Loading...') } })
    const { container } = render(el(Component))
    expect(renders).toBe(1)
    expect(container.textContent).toBe('Waiting for users to load...')

    await throttledWait()
    expect(renders).toBe(2)
    expect(container.textContent).toBe('John,Jane')

    fireEvent.click(container.querySelector('#active'))
    expect(renders).toBe(3)
    expect(container.textContent).toBe('John,Jane')
    await wait()
    expect(renders).toBe(3)
    expect(container.textContent).toBe('John,Jane')
    await throttledWait()
    expect(renders).toBe(4)
    expect(container.textContent).toBe('John')

    await wait()
    expect(renders).toBe(4)

    fireEvent.click(container.querySelector('#inactive'))
    expect(renders).toBe(5)
    expect(container.textContent).toBe('John')
    await throttledWait()
    expect(renders).toBe(6)
    expect(container.textContent).toBe('Jane')

    await throttledWait()
    expect(renders).toBe(6)
    resetTestThrottling()
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
