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

  it('reacts to changes inside array when iterator is used', () => {
    let $array
    let renders = 0
    const Component = observer(() => {
      renders++
      $array = $([1, 2, 3])
      return fr(
        el('span', {}, $array.map($item => $item.get()).join(',')),
        el('button', { onClick: () => $array.push(4) })
      )
    })
    const { container } = render(el(Component))
    expect(container.textContent).toBe('1,2,3')
    expect(renders).toBe(1)

    act(() => { $array[1].set(5) })
    expect(container.textContent).toBe('1,5,3')
    expect(renders).toBe(2)

    fireEvent.click(container.querySelector('button'))
    expect(container.textContent).toBe('1,5,3,4')
    expect(renders).toBe(3)
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
    expect(renders).toBe(4)
    expect(container.textContent).toBe('John,Jane')
    await wait()
    expect(renders).toBe(4)
    expect(container.textContent).toBe('John,Jane')
    await throttledWait()
    expect(renders).toBe(5)
    expect(container.textContent).toBe('John')

    await wait()
    expect(renders).toBe(5)

    fireEvent.click(container.querySelector('#inactive'))
    expect(renders).toBe(7)
    expect(container.textContent).toBe('John')
    await throttledWait()
    expect(renders).toBe(8)
    expect(container.textContent).toBe('Jane')

    await throttledWait()
    expect(renders).toBe(8)
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
    expect(renders).toBe(4)
    expect(container.textContent).toBe('Waiting for users to load...')
    await wait()
    expect(renders).toBe(4)
    expect(container.textContent).toBe('Waiting for users to load...')
    await throttledWait()
    expect(renders).toBe(5)
    expect(container.textContent).toBe('John')

    await wait()
    expect(renders).toBe(5)

    fireEvent.click(container.querySelector('#inactive'))
    expect(renders).toBe(7)
    expect(container.textContent).toBe('Waiting for users to load...')
    await throttledWait()
    expect(renders).toBe(8)
    expect(container.textContent).toBe('Jane')

    await throttledWait()
    expect(renders).toBe(8)
    resetTestThrottling()
  })
})

describe('nested components work with signals', () => {
  it('optimizes rerenders between parent and child components with local signals', () => {
    const $games = $([
      { title: 'Chess', players: 0 },
      { title: 'Poker', players: 0 }
    ])
    let gamesListRenders = 0
    const gameRenders = [0, 0]

    const Game = observer(({ $game, index }) => {
      gameRenders[index]++
      return el('div', { className: 'game' },
        el('span', {}, $game.title.get()),
        el('span', {}, ' - Players: ' + $game.players.get()),
        el('button', { onClick: () => $game.players.set($game.players.get() + 1) }, 'Join')
      )
    })

    const GamesList = observer(() => {
      gamesListRenders++
      return el('div', {},
        $games.map(($game, index) => el(Game, { key: index, $game, index }))
      )
    })

    const { container } = render(el(GamesList))
    expect(container.textContent).toBe('Chess - Players: 0JoinPoker - Players: 0Join')
    expect(gamesListRenders).toBe(1)
    expect(gameRenders[0]).toBe(1)
    expect(gameRenders[1]).toBe(1)

    // Update first game's players directly through signal
    act(() => { $games[0].players.set(1) })
    expect(container.textContent).toBe('Chess - Players: 1JoinPoker - Players: 0Join')
    expect(gamesListRenders).toBe(1, 'GamesList should not rerender')
    expect(gameRenders[0]).toBe(2, 'First game should rerender')
    expect(gameRenders[1]).toBe(1, 'Second game should not rerender')

    // Update second game's players through button click
    act(() => { fireEvent.click(container.querySelectorAll('button')[1]) })
    expect(container.textContent).toBe('Chess - Players: 1JoinPoker - Players: 1Join')
    expect(gamesListRenders).toBe(1, 'GamesList should still not rerender')
    expect(gameRenders[0]).toBe(2, 'First game should not rerender')
    expect(gameRenders[1]).toBe(2, 'Second game should rerender')

    expect(gamesListRenders).toBe(1)
    expect(gameRenders[0]).toBe(2)
    expect(gameRenders[1]).toBe(2)
  })

  it('optimizes rerenders between parent and child components with subscribed signals', async () => {
    // Setup initial games data
    const $game1 = await sub($.games._1)
    const $game2 = await sub($.games._2)
    $game1.set({ title: 'Chess', players: 0, active: true })
    $game2.set({ title: 'Poker', players: 0, active: true })
    await wait()

    let gamesListRenders = 0
    const gameRenders = [0, 0]

    const Game = observer(({ $game, index }) => {
      gameRenders[index]++
      return el('div', { className: 'game' },
        el('span', {}, $game.title.get()),
        el('span', {}, ' - Players: ' + $game.players.get()),
        el('button', { onClick: () => $game.players.set($game.players.get() + 1) }, 'Join')
      )
    })

    const GamesList = observer(() => {
      gamesListRenders++
      const $activeGames = useSub($.games, { active: true, $sort: { title: 1 } })
      return el('div', {},
        $activeGames.map(($game, index) => el(Game, { key: index, $game, index }))
      )
    }, { suspenseProps: { fallback: el('span', {}, 'Loading...') } })

    const { container } = render(el(GamesList))
    expect(container.textContent).toBe('Loading...')
    await wait()
    expect(container.textContent).toBe('Chess - Players: 0JoinPoker - Players: 0Join')
    expect(gamesListRenders).toBe(2) // Initial render + after subscription loaded
    expect(gameRenders[0]).toBe(1)
    expect(gameRenders[1]).toBe(1)

    // Update first game's players directly through signal
    act(() => { $.games._1.players.set(1) })
    expect(container.textContent).toBe('Chess - Players: 1JoinPoker - Players: 0Join')
    expect(gamesListRenders).toBe(2, 'GamesList should not rerender')
    expect(gameRenders[0]).toBe(2, 'First game should rerender')
    expect(gameRenders[1]).toBe(1, 'Second game should not rerender')

    // Update second game's players through button click
    act(() => { fireEvent.click(container.querySelectorAll('button')[1]) })
    expect(container.textContent).toBe('Chess - Players: 1JoinPoker - Players: 1Join')
    expect(gamesListRenders).toBe(2, 'GamesList should still not rerender')
    expect(gameRenders[0]).toBe(2, 'First game should not rerender')
    expect(gameRenders[1]).toBe(2, 'Second game should rerender')

    await wait()
    expect(gamesListRenders).toBe(2)
    expect(gameRenders[0]).toBe(2)
    expect(gameRenders[1]).toBe(2)
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
