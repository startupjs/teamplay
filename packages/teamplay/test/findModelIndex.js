import assert from 'node:assert/strict'
import addModel, { MODELS, findModel } from '../src/orm/addModel.ts'

// findModel() runs on every signal lookup (getSignalClass, idFields). It used to
// split every registered pattern on each call: with an app's ~250 models that was
// most of the cost of creating a signal (a fifth of the LMS E2E server's JS time).
// The patterns are now split once and grouped by segment count. These tests pin
// the original matching rule (first registered match wins, `*` matches any
// segment, an empty path is the root pattern ''), that MODELS written or deleted
// directly is seen by the next lookup, and that lookups no longer split patterns.

function originalFindModel (segments) {
  if (segments.length === 0) segments = ['']
  for (const pattern in MODELS) {
    const patternSegments = pattern.split('.')
    if (segments.length !== patternSegments.length) continue
    let match = true
    for (let i = 0; i < segments.length; i++) {
      if (patternSegments[i] !== '*' && patternSegments[i] !== segments[i]) {
        match = false
        break
      }
    }
    if (match) return MODELS[pattern]
  }
}

const PREFIX = '__findModelIndex'

describe('findModel() pattern index', () => {
  const registered = []

  function modelClass (pattern) {
    const Model = class {}
    Object.defineProperty(Model, 'name', { value: `Model(${pattern})` })
    return Model
  }
  function register (pattern) {
    const Model = modelClass(pattern)
    addModel(pattern, Model)
    registered.push(pattern)
    return Model
  }
  function probes () {
    const result = [[], [`${PREFIX}Missing`]]
    for (let i = 0; i < 6; i++) {
      const collection = `${PREFIX}${i}`
      result.push([collection], [collection, 'doc1'], [collection, 'doc1', 'title'],
        [collection, 'doc1', 'tie'], ['other', 'doc1', 'tie'], [collection, 'doc1', 'a', 'b'])
    }
    return result
  }
  function assertSameAsOriginal () {
    for (const segments of probes()) {
      assert.equal(findModel(segments), originalFindModel(segments), `segments ${JSON.stringify(segments)}`)
    }
  }

  after(() => {
    for (const pattern of registered) delete MODELS[pattern]
  })

  it('keeps the matching rule: the first registered match wins', () => {
    const Collection = register(`${PREFIX}0`)
    const Doc = register(`${PREFIX}0.*`)
    const Title = register(`${PREFIX}0.*.title`)
    const AnyTie = register('*.*.tie')
    const LaterTie = register(`${PREFIX}1.*.tie`)

    assert.equal(findModel([`${PREFIX}0`]), Collection)
    assert.equal(findModel([`${PREFIX}0`, 'doc1']), Doc)
    assert.equal(findModel([`${PREFIX}0`, 'doc1', 'title']), Title)
    assert.equal(findModel([`${PREFIX}1`, 'doc1', 'tie']), AnyTie, 'a wildcard registered earlier wins over a later exact pattern')
    assert.notEqual(findModel([`${PREFIX}1`, 'doc1', 'tie']), LaterTie)
    assertSameAsOriginal()
  })

  it('finds a model registered after a lookup', () => {
    assert.equal(findModel([`${PREFIX}2`, 'doc1']), originalFindModel([`${PREFIX}2`, 'doc1']))
    const Late = register(`${PREFIX}2.*`)
    assert.equal(findModel([`${PREFIX}2`, 'doc1']), Late)
    assertSameAsOriginal()
  })

  it('sees MODELS written or deleted directly on the next lookup', () => {
    const pattern = `${PREFIX}3.*`
    assert.equal(findModel([`${PREFIX}3`, 'doc1']), originalFindModel([`${PREFIX}3`, 'doc1']))
    const Swapped = modelClass(pattern)
    MODELS[pattern] = Swapped
    registered.push(pattern)
    assert.equal(findModel([`${PREFIX}3`, 'doc1']), Swapped)
    const Replacement = modelClass(pattern)
    MODELS[pattern] = Replacement
    assert.equal(findModel([`${PREFIX}3`, 'doc1']), Replacement)
    delete MODELS[pattern]
    assert.notEqual(findModel([`${PREFIX}3`, 'doc1']), Replacement)
    assertSameAsOriginal()
  })

  it('does not split the registered patterns on every lookup', () => {
    for (let i = 4; i < 6; i++) register(`${PREFIX}${i}.*`)
    findModel([`${PREFIX}4`, 'doc1'])
    const split = String.prototype.split
    let splits = 0
    String.prototype.split = function (...args) { // eslint-disable-line no-extend-native
      splits++
      return split.apply(this, args)
    }
    try {
      for (let i = 0; i < 100; i++) {
        findModel([`${PREFIX}${i % 6}`, `doc${i}`])
        findModel([`${PREFIX}${i % 6}`, `doc${i}`, 'title'])
      }
    } finally {
      String.prototype.split = split // eslint-disable-line no-extend-native
    }
    assert.equal(splits, 0)
    assertSameAsOriginal()
  })
})
