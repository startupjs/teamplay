import { describe, it, beforeEach } from 'mocha'
import { strict as assert } from 'node:assert'
import {
  runInBatch,
  scheduleReaction,
  __resetBatchSchedulerForTests
} from '../src/orm/batchScheduler.js'

describe('batchScheduler', () => {
  beforeEach(() => {
    __resetBatchSchedulerForTests()
  })

  it('flushes only at outer batch boundary (nested batches)', () => {
    let runs = 0
    const reaction = () => { runs += 1 }

    runInBatch(() => {
      scheduleReaction(reaction)
      runInBatch(() => {
        scheduleReaction(reaction)
      })
      assert.equal(runs, 0)
    })

    assert.equal(runs, 1)
  })

  it('deduplicates the same reaction within one batch', () => {
    let runs = 0
    const reaction = () => { runs += 1 }

    runInBatch(() => {
      scheduleReaction(reaction)
      scheduleReaction(reaction)
      scheduleReaction(reaction)
      assert.equal(runs, 0)
    })

    assert.equal(runs, 1)
  })

  it('flush handles reentrancy and processes newly queued reactions', () => {
    const order = []
    const second = () => order.push('second')
    const first = () => {
      order.push('first')
      scheduleReaction(second)
    }

    runInBatch(() => {
      scheduleReaction(first)
    })

    assert.deepEqual(order, ['first', 'second'])
  })
})
