import { raw } from '@nx-js/observer-util'
import arrayDiff from 'arraydiff'
import {
  Signal,
  GETTERS,
  DEFAULT_GETTERS,
  SEGMENTS,
  isPublicCollection,
  isPublicCollectionSignal,
  isPublicDocumentSignal
} from '../SignalBase.ts'
import { getRoot, ROOT, ROOT_ID } from '../Root.ts'
import { docSubscriptions } from '../Doc.js'
import { IS_QUERY, querySubscriptions } from '../Query.js'
import { AGGREGATIONS, IS_AGGREGATION, aggregationSubscriptions } from '../Aggregation.js'
import { getIdFieldsForSegments, isIdFieldPath, isPublicDocPath, normalizeIdFields, isPlainObject } from '../idFields.ts'
import {
  incrementPublic as _incrementPublic,
  arrayPushPublic as _arrayPushPublic,
  arrayUnshiftPublic as _arrayUnshiftPublic,
  arrayInsertPublic as _arrayInsertPublic,
  arrayPopPublic as _arrayPopPublic,
  arrayShiftPublic as _arrayShiftPublic,
  arrayRemovePublic as _arrayRemovePublic,
  arrayMovePublic as _arrayMovePublic,
  setPublicDocReplace as _setPublicDocReplace,
  stringInsertPublic as _stringInsertPublic,
  stringRemovePublic as _stringRemovePublic
} from '../dataTree.js'
import { on as onCustomEvent, removeListener as removeCustomEventListener } from '../events.js'
import { waitForImperativeQueryReady } from '../queryReadiness.js'
import { runInBatch } from '../batchScheduler.js'
import {
  arrayInsertPrivateData,
  arrayMovePrivateData,
  arrayPopPrivateData,
  arrayPushPrivateData,
  arrayRemovePrivateData,
  arrayShiftPrivateData,
  arrayUnshiftPrivateData,
  delPrivateData,
  setReplacePrivateData,
  stringInsertPrivateData,
  stringRemovePrivateData
} from '../privateData.js'

class SignalCompat extends Signal {
  static [GETTERS] = DEFAULT_GETTERS

  path () {
    if (arguments.length > 0) throw Error('Signal.path() does not accept any arguments')
    return super.path()
  }

  getId () {
    if (isAggregationValuePath(this[SEGMENTS])) return super.getId()
    return super.getId()
  }

  getCollection () {
    return super.getCollection()
  }

  getCopy () {
    if (arguments.length > 0) throw Error('Signal.getCopy() does not accept any arguments')
    return shallowCopy(this.get())
  }

  getDeepCopy () {
    if (arguments.length > 0) throw Error('Signal.getDeepCopy() does not accept any arguments')
    return deepCopy(this.get())
  }

  fetch (...items) {
    if (items.length > 0) return subscribeMany(items, 'subscribe', 'fetch', 'fetch')
    return subscribeSelf(this, 'fetch', 'fetch')
  }

  unfetch (...items) {
    if (items.length > 0) return subscribeMany(items, 'unsubscribe', 'fetch', 'unfetch')
    return unsubscribeSelf(this, 'fetch', 'unfetch')
  }

  getExtra () {
    if (arguments.length > 0) throw Error('Signal.getExtra() does not accept any arguments')
    if (this[IS_AGGREGATION]) return this.get()
    if (this[IS_QUERY]) return this.extra.get()
    return undefined
  }

  get () {
    if (arguments.length > 0) throw Error('Signal.get() does not accept any arguments')
    return Signal.prototype.get.apply(this, arguments)
  }

  peek () {
    if (arguments.length > 0) throw Error('Signal.peek() does not accept any arguments')
    return Signal.prototype.peek.apply(this, arguments)
  }

  async set (value) {
    if (arguments.length > 1) throw Error('Signal.set() expects a single argument')
    if (value === undefined) return Signal.prototype.set.call(this, value)
    return setReplaceOnSignal(this, value)
  }

  async setReplace (value) {
    if (arguments.length > 1) throw Error('Signal.setReplace() expects a single argument')
    if (value === undefined) return Signal.prototype.set.call(this, value)
    return setReplaceOnSignal(this, value)
  }

  async setNull (value) {
    if (arguments.length > 1) throw Error('Signal.setNull() expects a single argument')
    if (this.get() != null) return
    return setReplaceOnSignal(this, value)
  }

  async setDiffDeep (value) {
    if (arguments.length > 1) throw Error('Signal.setDiffDeep() expects a single argument')
    return runInBatch(() => setDiffDeepOnSignal(this, value))
  }

  async setDiff (value) {
    if (arguments.length > 1) throw Error('Signal.setDiff() expects a single argument')
    const before = this.peek()
    if (racerEqualCompat(before, value)) return
    return setReplaceOnSignal(this, value)
  }

  async setEach (object) {
    if (arguments.length > 1) throw Error('Signal.setEach() expects a single argument')
    if (!object) return
    if (typeof object !== 'object') {
      throw Error('Signal.setEach() expects an object argument, got: ' + typeof object)
    }
    return runInBatch(async () => {
      const promises = []
      for (const key of Object.keys(object)) {
        promises.push(SignalCompat.prototype.set.call(this[key], object[key]))
      }
      await Promise.all(promises)
    })
  }

  async del () {
    if (arguments.length > 0) throw Error('Signal.del() does not accept any arguments')
    try {
      return await Signal.prototype.del.call(this)
    } catch (error) {
      if (isMissingPublicDocDeleteError(this, error)) return
      throw error
    }
  }

  async increment (byNumber) {
    if (arguments.length > 1) throw Error('Signal.increment() expects zero or one argument')
    if (byNumber != null && (typeof byNumber !== 'number' || !Number.isFinite(byNumber))) {
      throw Error('Signal.increment() expects a numeric argument')
    }
    return incrementOnSignal(this, byNumber)
  }

  async push (value) {
    if (arguments.length > 1) throw Error('Signal.push() expects a single argument')
    return arrayPushOnSignal(this, value)
  }

  async unshift (value) {
    if (arguments.length > 1) throw Error('Signal.unshift() expects a single argument')
    return arrayUnshiftOnSignal(this, value)
  }

  async insert (index, values) {
    if (arguments.length < 2) throw Error('Not enough arguments for insert')
    if (arguments.length > 2) throw Error('Signal.insert() expects two arguments')
    if (typeof index !== 'number' || !Number.isFinite(index)) {
      throw Error('Signal.insert() expects a numeric index')
    }
    return arrayInsertOnSignal(this, index, values)
  }

  async pop () {
    if (arguments.length > 0) throw Error('Signal.pop() does not accept any arguments')
    return arrayPopOnSignal(this)
  }

  async shift () {
    if (arguments.length > 0) throw Error('Signal.shift() does not accept any arguments')
    return arrayShiftOnSignal(this)
  }

  async remove (index, howMany) {
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
    if (arguments.length > 2) throw Error('Signal.remove() expects zero to two arguments')
    if (typeof index !== 'number' || !Number.isFinite(index)) {
      throw Error('Signal.remove() expects a numeric index')
    }
    return arrayRemoveOnSignal(this, index, howMany)
  }

  async move (from, to, howMany) {
    if (arguments.length < 2) throw Error('Not enough arguments for move')
    if (arguments.length > 3) throw Error('Signal.move() expects two or three arguments')
    if (typeof from !== 'number' || !Number.isFinite(from) || typeof to !== 'number' || !Number.isFinite(to)) {
      throw Error('Signal.move() expects numeric from/to')
    }
    return arrayMoveOnSignal(this, from, to, howMany)
  }

  async stringInsert (index, text) {
    if (arguments.length < 2) throw Error('Not enough arguments for stringInsert')
    if (arguments.length > 2) throw Error('Signal.stringInsert() expects two arguments')
    if (typeof index !== 'number' || !Number.isFinite(index)) {
      throw Error('Signal.stringInsert() expects a numeric index')
    }
    return stringInsertOnSignal(this, index, text)
  }

  async stringRemove (index, howMany) {
    if (arguments.length < 2) throw Error('Not enough arguments for stringRemove')
    if (arguments.length > 2) throw Error('Signal.stringRemove() expects two arguments')
    if (typeof index !== 'number' || !Number.isFinite(index)) {
      throw Error('Signal.stringRemove() expects a numeric index')
    }
    if (howMany == null) howMany = 1
    return stringRemoveOnSignal(this, index, howMany)
  }

  async assign (value) {
    if (arguments.length > 1) throw Error('Signal.assign() expects a single argument')
    return Signal.prototype.assign.call(this, value)
  }

  on (eventName, pattern, handler) {
    if (arguments.length < 2) throw Error('Signal.on() expects at least two arguments')
    if ((eventName === 'change' || eventName === 'all') && typeof pattern !== 'function') {
      throw Error('Signal model events are not supported. Use reaction() for signal changes.')
    }
    if (typeof pattern !== 'function') throw Error('Signal.on() expects a handler function')
    return onCustomEvent(eventName, pattern)
  }

  once (eventName, pattern, handler) {
    if (arguments.length < 2) throw Error('Signal.once() expects at least two arguments')
    if ((eventName === 'change' || eventName === 'all') && typeof pattern !== 'function') {
      throw Error('Signal model events are not supported. Use reaction() for signal changes.')
    }
    if (typeof pattern !== 'function') throw Error('Signal.once() expects a handler function')
    const onceHandler = (...args) => {
      this.removeListener(eventName, onceHandler)
      pattern(...args)
    }
    this.on(eventName, onceHandler)
    return onceHandler
  }

  removeListener (eventName, handler) {
    if (arguments.length !== 2) throw Error('Signal.removeListener() expects two arguments')
    return removeCustomEventListener(eventName, handler)
  }
}

function isAggregationValuePath (segments) {
  return Array.isArray(segments) &&
    segments.length >= 3 &&
    segments[0] === AGGREGATIONS
}

function isReactLike (value) {
  return !!(value && typeof value === 'object' && typeof value.$$typeof === 'symbol')
}

function resolveSignal ($signal, segments) {
  let $cursor = $signal
  for (const segment of segments) {
    $cursor = $cursor[segment]
  }
  return $cursor
}

function isMissingPublicDocDeleteError ($signal, error) {
  const segments = $signal?.[SEGMENTS]
  if (!Array.isArray(segments) || segments.length < 2) return false
  if (!isPublicCollection(segments[0])) return false
  if (!(error instanceof Error)) return false
  return error.message.includes('Trying to delete data from a non-existing doc')
}

async function setDiffDeepOnSignal ($target, value) {
  if ($target[SEGMENTS].length === 0) throw Error('Can\'t set the root signal data')
  // Use peek() here. compat start() writes via setDiffDeep inside an observer and must not
  // subscribe to its own target, otherwise later local edits on child signals cause start()
  // to rerun and overwrite them from source.
  const before = $target.peek()
  if (isPublicCollection($target[SEGMENTS][0])) {
    await diffDeepCompat($target, before, value)
    return
  }
  diffDeepCompatSync($target, before, value)
}

async function diffDeepCompat ($signal, before, after) {
  if (before === after) return

  if (Array.isArray(before) && Array.isArray(after)) {
    const diff = arrayDiff(before, after, deepEqualCompat)
    if (!diff.length) return
    const index = getSingleArrayReplacementIndex(diff)
    if (index != null) {
      await diffDeepCompat(getChildSignal($signal, index), before[index], after[index])
      return
    }
    await applyArrayDiffCompat($signal, diff)
    return
  }

  if (isDiffableObject(before, after)) {
    for (const key of Object.keys(before)) {
      if (Object.prototype.hasOwnProperty.call(after, key)) continue
      await SignalCompat.prototype.del.call(getChildSignal($signal, key))
    }
    for (const key of Object.keys(after)) {
      await diffDeepCompat(getChildSignal($signal, key), before[key], after[key])
    }
    return
  }

  await SignalCompat.prototype.set.call($signal, after)
}

function diffDeepCompatSync ($signal, before, after) {
  if (before === after) return

  if (Array.isArray(before) && Array.isArray(after)) {
    const diff = arrayDiff(before, after, deepEqualCompat)
    if (!diff.length) return
    const index = getSingleArrayReplacementIndex(diff)
    if (index != null) {
      diffDeepCompatSync(getChildSignal($signal, index), before[index], after[index])
      return
    }
    applyArrayDiffCompatSync($signal, diff)
    return
  }

  if (isDiffableObject(before, after)) {
    const preservePath = $signal[SEGMENTS]
    for (const key of Object.keys(before)) {
      if (Object.prototype.hasOwnProperty.call(after, key)) continue
      delPrivateCompatSync(getChildSignal($signal, key), { preservePath })
    }
    for (const key of Object.keys(after)) {
      diffDeepCompatSync(getChildSignal($signal, key), before[key], after[key])
    }
    return
  }

  setReplacePrivateCompatSync($signal, after)
}

function isDiffableObject (before, after) {
  if (!isPlainObject(before) || !isPlainObject(after)) return false
  if (isReactLike(before) || isReactLike(after)) return false
  return true
}

function getSingleArrayReplacementIndex (diff) {
  if (!Array.isArray(diff) || diff.length !== 2) return null
  const first = diff[0]
  const second = diff[1]
  if (
    first instanceof arrayDiff.RemoveDiff &&
    second instanceof arrayDiff.InsertDiff &&
    first.index === second.index &&
    first.howMany === 1 &&
    second.values.length === 1
  ) {
    return first.index
  }
  return null
}

async function applyArrayDiffCompat ($signal, diff) {
  for (const item of diff) {
    if (item instanceof arrayDiff.InsertDiff) {
      await arrayInsertOnSignal($signal, item.index, item.values)
      continue
    }
    if (item instanceof arrayDiff.RemoveDiff) {
      await arrayRemoveOnSignal($signal, item.index, item.howMany)
      continue
    }
    if (item instanceof arrayDiff.MoveDiff) {
      await arrayMoveOnSignal($signal, item.from, item.to, item.howMany)
    }
  }
}

function applyArrayDiffCompatSync ($signal, diff) {
  const segments = ensureArrayTarget($signal)
  const rootId = getOwningRootId($signal)
  for (const item of diff) {
    if (item instanceof arrayDiff.InsertDiff) {
      arrayInsertPrivateData(rootId, segments, item.index, item.values)
      continue
    }
    if (item instanceof arrayDiff.RemoveDiff) {
      arrayRemovePrivateData(rootId, segments, item.index, item.howMany)
      continue
    }
    if (item instanceof arrayDiff.MoveDiff) {
      arrayMovePrivateData(rootId, segments, item.from, item.to, item.howMany)
    }
  }
}

function getChildSignal ($parent, key) {
  const $child = new SignalCompat([...$parent[SEGMENTS], key])
  const $root = getRoot($parent)
  if ($root) $child[ROOT] = $root
  return $child
}

function setReplacePrivateCompatSync ($signal, value) {
  const segments = $signal[SEGMENTS]
  if (segments.length === 0) throw Error('Can\'t set the root signal data')
  const idFields = getIdFieldsForSegments(segments)
  if (isIdFieldPath(segments, idFields)) return
  if (isPublicDocPath(segments)) {
    value = normalizeIdFields(value, idFields, segments[1])
  }
  setReplacePrivateData(getOwningRootId($signal), segments, value)
}

function delPrivateCompatSync ($signal, options) {
  const segments = $signal[SEGMENTS]
  if (segments.length === 0) throw Error('Can\'t delete the root signal data')
  const idFields = getIdFieldsForSegments(segments)
  if (isIdFieldPath(segments, idFields)) return
  delPrivateData(getOwningRootId($signal), segments, options)
}

function deepEqualCompat (left, right) {
  if (left === right) return true
  if (left == null || right == null) return false
  if (typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) !== Array.isArray(right)) return false

  if (Array.isArray(left)) {
    if (left.length !== right.length) return false
    for (let i = 0; i < left.length; i++) {
      if (!deepEqualCompat(left[i], right[i])) return false
    }
    return true
  }

  if (!isPlainObject(left) || !isPlainObject(right)) return false
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false
    if (!deepEqualCompat(left[key], right[key])) return false
  }
  return true
}

function racerEqualCompat (left, right) {
  return left === right || (Number.isNaN(left) && Number.isNaN(right))
}

async function setReplaceOnSignal ($signal, value) {
  const segments = $signal[SEGMENTS]
  if (segments.length === 0) throw Error('Can\'t set the root signal data')
  const idFields = getIdFieldsForSegments(segments)
  if (isIdFieldPath(segments, idFields)) return
  if (isPublicDocPath(segments)) {
    value = normalizeIdFields(value, idFields, segments[1])
  }
  if (isPublicCollection(segments[0])) {
    return _setPublicDocReplace(segments, value)
  }
  return setReplacePrivateData(getOwningRootId($signal), segments, value)
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
  setReplacePrivateData(getOwningRootId($signal), segments, currentValue + byNumber)
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
  return arrayPushPrivateData(getOwningRootId($signal), segments, value)
}

async function arrayUnshiftOnSignal ($signal, value) {
  const segments = ensureArrayTarget($signal)
  const idFields = getIdFieldsForSegments(segments)
  if (isIdFieldPath(segments, idFields)) return
  if (isPublicCollection(segments[0])) return _arrayUnshiftPublic(segments, value)
  return arrayUnshiftPrivateData(getOwningRootId($signal), segments, value)
}

async function arrayInsertOnSignal ($signal, index, values) {
  const segments = ensureArrayTarget($signal)
  const idFields = getIdFieldsForSegments(segments)
  if (isIdFieldPath(segments, idFields)) return
  if (isPublicCollection(segments[0])) return _arrayInsertPublic(segments, index, values)
  return arrayInsertPrivateData(getOwningRootId($signal), segments, index, values)
}

async function arrayPopOnSignal ($signal) {
  const segments = ensureArrayTarget($signal)
  const idFields = getIdFieldsForSegments(segments)
  if (isIdFieldPath(segments, idFields)) return
  if (isPublicCollection(segments[0])) return _arrayPopPublic(segments)
  return arrayPopPrivateData(getOwningRootId($signal), segments)
}

async function arrayShiftOnSignal ($signal) {
  const segments = ensureArrayTarget($signal)
  const idFields = getIdFieldsForSegments(segments)
  if (isIdFieldPath(segments, idFields)) return
  if (isPublicCollection(segments[0])) return _arrayShiftPublic(segments)
  return arrayShiftPrivateData(getOwningRootId($signal), segments)
}

async function arrayRemoveOnSignal ($signal, index, howMany) {
  const segments = ensureArrayTarget($signal)
  const idFields = getIdFieldsForSegments(segments)
  if (isIdFieldPath(segments, idFields)) return
  if (isPublicCollection(segments[0])) return _arrayRemovePublic(segments, index, howMany)
  return arrayRemovePrivateData(getOwningRootId($signal), segments, index, howMany)
}

async function arrayMoveOnSignal ($signal, from, to, howMany) {
  const segments = ensureArrayTarget($signal)
  const idFields = getIdFieldsForSegments(segments)
  if (isIdFieldPath(segments, idFields)) return
  if (isPublicCollection(segments[0])) return _arrayMovePublic(segments, from, to, howMany)
  return arrayMovePrivateData(getOwningRootId($signal), segments, from, to, howMany)
}

async function stringInsertOnSignal ($signal, index, text) {
  const segments = ensureValueTarget($signal)
  const idFields = getIdFieldsForSegments(segments)
  if (isIdFieldPath(segments, idFields)) return
  if (isPublicCollection(segments[0])) return _stringInsertPublic(segments, index, text)
  return stringInsertPrivateData(getOwningRootId($signal), segments, index, text)
}

async function stringRemoveOnSignal ($signal, index, howMany) {
  const segments = ensureValueTarget($signal)
  const idFields = getIdFieldsForSegments(segments)
  if (isIdFieldPath(segments, idFields)) return
  if (isPublicCollection(segments[0])) return _stringRemovePublic(segments, index, howMany)
  return stringRemovePrivateData(getOwningRootId($signal), segments, index, howMany)
}

function getOwningRootId ($signal) {
  const $root = getRoot($signal) || $signal
  return $root?.[ROOT_ID]
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

function subscribeMany (items, action, intent = 'subscribe', methodName = action) {
  const targets = flattenItems(items)
  const promises = []
  for (const target of targets) {
    if (!target) continue
    if (!(target instanceof Signal)) {
      throw Error(`Signal.${methodName}() accepts only Signal instances. Got: ${target}`)
    }
    const result = action === 'subscribe'
      ? subscribeSelf(target, intent, methodName)
      : unsubscribeSelf(target, intent, methodName)
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

function subscribeSelf ($signal, intent = 'subscribe', methodName = 'subscribe') {
  if ($signal[IS_QUERY]) {
    return (async () => {
      await querySubscriptions.subscribe($signal, { intent })
      await waitForImperativeQueryReady($signal)
    })()
  }
  if ($signal[IS_AGGREGATION]) {
    return (async () => {
      await aggregationSubscriptions.subscribe($signal, { intent })
      await waitForImperativeQueryReady($signal)
    })()
  }
  if (isPublicDocumentSignal($signal)) return docSubscriptions.subscribe($signal, { intent })
  if (isPublicCollectionSignal($signal)) {
    throw Error(`Signal.${methodName}() expects a document or query signal. Use sub($collection, params, { mode: 'fetch' }) for collection fetches.`)
  }
  if ($signal[SEGMENTS].length === 0) {
    throw Error(`Signal.${methodName}() cannot be called on the root signal`)
  }
  throw Error(`Signal.${methodName}() expects a document or query signal`)
}

function unsubscribeSelf ($signal, intent = 'subscribe', methodName = 'unsubscribe') {
  if ($signal[IS_QUERY]) return querySubscriptions.unsubscribe($signal, { intent })
  if ($signal[IS_AGGREGATION]) return aggregationSubscriptions.unsubscribe($signal, { intent })
  if (isPublicDocumentSignal($signal)) return docSubscriptions.unsubscribe($signal, { intent })
  if (isPublicCollectionSignal($signal)) {
    throw Error(`Signal.${methodName}() expects a document or query signal`)
  }
  if ($signal[SEGMENTS].length === 0) {
    throw Error(`Signal.${methodName}() cannot be called on the root signal`)
  }
  throw Error(`Signal.${methodName}() expects a document or query signal`)
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

export { SignalCompat }
export default SignalCompat
