/**
 * Implementation of the BaseSignal class which is used as a base class for all signals
 * and can be extended to create custom models for a particular path pattern of the data tree.
 *
 * All signals in the app should be created using getSignal() function which automatically
 * determines the correct model for the given path pattern and wraps the signal object in a Proxy.
 *
 * Proxy is used for the following reasons:
 * 1. To allow accessing child signals using dot syntax
 * 2. To be able to call the top-level signal as a `$()` function
 * 3. If extremely late bindings are enabled, to prevent name collisions when accessing fields
 *    in the raw data tree which have the same name as signal's methods
 */
import uuid from '@teamplay/utils/uuid'
import {
  get as _get,
  set as _set,
  setReplace as _setReplace,
  del as _del,
  setPublicDoc as _setPublicDoc,
  getRaw,
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
import getSignal, { rawSignal } from './getSignal.js'
import { docSubscriptions } from './Doc.js'
import { IS_QUERY, HASH, QUERIES } from './Query.js'
import { AGGREGATIONS, IS_AGGREGATION, getAggregationCollectionName, getAggregationDocId } from './Aggregation.js'
import { ROOT_FUNCTION, getRoot } from './Root.js'
import { publicOnly } from './connection.js'
import { DEFAULT_ID_FIELDS, getIdFieldsForSegments, isIdFieldPath, normalizeIdFields } from './idFields.js'

export const SEGMENTS = Symbol('path segments targeting the particular node in the data tree')
export const ARRAY_METHOD = Symbol('run array method on the signal')
export const GET = Symbol('get the value of the signal - either observed or raw')
export const GETTERS = Symbol('get the list of this signal\'s getters')
export const DEFAULT_GETTERS = ['path', 'id', 'get', 'peek', 'getId', 'map', 'reduce', 'find', 'getIds', 'getExtra', 'getCollection']

export class Signal extends Function {
  static ID_FIELDS = DEFAULT_ID_FIELDS
  static [GETTERS] = DEFAULT_GETTERS

  constructor (segments) {
    if (!Array.isArray(segments)) throw Error('Signal constructor expects an array of segments')
    super()
    this[SEGMENTS] = segments
  }

  path () {
    if (arguments.length > 0) throw Error('Signal.path() does not accept any arguments')
    return this[SEGMENTS].join('.')
  }

  leaf () {
    if (arguments.length > 0) throw Error('Signal.leaf() does not accept any arguments')
    const segments = this[SEGMENTS]
    if (segments.length === 0) return ''
    return String(segments[segments.length - 1])
  }

  parent (levels = 1) {
    if (arguments.length > 1) throw Error('Signal.parent() expects a single argument')
    if (arguments.length === 0) levels = 1
    if (typeof levels !== 'number' || !Number.isFinite(levels) || !Number.isInteger(levels)) {
      throw Error('Signal.parent() expects an integer argument')
    }
    if (levels < 1) throw Error('Signal.parent() expects a positive integer')
    const $root = getRoot(this) || this
    const segments = this[SEGMENTS]
    if (segments.length === 0) return $root
    const targetLength = Math.max(0, segments.length - levels)
    if (targetLength === 0) return $root
    let $cursor = $root
    for (let i = 0; i < targetLength; i++) {
      $cursor = $cursor[segments[i]]
    }
    return $cursor
  }

  id () {
    return uuid()
  }

  batch (fn) {
    if (arguments.length > 1) throw Error('Signal.batch() expects a single argument')
    if (fn == null) return
    if (typeof fn !== 'function') throw Error('Signal.batch() expects a function argument')
    return fn()
  }

  [GET] (method) {
    if (arguments.length > 1) throw Error('Signal[GET]() only accepts method as an argument')
    if (this[IS_QUERY]) {
      const hash = this[HASH]
      return method([QUERIES, hash, 'docs'])
    }
    return method(this[SEGMENTS])
  }

  get () {
    if (arguments.length > 0) throw Error('Signal.get() does not accept any arguments')
    if (this[SEGMENTS].length === 3 && this[SEGMENTS][0] === QUERIES && this[SEGMENTS][2] === 'ids') {
      // TODO: This should never happen, but in reality it happens sometimes
      // Patch getting query ids because sometimes for some reason we are not getting them
      const ids = this[GET](_get)
      if (!Array.isArray(ids)) {
        console.warn('Signal.get() on Query didn\'t find ids', this[SEGMENTS])
        return []
      }
      return ids
    }
    if (this[SEGMENTS].length === 3 && this[SEGMENTS][0] === QUERIES && this[SEGMENTS][2] === 'extra') {
      return this[GET](_get)
    }
    return this[GET](_get)
  }

  getIds () {
    if (arguments.length > 0) throw Error('Signal.getIds() does not accept any arguments')
    if (this[IS_QUERY]) {
      const ids = _get([QUERIES, this[HASH], 'ids'])
      if (!Array.isArray(ids)) {
        // TODO: This should never happen, but in reality it happens sometimes
        console.warn('Signal.getIds() on Query didn\'t find ids', [QUERIES, this[HASH], 'ids'])
        return []
      }
      return ids
    } else if (this[IS_AGGREGATION]) {
      const docs = _get(this[SEGMENTS])
      if (!Array.isArray(docs)) return []
      return docs.map(doc => doc._id || doc.id)
    } else {
      // TODO: this should throw an error in the future
      console.error(
        'Signal.getIds() can only be used on query signals or aggregation signals. ' +
        'Received a regular signal: ' + JSON.stringify(this[SEGMENTS])
      )
      return []
    }
  }

  peek () {
    if (arguments.length > 0) throw Error('Signal.peek() does not accept any arguments')
    return this[GET](getRaw)
  }

  getId () {
    if (this[SEGMENTS].length === 0) throw Error('Can\'t get the id of the root signal')
    if (this[SEGMENTS].length === 1) throw Error('Can\'t get the id of a collection')
    if (this[SEGMENTS][0] === AGGREGATIONS && this[SEGMENTS].length === 3) {
      // use get() instead of the default getRaw() to trigger observability on changes
      // This is required since within aggregation array results docs can change their position
      return getAggregationDocId(this[SEGMENTS], _get)
    }
    return this[SEGMENTS][this[SEGMENTS].length - 1]
  }

  getCollection () {
    if (this[SEGMENTS].length === 0) throw Error('Can\'t get the collection of the root signal')
    if (this[SEGMENTS][0] === AGGREGATIONS) {
      return getAggregationCollectionName(this[SEGMENTS])
    }
    return this[SEGMENTS][0]
  }

  * [Symbol.iterator] () {
    if (this[IS_QUERY]) {
      const ids = _get([QUERIES, this[HASH], 'ids'])
      if (!Array.isArray(ids)) {
        // TODO: This should never happen, but in reality it happens sometimes
        console.warn('Signal iterator on Query didn\'t find ids', [QUERIES, this[HASH], 'ids'])
        return
      }
      for (const id of ids) yield getSignal(getRoot(this), [this[SEGMENTS][0], id])
    } else {
      const items = _get(this[SEGMENTS])
      if (!Array.isArray(items)) return
      for (let i = 0; i < items.length; i++) yield getSignal(getRoot(this), [...this[SEGMENTS], i])
    }
  }

  [ARRAY_METHOD] (method, nonArrayReturnValue, ...args) {
    if (this[IS_QUERY]) {
      const collection = this[SEGMENTS][0]
      const hash = this[HASH]
      const ids = _get([QUERIES, hash, 'ids'])
      if (!Array.isArray(ids)) {
        // TODO: This should never happen, but in reality it happens sometimes
        console.warn('Signal array method on Query didn\'t find ids', [QUERIES, hash, 'ids'], method)
        return nonArrayReturnValue
      }
      return ids.map(
        id => getSignal(getRoot(this), [collection, id])
      )[method](...args)
    }
    const items = _get(this[SEGMENTS])
    if (!Array.isArray(items)) return nonArrayReturnValue
    return Array(items.length).fill().map(
      (_, index) => getSignal(getRoot(this), [...this[SEGMENTS], index])
    )[method](...args)
  }

  map (...args) {
    return this[ARRAY_METHOD]('map', [], ...args)
  }

  reduce (...args) {
    return this[ARRAY_METHOD]('reduce', undefined, ...args)
  }

  find (...args) {
    return this[ARRAY_METHOD]('find', undefined, ...args)
  }

  async set (value) {
    if (arguments.length > 1) throw Error('Signal.set() expects a single argument')
    if (this[SEGMENTS].length === 0) throw Error('Can\'t set the root signal data')
    const idFields = getIdFieldsForSegments(this[SEGMENTS])
    if (isIdFieldPath(this[SEGMENTS], idFields)) return
    if (this[SEGMENTS].length === 2) {
      value = normalizeIdFields(value, idFields, this[SEGMENTS][1])
    }
    if (isPublicCollection(this[SEGMENTS][0])) {
      await _setPublicDoc(this[SEGMENTS], value)
    } else {
      if (publicOnly) throw Error(ERRORS.publicOnly)
      _set(this[SEGMENTS], value)
    }
  }

  async assign (value) {
    if (arguments.length > 1) throw Error('Signal.assign() expects a single argument')
    if (this[SEGMENTS].length === 0) throw Error('Can\'t assign to the root signal data')
    if (!value) return
    if (typeof value !== 'object') throw Error('Signal.assign() expects an object argument, got: ' + typeof value)
    const promises = []
    // use Object.keys() to avoid setting inherited properties
    for (const key of Object.keys(value)) {
      let promise
      if (value[key] != null) {
        promise = this[key].set(value[key])
      } else {
        promise = this[key].del()
      }
      promises.push(promise)
    }
    await Promise.all(promises)
  }

  async push (value) {
    if (arguments.length > 1) throw Error('Signal.push() expects a single argument')
    const segments = ensureArrayTarget(this)
    const idFields = getIdFieldsForSegments(segments)
    if (isIdFieldPath(segments, idFields)) return
    if (isPublicCollection(segments[0])) return _arrayPushPublic(segments, value)
    if (publicOnly) throw Error(ERRORS.publicOnly)
    return _arrayPush(segments, value)
  }

  async pop () {
    if (arguments.length > 0) throw Error('Signal.pop() does not accept any arguments')
    const segments = ensureArrayTarget(this)
    const idFields = getIdFieldsForSegments(segments)
    if (isIdFieldPath(segments, idFields)) return
    if (isPublicCollection(segments[0])) return _arrayPopPublic(segments)
    if (publicOnly) throw Error(ERRORS.publicOnly)
    return _arrayPop(segments)
  }

  async unshift (value) {
    if (arguments.length > 1) throw Error('Signal.unshift() expects a single argument')
    const segments = ensureArrayTarget(this)
    const idFields = getIdFieldsForSegments(segments)
    if (isIdFieldPath(segments, idFields)) return
    if (isPublicCollection(segments[0])) return _arrayUnshiftPublic(segments, value)
    if (publicOnly) throw Error(ERRORS.publicOnly)
    return _arrayUnshift(segments, value)
  }

  async shift () {
    if (arguments.length > 0) throw Error('Signal.shift() does not accept any arguments')
    const segments = ensureArrayTarget(this)
    const idFields = getIdFieldsForSegments(segments)
    if (isIdFieldPath(segments, idFields)) return
    if (isPublicCollection(segments[0])) return _arrayShiftPublic(segments)
    if (publicOnly) throw Error(ERRORS.publicOnly)
    return _arrayShift(segments)
  }

  async insert (index, values) {
    if (arguments.length < 2) throw Error('Not enough arguments for insert')
    if (arguments.length > 2) throw Error('Signal.insert() expects two arguments')
    if (typeof index !== 'number' || !Number.isFinite(index)) {
      throw Error('Signal.insert() expects a numeric index')
    }
    const segments = ensureArrayTarget(this)
    const idFields = getIdFieldsForSegments(segments)
    if (isIdFieldPath(segments, idFields)) return
    if (isPublicCollection(segments[0])) return _arrayInsertPublic(segments, index, values)
    if (publicOnly) throw Error(ERRORS.publicOnly)
    return _arrayInsert(segments, index, values)
  }

  async remove (index, howMany = 1) {
    if (arguments.length < 1) throw Error('Not enough arguments for remove')
    if (arguments.length > 2) throw Error('Signal.remove() expects one or two arguments')
    if (typeof index !== 'number' || !Number.isFinite(index)) {
      throw Error('Signal.remove() expects a numeric index')
    }
    const segments = ensureArrayTarget(this)
    const idFields = getIdFieldsForSegments(segments)
    if (isIdFieldPath(segments, idFields)) return
    if (isPublicCollection(segments[0])) return _arrayRemovePublic(segments, index, howMany)
    if (publicOnly) throw Error(ERRORS.publicOnly)
    return _arrayRemove(segments, index, howMany)
  }

  async move (from, to, howMany = 1) {
    if (arguments.length < 2) throw Error('Not enough arguments for move')
    if (arguments.length > 3) throw Error('Signal.move() expects two or three arguments')
    if (typeof from !== 'number' || !Number.isFinite(from) || typeof to !== 'number' || !Number.isFinite(to)) {
      throw Error('Signal.move() expects numeric from/to')
    }
    const segments = ensureArrayTarget(this)
    const idFields = getIdFieldsForSegments(segments)
    if (isIdFieldPath(segments, idFields)) return
    if (isPublicCollection(segments[0])) return _arrayMovePublic(segments, from, to, howMany)
    if (publicOnly) throw Error(ERRORS.publicOnly)
    return _arrayMove(segments, from, to, howMany)
  }

  async stringInsert (index, text) {
    if (arguments.length < 2) throw Error('Not enough arguments for stringInsert')
    if (arguments.length > 2) throw Error('Signal.stringInsert() expects two arguments')
    if (typeof index !== 'number' || !Number.isFinite(index)) {
      throw Error('Signal.stringInsert() expects a numeric index')
    }
    const segments = ensureValueTarget(this)
    const idFields = getIdFieldsForSegments(segments)
    if (isIdFieldPath(segments, idFields)) return
    if (isPublicCollection(segments[0])) return _stringInsertPublic(segments, index, text)
    if (publicOnly) throw Error(ERRORS.publicOnly)
    return _stringInsertLocal(segments, index, text)
  }

  async stringRemove (index, howMany = 1) {
    if (arguments.length < 2) throw Error('Not enough arguments for stringRemove')
    if (arguments.length > 2) throw Error('Signal.stringRemove() expects two arguments')
    if (typeof index !== 'number' || !Number.isFinite(index)) {
      throw Error('Signal.stringRemove() expects a numeric index')
    }
    const segments = ensureValueTarget(this)
    const idFields = getIdFieldsForSegments(segments)
    if (isIdFieldPath(segments, idFields)) return
    if (isPublicCollection(segments[0])) return _stringRemovePublic(segments, index, howMany)
    if (publicOnly) throw Error(ERRORS.publicOnly)
    return _stringRemoveLocal(segments, index, howMany)
  }

  async increment (value) {
    if (arguments.length > 1) throw Error('Signal.increment() expects a single argument')
    if (value === undefined) value = 1
    if (typeof value !== 'number') throw Error('Signal.increment() expects a number argument')
    let currentValue = this.get()
    if (currentValue === undefined) currentValue = 0
    if (typeof currentValue !== 'number') throw Error('Signal.increment() tried to increment a non-number value')
    const segments = this[SEGMENTS]
    if (segments.length === 0) throw Error('Can\'t increment the root signal data')
    const idFields = getIdFieldsForSegments(segments)
    if (isIdFieldPath(segments, idFields)) return currentValue
    if (isPublicCollection(segments[0])) {
      await _incrementPublic(segments, value)
      return currentValue + value
    }
    if (publicOnly) throw Error(ERRORS.publicOnly)
    _setReplace(segments, currentValue + value)
    return currentValue + value
  }

  async add (value) {
    if (arguments.length > 1) throw Error('Signal.add() expects a single argument')
    if (!value || typeof value !== 'object') throw Error('Signal.add() expects an object argument')
    let id = value._id ?? value.id
    id ??= uuid()
    const idFields = getIdFieldsForSegments([this[SEGMENTS][0], id])
    if (idFields.includes('_id')) value._id = id
    if (idFields.includes('id')) {
      value.id = id
    } else if (value.id === id) {
      delete value.id
    }
    await this[id].set(value)
    return id
  }

  async del () {
    if (arguments.length > 0) throw Error('Signal.del() does not accept any arguments')
    if (this[SEGMENTS].length === 0) throw Error('Can\'t delete the root signal data')
    const idFields = getIdFieldsForSegments(this[SEGMENTS])
    if (isIdFieldPath(this[SEGMENTS], idFields)) return
    if (isPublicCollection(this[SEGMENTS][0])) {
      if (this[SEGMENTS].length === 1) throw Error('Can\'t delete the whole collection')
      await _setPublicDoc(this[SEGMENTS], undefined, true)
    } else {
      if (publicOnly) throw Error(ERRORS.publicOnly)
      _del(this[SEGMENTS])
    }
  }

  // clone () {}
  // async assign () {}
  // async splice () {}
}

function ensureArrayTarget ($signal) {
  if ($signal[SEGMENTS].length < 2) throw Error('Can\'t mutate array on a collection or root signal')
  if ($signal[IS_QUERY]) throw Error('Array mutators can\'t be used on a query signal')
  return $signal[SEGMENTS]
}

function ensureValueTarget ($signal) {
  if ($signal[SEGMENTS].length < 2) throw Error('Can\'t mutate on a collection or root signal')
  if ($signal[IS_QUERY]) throw Error('Mutators can\'t be used on a query signal')
  return $signal[SEGMENTS]
}

// dot syntax returns a child signal only if no such method or property exists
export const regularBindings = {
  apply (signal, thisArg, argumentsList) {
    if (signal[SEGMENTS].length === 0) {
      if (!signal[ROOT_FUNCTION]) throw Error(ERRORS.noRootFunction)
      return signal[ROOT_FUNCTION].call(thisArg, signal, ...argumentsList)
    }
    throw Error('Signal can\'t be called as a function since extremely late bindings are disabled')
  },
  get (signal, key, receiver) {
    if (key in signal) return Reflect.get(signal, key, receiver)
    return Reflect.apply(extremelyLateBindings.get, this, arguments)
  }
}

const QUERY_METHODS = ['map', 'reduce', 'find', 'get', 'getIds', 'getExtra', 'subscribe', 'unsubscribe', 'fetch', 'unfetch']

// dot syntax always returns a child signal even if such method or property exists.
// The method is only called when the signal is explicitly called as a function,
// in which case we get the original method from the raw (non-proxied) parent signal
export const extremelyLateBindings = {
  apply (signal, thisArg, argumentsList) {
    if (signal[SEGMENTS].length === 0) {
      if (!signal[ROOT_FUNCTION]) throw Error(ERRORS.noRootFunction)
      return signal[ROOT_FUNCTION].call(thisArg, signal, ...argumentsList)
    }
    const key = signal[SEGMENTS][signal[SEGMENTS].length - 1]
    const segments = signal[SEGMENTS].slice(0, -1)
    if (segments[0] === AGGREGATIONS) {
      const aggregationDocId = getAggregationDocId(segments)
      if (aggregationDocId) {
        if (segments.length === 3 && key === 'set') throw Error(ERRORS.setAggregationDoc(segments, key))
        const collectionName = getAggregationCollectionName(segments)
        const subDocSegments = segments.slice(3)
        const $original = getSignal(getRoot(signal), [collectionName, aggregationDocId, ...subDocSegments])
        const rawOriginal = rawSignal($original)
        if (!(key in rawOriginal)) throw Error(ERRORS.noSignalKey($original, key))
        const fn = rawOriginal[key]
        const getters = rawOriginal.constructor[GETTERS]
        // for getters run the method on the aggregation data itself
        if (getters.includes(key)) {
          const $parent = getSignal(getRoot(signal), segments)
          return Reflect.apply(fn, $parent, argumentsList)
        // for async methods (setters) subscribe to the original doc and run the method on its relative signal
        } else {
          const $doc = getSignal(getRoot(signal), [collectionName, aggregationDocId])
          const promise = docSubscriptions.subscribe($doc)
          if (!promise) return Reflect.apply(fn, $original, argumentsList)
          return new Promise(resolve => {
            promise.then(() => {
              resolve(Reflect.apply(fn, $original, argumentsList))
            })
          })
        }
      } else if (!DEFAULT_GETTERS.includes(key)) {
        throw Error(ERRORS.aggregationSetter(segments, key))
      }
    }
    const $parent = getSignal(getRoot(signal), segments)
    const rawParent = rawSignal($parent)
    if (!(key in rawParent)) throw Error(ERRORS.noSignalKey($parent, key))
    return Reflect.apply(rawParent[key], $parent, argumentsList)
  },
  get (signal, key, receiver) {
    if (typeof key === 'symbol') return Reflect.get(signal, key, receiver)
    if (key === 'then') return undefined // handle checks for whether the symbol is a Promise
    key = transformAlias(signal[SEGMENTS], key)
    key = maybeTransformToArrayIndex(key)
    if (signal[IS_QUERY]) {
      if (key === 'ids') return getSignal(getRoot(signal), [QUERIES, signal[HASH], 'ids'])
      if (key === 'extra') return getSignal(getRoot(signal), [QUERIES, signal[HASH], 'extra'])
      if (QUERY_METHODS.includes(key)) return Reflect.get(signal, key, receiver)
    }
    return getSignal(getRoot(signal), [...signal[SEGMENTS], key])
  }
}

const REGEX_POSITIVE_INTEGER = /^(?:0|[1-9]\d*)$/
// Transform the key to a number if it's a positive integer.
// Otherwise the key must be a string.
function maybeTransformToArrayIndex (key) {
  if (typeof key === 'string' && REGEX_POSITIVE_INTEGER.test(key)) return +key
  return key
}

const transformAlias = (({
  collectionsMapping = {
    session: '_session',
    page: '_page',
    render: '$render',
    system: '$system'
  },
  regex$ = /^\$/
} = {}) => (segments, key) => {
  if (regex$.test(key)) key = key.slice(1)
  if (segments.length === 0) key = collectionsMapping[key] || key
  return key
})()

export function isPublicCollectionSignal ($signal) {
  return $signal instanceof Signal && $signal[SEGMENTS].length === 1 && isPublicCollection($signal[SEGMENTS][0])
}

export function isPublicDocumentSignal ($signal) {
  return $signal instanceof Signal && $signal[SEGMENTS].length === 2 && isPublicCollection($signal[SEGMENTS][0])
}

export function isPublicCollection (collectionName) {
  if (!collectionName) return false
  return !isPrivateCollection(collectionName)
}

export function isPrivateCollection (collectionName) {
  if (!collectionName) return false
  return /^[_$]/.test(collectionName)
}

const ERRORS = {
  noRootFunction: `
    Root signal does not have a root function set.
    You must use getRootSignal({ rootId, rootFunction }) to create a root signal.
  `,
  publicOnly: `
    Can't modify private collections data when 'publicOnly' is enabled.
    On the server you can only work with public collections.
  `,
  noSignalKey: ($signal, key) => `Method "${key}" does not exist on signal "${$signal[SEGMENTS].join('.')}"`,
  aggregationSetter: (segments, key) => `
    You can not use setters on aggregation signals.
    It's only allowed when the aggregation result is an array of documents
    with either '_id' or 'id' field present in them.

    Path: ${segments}
    Method: ${key}
  `,
  setAggregationDoc: (segments, key) => `
    Changing a whole document using .set() from an aggregation signal is prohibited.
    This is to prevent accidental overwriting of the whole document with incorrect aggregation results.
    You can only change the particular fields within the document using the aggregation signal.

    If you want to change the whole document, use the actual document signal explicitly
    (and make sure to subscribe to it).

    Path: ${segments}
    Method: ${key}
  `
}
