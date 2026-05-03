import { describe, it } from 'mocha'
import { strict as assert } from 'node:assert'
import setDiffDeep from '../utils/setDiffDeep.js'

describe('setDiffDeep()', () => {
  it('updates plain nested objects in place when mutation is safe', () => {
    const existing = {
      item: {
        x: 1,
        y: 2
      },
      stale: true
    }
    const oldItemRef = existing.item

    const result = setDiffDeep(existing, {
      item: { x: 9 },
      fresh: true
    })

    assert.equal(result, existing)
    assert.equal(result.item, oldItemRef)
    assert.deepEqual(result, {
      item: { x: 9 },
      fresh: true
    })
  })

  it('treats react-like values as replace-only', () => {
    const reactLikeA = {
      $$typeof: Symbol.for('react.element'),
      type: 'div',
      props: { a: 1, b: 2 }
    }
    const reactLikeB = {
      $$typeof: Symbol.for('react.element'),
      type: 'span',
      props: { a: 9 }
    }

    const result = setDiffDeep(reactLikeA, reactLikeB)

    assert.equal(result, reactLikeB)
  })

  it('returns updated value when proxy rejects set trap', () => {
    const existing = new Proxy({ storeId: 'old' }, {
      set () {
        return false
      }
    })
    const updated = { storeId: 'new' }

    const result = setDiffDeep(existing, updated)

    assert.equal(result, updated)
  })

  it('returns updated value when proxy rejects delete trap', () => {
    const existing = new Proxy({ keep: 1, remove: 2 }, {
      deleteProperty () {
        return false
      }
    })
    const updated = { keep: 1 }

    const result = setDiffDeep(existing, updated)

    assert.equal(result, updated)
  })

  it('returns updated value when array proxy rejects writes', () => {
    const existing = new Proxy([1, 2], {
      set () {
        return false
      }
    })
    const updated = [3, 4]

    const result = setDiffDeep(existing, updated)

    assert.equal(result, updated)
  })
})
