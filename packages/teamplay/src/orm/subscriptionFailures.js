// Subscriptions the server stopped. After a reconnect ShareDB re-subscribes
// every doc and query on its own, and the server can refuse that (the read
// rules no longer let the user read the doc, say). ShareDB's client reports
// it only with an 'error' event; the doc and query runtimes listen while
// teamplay uses them, and their manager records the error here, keyed by the
// manager kind ('doc', 'query', 'aggregation') and the transport hash, until
// the target subscribes again or its runtime is destroyed.
//
// The record is observable: useSub() and its variants read it in render, so
// a component using the subscription re-renders and throws the error to its
// error boundary, as when sub() rejects.
import { observable, raw } from '@nx-js/observer-util'
import isDevMode from '../utils/isDevMode.ts'

const failures = observable(new Map())

export function getSubscriptionFailureKey (kind, hash) {
  return kind + ':' + hash
}

// A tracked read: the running reaction re-runs when the key is set or cleared
export function getSubscriptionFailure (key) {
  if (key == null) return
  return raw(failures.get(key))
}

export function setSubscriptionFailure (key, error) {
  failures.set(key, error)
}

export function clearSubscriptionFailure (key) {
  if (raw(failures).has(key)) failures.delete(key)
}

export function getSubscriptionFailureCount () {
  return raw(failures).size
}

// What ShareDB reported on a doc or query that teamplay uses. `stopped`: the
// subscription is gone (a re-subscribe the server refused); `path`: what to
// name in the log; `owned`: something still uses the subscription.
export function reportSubscriptionError (err, { path, stopped, owned }) {
  if (!isDevMode()) return
  if (stopped && owned) {
    console.warn(
      `[teamplay] The server refused to subscribe to ${path} again (after a reconnect). ` +
      'Components that use it throw the error to the nearest error boundary; a remount subscribes again.',
      err
    )
  } else if (stopped) {
    console.warn(`[teamplay] The server refused to subscribe to ${path} again (after a reconnect); nothing uses it any more.`, err)
  } else {
    console.warn(`[teamplay] ShareDB reported an error for ${path}.`, err)
  }
}
