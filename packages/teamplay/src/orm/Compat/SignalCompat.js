import { raw, observe, unobserve } from '@nx-js/observer-util'
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
import { getRoot, ROOT, ROOT_ID, getRootSignal, GLOBAL_ROOT_ID } from '../Root.ts'
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
import { on as onCustomEvent, removeListener as removeCustomEventListener } from './eventsCompat.js'
import { waitForImperativeQueryReady } from './queryReadiness.js'
import { isModelEventsEnabled } from './modelEvents.js'
import { setRefLink, removeRefLink, getAllRefLinks } from './refRegistry.js'
import { REF_TARGET, resolveRefSignalSafe, resolveRefSegmentsSafe } from './refFallback.js'
import { runInBatch } from '../batchScheduler.js'
import { runInModelEventsSilentContext, isSilentContextActive } from './silentContext.js'
import universal$ from '../../react/universal$.ts'
import { getRootContext } from '../rootContext.ts'
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
    const $target = resolveRefSignal(this)
    if ($target !== this) return $target.getId()
    return super.getId()
  }

  getCollection () {
    const $target = resolveRefSignal(this)
    if ($target !== this) return $target.getCollection()
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
    const $target = resolveRefSignal(this)
    if ($target !== this) return Signal.prototype.peek.apply($target, arguments)
    return Signal.prototype.peek.apply(this, arguments)
  }

  async set (value) {
    const forwarded = forwardRef(this, 'set', arguments)
    if (forwarded) return forwarded
    if (arguments.length > 1) throw Error('Signal.set() expects a single argument')
    if (value === undefined) return Signal.prototype.set.call(this, value)
    return setReplaceOnSignal(this, value)
  }

  async setReplace (value) {
    const forwarded = forwardRef(this, 'setReplace', arguments)
    if (forwarded) return forwarded
    if (arguments.length > 1) throw Error('Signal.setReplace() expects a single argument')
    if (value === undefined) return Signal.prototype.set.call(this, value)
    return setReplaceOnSignal(this, value)
  }

  async setNull (value) {
    const forwarded = forwardRef(this, 'setNull', arguments)
    if (forwarded) return forwarded
    if (arguments.length > 1) throw Error('Signal.setNull() expects a single argument')
    if (this.get() != null) return
    return setReplaceOnSignal(this, value)
  }

  async setDiffDeep (value) {
    const forwarded = forwardRef(this, 'setDiffDeep', arguments)
    if (forwarded) return forwarded
    if (arguments.length > 1) throw Error('Signal.setDiffDeep() expects a single argument')
    return runInBatch(() => setDiffDeepOnSignal(this, value))
  }

  async setDiff (value) {
    const forwarded = forwardRef(this, 'setDiff', arguments)
    if (forwarded) return forwarded
    if (arguments.length > 1) throw Error('Signal.setDiff() expects a single argument')
    const before = this.peek()
    if (racerEqualCompat(before, value)) return
    return setReplaceOnSignal(this, value)
  }

  async setEach (object) {
    const forwarded = forwardRef(this, 'setEach', arguments)
    if (forwarded) return forwarded
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
    const forwarded = forwardRef(this, 'del', arguments)
    if (forwarded) return forwarded
    if (arguments.length > 0) throw Error('Signal.del() does not accept any arguments')
    try {
      return await Signal.prototype.del.call(this)
    } catch (error) {
      if (isMissingPublicDocDeleteError(this, error)) return
      throw error
    }
  }

  async increment (byNumber) {
    const forwarded = forwardRef(this, 'increment', arguments)
    if (forwarded) return forwarded
    if (arguments.length > 1) throw Error('Signal.increment() expects zero or one argument')
    if (byNumber != null && (typeof byNumber !== 'number' || !Number.isFinite(byNumber))) {
      throw Error('Signal.increment() expects a numeric argument')
    }
    return incrementOnSignal(this, byNumber)
  }

  async push (value) {
    const forwarded = forwardRef(this, 'push', arguments)
    if (forwarded) return forwarded
    if (arguments.length > 1) throw Error('Signal.push() expects a single argument')
    return arrayPushOnSignal(this, value)
  }

  async unshift (value) {
    const forwarded = forwardRef(this, 'unshift', arguments)
    if (forwarded) return forwarded
    if (arguments.length > 1) throw Error('Signal.unshift() expects a single argument')
    return arrayUnshiftOnSignal(this, value)
  }

  async insert (index, values) {
    const forwarded = forwardRef(this, 'insert', arguments)
    if (forwarded) return forwarded
    if (arguments.length < 2) throw Error('Not enough arguments for insert')
    if (arguments.length > 2) throw Error('Signal.insert() expects two arguments')
    if (typeof index !== 'number' || !Number.isFinite(index)) {
      throw Error('Signal.insert() expects a numeric index')
    }
    return arrayInsertOnSignal(this, index, values)
  }

  async pop () {
    const forwarded = forwardRef(this, 'pop', arguments)
    if (forwarded) return forwarded
    if (arguments.length > 0) throw Error('Signal.pop() does not accept any arguments')
    return arrayPopOnSignal(this)
  }

  async shift () {
    const forwarded = forwardRef(this, 'shift', arguments)
    if (forwarded) return forwarded
    if (arguments.length > 0) throw Error('Signal.shift() does not accept any arguments')
    return arrayShiftOnSignal(this)
  }

  async remove (index, howMany) {
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
    if (arguments.length > 2) throw Error('Signal.remove() expects zero to two arguments')
    if (typeof index !== 'number' || !Number.isFinite(index)) {
      throw Error('Signal.remove() expects a numeric index')
    }
    return arrayRemoveOnSignal(this, index, howMany)
  }

  async move (from, to, howMany) {
    const forwarded = forwardRef(this, 'move', arguments)
    if (forwarded) return forwarded
    if (arguments.length < 2) throw Error('Not enough arguments for move')
    if (arguments.length > 3) throw Error('Signal.move() expects two or three arguments')
    if (typeof from !== 'number' || !Number.isFinite(from) || typeof to !== 'number' || !Number.isFinite(to)) {
      throw Error('Signal.move() expects numeric from/to')
    }
    return arrayMoveOnSignal(this, from, to, howMany)
  }

  async stringInsert (index, text) {
    const forwarded = forwardRef(this, 'stringInsert', arguments)
    if (forwarded) return forwarded
    if (arguments.length < 2) throw Error('Not enough arguments for stringInsert')
    if (arguments.length > 2) throw Error('Signal.stringInsert() expects two arguments')
    if (typeof index !== 'number' || !Number.isFinite(index)) {
      throw Error('Signal.stringInsert() expects a numeric index')
    }
    return stringInsertOnSignal(this, index, text)
  }

  async stringRemove (index, howMany) {
    const forwarded = forwardRef(this, 'stringRemove', arguments)
    if (forwarded) return forwarded
    if (arguments.length < 2) throw Error('Not enough arguments for stringRemove')
    if (arguments.length > 2) throw Error('Signal.stringRemove() expects two arguments')
    if (typeof index !== 'number' || !Number.isFinite(index)) {
      throw Error('Signal.stringRemove() expects a numeric index')
    }
    if (howMany == null) howMany = 1
    return stringRemoveOnSignal(this, index, howMany)
  }

  async assign (value) {
    const forwarded = forwardRef(this, 'assign', arguments)
    if (forwarded) return forwarded
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

  ref (path, target, options) {
    if (arguments.length < 1 || arguments.length > 2) throw Error('Signal.ref() expects one or two arguments')
    let $to
    if (arguments.length === 1) {
      $to = resolveRefTarget(this, path, 'Signal.ref()')
    } else {
      $to = resolveRefTarget(this, path, 'Signal.ref()')
      options = target
    }
    if (!$to) throw Error('Signal.ref() expects a target path or signal')
    if (this === $to) return this
    ensurePrivateRefSource(this, 'Signal.ref()')
    const store = getRefStore(this)
    const fromPath = this.path()
    const existing = store.get(fromPath)
    if (existing) existing.stop()
    const mirrorOnly = !!($to?.[IS_QUERY] || $to?.[IS_AGGREGATION])
    const { stop, onChange } = createRefLink(this, $to, { mirrorOnly, options })
    store.set(fromPath, { stop })
    const fromRootId = (getRoot(this) || this)?.[ROOT_ID]
    const toRootId = (getRoot($to) || $to)?.[ROOT_ID]
    if (!mirrorOnly) {
      this[REF_TARGET] = $to
      setRefLink(fromRootId, fromPath, $to.path(), this[SEGMENTS], $to[SEGMENTS], {
        mirrorOnly: false,
        fromRootId,
        toRootId
      })
    } else {
      setRefLink(fromRootId, fromPath, $to.path(), this[SEGMENTS], $to[SEGMENTS], {
        mirrorOnly: true,
        onChange,
        fromRootId,
        toRootId
      })
      if (this[REF_TARGET]) delete this[REF_TARGET]
    }
    return this
  }

  refExtra (path) {
    if (arguments.length !== 1) throw Error('Signal.refExtra() expects a single argument')
    const segments = parseAtSubpath(path, 1, 'Signal.refExtra()')
    const $root = getRoot(this) || this
    const $target = resolveSignal($root, segments)

    let $source = this
    if (this[IS_QUERY]) {
      $source = this.extra
    }

    return SignalCompat.prototype.ref.call($target, $source)
  }

  refIds (path) {
    if (arguments.length !== 1) throw Error('Signal.refIds() expects a single argument')
    if (!this[IS_QUERY]) {
      throw Error('Signal.refIds() can only be used on query signals')
    }
    const segments = parseAtSubpath(path, 1, 'Signal.refIds()')
    const $root = getRoot(this) || this
    const $target = resolveSignal($root, segments)
    return SignalCompat.prototype.ref.call($target, this.ids)
  }

  removeRef () {
    if (arguments.length > 0) throw Error('Signal.removeRef() does not accept any arguments')
    const store = getRefStore(this)
    const fromPath = this.path()
    const existing = store.get(fromPath)
    if (existing) {
      existing.stop()
      store.delete(fromPath)
    }
    const fromRootId = (getRoot(this) || this)?.[ROOT_ID]
    removeRefLink(fromRootId, fromPath)
    const $target = resolveRefSignal(this)
    if ($target !== this) {
      setDiffDeepBypassRef(this, deepCopy($target.get()))
    }
    if (this[REF_TARGET]) delete this[REF_TARGET]
  }
}

function getRefStore ($signal) {
  const $root = getRoot($signal) || $signal
  const rootId = $root?.[ROOT_ID]
  return getRootContext(rootId, true).activeRefs
}

function createRefLink ($from, $to, { mirrorOnly = false } = {}) {
  let disposed = false
  let pendingRead = null
  let mirrorObserver

  const syncFromTarget = () => {
    const value = readRefValue($to)
    if (isThenable(value)) {
      pendingRead = value
      value.then(() => {
        if (disposed || pendingRead !== value) return
        pendingRead = null
        syncFromTarget()
      }, () => {
        if (pendingRead === value) pendingRead = null
      })
      return
    }
    if (value === undefined) return
    setDiffDeepBypassRef($from, deepCopy(value))
  }

  syncFromTarget()
  if (mirrorOnly) {
    mirrorObserver = observe(
      () => {
        syncFromTarget()
        return readRefValue($to)
      },
      {
        scheduler: job => job()
      }
    )
    // initialize dependency graph
    mirrorObserver()
  }
  return {
    onChange: syncFromTarget,
    stop: () => {
      disposed = true
      if (mirrorObserver) unobserve(mirrorObserver)
      // Subsequent sync happens directly at mutation time via mirrorRefMutationFromTarget().
    }
  }
}

function readRefValue ($signal) {
  try {
    return $signal.get()
  } catch (err) {
    if (isThenable(err)) return err
    throw err
  }
}

function isAggregationValuePath (segments) {
  return Array.isArray(segments) &&
    segments.length >= 3 &&
    segments[0] === AGGREGATIONS
}

function resolveRefSignal ($signal) {
  const directTarget = resolveRefSignalSafe($signal)
  if (directTarget && directTarget !== $signal) return directTarget
  const resolvedSegments = resolveRefSegmentsSafe(
    $signal[SEGMENTS],
    (getRoot($signal) || $signal)?.[ROOT_ID]
  )
  if (!resolvedSegments) return $signal
  const $root = getRoot($signal) || $signal
  return resolveSignal($root, resolvedSegments)
}

function forwardRef ($signal, methodName, args) {
  const $target = resolveRefSignal($signal)
  if ($target === $signal) return null
  return SignalCompat.prototype[methodName].apply($target, args)
}

function setDiffDeepBypassRef ($signal, value) {
  const segments = $signal[SEGMENTS]
  if (isPublicCollection(segments[0])) return Signal.prototype.set.call($signal, value)
  return setReplacePrivateData(getOwningRootId($signal), segments, value)
}

function mirrorRefMutationFromTarget (targetSegments, value) {
  if (!Array.isArray(targetSegments) || targetSegments.length === 0) return
  const updates = []
  for (const link of getAllRefLinks()) {
    if (!isPathPrefix(link.toSegments, targetSegments)) continue
    const suffix = targetSegments.slice(link.toSegments.length)
    updates.push({
      fromRootId: link.fromRootId,
      segments: link.fromSegments.concat(suffix),
      value: deepCopy(value)
    })
  }
  if (!updates.length) return
  runInModelEventsSilentContext(() => {
    for (const update of updates) {
      const $root = getRootSignal({
        rootId: update.fromRootId || GLOBAL_ROOT_ID,
        rootFunction: universal$
      })
      const $target = resolveSignal($root, update.segments)
      setDiffDeepBypassRef($target, update.value)
    }
  })
}

function isPathPrefix (prefixSegments, fullSegments) {
  if (prefixSegments.length > fullSegments.length) return false
  for (let i = 0; i < prefixSegments.length; i++) {
    if (String(prefixSegments[i]) !== String(fullSegments[i])) return false
  }
  return true
}

function isSignalLike (value) {
  return value && typeof value.path === 'function' && typeof value.get === 'function'
}

function isReactLike (value) {
  return !!(value && typeof value === 'object' && typeof value.$$typeof === 'symbol')
}

function isThenable (value) {
  return !!value && typeof value.then === 'function'
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
  if (shouldMirrorPrivateRefMutationLocally()) {
    mirrorRefMutationFromTarget(segments, value)
  }
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
    const result = await _setPublicDocReplace(segments, value)
    if (shouldMirrorPublicRefMutationLocally(segments)) {
      mirrorRefMutationFromTarget(segments, value)
    }
    return result
  }
  const result = setReplacePrivateData(getOwningRootId($signal), segments, value)
  if (shouldMirrorPrivateRefMutationLocally()) {
    mirrorRefMutationFromTarget(segments, value)
  }
  return result
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

function ensurePrivateRefSource ($signal, methodName) {
  const segments = $signal?.[SEGMENTS]
  const collection = segments?.[0]
  if (typeof collection === 'string' && /^[_$]/.test(collection)) return
  throw Error(`${methodName} source path must be in a private collection`)
}

function shouldMirrorPublicRefMutationLocally (segments) {
  if (isSilentContextActive()) return true
  if (!Array.isArray(segments) || segments.length < 2) return true
  // Public doc ops emit compat model events only when there is an initialized
  // Doc runtime (subscribed/fetched). Without runtime we must mirror immediately.
  const transportHash = JSON.stringify([segments[0], segments[1]])
  return !docSubscriptions.hasRuntime(transportHash)
}

function shouldMirrorPrivateRefMutationLocally () {
  if (isSilentContextActive()) return true
  return !isModelEventsEnabled()
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
