import { strict as assert } from 'node:assert'
import { describe, it } from 'mocha'
import {
  ensureArrayTargetSegments,
  ensureValueTargetSegments
} from '../orm/signalMutationGuards.ts'

describe('signal mutation guards', () => {
  it('allows nested value and array paths', () => {
    const segments = ['games', 'game-1', 'tags']

    assert.equal(ensureArrayTargetSegments(segments, false), segments)
    assert.equal(ensureValueTargetSegments(segments, false), segments)
  })

  it('rejects root and collection paths', () => {
    assert.throws(
      () => ensureArrayTargetSegments([], false),
      /Can't mutate array on a collection or root signal/
    )
    assert.throws(
      () => ensureArrayTargetSegments(['games'], false),
      /Can't mutate array on a collection or root signal/
    )
    assert.throws(
      () => ensureValueTargetSegments(['games'], false),
      /Can't mutate on a collection or root signal/
    )
  })

  it('rejects query signals before mutating', () => {
    assert.throws(
      () => ensureArrayTargetSegments(['games', 'game-1'], true),
      /Array mutators can't be used on a query signal/
    )
    assert.throws(
      () => ensureValueTargetSegments(['games', 'game-1'], true),
      /Mutators can't be used on a query signal/
    )
  })
})
