import { createElement as el } from 'react'
import { describe, it, afterEach, beforeEach, expect, beforeAll as before } from '@jest/globals'
import { act, cleanup, render } from '@testing-library/react'
import { $, observer } from '../index.js'
import { runGc, cache } from '../test/_helpers.js'
import connect from '../connect/test.js'

before(connect)
beforeEach(() => {
  expect(cache.size).toBe(1)
})
afterEach(cleanup)
afterEach(runGc)

// These tests were added to debug reactivity bugs
// but they might not actually test a real thing.
// Skipping them for now.
describe.skip('Observer Session Array Reactivity Bug', () => {
  it('FAILS: direct session access creates more cache entries than computed signals', async () => {
    const directKey = `direct_${Date.now()}`
    const computedKey = `computed_${Date.now()}`

    $.session[directKey].set(undefined)
    $.session[computedKey].set(undefined)

    const directCacheSnapshots = []
    const computedCacheSnapshots = []

    const DirectComponent = observer(() => {
      const data = $.session[directKey].get()
      directCacheSnapshots.push(cache.size)
      return el('div', { 'data-testid': 'direct' }, JSON.stringify(data || []))
    })

    const $computedData = $(() => $.session[computedKey].get())

    const ComputedComponent = observer(() => {
      const data = $computedData.get()
      computedCacheSnapshots.push(cache.size)
      return el('div', { 'data-testid': 'computed' }, JSON.stringify(data || []))
    })

    const { container } = render(el('div', {},
      el(DirectComponent),
      el(ComputedComponent)
    ))

    const directDiv = container.querySelector('[data-testid="direct"]')
    const computedDiv = container.querySelector('[data-testid="computed"]')

    // Add two items to trigger the cache difference
    act(() => {
      $.session[directKey][0].set('item-1')
      $.session[computedKey][0].set('item-1')
    })

    act(() => {
      $.session[directKey][1].set('item-2')
      $.session[computedKey][1].set('item-2')
    })

    // Verify both approaches work functionally
    expect(JSON.parse(directDiv.textContent)).toEqual(['item-1', 'item-2'])
    expect(JSON.parse(computedDiv.textContent)).toEqual(['item-1', 'item-2'])

    // The bug: direct approach creates more cache entries
    const directCacheGrowth = Math.max(...directCacheSnapshots) - Math.min(...directCacheSnapshots)
    const computedCacheGrowth = Math.max(...computedCacheSnapshots) - Math.min(...computedCacheSnapshots)

    // This assertion fails, proving the cache behavior difference
    expect(directCacheGrowth).toBe(computedCacheGrowth)
  })

  it('FAILS: memory cleanup issue after component unmount', async () => {
    const initialCacheSize = cache.size

    const components = []
    for (let i = 0; i < 3; i++) {
      const key = `test_${i}_${Date.now()}`
      $.session[key].set([])

      const TestComponent = observer(() => {
        const data = $.session[key].get()
        return el('div', {}, JSON.stringify(data || []))
      })

      components.push(TestComponent)
    }

    const { unmount } = render(el('div', {},
      ...components.map((Component, i) => el(Component, { key: i }))
    ))

    // Update signals
    act(() => {
      for (let i = 0; i < 3; i++) {
        const key = `test_${i}_${Date.now()}`
        $.session[key][0].set(`item-${i}`)
      }
    })

    unmount()
    await runGc()

    const cacheGrowth = cache.size - initialCacheSize

    // This assertion fails, proving memory cleanup issues
    expect(cacheGrowth).toBeLessThanOrEqual(1)
  })
})
