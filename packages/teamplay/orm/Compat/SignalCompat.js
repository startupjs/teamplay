import { raw, observe, unobserve } from '@nx-js/observer-util'
import {
  Signal,
  GETTERS,
  DEFAULT_GETTERS,
  SEGMENTS,
  isPublicCollection,
  isPublicCollectionSignal,
  isPublicDocumentSignal
} from '../SignalBase.js'
import { getRoot } from '../Root.js'
import { publicOnly, fetchOnly, setFetchOnly } from '../connection.js'
import { docSubscriptions } from '../Doc.js'
import { IS_QUERY, getQuerySignal, querySubscriptions } from '../Query.js'
import { IS_AGGREGATION, aggregationSubscriptions, getAggregationSignal } from '../Aggregation.js'
import { getIdFieldsForSegments, isIdFieldPath, normalizeIdFields } from '../idFields.js'
import {
  setReplace as _setReplace,
  setPublicDocReplace as _setPublicDocReplace,
  incrementPublic as _incrementPublic,
  arrayPush as _arrayPush,
  arrayUnshift as _arrayUnshift,
  arrayInsert as _arrayInsert,
  arrayPop as _arrayPop,
  arrayShift as _arrayShift,
  arrayRemove as _arrayRemove,
  arrayMove as _arrayMove,
  arrayPushPublic as _arrayPushPublic,
  arrayUnshiftPublic as _arrayUnshiftPublic,
  arrayInsertPublic as _arrayInsertPublic,
  arrayPopPublic as _arrayPopPublic,
  arrayShiftPublic as _arrayShiftPublic,
  arrayRemovePublic as _arrayRemovePublic,
  arrayMovePublic as _arrayMovePublic,
  stringInsertLocal as _stringInsertLocal,
  stringRemoveLocal as _stringRemoveLocal,
  stringInsertPublic as _stringInsertPublic,
  stringRemovePublic as _stringRemovePublic
} from '../dataTree.js'
import { on as onCustomEvent, removeListener as removeCustomEventListener } from './eventsCompat.js'
import { normalizePattern, onModelEvent, removeModelListener } from './modelEvents.js'
import { setRefLink, removeRefLink } from './refRegistry.js'

class SignalCompat extends Signal {
  static ID_FIELDS = ['_id', 'id']
  static [GETTERS] = [...DEFAULT_GETTERS, 'getCopy', 'getDeepCopy']

  path (subpath) {
    if (arguments.length > 1) throw Error('Signal.path() expects a single argument')
    if (arguments.length === 0) return super.path()
    const segments = parseAtSubpath(subpath, arguments.length, 'Signal.path()')
    if (segments.length === 0) return super.path()
    return [...this[SEGMENTS], ...segments].join('.')
  }

  at (subpath) {
    if (arguments.length > 1) throw Error('Signal.at() expects a single argument')
    const segments = parseAtSubpath(subpath, arguments.length, 'Signal.at()')
    if (segments.length === 0) return this
    let $cursor = this
    for (const segment of segments) {
      $cursor = $cursor[segment]
    }
    return $cursor
  }

  getCopy (subpath) {
    if (arguments.length > 1) throw Error('Signal.getCopy() expects a single argument')
    const segments = parseAtSubpath(subpath, arguments.length, 'Signal.getCopy()')
    const value = getSignalValueAt(this, segments)
    return shallowCopy(value)
  }

  getDeepCopy (subpath) {
    if (arguments.length > 1) throw Error('Signal.getDeepCopy() expects a single argument')
    const segments = parseAtSubpath(subpath, arguments.length, 'Signal.getDeepCopy()')
    const value = getSignalValueAt(this, segments)
    return deepCopy(value)
  }

  query (collection, params, options) {
    if (arguments.length < 1 || arguments.length > 3) throw Error('Signal.query() expects one to three arguments')
    if (typeof collection !== 'string') throw Error('Signal.query() expects collection to be a string')
    const normalized = normalizeQueryParams(collection, params)
    if (isAggregationParams(normalized)) {
      return getAggregationSignal(collection, normalized, options)
    }
    return getQuerySignal(collection, normalized, options)
  }

  subscribe (...items) {
    if (items.length > 0) return subscribeMany(items, 'subscribe')
    return subscribeSelf(this)
  }

  unsubscribe (...items) {
    if (items.length > 0) return subscribeMany(items, 'unsubscribe')
    return unsubscribeSelf(this)
  }

  fetch (...items) {
    return withFetchOnly(() => {
      if (items.length > 0) return subscribeMany(items, 'subscribe')
      return subscribeSelf(this)
    })
  }

  unfetch (...items) {
    if (items.length > 0) return subscribeMany(items, 'unsubscribe')
    return unsubscribeSelf(this)
  }

  getExtra () {
    if (arguments.length > 0) throw Error('Signal.getExtra() does not accept any arguments')
    if (this[IS_AGGREGATION]) return this.get()
    if (this[IS_QUERY]) return this.extra.get()
    return undefined
  }

  get () {
    if (arguments.length > 1) throw Error('Signal.get() expects zero or one argument')
    if (arguments.length === 1) {
      const segments = parseAtSubpath(arguments[0], 1, 'Signal.get()')
      const $base = resolveRefSignal(this)
      const $target = resolveSignal($base, segments)
      return Signal.prototype.get.call($target)
    }
    const $target = resolveRefSignal(this)
    if ($target !== this) return Signal.prototype.get.apply($target, arguments)
    return Signal.prototype.get.apply(this, arguments)
  }

  peek () {
    if (arguments.length > 1) throw Error('Signal.peek() expects zero or one argument')
    if (arguments.length === 1) {
      const segments = parseAtSubpath(arguments[0], 1, 'Signal.peek()')
      const $base = resolveRefSignal(this)
      const $target = resolveSignal($base, segments)
      return Signal.prototype.peek.call($target)
    }
    const $target = resolveRefSignal(this)
    if ($target !== this) return Signal.prototype.peek.apply($target, arguments)
    return Signal.prototype.peek.apply(this, arguments)
  }

  async set (path, value) {
    const forwarded = forwardRef(this, 'set', arguments)
    if (forwarded) return forwarded
    if (arguments.length > 2) throw Error('Signal.set() expects one or two arguments')
    let segments = []
    if (arguments.length === 2) {
      segments = parseAtSubpath(path, 1, 'Signal.set()')
    } else if (arguments.length === 1) {
      value = path
    }
    const $target = resolveSignal(this, segments)
    return Signal.prototype.set.call($target, value)
  }

  async setNull (path, value) {
    const forwarded = forwardRef(this, 'setNull', arguments)
    if (forwarded) return forwarded
    if (arguments.length > 2) throw Error('Signal.setNull() expects one or two arguments')
    let segments = []
    if (arguments.length === 2) {
      segments = parseAtSubpath(path, 1, 'Signal.setNull()')
    } else if (arguments.length === 1) {
      value = path
    }
    const $target = resolveSignal(this, segments)
    if ($target.get() != null) return
    return setReplaceOnSignal($target, value)
  }

  async setDiffDeep (path, value) {
    const forwarded = forwardRef(this, 'setDiffDeep', arguments)
    if (forwarded) return forwarded
    if (arguments.length > 2) throw Error('Signal.setDiffDeep() expects one or two arguments')
    let segments = []
    if (arguments.length === 2) {
      segments = parseAtSubpath(path, 1, 'Signal.setDiffDeep()')
    } else if (arguments.length === 1) {
      value = path
    }
    const $target = resolveSignal(this, segments)
    return Signal.prototype.set.call($target, value)
  }

  async setDiff (path, value) {
    const forwarded = forwardRef(this, 'setDiff', arguments)
    if (forwarded) return forwarded
    if (arguments.length > 2) throw Error('Signal.setDiff() expects one or two arguments')
    if (arguments.length === 1) {
      return Signal.prototype.set.call(this, path)
    }
    return this.set(path, value)
  }

  async setEach (path, object) {
    const forwarded = forwardRef(this, 'setEach', arguments)
    if (forwarded) return forwarded
    if (arguments.length > 2) throw Error('Signal.setEach() expects one or two arguments')
    let segments = []
    if (arguments.length === 2) {
      segments = parseAtSubpath(path, 1, 'Signal.setEach()')
    } else if (arguments.length === 1) {
      object = path
    }
    const $target = resolveSignal(this, segments)
    return Signal.prototype.assign.call($target, object)
  }

  async del (path) {
    const forwarded = forwardRef(this, 'del', arguments)
    if (forwarded) return forwarded
    if (arguments.length > 1) throw Error('Signal.del() expects a single argument')
    const segments = parseAtSubpath(path, arguments.length, 'Signal.del()')
    const $target = resolveSignal(this, segments)
    return Signal.prototype.del.call($target)
  }

  async increment (path, byNumber) {
    const forwarded = forwardRef(this, 'increment', arguments)
    if (forwarded) return forwarded
    if (arguments.length > 2) throw Error('Signal.increment() expects one or two arguments')
    let segments = []
    if (arguments.length === 2) {
      segments = parseAtSubpath(path, 1, 'Signal.increment()')
    } else if (arguments.length === 1) {
      if (typeof path === 'number') {
        byNumber = path
      } else {
        segments = parseAtSubpath(path, 1, 'Signal.increment()')
      }
    }
    const $target = resolveSignal(this, segments)
    return incrementOnSignal($target, byNumber)
  }

  async push (path, value) {
    const forwarded = forwardRef(this, 'push', arguments)
    if (forwarded) return forwarded
    if (arguments.length > 2) throw Error('Signal.push() expects one or two arguments')
    let segments = []
    if (arguments.length === 2) {
      segments = parseAtSubpath(path, 1, 'Signal.push()')
    } else {
      value = path
    }
    const $target = resolveSignal(this, segments)
    return arrayPushOnSignal($target, value)
  }

  async unshift (path, value) {
    const forwarded = forwardRef(this, 'unshift', arguments)
    if (forwarded) return forwarded
    if (arguments.length > 2) throw Error('Signal.unshift() expects one or two arguments')
    let segments = []
    if (arguments.length === 2) {
      segments = parseAtSubpath(path, 1, 'Signal.unshift()')
    } else {
      value = path
    }
    const $target = resolveSignal(this, segments)
    return arrayUnshiftOnSignal($target, value)
  }

  async insert (path, index, values) {
    const forwarded = forwardRef(this, 'insert', arguments)
    if (forwarded) return forwarded
    if (arguments.length < 2) throw Error('Not enough arguments for insert')
    if (arguments.length > 3) throw Error('Signal.insert() expects two or three arguments')
    let segments = []
    if (arguments.length === 2) {
      index = arguments[0]
      values = arguments[1]
    } else {
      segments = parseAtSubpath(path, 1, 'Signal.insert()')
      index = arguments[1]
      values = arguments[2]
    }
    if (typeof index !== 'number' || !Number.isFinite(index)) {
      throw Error('Signal.insert() expects a numeric index')
    }
    const $target = resolveSignal(this, segments)
    return arrayInsertOnSignal($target, index, values)
  }

  async pop (path) {
    const forwarded = forwardRef(this, 'pop', arguments)
    if (forwarded) return forwarded
    if (arguments.length > 1) throw Error('Signal.pop() expects a single argument')
    const segments = parseAtSubpath(path, arguments.length, 'Signal.pop()')
    const $target = resolveSignal(this, segments)
    return arrayPopOnSignal($target)
  }

  async shift (path) {
    const forwarded = forwardRef(this, 'shift', arguments)
    if (forwarded) return forwarded
    if (arguments.length > 1) throw Error('Signal.shift() expects a single argument')
    const segments = parseAtSubpath(path, arguments.length, 'Signal.shift()')
    const $target = resolveSignal(this, segments)
    return arrayShiftOnSignal($target)
  }

  async remove (path, index, howMany) {
    const forwarded = forwardRef(this, 'remove', arguments)
    if (forwarded) return forwarded
    if (arguments.length === 0) {
      const segments = this[SEGMENTS].slice()
      if (!segments.length || typeof segments[segments.length - 1] !== 'number') {
        throw Error('Signal.remove() expects an index')
      }
      index = segments.pop()
      const $root = getRoot(this) || this
      const $target = resolveSignal($root, segments)
      return arrayRemoveOnSignal($target, +index, howMany)
    }
    if (arguments.length < 1) throw Error('Not enough arguments for remove')
    if (arguments.length > 3) throw Error('Signal.remove() expects one to three arguments')
    let segments = []
    if (arguments.length === 1) {
      if (typeof path === 'number') {
        index = path
      } else {
        segments = parseAtSubpath(path, 1, 'Signal.remove()')
      }
    } else if (arguments.length === 2) {
      if (typeof path === 'number') {
        index = path
        howMany = arguments[1]
      } else {
        segments = parseAtSubpath(path, 1, 'Signal.remove()')
        index = arguments[1]
      }
    } else {
      segments = parseAtSubpath(path, 1, 'Signal.remove()')
      index = arguments[1]
      howMany = arguments[2]
    }
    if (index == null && segments.length && typeof segments[segments.length - 1] === 'number') {
      index = segments.pop()
    }
    if (typeof index !== 'number' || !Number.isFinite(index)) {
      throw Error('Signal.remove() expects a numeric index')
    }
    const $target = resolveSignal(this, segments)
    return arrayRemoveOnSignal($target, index, howMany)
  }

  async move (path, from, to, howMany) {
    const forwarded = forwardRef(this, 'move', arguments)
    if (forwarded) return forwarded
    if (arguments.length < 2) throw Error('Not enough arguments for move')
    if (arguments.length > 4) throw Error('Signal.move() expects two to four arguments')
    let segments = []
    if (arguments.length === 2) {
      from = arguments[0]
      to = arguments[1]
    } else if (arguments.length === 3) {
      if (typeof path === 'number') {
        from = arguments[0]
        to = arguments[1]
        howMany = arguments[2]
      } else {
        segments = parseAtSubpath(path, 1, 'Signal.move()')
        from = arguments[1]
        to = arguments[2]
      }
    } else {
      segments = parseAtSubpath(path, 1, 'Signal.move()')
      from = arguments[1]
      to = arguments[2]
      howMany = arguments[3]
    }
    if (typeof from !== 'number' || !Number.isFinite(from) || typeof to !== 'number' || !Number.isFinite(to)) {
      throw Error('Signal.move() expects numeric from/to')
    }
    const $target = resolveSignal(this, segments)
    return arrayMoveOnSignal($target, from, to, howMany)
  }

  async stringInsert (path, index, text) {
    const forwarded = forwardRef(this, 'stringInsert', arguments)
    if (forwarded) return forwarded
    if (arguments.length < 2) throw Error('Not enough arguments for stringInsert')
    if (arguments.length > 3) throw Error('Signal.stringInsert() expects two or three arguments')
    let segments = []
    if (arguments.length === 2) {
      index = arguments[0]
      text = arguments[1]
    } else {
      segments = parseAtSubpath(path, 1, 'Signal.stringInsert()')
      index = arguments[1]
      text = arguments[2]
    }
    if (typeof index !== 'number' || !Number.isFinite(index)) {
      throw Error('Signal.stringInsert() expects a numeric index')
    }
    const $target = resolveSignal(this, segments)
    return stringInsertOnSignal($target, index, text)
  }

  async stringRemove (path, index, howMany) {
    const forwarded = forwardRef(this, 'stringRemove', arguments)
    if (forwarded) return forwarded
    if (arguments.length < 2) throw Error('Not enough arguments for stringRemove')
    if (arguments.length > 3) throw Error('Signal.stringRemove() expects two or three arguments')
    let segments = []
    if (arguments.length === 2) {
      index = arguments[0]
      howMany = arguments[1]
    } else {
      segments = parseAtSubpath(path, 1, 'Signal.stringRemove()')
      index = arguments[1]
      howMany = arguments[2]
    }
    if (typeof index !== 'number' || !Number.isFinite(index)) {
      throw Error('Signal.stringRemove() expects a numeric index')
    }
    if (howMany == null) howMany = 1
    const $target = resolveSignal(this, segments)
    return stringRemoveOnSignal($target, index, howMany)
  }

  async assign (value) {
    const forwarded = forwardRef(this, 'assign', arguments)
    if (forwarded) return forwarded
    if (arguments.length > 1) throw Error('Signal.assign() expects a single argument')
    return Signal.prototype.assign.call(this, value)
  }

  on (eventName, pattern, handler) {
    if (arguments.length < 2) throw Error('Signal.on() expects at least two arguments')
    if (eventName === 'change' || eventName === 'all') {
      if (typeof pattern === 'function') {
        return onCustomEvent(eventName, pattern)
      }
      if (typeof handler !== 'function') throw Error('Signal.on() expects a handler function')
      const normalized = normalizePattern(pattern, 'Signal.on()')
      return onModelEvent(eventName, normalized, handler)
    }
    if (typeof pattern !== 'function') throw Error('Signal.on() expects a handler function')
    return onCustomEvent(eventName, pattern)
  }

  removeListener (eventName, handler) {
    if (arguments.length !== 2) throw Error('Signal.removeListener() expects two arguments')
    if (eventName === 'change' || eventName === 'all') {
      return removeModelListener(eventName, handler)
    }
    return removeCustomEventListener(eventName, handler)
  }

  ref (path, target, options) {
    if (arguments.length > 3) throw Error('Signal.ref() expects one to three arguments')
    let $from = this
    let $to
    if (arguments.length === 1) {
      $to = resolveRefTarget(this, path, 'Signal.ref()')
    } else if (arguments.length === 2) {
      if (isSignalLike(target) || typeof target === 'string') {
        const segments = parseAtSubpath(path, 1, 'Signal.ref()')
        $from = resolveSignal(this, segments)
        $to = resolveRefTarget(this, target, 'Signal.ref()')
      } else {
        $to = resolveRefTarget(this, path, 'Signal.ref()')
        options = target
      }
    } else {
      const segments = parseAtSubpath(path, 1, 'Signal.ref()')
      $from = resolveSignal(this, segments)
      $to = resolveRefTarget(this, target, 'Signal.ref()')
    }
    if (!$to) throw Error('Signal.ref() expects a target path or signal')
    if ($from === $to) return $from
    const store = getRefStore($from)
    const fromPath = $from.path()
    const existing = store.get(fromPath)
    if (existing) existing.stop()
    const stop = createRefLink($from, $to, options)
    store.set(fromPath, { stop })
    $from[REF_TARGET] = $to
    setRefLink(fromPath, $to.path())
    return $from
  }

  removeRef (path) {
    if (arguments.length > 1) throw Error('Signal.removeRef() expects a single argument')
    let $from = this
    if (arguments.length === 1) {
      const segments = parseAtSubpath(path, 1, 'Signal.removeRef()')
      $from = resolveSignal(this, segments)
    }
    const store = getRefStore($from)
    const fromPath = $from.path()
    const existing = store.get(fromPath)
    if (existing) {
      existing.stop()
      store.delete(fromPath)
    }
    removeRefLink(fromPath)
    const $target = resolveRefSignal($from)
    if ($target !== $from) {
      setDiffDeepBypassRef($from, deepCopy($target.get()))
    }
    if ($from[REF_TARGET]) delete $from[REF_TARGET]
  }

  scope (path) {
    if (arguments.length > 1) throw Error('Signal.scope() expects a single argument')
    const $root = getRoot(this) || this
    if (arguments.length === 0) return $root
    if (typeof path !== 'string') throw Error('Signal.scope() expects a string argument')
    const segments = path.split('.').filter(Boolean)
    if (segments.length === 0) return $root
    let $cursor = $root
    for (const segment of segments) {
      $cursor = $cursor[segment]
    }
    return $cursor
  }
}

const REFS = Symbol('compat refs')
const REF_TARGET = Symbol('compat ref target')

function getRefStore ($signal) {
  const $root = getRoot($signal) || $signal
  $root[REFS] ??= new Map()
  return $root[REFS]
}

function createRefLink ($from, $to) {
  const toReaction = observe(() => {
    const value = $to.get()
    trackDeep(value)
    setDiffDeepBypassRef($from, deepCopy(value))
  })
  return () => {
    unobserve(toReaction)
  }
}

function trackDeep (value, seen = new Set()) {
  if (!value || typeof value !== 'object') return
  if (seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) trackDeep(item, seen)
  } else {
    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        trackDeep(value[key], seen)
      }
    }
  }
}

function resolveRefSignal ($signal) {
  let current = $signal
  const seen = new Set()
  while (current && current[REF_TARGET]) {
    if (seen.has(current)) break
    seen.add(current)
    current = current[REF_TARGET]
  }
  return current
}

function forwardRef ($signal, methodName, args) {
  const $target = resolveRefSignal($signal)
  if ($target === $signal) return null
  return SignalCompat.prototype[methodName].apply($target, args)
}

function setDiffDeepBypassRef ($signal, value) {
  return Signal.prototype.set.call($signal, value)
}

function isSignalLike (value) {
  return value && typeof value.path === 'function' && typeof value.get === 'function'
}

function resolveRefTarget ($signal, target, methodName) {
  if (isSignalLike(target)) return target
  if (typeof target === 'string') {
    const segments = parseAtSubpath(target, 1, methodName)
    const $root = getRoot($signal) || $signal
    return resolveSignal($root, segments)
  }
  return undefined
}

function parseAtSubpath (subpath, argsLength, methodName) {
  if (argsLength === 0) return []
  if (typeof subpath === 'string') return subpath.split('.').filter(Boolean)
  if (typeof subpath === 'number' && Number.isFinite(subpath) && Number.isInteger(subpath)) return [subpath]
  throw Error(`${methodName} expects a string or integer argument`)
}

function resolveSignal ($signal, segments) {
  let $cursor = $signal
  for (const segment of segments) {
    $cursor = $cursor[segment]
  }
  return $cursor
}

function getSignalValueAt ($signal, segments) {
  const $target = resolveSignal($signal, segments)
  return $target.get()
}

async function setReplaceOnSignal ($signal, value) {
  const segments = $signal[SEGMENTS]
  if (segments.length === 0) throw Error('Can\'t set the root signal data')
  const idFields = getIdFieldsForSegments(segments)
  if (isIdFieldPath(segments, idFields)) return
  if (segments.length === 2) {
    value = normalizeIdFields(value, idFields, segments[1])
  }
  if (isPublicCollection(segments[0])) {
    return _setPublicDocReplace(segments, value)
  }
  if (publicOnly) throw Error(ERRORS.publicOnly)
  return _setReplace(segments, value)
}

async function incrementOnSignal ($signal, byNumber) {
  const segments = $signal[SEGMENTS]
  if (segments.length === 0) throw Error('Can\'t increment the root signal data')
  const idFields = getIdFieldsForSegments(segments)
  if (isIdFieldPath(segments, idFields)) return $signal.get()
  if (byNumber == null) byNumber = 1
  if (typeof byNumber !== 'number') throw Error('Signal.increment() expects a number argument')
  let currentValue = $signal.get()
  if (currentValue == null) currentValue = 0
  if (typeof currentValue !== 'number') throw Error('Signal.increment() tried to increment a non-number value')
  if (isPublicCollection(segments[0])) {
    await _incrementPublic(segments, byNumber)
    return currentValue + byNumber
  }
  if (publicOnly) throw Error(ERRORS.publicOnly)
  _setReplace(segments, currentValue + byNumber)
  return currentValue + byNumber
}

function ensureArrayTarget ($signal) {
  const segments = $signal[SEGMENTS]
  if (segments.length < 2) throw Error('Can\'t mutate array on a collection or root signal')
  if ($signal[IS_QUERY]) throw Error('Array mutators can\'t be used on a query signal')
  return segments
}

function ensureValueTarget ($signal) {
  const segments = $signal[SEGMENTS]
  if (segments.length < 2) throw Error('Can\'t mutate on a collection or root signal')
  if ($signal[IS_QUERY]) throw Error('Mutators can\'t be used on a query signal')
  return segments
}

async function arrayPushOnSignal ($signal, value) {
  const segments = ensureArrayTarget($signal)
  const idFields = getIdFieldsForSegments(segments)
  if (isIdFieldPath(segments, idFields)) return
  if (isPublicCollection(segments[0])) return _arrayPushPublic(segments, value)
  if (publicOnly) throw Error(ERRORS.publicOnly)
  return _arrayPush(segments, value)
}

async function arrayUnshiftOnSignal ($signal, value) {
  const segments = ensureArrayTarget($signal)
  const idFields = getIdFieldsForSegments(segments)
  if (isIdFieldPath(segments, idFields)) return
  if (isPublicCollection(segments[0])) return _arrayUnshiftPublic(segments, value)
  if (publicOnly) throw Error(ERRORS.publicOnly)
  return _arrayUnshift(segments, value)
}

async function arrayInsertOnSignal ($signal, index, values) {
  const segments = ensureArrayTarget($signal)
  const idFields = getIdFieldsForSegments(segments)
  if (isIdFieldPath(segments, idFields)) return
  if (isPublicCollection(segments[0])) return _arrayInsertPublic(segments, index, values)
  if (publicOnly) throw Error(ERRORS.publicOnly)
  return _arrayInsert(segments, index, values)
}

async function arrayPopOnSignal ($signal) {
  const segments = ensureArrayTarget($signal)
  const idFields = getIdFieldsForSegments(segments)
  if (isIdFieldPath(segments, idFields)) return
  if (isPublicCollection(segments[0])) return _arrayPopPublic(segments)
  if (publicOnly) throw Error(ERRORS.publicOnly)
  return _arrayPop(segments)
}

async function arrayShiftOnSignal ($signal) {
  const segments = ensureArrayTarget($signal)
  const idFields = getIdFieldsForSegments(segments)
  if (isIdFieldPath(segments, idFields)) return
  if (isPublicCollection(segments[0])) return _arrayShiftPublic(segments)
  if (publicOnly) throw Error(ERRORS.publicOnly)
  return _arrayShift(segments)
}

async function arrayRemoveOnSignal ($signal, index, howMany) {
  const segments = ensureArrayTarget($signal)
  const idFields = getIdFieldsForSegments(segments)
  if (isIdFieldPath(segments, idFields)) return
  if (isPublicCollection(segments[0])) return _arrayRemovePublic(segments, index, howMany)
  if (publicOnly) throw Error(ERRORS.publicOnly)
  return _arrayRemove(segments, index, howMany)
}

async function arrayMoveOnSignal ($signal, from, to, howMany) {
  const segments = ensureArrayTarget($signal)
  const idFields = getIdFieldsForSegments(segments)
  if (isIdFieldPath(segments, idFields)) return
  if (isPublicCollection(segments[0])) return _arrayMovePublic(segments, from, to, howMany)
  if (publicOnly) throw Error(ERRORS.publicOnly)
  return _arrayMove(segments, from, to, howMany)
}

async function stringInsertOnSignal ($signal, index, text) {
  const segments = ensureValueTarget($signal)
  const idFields = getIdFieldsForSegments(segments)
  if (isIdFieldPath(segments, idFields)) return
  if (isPublicCollection(segments[0])) return _stringInsertPublic(segments, index, text)
  if (publicOnly) throw Error(ERRORS.publicOnly)
  return _stringInsertLocal(segments, index, text)
}

async function stringRemoveOnSignal ($signal, index, howMany) {
  const segments = ensureValueTarget($signal)
  const idFields = getIdFieldsForSegments(segments)
  if (isIdFieldPath(segments, idFields)) return
  if (isPublicCollection(segments[0])) return _stringRemovePublic(segments, index, howMany)
  if (publicOnly) throw Error(ERRORS.publicOnly)
  return _stringRemoveLocal(segments, index, howMany)
}

function shallowCopy (value) {
  const rawValue = raw(value)
  if (Array.isArray(rawValue)) return rawValue.slice()
  if (rawValue && typeof rawValue === 'object') return { ...rawValue }
  return rawValue
}

function deepCopy (value) {
  const rawValue = raw(value)
  if (!rawValue || typeof rawValue !== 'object') return rawValue
  if (typeof globalThis.structuredClone === 'function') {
    try {
      return globalThis.structuredClone(rawValue)
    } catch {}
  }
  return racerDeepCopy(rawValue)
}

function normalizeQueryParams (collection, params) {
  if (params == null) {
    console.warn(`
      [Signal.query] Query is undefined. Got:
        ${collection}, ${params}
      Falling back to {_id: '__NON_EXISTENT__'} query to prevent critical crash.
      You should prevent situations when the \`query\` is undefined.
    `)
    return { _id: '__NON_EXISTENT__' }
  }
  if (Array.isArray(params)) {
    return { _id: { $in: params.slice() } }
  }
  if (typeof params === 'string' || typeof params === 'number') {
    return { _id: params }
  }
  if (typeof params !== 'object') {
    throw Error(`Signal.query() expects params to be an object, array, or id. Got: ${params}`)
  }
  return params
}

function isAggregationParams (params) {
  return Boolean(params?.$aggregate || params?.$aggregationName)
}

function withFetchOnly (fn) {
  const prevFetchOnly = fetchOnly
  setFetchOnly(true)
  try {
    return fn()
  } finally {
    setFetchOnly(prevFetchOnly)
  }
}

function subscribeMany (items, action) {
  const targets = flattenItems(items)
  const promises = []
  for (const target of targets) {
    if (!target) continue
    if (!(target instanceof Signal)) {
      throw Error(`Signal.${action}() accepts only Signal instances. Got: ${target}`)
    }
    const result = action === 'subscribe'
      ? subscribeSelf(target)
      : unsubscribeSelf(target)
    if (result?.then) promises.push(result)
  }
  if (promises.length) return Promise.all(promises)
}

function flattenItems (items, result = []) {
  for (const item of items) {
    if (!item) continue
    if (Array.isArray(item)) {
      flattenItems(item, result)
    } else {
      result.push(item)
    }
  }
  return result
}

function subscribeSelf ($signal) {
  if ($signal[IS_QUERY]) return querySubscriptions.subscribe($signal)
  if ($signal[IS_AGGREGATION]) return aggregationSubscriptions.subscribe($signal)
  if (isPublicDocumentSignal($signal)) return docSubscriptions.subscribe($signal)
  if (isPublicCollectionSignal($signal)) {
    throw Error('Signal.subscribe() expects a query signal. Use .query() for collections.')
  }
  if ($signal[SEGMENTS].length === 0) {
    throw Error('Signal.subscribe() cannot be called on the root signal')
  }
  throw Error('Signal.subscribe() expects a document or query signal')
}

function unsubscribeSelf ($signal) {
  if ($signal[IS_QUERY]) return querySubscriptions.unsubscribe($signal)
  if ($signal[IS_AGGREGATION]) return aggregationSubscriptions.unsubscribe($signal)
  if (isPublicDocumentSignal($signal)) return docSubscriptions.unsubscribe($signal)
  if (isPublicCollectionSignal($signal)) {
    throw Error('Signal.unsubscribe() expects a query signal. Use .query() for collections.')
  }
  if ($signal[SEGMENTS].length === 0) {
    throw Error('Signal.unsubscribe() cannot be called on the root signal')
  }
  throw Error('Signal.unsubscribe() expects a document or query signal')
}

// Racer-style deep copy:
// - Preserves prototypes by instantiating via `new value.constructor()`
// - Copies own enumerable props recursively
// - Keeps functions as-is (no cloning)
// - Handles Date by creating a new Date
// Limitations: does not handle cyclic refs, Map/Set/RegExp/TypedArray, non-enumerables.
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

const ERRORS = {
  publicOnly: `
    Can't modify private collections data when 'publicOnly' is enabled.
    On the server you can only work with public collections.
  `
}

export { SignalCompat }
export default SignalCompat
