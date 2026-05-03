import { it, describe } from 'mocha'
import { strict as assert } from 'node:assert'
import SubscriptionState, { STATE } from '../orm/SubscriptionState.js'

function createControllablePromise () {
  let resolve, reject
  const promise = new Promise((_resolve, _reject) => { resolve = _resolve; reject = _reject })
  return { promise, resolve, reject }
}

describe('SubscriptionState', () => {
  describe('Basic lifecycle', () => {
    it('starts in IDLE state', () => {
      const state = new SubscriptionState({
        onSubscribe: async () => {},
        onUnsubscribe: async () => {}
      })
      assert.equal(state.state, STATE.IDLE)
      assert.equal(state.subscribed, false)
    })

    it('subscribe -> SUBSCRIBED -> unsubscribe -> IDLE', async () => {
      const state = new SubscriptionState({
        onSubscribe: async () => {},
        onUnsubscribe: async () => {}
      })

      assert.equal(state.state, STATE.IDLE)
      assert.equal(state.subscribed, false)

      await state.subscribe()
      assert.equal(state.state, STATE.SUBSCRIBED)
      assert.equal(state.subscribed, true)

      await state.unsubscribe()
      assert.equal(state.state, STATE.IDLE)
      assert.equal(state.subscribed, false)
    })
  })

  describe('No-op cases', () => {
    it('subscribe() when already SUBSCRIBED is a no-op', async () => {
      let subscribeCount = 0
      const state = new SubscriptionState({
        onSubscribe: async () => { subscribeCount++ },
        onUnsubscribe: async () => {}
      })

      await state.subscribe()
      assert.equal(state.state, STATE.SUBSCRIBED)
      assert.equal(subscribeCount, 1)

      await state.subscribe()
      assert.equal(state.state, STATE.SUBSCRIBED)
      assert.equal(subscribeCount, 1, 'onSubscribe should not be called again')
    })

    it('unsubscribe() when already IDLE is a no-op', async () => {
      let unsubscribeCount = 0
      const state = new SubscriptionState({
        onSubscribe: async () => {},
        onUnsubscribe: async () => { unsubscribeCount++ }
      })

      assert.equal(state.state, STATE.IDLE)

      await state.unsubscribe()
      assert.equal(state.state, STATE.IDLE)
      assert.equal(unsubscribeCount, 0, 'onUnsubscribe should not be called')
    })
  })

  describe('During transition cases', () => {
    it('subscribe() during SUBSCRIBING returns same promise', async () => {
      const { promise, resolve } = createControllablePromise()
      let subscribeCount = 0
      const state = new SubscriptionState({
        onSubscribe: async () => { subscribeCount++; await promise },
        onUnsubscribe: async () => {}
      })

      const promise1 = state.subscribe()
      assert.equal(state.state, STATE.SUBSCRIBING)

      const promise2 = state.subscribe()
      assert.equal(state.state, STATE.SUBSCRIBING)

      resolve()
      await promise1
      await promise2

      assert.equal(state.state, STATE.SUBSCRIBED)
      assert.equal(subscribeCount, 1, 'onSubscribe should only be called once')
    })

    it('unsubscribe() during UNSUBSCRIBING returns same promise', async () => {
      const { promise, resolve } = createControllablePromise()
      let unsubscribeCount = 0
      const state = new SubscriptionState({
        onSubscribe: async () => {},
        onUnsubscribe: async () => { unsubscribeCount++; await promise }
      })

      await state.subscribe()
      assert.equal(state.state, STATE.SUBSCRIBED)

      const promise1 = state.unsubscribe()
      assert.equal(state.state, STATE.UNSUBSCRIBING)

      const promise2 = state.unsubscribe()
      assert.equal(state.state, STATE.UNSUBSCRIBING)

      resolve()
      await promise1
      await promise2

      assert.equal(state.state, STATE.IDLE)
      assert.equal(unsubscribeCount, 1, 'onUnsubscribe should only be called once')
    })
  })

  describe('Rapid action sequences', () => {
    it('subscribe() then immediately unsubscribe() before subscribe completes -> ends IDLE', async () => {
      const { promise: subPromise, resolve: subResolve } = createControllablePromise()
      let subscribeCount = 0
      let unsubscribeCount = 0

      const state = new SubscriptionState({
        onSubscribe: async () => { subscribeCount++; await subPromise },
        onUnsubscribe: async () => { unsubscribeCount++ }
      })

      const subResult = state.subscribe()
      assert.equal(state.state, STATE.SUBSCRIBING)

      const unsubResult = state.unsubscribe()
      assert.equal(state.state, STATE.SUBSCRIBING, 'should still be subscribing')

      subResolve()
      await subResult
      await unsubResult

      assert.equal(state.state, STATE.IDLE, 'should end in IDLE')
      assert.equal(subscribeCount, 1)
      assert.equal(unsubscribeCount, 1)
    })

    it('from SUBSCRIBED, unsubscribe() then immediately subscribe() -> ends SUBSCRIBED', async () => {
      const { promise: unsubPromise, resolve: unsubResolve } = createControllablePromise()
      let subscribeCount = 0
      let unsubscribeCount = 0

      const state = new SubscriptionState({
        onSubscribe: async () => { subscribeCount++ },
        onUnsubscribe: async () => { unsubscribeCount++; await unsubPromise }
      })

      await state.subscribe()
      assert.equal(state.state, STATE.SUBSCRIBED)
      assert.equal(subscribeCount, 1)

      const unsubResult = state.unsubscribe()
      assert.equal(state.state, STATE.UNSUBSCRIBING)

      const subResult = state.subscribe()
      assert.equal(state.state, STATE.UNSUBSCRIBING, 'should still be unsubscribing')

      unsubResolve()
      await unsubResult
      await subResult

      assert.equal(state.state, STATE.SUBSCRIBED, 'should end in SUBSCRIBED')
      assert.equal(subscribeCount, 2)
      assert.equal(unsubscribeCount, 1)
    })

    it('triple rapid: subscribe, unsubscribe, subscribe -> ends SUBSCRIBED (latest intent wins)', async () => {
      const { promise: subPromise, resolve: subResolve } = createControllablePromise()
      let subscribeCount = 0
      let unsubscribeCount = 0

      const state = new SubscriptionState({
        onSubscribe: async () => { subscribeCount++; await subPromise },
        onUnsubscribe: async () => { unsubscribeCount++ }
      })

      const sub1 = state.subscribe()
      assert.equal(state.state, STATE.SUBSCRIBING)

      state.unsubscribe() // Sets pending to 'unsubscribe'
      state.subscribe() // Clears pending (sets to undefined)

      subResolve()
      await sub1

      assert.equal(state.state, STATE.SUBSCRIBED, 'should end in SUBSCRIBED (latest intent)')
      assert.equal(subscribeCount, 1, 'should have called onSubscribe once (pending was cleared)')
      assert.equal(unsubscribeCount, 0, 'should not have called onUnsubscribe (pending cleared)')
    })

    it('triple rapid: unsubscribe, subscribe, unsubscribe -> ends IDLE (latest intent wins)', async () => {
      const { promise: unsubPromise, resolve: unsubResolve } = createControllablePromise()
      let subscribeCount = 0
      let unsubscribeCount = 0

      const state = new SubscriptionState({
        onSubscribe: async () => { subscribeCount++ },
        onUnsubscribe: async () => { unsubscribeCount++; await unsubPromise }
      })

      await state.subscribe()
      assert.equal(state.state, STATE.SUBSCRIBED)
      subscribeCount = 0 // Reset

      const p1 = state.unsubscribe()
      assert.equal(state.state, STATE.UNSUBSCRIBING)

      state.subscribe() // Sets pending to 'subscribe'
      state.unsubscribe() // Clears pending (sets to undefined)

      unsubResolve()
      await p1

      assert.equal(state.state, STATE.IDLE, 'should end in IDLE (latest intent)')
      assert.equal(subscribeCount, 0, 'should not have called onSubscribe (pending cleared)')
      assert.equal(unsubscribeCount, 1, 'should have called onUnsubscribe once')
    })
  })

  describe('Error handling', () => {
    it('subscribe error returns to IDLE and throws', async () => {
      const error = new Error('Subscribe failed')
      const state = new SubscriptionState({
        onSubscribe: async () => { throw error },
        onUnsubscribe: async () => {}
      })

      assert.equal(state.state, STATE.IDLE)

      await assert.rejects(
        async () => await state.subscribe(),
        error
      )

      assert.equal(state.state, STATE.IDLE, 'should return to IDLE on error')
      assert.equal(state.subscribed, false)
    })

    it('unsubscribe error returns to SUBSCRIBED and throws', async () => {
      const error = new Error('Unsubscribe failed')
      const state = new SubscriptionState({
        onSubscribe: async () => {},
        onUnsubscribe: async () => { throw error }
      })

      await state.subscribe()
      assert.equal(state.state, STATE.SUBSCRIBED)

      await assert.rejects(
        async () => await state.unsubscribe(),
        error
      )

      assert.equal(state.state, STATE.SUBSCRIBED, 'should return to SUBSCRIBED on error')
      assert.equal(state.subscribed, true)
    })

    it('subscribe error clears pending unsubscribe', async () => {
      const { promise: subPromise, reject: subReject } = createControllablePromise()
      const error = new Error('Subscribe failed')
      let unsubscribeCount = 0

      const state = new SubscriptionState({
        onSubscribe: async () => { await subPromise },
        onUnsubscribe: async () => { unsubscribeCount++ }
      })

      const sub1 = state.subscribe()
      assert.equal(state.state, STATE.SUBSCRIBING)

      state.unsubscribe() // Sets pending to 'unsubscribe'

      subReject(error)

      try {
        await sub1
        assert.fail('Should have thrown error')
      } catch (err) {
        assert.equal(err, error)
      }

      assert.equal(state.state, STATE.IDLE, 'should be IDLE after error')
      assert.equal(unsubscribeCount, 0, 'pending unsubscribe should be cleared, not executed')
    })

    it('unsubscribe error clears pending subscribe', async () => {
      const { promise: unsubPromise, reject: unsubReject } = createControllablePromise()
      const error = new Error('Unsubscribe failed')
      let subscribeCount = 0

      const state = new SubscriptionState({
        onSubscribe: async () => { subscribeCount++ },
        onUnsubscribe: async () => { await unsubPromise }
      })

      await state.subscribe()
      subscribeCount = 0 // Reset counter

      state.unsubscribe()
      assert.equal(state.state, STATE.UNSUBSCRIBING)

      state.subscribe() // Sets pending to 'subscribe'

      unsubReject(error)

      try {
        await state.unsubscribe() // Wait for the active promise
        assert.fail('Should have thrown error')
      } catch (err) {
        assert.equal(err, error)
      }

      assert.equal(state.state, STATE.SUBSCRIBED, 'should be SUBSCRIBED after error')
      assert.equal(subscribeCount, 0, 'pending subscribe should be cleared, not executed')
    })
  })

  describe('Multiple cycles', () => {
    it('multiple subscribe/unsubscribe cycles work correctly', async () => {
      let subscribeCount = 0
      let unsubscribeCount = 0

      const state = new SubscriptionState({
        onSubscribe: async () => { subscribeCount++ },
        onUnsubscribe: async () => { unsubscribeCount++ }
      })

      // Cycle 1
      await state.subscribe()
      assert.equal(state.state, STATE.SUBSCRIBED)
      assert.equal(subscribeCount, 1)

      await state.unsubscribe()
      assert.equal(state.state, STATE.IDLE)
      assert.equal(unsubscribeCount, 1)

      // Cycle 2
      await state.subscribe()
      assert.equal(state.state, STATE.SUBSCRIBED)
      assert.equal(subscribeCount, 2)

      await state.unsubscribe()
      assert.equal(state.state, STATE.IDLE)
      assert.equal(unsubscribeCount, 2)

      // Cycle 3
      await state.subscribe()
      assert.equal(state.state, STATE.SUBSCRIBED)
      assert.equal(subscribeCount, 3)

      await state.unsubscribe()
      assert.equal(state.state, STATE.IDLE)
      assert.equal(unsubscribeCount, 3)
    })
  })

  describe('Callback invocation', () => {
    it('onSubscribe called exactly once per successful subscribe', async () => {
      let subscribeCount = 0
      const state = new SubscriptionState({
        onSubscribe: async () => { subscribeCount++ },
        onUnsubscribe: async () => {}
      })

      await state.subscribe()
      assert.equal(subscribeCount, 1)

      // Already subscribed, should not call again
      await state.subscribe()
      assert.equal(subscribeCount, 1)

      await state.unsubscribe()
      await state.subscribe()
      assert.equal(subscribeCount, 2)
    })

    it('onUnsubscribe called exactly once per successful unsubscribe', async () => {
      let unsubscribeCount = 0
      const state = new SubscriptionState({
        onSubscribe: async () => {},
        onUnsubscribe: async () => { unsubscribeCount++ }
      })

      await state.subscribe()
      await state.unsubscribe()
      assert.equal(unsubscribeCount, 1)

      // Already idle, should not call again
      await state.unsubscribe()
      assert.equal(unsubscribeCount, 1)

      await state.subscribe()
      await state.unsubscribe()
      assert.equal(unsubscribeCount, 2)
    })

    it('callbacks called in correct order during rapid sequence', async () => {
      const callOrder = []
      const { promise: subPromise, resolve: subResolve } = createControllablePromise()

      const state = new SubscriptionState({
        onSubscribe: async () => {
          callOrder.push('subscribe-start')
          await subPromise
          callOrder.push('subscribe-end')
        },
        onUnsubscribe: async () => {
          callOrder.push('unsubscribe-start')
          callOrder.push('unsubscribe-end')
        }
      })

      const sub1 = state.subscribe()
      const unsub1 = state.unsubscribe()

      subResolve()
      await sub1
      await unsub1

      assert.deepEqual(callOrder, [
        'subscribe-start',
        'subscribe-end',
        'unsubscribe-start',
        'unsubscribe-end'
      ])
    })

    it('callbacks are called with async context', async () => {
      let subscribeContext
      let unsubscribeContext

      const state = new SubscriptionState({
        onSubscribe: async function () { subscribeContext = this },
        onUnsubscribe: async function () { unsubscribeContext = this }
      })

      await state.subscribe()
      await state.unsubscribe()

      // The callbacks should have been called
      assert.ok(subscribeContext !== undefined, 'onSubscribe was called')
      assert.ok(unsubscribeContext !== undefined, 'onUnsubscribe was called')
    })
  })

  describe('Promise handling', () => {
    it('subscribe returns a promise that resolves when complete', async () => {
      const state = new SubscriptionState({
        onSubscribe: async () => {},
        onUnsubscribe: async () => {}
      })

      const result = state.subscribe()
      assert.ok(result instanceof Promise, 'subscribe should return a promise')
      await result
      assert.equal(state.state, STATE.SUBSCRIBED)
    })

    it('unsubscribe returns a promise that resolves when complete', async () => {
      const state = new SubscriptionState({
        onSubscribe: async () => {},
        onUnsubscribe: async () => {}
      })

      await state.subscribe()
      const result = state.unsubscribe()
      assert.ok(result instanceof Promise, 'unsubscribe should return a promise')
      await result
      assert.equal(state.state, STATE.IDLE)
    })

    it('rapid calls during transition all resolve', async () => {
      const { promise, resolve } = createControllablePromise()
      let subscribeCount = 0

      const state = new SubscriptionState({
        onSubscribe: async () => { subscribeCount++; await promise },
        onUnsubscribe: async () => {}
      })

      const p1 = state.subscribe()
      const p2 = state.subscribe()
      const p3 = state.subscribe()

      resolve()
      await p1
      await p2
      await p3

      assert.equal(state.state, STATE.SUBSCRIBED)
      assert.equal(subscribeCount, 1, 'should only subscribe once')
    })
  })

  describe('Edge cases', () => {
    it('handles synchronous onSubscribe callback', async () => {
      let called = false
      const state = new SubscriptionState({
        onSubscribe: async () => { called = true },
        onUnsubscribe: async () => {}
      })

      await state.subscribe()
      assert.equal(called, true)
      assert.equal(state.state, STATE.SUBSCRIBED)
    })

    it('handles synchronous onUnsubscribe callback', async () => {
      let called = false
      const state = new SubscriptionState({
        onSubscribe: async () => {},
        onUnsubscribe: async () => { called = true }
      })

      await state.subscribe()
      await state.unsubscribe()
      assert.equal(called, true)
      assert.equal(state.state, STATE.IDLE)
    })

    it('pending action is cleared after successful subscribe', async () => {
      const { promise: unsubPromise, resolve: unsubResolve } = createControllablePromise()
      const state = new SubscriptionState({
        onSubscribe: async () => {},
        onUnsubscribe: async () => { await unsubPromise }
      })

      await state.subscribe()
      const unsub1 = state.unsubscribe()
      const sub1 = state.subscribe()

      unsubResolve()
      await unsub1
      await sub1

      assert.equal(state.state, STATE.SUBSCRIBED)

      // Now do another unsubscribe - should work normally
      await state.unsubscribe()
      assert.equal(state.state, STATE.IDLE)
    })

    it('pending action is cleared after successful unsubscribe', async () => {
      const { promise: subPromise, resolve: subResolve } = createControllablePromise()
      const state = new SubscriptionState({
        onSubscribe: async () => { await subPromise },
        onUnsubscribe: async () => {}
      })

      const sub1 = state.subscribe()
      const unsub1 = state.unsubscribe()

      subResolve()
      await sub1
      await unsub1

      assert.equal(state.state, STATE.IDLE)

      // Now do another subscribe - should work normally
      await state.subscribe()
      assert.equal(state.state, STATE.SUBSCRIBED)
    })
  })

  describe('State transitions', () => {
    it('IDLE -> SUBSCRIBING -> SUBSCRIBED', async () => {
      const { promise, resolve } = createControllablePromise()
      const states = []

      const state = new SubscriptionState({
        onSubscribe: async () => { await promise },
        onUnsubscribe: async () => {}
      })

      states.push(state.state) // Should be IDLE
      const subPromise = state.subscribe()
      states.push(state.state) // Should be SUBSCRIBING

      resolve()
      await subPromise
      states.push(state.state) // Should be SUBSCRIBED

      assert.deepEqual(states, [STATE.IDLE, STATE.SUBSCRIBING, STATE.SUBSCRIBED])
    })

    it('SUBSCRIBED -> UNSUBSCRIBING -> IDLE', async () => {
      const { promise, resolve } = createControllablePromise()
      const states = []

      const state = new SubscriptionState({
        onSubscribe: async () => {},
        onUnsubscribe: async () => { await promise }
      })

      await state.subscribe()
      states.push(state.state) // Should be SUBSCRIBED

      const unsubPromise = state.unsubscribe()
      states.push(state.state) // Should be UNSUBSCRIBING

      resolve()
      await unsubPromise
      states.push(state.state) // Should be IDLE

      assert.deepEqual(states, [STATE.SUBSCRIBED, STATE.UNSUBSCRIBING, STATE.IDLE])
    })

    it('subscribed getter matches state correctly', async () => {
      const state = new SubscriptionState({
        onSubscribe: async () => {},
        onUnsubscribe: async () => {}
      })

      assert.equal(state.subscribed, false, 'IDLE should not be subscribed')

      await state.subscribe()
      assert.equal(state.subscribed, true, 'SUBSCRIBED should be subscribed')

      await state.unsubscribe()
      assert.equal(state.subscribed, false, 'IDLE should not be subscribed')
    })

    it('subscribed getter is false during SUBSCRIBING', async () => {
      const { promise, resolve } = createControllablePromise()
      const state = new SubscriptionState({
        onSubscribe: async () => { await promise },
        onUnsubscribe: async () => {}
      })

      const subPromise = state.subscribe()
      assert.equal(state.state, STATE.SUBSCRIBING)
      assert.equal(state.subscribed, false, 'SUBSCRIBING should not be considered subscribed')

      resolve()
      await subPromise
      assert.equal(state.subscribed, true)
    })

    it('subscribed getter is false during UNSUBSCRIBING', async () => {
      const { promise, resolve } = createControllablePromise()
      const state = new SubscriptionState({
        onSubscribe: async () => {},
        onUnsubscribe: async () => { await promise }
      })

      await state.subscribe()
      const unsubPromise = state.unsubscribe()
      assert.equal(state.state, STATE.UNSUBSCRIBING)
      assert.equal(state.subscribed, false, 'UNSUBSCRIBING should not be considered subscribed')

      resolve()
      await unsubPromise
      assert.equal(state.subscribed, false)
    })
  })

  describe('Complex scenarios', () => {
    it('alternating rapid calls during SUBSCRIBING', async () => {
      const { promise: subPromise, resolve: subResolve } = createControllablePromise()
      let subscribeCount = 0
      let unsubscribeCount = 0

      const state = new SubscriptionState({
        onSubscribe: async () => { subscribeCount++; await subPromise },
        onUnsubscribe: async () => { unsubscribeCount++ }
      })

      const sub1 = state.subscribe()
      state.unsubscribe() // pending = 'unsubscribe'
      state.subscribe() // pending = undefined (cancels unsubscribe)
      state.unsubscribe() // pending = 'unsubscribe'

      subResolve()
      await sub1

      assert.equal(state.state, STATE.IDLE)
      assert.equal(subscribeCount, 1, 'should only subscribe once')
      assert.equal(unsubscribeCount, 1, 'should unsubscribe once at the end')
    })

    it('alternating rapid calls during UNSUBSCRIBING', async () => {
      const { promise: unsubPromise, resolve: unsubResolve } = createControllablePromise()
      let subscribeCount = 0
      let unsubscribeCount = 0

      const state = new SubscriptionState({
        onSubscribe: async () => { subscribeCount++ },
        onUnsubscribe: async () => { unsubscribeCount++; await unsubPromise }
      })

      await state.subscribe()
      subscribeCount = 0 // Reset counter

      const unsub1 = state.unsubscribe()
      state.subscribe() // pending = 'subscribe'
      state.unsubscribe() // pending = undefined (cancels subscribe)
      state.subscribe() // pending = 'subscribe'

      unsubResolve()
      await unsub1

      assert.equal(state.state, STATE.SUBSCRIBED)
      assert.equal(subscribeCount, 1, 'should subscribe once at the end')
      assert.equal(unsubscribeCount, 1, 'should only unsubscribe once')
    })

    it('pending actions are cleared on error (subscribe fails)', async function () {
      let shouldFail = true
      let unsubscribeCount = 0

      const state = new SubscriptionState({
        onSubscribe: async () => {
          if (shouldFail) throw new Error('Subscribe failed')
        },
        onUnsubscribe: async () => { unsubscribeCount++ }
      })

      // Try to subscribe (will fail), with pending unsubscribe
      const p1 = state.subscribe()
      const p2 = state.unsubscribe()

      // Both promises will reject since they're the same activePromise
      p1.catch(() => {})
      p2.catch(() => {})

      await new Promise(resolve => setImmediate(resolve))

      assert.equal(state.state, STATE.IDLE, 'should be IDLE after subscribe error')
      assert.equal(unsubscribeCount, 0, 'pending unsubscribe should not execute')

      // Verify state machine still works
      shouldFail = false
      await state.subscribe()
      assert.equal(state.state, STATE.SUBSCRIBED)
    })

    it('pending actions are cleared on error (unsubscribe fails)', async function () {
      let shouldFail = true
      let subscribeCount = 0

      const state = new SubscriptionState({
        onSubscribe: async () => { subscribeCount++ },
        onUnsubscribe: async () => {
          if (shouldFail) throw new Error('Unsubscribe failed')
        }
      })

      await state.subscribe()
      subscribeCount = 0

      // Try to unsubscribe (will fail), with pending subscribe
      const p1 = state.unsubscribe()
      const p2 = state.subscribe()

      // Both promises will reject since they're the same activePromise
      p1.catch(() => {})
      p2.catch(() => {})

      await new Promise(resolve => setImmediate(resolve))

      assert.equal(state.state, STATE.SUBSCRIBED, 'should be SUBSCRIBED after unsubscribe error')
      assert.equal(subscribeCount, 0, 'pending subscribe should not execute')

      // Verify state machine still works
      shouldFail = false
      await state.unsubscribe()
      assert.equal(state.state, STATE.IDLE)
    })
  })
})
