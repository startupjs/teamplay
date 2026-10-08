import { createElement as el } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it } from 'mocha'
import { strict as assert } from 'node:assert'
import { SuspenseGroup, observer } from '../src/index.ts'

describe('SuspenseGroup server rendering', () => {
  it('renders revealed content without any warning', () => {
    const errors = []
    const originalConsoleError = console.error
    console.error = (...args) => errors.push(args.join(' '))

    try {
      const Child = observer(() => el(
        'div',
        { 'data-testid': 'ssr-content' },
        'Ready'
      ))

      const html = renderToStaticMarkup(
        el(SuspenseGroup, {
          fallback: el('div', {}, 'Loading')
        }, el(Child))
      )

      assert.equal(html, '<div data-testid="ssr-content">Ready</div>')
      // including React 18's 'useLayoutEffect does nothing on the server'
      assert.deepEqual(errors, [])
    } finally {
      console.error = originalConsoleError
    }
  })
})
