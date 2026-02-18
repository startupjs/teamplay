import { raw } from '@nx-js/observer-util'
import { Signal, GETTERS, DEFAULT_GETTERS, SEGMENTS, isPublicCollection } from './SignalBase.js'
import { getRoot } from './Root.js'
import { publicOnly } from './connection.js'
import { IS_QUERY } from './Query.js'
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
} from './dataTree.js'

class SignalCompat extends Signal {
  static [GETTERS] = [...DEFAULT_GETTERS, 'getCopy', 'getDeepCopy']

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

  async set (path, value) {
    if (arguments.length > 2) throw Error('Signal.set() expects one or two arguments')
    let segments = []
    if (arguments.length === 2) {
      segments = parseAtSubpath(path, 1, 'Signal.set()')
    } else if (arguments.length === 1) {
      value = path
    }
    const $target = resolveSignal(this, segments)
    return setReplaceOnSignal($target, value)
  }

  async setNull (path, value) {
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

  async setEach (path, object) {
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
    if (arguments.length > 1) throw Error('Signal.del() expects a single argument')
    const segments = parseAtSubpath(path, arguments.length, 'Signal.del()')
    const $target = resolveSignal(this, segments)
    return Signal.prototype.del.call($target)
  }

  async increment (path, byNumber) {
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
    if (arguments.length > 1) throw Error('Signal.pop() expects a single argument')
    const segments = parseAtSubpath(path, arguments.length, 'Signal.pop()')
    const $target = resolveSignal(this, segments)
    return arrayPopOnSignal($target)
  }

  async shift (path) {
    if (arguments.length > 1) throw Error('Signal.shift() expects a single argument')
    const segments = parseAtSubpath(path, arguments.length, 'Signal.shift()')
    const $target = resolveSignal(this, segments)
    return arrayShiftOnSignal($target)
  }

  async remove (path, index, howMany) {
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
  if (isPublicCollection(segments[0])) {
    return _setPublicDocReplace(segments, value)
  }
  if (publicOnly) throw Error(ERRORS.publicOnly)
  return _setReplace(segments, value)
}

async function incrementOnSignal ($signal, byNumber) {
  const segments = $signal[SEGMENTS]
  if (segments.length === 0) throw Error('Can\'t increment the root signal data')
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
  if (isPublicCollection(segments[0])) return _arrayPushPublic(segments, value)
  if (publicOnly) throw Error(ERRORS.publicOnly)
  return _arrayPush(segments, value)
}

async function arrayUnshiftOnSignal ($signal, value) {
  const segments = ensureArrayTarget($signal)
  if (isPublicCollection(segments[0])) return _arrayUnshiftPublic(segments, value)
  if (publicOnly) throw Error(ERRORS.publicOnly)
  return _arrayUnshift(segments, value)
}

async function arrayInsertOnSignal ($signal, index, values) {
  const segments = ensureArrayTarget($signal)
  if (isPublicCollection(segments[0])) return _arrayInsertPublic(segments, index, values)
  if (publicOnly) throw Error(ERRORS.publicOnly)
  return _arrayInsert(segments, index, values)
}

async function arrayPopOnSignal ($signal) {
  const segments = ensureArrayTarget($signal)
  if (isPublicCollection(segments[0])) return _arrayPopPublic(segments)
  if (publicOnly) throw Error(ERRORS.publicOnly)
  return _arrayPop(segments)
}

async function arrayShiftOnSignal ($signal) {
  const segments = ensureArrayTarget($signal)
  if (isPublicCollection(segments[0])) return _arrayShiftPublic(segments)
  if (publicOnly) throw Error(ERRORS.publicOnly)
  return _arrayShift(segments)
}

async function arrayRemoveOnSignal ($signal, index, howMany) {
  const segments = ensureArrayTarget($signal)
  if (isPublicCollection(segments[0])) return _arrayRemovePublic(segments, index, howMany)
  if (publicOnly) throw Error(ERRORS.publicOnly)
  return _arrayRemove(segments, index, howMany)
}

async function arrayMoveOnSignal ($signal, from, to, howMany) {
  const segments = ensureArrayTarget($signal)
  if (isPublicCollection(segments[0])) return _arrayMovePublic(segments, from, to, howMany)
  if (publicOnly) throw Error(ERRORS.publicOnly)
  return _arrayMove(segments, from, to, howMany)
}

async function stringInsertOnSignal ($signal, index, text) {
  const segments = ensureValueTarget($signal)
  if (isPublicCollection(segments[0])) return _stringInsertPublic(segments, index, text)
  if (publicOnly) throw Error(ERRORS.publicOnly)
  return _stringInsertLocal(segments, index, text)
}

async function stringRemoveOnSignal ($signal, index, howMany) {
  const segments = ensureValueTarget($signal)
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
  return JSON.parse(JSON.stringify(rawValue))
}

const ERRORS = {
  publicOnly: `
    Can't modify private collections data when 'publicOnly' is enabled.
    On the server you can only work with public collections.
  `
}

export { SignalCompat }
export default SignalCompat
