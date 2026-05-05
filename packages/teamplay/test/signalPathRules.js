import { strict as assert } from 'node:assert'
import { describe, it } from 'mocha'
import {
  maybeTransformToArrayIndex,
  normalizeSignalPropertyKey,
  pathSegmentsToPattern,
  transformRootDollarAlias
} from '../src/orm/signalPathRules.ts'

describe('signal path rules', () => {
  it('maps root dollar aliases to private collection names', () => {
    assert.equal(transformRootDollarAlias([], '$session'), '_session')
    assert.equal(transformRootDollarAlias([], '$page'), '_page')
    assert.equal(transformRootDollarAlias([], '$render'), '$render')
    assert.equal(transformRootDollarAlias([], '$system'), '$system')
    assert.equal(transformRootDollarAlias([], 'toString'), 'toString')
  })

  it('only applies dollar aliases at the root', () => {
    assert.equal(transformRootDollarAlias(['games', 'game-1'], '$session'), 'session')
    assert.equal(normalizeSignalPropertyKey(['games', 'game-1'], '$page'), 'page')
  })

  it('normalizes positive integer property keys to array indexes', () => {
    assert.equal(maybeTransformToArrayIndex('0'), 0)
    assert.equal(maybeTransformToArrayIndex('12'), 12)
    assert.equal(maybeTransformToArrayIndex('01'), '01')
    assert.equal(maybeTransformToArrayIndex('-1'), '-1')
  })

  it('joins runtime path tuples into model pattern strings', () => {
    assert.equal(pathSegmentsToPattern([]), '')
    assert.equal(pathSegmentsToPattern(['games']), 'games')
    assert.equal(pathSegmentsToPattern(['games', '*', 'players', '*']), 'games.*.players.*')
    assert.equal(pathSegmentsToPattern(['games', 'game-1', 'players', 0]), 'games.game-1.players.*')
  })
})
