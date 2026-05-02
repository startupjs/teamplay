import { describe, it, beforeEach } from 'mocha'
import { strict as assert } from 'node:assert'
import * as promiseBatcher from '../react/promiseBatcher.ts'

describe('promiseBatcher', () => {
  beforeEach(() => {
    promiseBatcher.reset()
  })

  it('does not suspend when only readiness checks are registered', () => {
    promiseBatcher.addCheck({
      key: 'check-only',
      isReady: () => false
    })

    const pending = promiseBatcher.getPromiseAll()
    assert.equal(pending, null)
  })

  it('waits for readiness checks when initial batch promises exist', async () => {
    let ready = false

    promiseBatcher.add(Promise.resolve())
    promiseBatcher.addCheck({
      key: 'check-with-promise',
      isReady: () => ready
    })

    const pending = promiseBatcher.getPromiseAll()
    assert.ok(pending && typeof pending.then === 'function')

    setTimeout(() => {
      ready = true
    }, 20)

    await pending
  })
})
