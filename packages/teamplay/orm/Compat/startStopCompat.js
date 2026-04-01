import { observe, raw, unobserve } from '@nx-js/observer-util'
import { getRoot } from '../Root.js'
import { scheduleReaction } from '../batchScheduler.js'

const START_REACTIONS = Symbol('compat start reactions')
const SKIP_TICK = Symbol('compat start skip tick')

export function compatStartOnRoot ($root, targetPath, ...depsAndGetter) {
  if (!isRootSignal($root)) throw Error('Signal.start() is only available on root signal')
  if (typeof targetPath !== 'string') throw Error('Signal.start() expects targetPath to be a string')
  if (depsAndGetter.length < 1) {
    throw Error('Signal.start() expects targetPath, dependencies, and a getter function')
  }
  const getter = depsAndGetter[depsAndGetter.length - 1]
  if (typeof getter !== 'function') {
    throw Error('Signal.start() expects the last argument to be a getter function')
  }
  const deps = depsAndGetter.slice(0, -1)
  const targetSegments = parsePathSegments(targetPath)
  const $target = resolveSignal($root, targetSegments)
  const targetKey = $target.path()

  const store = getStartStore($root)
  const existing = store.get(targetKey)
  if (existing) existing.stop()

  const reaction = observe(() => {
    const resolvedDeps = []
    for (const dep of deps) {
      const resolved = resolveStartDep(dep, $root)
      if (resolved === SKIP_TICK) return
      resolvedDeps.push(resolved)
    }
    let nextValue
    try {
      nextValue = getter(...resolvedDeps)
    } catch (err) {
      if (isThenable(err)) return
      throw err
    }
    const detachedValue = detachStartValue(nextValue)
    // Keep the detached snapshot to avoid aliasing source and target.
    // Old racer start() writes through diffDeep by default. In compat mode we must preserve
    // that behavior, but also avoid reading the target reactively inside start(), otherwise
    // start() subscribes to its own output and local child edits get immediately overwritten.
    const maybePromise = $target.setDiffDeep(detachedValue)
    if (maybePromise?.catch) maybePromise.catch(ignorePromiseRejection)
  }, { scheduler: scheduleReaction })
  store.set(targetKey, { stop: () => unobserve(reaction) })
  return $target
}

export function compatStopOnRoot ($root, targetPath) {
  if (!isRootSignal($root)) throw Error('Signal.stop() is only available on root signal')
  if (typeof targetPath !== 'string') throw Error('Signal.stop() expects targetPath to be a string')
  const targetSegments = parsePathSegments(targetPath)
  const $target = resolveSignal($root, targetSegments)
  const targetKey = $target.path()
  const store = getStartStore($root)
  const existing = store.get(targetKey)
  if (!existing) return
  existing.stop()
  store.delete(targetKey)
}

export function joinScopePath (scopePath, relativePath) {
  if (typeof scopePath !== 'string') scopePath = ''
  const segments = []
  if (scopePath) segments.push(...parsePathSegments(scopePath))
  if (relativePath) segments.push(...parsePathSegments(relativePath))
  return segments.join('.')
}

function getStartStore ($root) {
  $root[START_REACTIONS] ??= new Map()
  return $root[START_REACTIONS]
}

function resolveStartDep (dep, $root) {
  try {
    if (isSignalLike(dep)) return getStartDepValue(dep)
    if (typeof dep === 'string') return getStartDepValue(resolveSignal($root, parsePathSegments(dep)))
    return dep
  } catch (err) {
    if (isThenable(err)) return SKIP_TICK
    throw err
  }
}

function getStartDepValue ($signal) {
  return readReactiveSnapshot($signal.get())
}

function readReactiveSnapshot (value) {
  if (!value || typeof value !== 'object') return value
  if (value instanceof Date) return new Date(value)
  if (Array.isArray(value)) {
    const array = []
    for (let i = 0; i < value.length; i++) {
      array[i] = readReactiveSnapshot(value[i])
    }
    return array
  }
  const object = new value.constructor()
  for (const key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      object[key] = readReactiveSnapshot(value[key])
    }
  }
  return object
}

function isSignalLike (value) {
  return value && typeof value.path === 'function' && typeof value.get === 'function'
}

function parsePathSegments (path) {
  return path.split('.').filter(Boolean)
}

function resolveSignal ($base, segments) {
  let $cursor = $base
  for (const segment of segments) $cursor = $cursor[segment]
  return $cursor
}

function isRootSignal ($signal) {
  return getRoot($signal) === $signal
}

function ignorePromiseRejection () {}

function isThenable (value) {
  return !!value && typeof value.then === 'function'
}

function detachStartValue (value) {
  const rawValue = raw(value)
  if (!rawValue || typeof rawValue !== 'object') return rawValue
  if (typeof globalThis.structuredClone === 'function') {
    try {
      return globalThis.structuredClone(rawValue)
    } catch {}
  }
  return racerDeepCopy(rawValue)
}

function racerDeepCopy (value) {
  if (value instanceof Date) return new Date(value)
  if (typeof value === 'object') {
    if (value === null) return null
    if (Array.isArray(value)) {
      const array = []
      for (let i = value.length; i--;) {
        array[i] = racerDeepCopy(value[i])
      }
      return array
    }
    const object = new value.constructor()
    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        object[key] = racerDeepCopy(value[key])
      }
    }
    return object
  }
  return value
}
