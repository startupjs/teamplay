import { createElement as el, useEffect } from 'react'
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

describe('useEffect Observer Reactivity Bug', () => {
  it('FAILS: useEffect initialization breaks subsequent observer updates', async () => {
    const sessionKey = `useeffect_${Date.now()}`

    const cacheSnapshots = []
    let renderCount = 0

    const ProblematicComponent = observer(() => {
      renderCount++
      const data = $.session[sessionKey].get()
      cacheSnapshots.push(cache.size)

      // This useEffect pattern breaks subsequent reactivity
      useEffect(() => {
        if (data === undefined) {
          $.session[sessionKey].set([])
        }
      }, [])

      return el('div', { 'data-testid': 'problematic' }, JSON.stringify(data || []))
    })

    const { container } = render(el(ProblematicComponent))
    const div = container.querySelector('[data-testid="problematic"]')

    // Initial render should show empty array after useEffect
    expect(div.textContent).toBe('[]')
    expect(renderCount).toBe(2) // Initial + useEffect trigger

    // Try to add items - this should trigger re-renders but might not
    act(() => {
      $.session[sessionKey][0].set('item-1')
    })

    const afterFirstUpdate = {
      content: div.textContent,
      renders: renderCount,
      signalData: $.session[sessionKey].get()
    }

    act(() => {
      $.session[sessionKey][1].set('item-2')
    })

    const afterSecondUpdate = {
      content: div.textContent,
      renders: renderCount,
      signalData: $.session[sessionKey].get()
    }

    // The bug: component might not re-render after useEffect initialization
    const expectedAfterFirst = ['item-1']
    const expectedAfterSecond = ['item-1', 'item-2']

    // These assertions will fail if useEffect breaks reactivity
    expect(JSON.parse(afterFirstUpdate.content)).toEqual(expectedAfterFirst)
    expect(JSON.parse(afterSecondUpdate.content)).toEqual(expectedAfterSecond)

    // Check if renders happened as expected
    expect(afterFirstUpdate.renders).toBeGreaterThan(2)
    expect(afterSecondUpdate.renders).toBeGreaterThan(afterFirstUpdate.renders)
  })

  it('FAILS: cache behavior difference with useEffect vs direct initialization', async () => {
    const useEffectKey = `useeffect_${Date.now()}`
    const directKey = `direct_${Date.now()}`

    const useEffectCacheSnapshots = []
    const directCacheSnapshots = []

    // Component using useEffect initialization
    const UseEffectComponent = observer(() => {
      const data = $.session[useEffectKey].get()
      useEffectCacheSnapshots.push(cache.size)

      useEffect(() => {
        if (data === undefined) {
          $.session[useEffectKey].set([])
        }
      }, [])

      return el('div', { 'data-testid': 'useeffect' }, JSON.stringify(data || []))
    })

    // Component using direct initialization
    const DirectComponent = observer(() => {
      const data = $.session[directKey].get() || []
      directCacheSnapshots.push(cache.size)

      // Initialize directly if needed
      if ($.session[directKey].get() === undefined) {
        $.session[directKey].set([])
      }

      return el('div', { 'data-testid': 'direct' }, JSON.stringify(data))
    })

    const { container } = render(el('div', {},
      el(UseEffectComponent),
      el(DirectComponent)
    ))

    const useEffectDiv = container.querySelector('[data-testid="useeffect"]')
    const directDiv = container.querySelector('[data-testid="direct"]')

    // Add items to both
    act(() => {
      $.session[useEffectKey][0].set('useeffect-1')
      $.session[directKey][0].set('direct-1')
    })

    act(() => {
      $.session[useEffectKey][1].set('useeffect-2')
      $.session[directKey][1].set('direct-2')
    })

    // Check final states
    const useEffectData = JSON.parse(useEffectDiv.textContent)
    const directData = JSON.parse(directDiv.textContent)

    // Both should work functionally
    expect(useEffectData).toEqual(['useeffect-1', 'useeffect-2'])
    expect(directData).toEqual(['direct-1', 'direct-2'])

    // Check cache behavior differences
    const useEffectCacheGrowth = Math.max(...useEffectCacheSnapshots) - Math.min(...useEffectCacheSnapshots)
    const directCacheGrowth = Math.max(...directCacheSnapshots) - Math.min(...directCacheSnapshots)

    // This might fail if useEffect causes different cache behavior
    expect(useEffectCacheGrowth).toBe(directCacheGrowth)
  })

  it('FAILS: useEffect timing issue with observer dependency tracking', async () => {
    const sessionKey = `timing_${Date.now()}`

    let effectRuns = 0
    let renderRuns = 0
    const cacheAtEffect = []
    const cacheAtRender = []

    const TimingComponent = observer(() => {
      renderRuns++
      const data = $.session[sessionKey].get()
      cacheAtRender.push(cache.size)

      useEffect(() => {
        effectRuns++
        cacheAtEffect.push(cache.size)

        // This pattern might break dependency tracking
        if (data === undefined) {
          $.session[sessionKey].set([])
        }
      }, [data]) // Note: depending on data in useEffect

      return el('div', { 'data-testid': 'timing' }, JSON.stringify(data || []))
    })

    const { container } = render(el(TimingComponent))
    const div = container.querySelector('[data-testid="timing"]')

    // Wait for initial useEffect
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    const initialState = {
      renders: renderRuns,
      effects: effectRuns,
      content: div.textContent,
      signal: $.session[sessionKey].get()
    }

    // Try updates
    act(() => {
      $.session[sessionKey][0].set('timing-1')
    })

    const afterFirstUpdate = {
      renders: renderRuns,
      effects: effectRuns,
      content: div.textContent,
      signal: $.session[sessionKey].get()
    }

    // The timing issue: useEffect might interfere with observer tracking
    expect(JSON.parse(afterFirstUpdate.content)).toEqual(['timing-1'])
    expect(afterFirstUpdate.renders).toBeGreaterThan(initialState.renders)

    // Check cache behavior during effect vs render
    const effectCacheGrowth = Math.max(...cacheAtEffect) - Math.min(...cacheAtEffect)
    const renderCacheGrowth = Math.max(...cacheAtRender) - Math.min(...cacheAtRender)

    // This might reveal timing-related cache issues
    expect(effectCacheGrowth).toBeLessThanOrEqual(renderCacheGrowth + 2)
  })
})
