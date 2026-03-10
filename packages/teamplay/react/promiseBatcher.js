let active = false
let promises = []

export function activate () {
  active = true
}

export function add (promise) {
  if (!promise || typeof promise.then !== 'function') return
  promises.push(promise)
}

export function getPromiseAll () {
  const hasPromises = promises.length > 0
  const result = hasPromises ? Promise.all(promises) : null
  reset()
  return result
}

export function isActive () {
  return active
}

export function reset () {
  active = false
  promises = []
}
