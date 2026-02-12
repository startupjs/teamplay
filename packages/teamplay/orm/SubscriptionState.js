// State machine for managing subscribe/unsubscribe lifecycle.
//
// States: IDLE, SUBSCRIBING, SUBSCRIBED, UNSUBSCRIBING
//
// Valid transitions:
//   IDLE -> SUBSCRIBING (subscribe called)
//   SUBSCRIBING -> SUBSCRIBED (subscribe succeeded)
//   SUBSCRIBING -> IDLE (subscribe failed)
//   SUBSCRIBED -> UNSUBSCRIBING (unsubscribe called)
//   UNSUBSCRIBING -> IDLE (unsubscribe succeeded)
//   UNSUBSCRIBING -> SUBSCRIBED (unsubscribe failed, rollback)
//
// Rapid sub/unsub handling:
//   If subscribe() is called during UNSUBSCRIBING, we queue a resubscribe.
//   If unsubscribe() is called during SUBSCRIBING, we queue an unsubscribe.
//   Only the latest intent matters - intermediate intents are collapsed.

export const STATE = {
  IDLE: 'IDLE',
  SUBSCRIBING: 'SUBSCRIBING',
  SUBSCRIBED: 'SUBSCRIBED',
  UNSUBSCRIBING: 'UNSUBSCRIBING'
}

export default class SubscriptionState {
  #state = STATE.IDLE
  #pendingAction = undefined // 'subscribe' | 'unsubscribe' | undefined
  #activePromise = undefined
  #onSubscribe // async () => void
  #onUnsubscribe // async () => void

  constructor ({ onSubscribe, onUnsubscribe }) {
    this.#onSubscribe = onSubscribe
    this.#onUnsubscribe = onUnsubscribe
  }

  get state () {
    return this.#state
  }

  get subscribed () {
    return this.#state === STATE.SUBSCRIBED
  }

  async subscribe () {
    // Already subscribed - nothing to do
    if (this.#state === STATE.SUBSCRIBED) return

    // Already subscribing - if there was a pending unsubscribe, cancel it
    if (this.#state === STATE.SUBSCRIBING) {
      this.#pendingAction = undefined
      return this.#activePromise
    }

    // Currently unsubscribing - queue a resubscribe after it finishes
    if (this.#state === STATE.UNSUBSCRIBING) {
      this.#pendingAction = 'subscribe'
      return this.#activePromise
    }

    // IDLE - start subscribing
    return this.#doSubscribe()
  }

  async unsubscribe () {
    // Already idle - nothing to do
    if (this.#state === STATE.IDLE) return

    // Already unsubscribing - if there was a pending subscribe, cancel it
    if (this.#state === STATE.UNSUBSCRIBING) {
      this.#pendingAction = undefined
      return this.#activePromise
    }

    // Currently subscribing - queue an unsubscribe after it finishes
    if (this.#state === STATE.SUBSCRIBING) {
      this.#pendingAction = 'unsubscribe'
      return this.#activePromise
    }

    // SUBSCRIBED - start unsubscribing
    return this.#doUnsubscribe()
  }

  async #doSubscribe () {
    this.#state = STATE.SUBSCRIBING
    this.#pendingAction = undefined

    this.#activePromise = (async () => {
      try {
        await this.#onSubscribe()
        this.#state = STATE.SUBSCRIBED
      } catch (err) {
        this.#state = STATE.IDLE
        this.#pendingAction = undefined
        throw err
      } finally {
        this.#activePromise = undefined
      }
      await this.#processPending()
    })()

    return this.#activePromise
  }

  async #doUnsubscribe () {
    this.#state = STATE.UNSUBSCRIBING
    this.#pendingAction = undefined

    this.#activePromise = (async () => {
      try {
        await this.#onUnsubscribe()
        this.#state = STATE.IDLE
      } catch (err) {
        this.#state = STATE.SUBSCRIBED
        this.#pendingAction = undefined
        throw err
      } finally {
        this.#activePromise = undefined
      }
      await this.#processPending()
    })()

    return this.#activePromise
  }

  async #processPending () {
    const action = this.#pendingAction
    this.#pendingAction = undefined

    if (action === 'subscribe' && this.#state === STATE.IDLE) {
      return this.#doSubscribe()
    }
    if (action === 'unsubscribe' && this.#state === STATE.SUBSCRIBED) {
      return this.#doUnsubscribe()
    }
  }
}
