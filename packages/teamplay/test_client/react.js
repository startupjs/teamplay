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

function fr (...children) {
  return el(Fragment, {}, ...children)
}

async function wait (ms = 30) {
  return await act(async () => {
    await new Promise(resolve => setTimeout(resolve, ms))
  })
}

// New test suite starts here
import { useState, useEffect, Suspense } from 'react' // Added for new tests
import { waitFor } from '@testing-library/react' // Added for new tests
import { ROOT, setTestBackend, setSyncBackend, getConnection, init as ormInit } from '../orm/index.js' // Explicit imports from orm
import { SCHEMA_COLLECTION, SCHEMA_META_COLLECTION } from '../orm/constants.js'
// hashDoc is not exported, so we'll use a simple array stringify for keys if needed, or rely on path.
// For direct subCount access, we might need to inspect the keys used by docSubscriptions internally or add test helpers.
import { docSubscriptions } from '../orm/Doc.js'
import { querySubscriptions, hashQuery as testHashQuery, COLLECTION_NAME as QUERY_COLLECTION_NAME, PARAMS as QUERY_PARAMS, HASH as QUERY_HASH } from '../orm/Query.js'
import { setUseDeferredValue } from '../react/useSub.js'

// Helper to create a hash key for docs similar to internal hashDoc for testing purposes
const getTestDocHash = (segments) => JSON.stringify(segments)

describe('useSub() with Rapid Changes and Throttling', () => {
  let consoleErrorSpy

  beforeAll(async () => {
    // Initialize the ORM and backend if not already done by global setup,
    // or re-init with specific collections for these tests.
    // The global 'before(connect)' might handle basic connection.
    // We might need a separate ORM instance or ensure clean state.
    ormInit({
      collections: {
        testDocsRapid: {}, // Define schema if needed, though not strictly for these tests
        testItemsRapid: {}
      }
    })
    // setTestBackend() // Ensure a test backend is used if not set globally

    // Create initial documents for test case 1
    const $testDocsRapid = ROOT.get('testDocsRapid')
    await act(async () => {
      let doc1 = sub($testDocsRapid.get('_doc1'))
      await doc1.set({ name: 'Doc1' })
      let doc2 = sub($testDocsRapid.get('_doc2'))
      await doc2.set({ name: 'Doc2' })
      let doc3 = sub($testDocsRapid.get('_doc3'))
      await doc3.set({ name: 'Doc3' })
    })

    // Create initial items for test case 2
    const $testItemsRapid = ROOT.get('testItemsRapid')
    await act(async () => {
      let item1 = sub($testItemsRapid.get('_item1'))
      await item1.set({ name: 'Item1', status: 'active' })
      let item2 = sub($testItemsRapid.get('_item2'))
      await item2.set({ name: 'Item2', status: 'inactive' })
      let item3 = sub($testItemsRapid.get('_item3'))
      await item3.set({ name: 'Item3', status: 'active' })
      let item4 = sub($testItemsRapid.get('_item4'))
      await item4.set({ name: 'Item4', status: 'pending' })
    })

    // Create initial doc for test case 3
    // Re-use collection, ensure unique ID.
    await act(async () => {
      let doc = sub($testDocsRapid.get('_docMountUnmount'))
      await doc.set({ name: 'MountUnmountDoc' })
    })
  })

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error')
    // Reset cache to a known state if tests are sensitive to prior state.
    // The global beforeEach already checks cache.size === 1.
    // For these specific tests, we'll measure cache changes locally.
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
    resetTestThrottling() // Ensure throttling is reset after each test
    // Global afterEach already calls cleanup and runGc
  })

  test('rapidly changing document ID in useSub should resolve to the latest document', async () => {
    const $testDocsRapid = ROOT.get('testDocsRapid')

    const DocViewer = observer(({ docId }) => {
      // console.log('DocViewer rendering for', docId)
      const doc = useSub($testDocsRapid.get(docId))
      // console.log('useSub returned for', docId, doc ? doc.get('name') : 'loading')
      if (!doc || !doc.get('name')) return el('div', {}, 'Loading...')
      return el('div', {}, `Name: ${doc.get('name')}`)
    })

    let rerenderFn
    let getByTextFn
    let containerFn

    await act(async () => {
      const { rerender, getByText, container } = render(el(DocViewer, { docId: '_doc1' }))
      rerenderFn = rerender
      getByTextFn = getByText
      containerFn = container
    })
    
    // Initial render might be Loading... then Doc1
    await waitFor(() => expect(getByTextFn('Name: Doc1')).toBeDefined(), { timeout: 2000 })

    const initialCacheSize = cache.size

    setTestThrottling(50) // ms

    // Rapidly change props
    await act(async () => {
      rerenderFn(el(DocViewer, { docId: '_doc2' }))
      await new Promise(resolve => setTimeout(resolve, 10)) // Short pause, less than throttle
      rerenderFn(el(DocViewer, { docId: '_doc3' }))
      await new Promise(resolve => setTimeout(resolve, 10))
      rerenderFn(el(DocViewer, { docId: '_doc1' }))
      await new Promise(resolve => setTimeout(resolve, 10))
      rerenderFn(el(DocViewer, { docId: '_doc2' }))
    })
    
    // Wait for all operations to settle. Throttling means subscriptions might take time.
    // The last update is to _doc2. We need to wait long enough for its subscription to complete.
    await waitFor(() => expect(getByTextFn('Name: Doc2')).toBeDefined(), { timeout: 2000 })

    // Check subscription counts
    // Paths are used directly by docSubscriptions if segments are passed.
    // $signal[SEGMENTS] is used by docSubscriptions. For root signals, this is [collection, docId]
    const doc1Segments = ['testDocsRapid', '_doc1']
    const doc2Segments = ['testDocsRapid', '_doc2']
    const doc3Segments = ['testDocsRapid', '_doc3']
    const doc1Hash = getTestDocHash(doc1Segments)
    const doc2Hash = getTestDocHash(doc2Segments)
    const doc3Hash = getTestDocHash(doc3Segments)

    expect(docSubscriptions.subCount.get(doc1Hash) || 0).toBe(0)
    expect(docSubscriptions.subCount.get(doc3Hash) || 0).toBe(0)
    // The final doc should be subscribed. useSub adds 1 to subCount.
    expect(docSubscriptions.subCount.get(doc2Hash) || 0).toBe(1)


    await act(async () => {
      rerenderFn(el(Fragment)) // Unmount the component
    })
    
    // After unmount and GC, all related subscriptions should be gone.
    await runGc() // Make sure GC runs thoroughly
    await wait(50) // Give FR time

    expect(docSubscriptions.subCount.get(doc1Hash) || 0).toBe(0)
    expect(docSubscriptions.subCount.get(doc2Hash) || 0).toBe(0)
    expect(docSubscriptions.subCount.get(doc3Hash) || 0).toBe(0)
    
    expect(docSubscriptions.docs.has(doc1Hash)).toBe(false)
    expect(docSubscriptions.docs.has(doc2Hash)).toBe(false)
    expect(docSubscriptions.docs.has(doc3Hash)).toBe(false)

    // Cache size check relative to its state before this specific test's operations.
    // This can be tricky if other things are still in cache from global setup.
    // A more robust check is that it doesn't grow excessively.
    expect(cache.size).toBeLessThanOrEqual(initialCacheSize)


    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  // TODO: Implement other test cases
  // Test: "rapidly changing query parameters in useSub should resolve to the latest query"
  // Test: "rapid mount/unmount of useSub component should cleanup subscriptions"
  // Test: "useSub with useDeferredValue behavior under rapid changes (if applicable)"

  test('rapidly changing query parameters in useSub should resolve to the latest query', async () => {
    const $testItemsRapid = ROOT.get('testItemsRapid')

    const QueryViewer = observer(({ status }) => {
      const items = useSub($testItemsRapid, { status }) // Query based on status
      if (!items) return el('div', {}, 'Loading query...')
      const itemNames = items.map(item => item.name.get()).join(', ')
      return el('div', {}, `Items: ${itemNames || 'None'}`)
    })

    let rerenderFn, getByTextFn
    await act(async () => {
      const { rerender, getByText } = render(el(QueryViewer, { status: 'active' }))
      rerenderFn = rerender
      getByTextFn = getByText
    })

    await waitFor(() => expect(getByTextFn('Items: Item1, Item3')).toBeDefined(), { timeout: 2000 })
    const initialCacheSize = cache.size

    setTestThrottling(50) // ms

    await act(async () => {
      rerenderFn(el(QueryViewer, { status: 'inactive' }))
      await new Promise(resolve => setTimeout(resolve, 10))
      rerenderFn(el(QueryViewer, { status: 'active' }))
      await new Promise(resolve => setTimeout(resolve, 10))
      rerenderFn(el(QueryViewer, { status: 'inactive' })) // Final state
    })

    await waitFor(() => expect(getByTextFn('Items: Item2')).toBeDefined(), { timeout: 2000 })

    const activeQueryHash = testHashQuery('testItemsRapid', { status: 'active' })
    const inactiveQueryHash = testHashQuery('testItemsRapid', { status: 'inactive' })

    expect(querySubscriptions.subCount.get(activeQueryHash) || 0).toBe(0)
    expect(querySubscriptions.subCount.get(inactiveQueryHash) || 0).toBe(1) // Final query

    await act(async () => {
      rerenderFn(el(Fragment)) // Unmount
    })

    await runGc()
    await wait(50) // Give FR time

    expect(querySubscriptions.subCount.get(activeQueryHash) || 0).toBe(0)
    expect(querySubscriptions.subCount.get(inactiveQueryHash) || 0).toBe(0)
    expect(querySubscriptions.queries.has(activeQueryHash)).toBe(false)
    expect(querySubscriptions.queries.has(inactiveQueryHash)).toBe(false)
    expect(cache.size).toBeLessThanOrEqual(initialCacheSize)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  test('rapid mount/unmount of useSub component should cleanup subscriptions', async () => {
    const $docToWatch = ROOT.get('testDocsRapid').get('_docMountUnmount')
    const docSegments = ['testDocsRapid', '_docMountUnmount']
    const docHash = getTestDocHash(docSegments)

    const SimpleSubComponent = observer(() => {
      const doc = useSub($docToWatch)
      // Render something to ensure subscription is active
      return el('div', {}, doc ? doc.get('name') : 'Loading doc...')
    })

    setTestThrottling(50) // ms
    const initialCacheSize = cache.size
    const initialDocSubCount = docSubscriptions.subCount.get(docHash) || 0

    for (let i = 0; i < 5; i++) {
      let unmountComponent
      await act(async () => {
        const { unmount } = render(el(SimpleSubComponent))
        unmountComponent = unmount
      })
      // Ensure component renders and subscription potentially starts
      await wait(10) // Shorter than throttle to create rapid succession
      await act(async () => {
        unmountComponent()
      })
      await wait(10) // Shorter than throttle
    }

    // Wait for all potential async operations from mount/unmount to settle
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 200)) // Wait longer than throttling
    })
    await runGc()
    await wait(50) // Give FinalizationRegistry time

    expect(docSubscriptions.subCount.get(docHash) || 0).toBe(initialDocSubCount) // Should return to baseline
    expect(docSubscriptions.docs.has(docHash)).toBe(false) // Doc instance should be removed from cache

    // Cache size should ideally return to its state before this test or very close
    expect(cache.size).toBeLessThanOrEqual(initialCacheSize)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  test('useSub with useDeferredValue behavior under rapid changes', async () => {
    const $testDocsRapid = ROOT.get('testDocsRapid')
    // This test is similar to the first one, but ensures USE_DEFERRED_VALUE is active.
    // USE_DEFERRED_VALUE is true by default, this test confirms behavior.
    // If other tests were to set it to false, we might need to reset it here.
    setUseDeferredValue(true) // Explicitly set for clarity, though it's default

    const DocViewerDeferred = observer(({ docId }) => {
      const doc = useSub($testDocsRapid.get(docId))
      if (!doc || !doc.get('name')) return el('div', {}, 'Loading Deferred...')
      return el('div', {}, `Name Deferred: ${doc.get('name')}`)
    })

    let rerenderFn, getByTextFn
    await act(async () => {
      const { rerender, getByText } = render(el(DocViewerDeferred, { docId: '_doc1' }))
      rerenderFn = rerender
      getByTextFn = getByText
    })

    await waitFor(() => expect(getByTextFn('Name Deferred: Doc1')).toBeDefined(), { timeout: 2000 })
    const initialCacheSize = cache.size

    setTestThrottling(50) // ms

    await act(async () => {
      rerenderFn(el(DocViewerDeferred, { docId: '_doc3' }))
      await new Promise(resolve => setTimeout(resolve, 10))
      rerenderFn(el(DocViewerDeferred, { docId: '_doc1' }))
      await new Promise(resolve => setTimeout(resolve, 10))
      rerenderFn(el(DocViewerDeferred, { docId: '_doc3' })) // Final state
    })

    // With useDeferredValue, updates might be staggered. The key is eventual consistency.
    await waitFor(() => expect(getByTextFn('Name Deferred: Doc3')).toBeDefined(), { timeout: 2000 })

    const doc1Segments = ['testDocsRapid', '_doc1']
    const doc3Segments = ['testDocsRapid', '_doc3']
    const doc1Hash = getTestDocHash(doc1Segments)
    const doc3Hash = getTestDocHash(doc3Segments)

    // Check that only the final document is subscribed.
    // Due to the nature of useDeferredValue, intermediate states might have brief subscriptions,
    // but the robust cleanup (tested elsewhere) and final state are key.
    expect(docSubscriptions.subCount.get(doc1Hash) || 0).toBe(0)
    expect(docSubscriptions.subCount.get(doc3Hash) || 0).toBe(1)

    await act(async () => {
      rerenderFn(el(Fragment)) // Unmount
    })

    await runGc()
    await wait(50) // Give FR time

    expect(docSubscriptions.subCount.get(doc1Hash) || 0).toBe(0)
    expect(docSubscriptions.subCount.get(doc3Hash) || 0).toBe(0)
    expect(docSubscriptions.docs.has(doc1Hash)).toBe(false)
    expect(docSubscriptions.docs.has(doc3Hash)).toBe(false)
    expect(cache.size).toBeLessThanOrEqual(initialCacheSize)
    expect(consoleErrorSpy).not.toHaveBeenCalled()

    // Reset USE_DEFERRED_VALUE if it were changed from a non-default for this test
    // Since it defaults to true and we set it to true, no reset is strictly needed here
    // unless other tests in this file might set it to false.
    // For safety, if a global default is assumed, one might reset:
    // setUseDeferredValue(true); // back to default if it was changed
  })
})
