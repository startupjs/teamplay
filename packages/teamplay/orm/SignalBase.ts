// @ts-nocheck
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
  setPublicDoc as _setPublicDoc,
  dataTreeRaw,
  getRaw,
  getLogicalRootSnapshot,
  incrementPublic as _incrementPublic,
  arrayPushPublic as _arrayPushPublic,
  arrayUnshiftPublic as _arrayUnshiftPublic,
  arrayInsertPublic as _arrayInsertPublic,
  arrayPopPublic as _arrayPopPublic,
  arrayShiftPublic as _arrayShiftPublic,
  arrayRemovePublic as _arrayRemovePublic,
  arrayMovePublic as _arrayMovePublic,
  stringInsertPublic as _stringInsertPublic,
  stringRemovePublic as _stringRemovePublic
} from './dataTree.js'
import getSignal, { rawSignal } from './getSignal.ts'
import { docSubscriptions } from './Doc.js'
import { IS_QUERY, HASH, QUERIES } from './Query.js'
import { AGGREGATIONS, IS_AGGREGATION, getAggregationCollectionName, getAggregationDocId } from './Aggregation.js'
import { ROOT_FUNCTION, ROOT_ID, getRoot } from './Root.ts'
import { isPrivateMutationForbidden } from './connection.ts'
import {
  DEFAULT_ID_FIELDS,
  getIdFieldsForSegments,
  isIdFieldPath,
  isPublicDocPath,
  normalizeIdFields,
  prepareAddPayload,
  resolveAddDocId
} from './idFields.js'
import { isCompatEnv } from './compatEnv.js'
import { resolveRefSegmentsSafe, resolveRefSignalSafe } from './Compat/refFallback.js'
import { compatStartOnRoot, compatStopOnRoot, joinScopePath } from './Compat/startStopCompat.js'
import { runInBatch } from './batchScheduler.js'
import { isPrivateCollectionSegments } from './rootScope.ts'
import { isPublicCollection } from './signalPathKind.ts'
import {
  ensureArrayTargetSegments,
  ensureValueTargetSegments
} from './signalMutationGuards.ts'
import { normalizeSignalPropertyKey } from './signalPathRules.ts'
import {
  arrayInsertPrivateData,
  arrayMovePrivateData,
  arrayPopPrivateData,
  arrayPushPrivateData,
  arrayRemovePrivateData,
  arrayShiftPrivateData,
  arrayUnshiftPrivateData,
  delPrivateData,
  getPrivateData,
  setPrivateData,
  setReplacePrivateData,
  stringInsertPrivateData,
  stringRemovePrivateData
} from './privateData.js'

export const SEGMENTS = Symbol('path segments targeting the particular node in the data tree')
export const ARRAY_METHOD = Symbol('run array method on the signal')
export const GET = Symbol('get the value of the signal - either observed or raw')
export const GETTERS = Symbol('get the list of this signal\'s getters')
export const DEFAULT_GETTERS = ['path', 'id', 'get', 'peek', 'getId', 'map', 'reduce', 'find', 'getIds', 'getExtra', 'getCollection']

export class Signal<TValue = unknown> extends Function {
  /** Fields that are treated as document ids and mirror the document id segment. */
  static ID_FIELDS = DEFAULT_ID_FIELDS
  /** Method names that keep method binding priority over child signal dot access. */
  static [GETTERS] = DEFAULT_GETTERS
  /** Association metadata registered for this model class. */
  static associations = []
  /** Path segments from the root signal to this signal. */
  readonly [SEGMENTS]: Array<string | number>

  /**
   * Add association metadata to this model class.
   * @param association Association metadata object to register on the model class.
   */
  static addAssociation (association: object): void {
    if (!association || typeof association !== 'object') {
      throw Error('Signal.addAssociation() expects an association object')
    }
    const inherited = this.associations || []
    const own = Object.prototype.hasOwnProperty.call(this, 'associations')
      ? this.associations
      : inherited.slice()
    this.associations = own.concat(association)
  }

  /**
   * Create a signal for the given root-relative path segments.
   * @param segments Root-relative path segments this signal points to.
   */
  constructor (segments: Array<string | number>) {
    if (!Array.isArray(segments)) throw Error('Signal constructor expects an array of segments')
    super()
    this[SEGMENTS] = segments
  }

  /** Return the dot-separated path of this signal from the root data tree. */
  path (): string {
    if (arguments.length > 0) throw Error('Signal.path() does not accept any arguments')
    return this[SEGMENTS].join('.')
  }

  /** Return the last segment of this signal path, or an empty string for the root signal. */
  leaf (): string {
    if (arguments.length > 0) throw Error('Signal.leaf() does not accept any arguments')
    const segments = this[SEGMENTS]
    if (segments.length === 0) return ''
    return String(segments[segments.length - 1])
  }

  /**
   * Return the parent signal `levels` above this signal.
   * @param levels Number of parent levels to walk upward. Defaults to `1`.
   */
  parent (levels = 1): Signal {
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

  /** Generate a new unique id suitable for a new document. */
  id (): string {
    return uuid()
  }

  /** Run multiple signal reads and writes in a single reactive batch. */
  batch (): undefined
  /**
   * Run multiple signal reads and writes in a single reactive batch.
   * @param fn Function to execute inside the batch.
   */
  batch<TResult>(fn: () => TResult): TResult
  batch<TResult>(fn?: () => TResult): TResult | undefined {
    if (arguments.length > 1) throw Error('Signal.batch() expects a single argument')
    if (fn == null) return
    if (typeof fn !== 'function') throw Error('Signal.batch() expects a function argument')
    return runInBatch(fn)
  }

  /**
   * Internal read hook used by `.get()` and `.peek()`.
   * @param method Storage read function to use for the current signal path.
   */
  [GET] (method: (segments: Array<string | number>) => TValue): TValue {
    if (arguments.length > 1) throw Error('Signal[GET]() only accepts method as an argument')
    if (this[SEGMENTS].length === 0) {
      const $root = getRoot(this) || this
      return getLogicalRootSnapshot($root?.[ROOT_ID], method === getRaw ? dataTreeRaw : undefined)
    }
    if (this[IS_QUERY]) {
      const $root = getRoot(this) || this
      return getPrivateData($root?.[ROOT_ID], [QUERIES, this[HASH], 'docs'], method === getRaw)
    }
    if (isPrivateSignalSegments(this[SEGMENTS])) {
      const $root = getRoot(this) || this
      return getPrivateData($root?.[ROOT_ID], this[SEGMENTS], method === getRaw)
    }
    return method(getStorageSegmentsForSignal(this))
  }

  /** Read the current value and track it for reactive rendering. */
  get (): TValue {
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

  /** Return document ids for a query or aggregation signal. */
  getIds (): Array<string | number> {
    if (arguments.length > 0) throw Error('Signal.getIds() does not accept any arguments')
    if (this[IS_QUERY]) {
      const $root = getRoot(this) || this
      const ids = getPrivateData($root?.[ROOT_ID], [QUERIES, this[HASH], 'ids'])
      if (!Array.isArray(ids)) {
        // TODO: This should never happen, but in reality it happens sometimes
        console.warn('Signal.getIds() on Query didn\'t find ids', [QUERIES, this[HASH], 'ids'])
        return []
      }
      return ids
    } else if (this[IS_AGGREGATION]) {
      const $root = getRoot(this) || this
      const docs = getPrivateData($root?.[ROOT_ID], this[SEGMENTS])
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

  /** Read the current value without tracking it for reactive rendering. */
  peek (): TValue {
    if (arguments.length > 0) throw Error('Signal.peek() does not accept any arguments')
    return this[GET](getRaw)
  }

  /** Return the document id represented by this document signal. */
  getId (): string | number {
    if (this[SEGMENTS].length === 0) throw Error('Can\'t get the id of the root signal')
    if (this[SEGMENTS].length === 1) throw Error('Can\'t get the id of a collection')
    if (this[SEGMENTS][0] === AGGREGATIONS && this[SEGMENTS].length === 3) {
      // use get() instead of the default getRaw() to trigger observability on changes
      // This is required since within aggregation array results docs can change their position
      const $root = getRoot(this) || this
      return getAggregationDocId(this[SEGMENTS], $root?.[ROOT_ID])
    }
    return this[SEGMENTS][this[SEGMENTS].length - 1]
  }

  /** Return the public collection name this signal belongs to. */
  getCollection (): string {
    if (this[SEGMENTS].length === 0) throw Error('Can\'t get the collection of the root signal')
    if (this[SEGMENTS][0] === AGGREGATIONS) {
      return getAggregationCollectionName(this[SEGMENTS])
    }
    // Racer compatibility:
    // prefer static model collection (when model is mounted on alternative paths,
    // e.g. `_virtualFields.*` -> model with `static collection = 'fields'`).
    const collectionFromModel = this.constructor?.collection
    if (typeof collectionFromModel === 'string' && collectionFromModel) {
      return collectionFromModel
    }
    return this[SEGMENTS][0]
  }

  /** Return association metadata registered on this signal's model class. */
  getAssociations (): readonly unknown[] {
    const $raw = rawSignal(this) || this
    return $raw.constructor.associations || []
  }

  /** Iterate child document signals for query signals, or item signals for array signals. */
  * [Symbol.iterator] (): IterableIterator<Signal> {
    if (this[IS_QUERY]) {
      const $root = getRoot(this) || this
      const ids = getPrivateData($root?.[ROOT_ID], [QUERIES, this[HASH], 'ids'])
      if (!Array.isArray(ids)) {
        // TODO: This should never happen, but in reality it happens sometimes
        console.warn('Signal iterator on Query didn\'t find ids', [QUERIES, this[HASH], 'ids'])
        return
      }
      for (const id of ids) yield getSignal(getRoot(this), [this[SEGMENTS][0], id])
    } else {
      const $root = getRoot(this) || this
      const items = isPrivateSignalSegments(this[SEGMENTS])
        ? getPrivateData($root?.[ROOT_ID], this[SEGMENTS])
        : _get(getStorageSegmentsForSignal(this))
      if (!Array.isArray(items)) return
      for (let i = 0; i < items.length; i++) yield getSignal(getRoot(this), [...this[SEGMENTS], i])
    }
  }

  /** Internal helper used to run array-style methods on query and array signals. */
  [ARRAY_METHOD] (method: string, nonArrayReturnValue: unknown, ...args: unknown[]): unknown {
    if (this[IS_QUERY]) {
      const collection = this[SEGMENTS][0]
      const $root = getRoot(this) || this
      const ids = getPrivateData($root?.[ROOT_ID], [QUERIES, this[HASH], 'ids'])
      if (!Array.isArray(ids)) {
        // TODO: This should never happen, but in reality it happens sometimes
        console.warn('Signal array method on Query didn\'t find ids', [QUERIES, this[HASH], 'ids'], method)
        return nonArrayReturnValue
      }
      return ids.map(
        id => getSignal(getRoot(this), [collection, id])
      )[method](...args)
    }
    const $root = getRoot(this) || this
    const items = isPrivateSignalSegments(this[SEGMENTS])
      ? getPrivateData($root?.[ROOT_ID], this[SEGMENTS])
      : _get(getStorageSegmentsForSignal(this))
    if (!Array.isArray(items)) return nonArrayReturnValue
    return Array(items.length).fill().map(
      (_, index) => getSignal(getRoot(this), [...this[SEGMENTS], index])
    )[method](...args)
  }

  /**
   * Run `Array.prototype.map()` over query document signals or array item signals.
   * @param callback Function called for each child signal.
   * @param thisArg Optional `this` value for the callback.
   */
  map<TResult>(callback: (value: Signal, index: number, array: Signal[]) => TResult, thisArg?: any): TResult[]
  map<TResult>(...args): TResult[] {
    return this[ARRAY_METHOD]('map', [], ...args)
  }

  /**
   * Run `Array.prototype.reduce()` over query document signals or array item signals.
   * @param callback Function called for each child signal and accumulated value.
   */
  reduce (callback: (previousValue: Signal, currentValue: Signal, currentIndex: number, array: Signal[]) => Signal): Signal
  /**
   * Run `Array.prototype.reduce()` over query document signals or array item signals.
   * @param callback Function called for each child signal and accumulated value.
   * @param initialValue Initial accumulator value.
   */
  reduce (callback: (previousValue: Signal, currentValue: Signal, currentIndex: number, array: Signal[]) => Signal, initialValue: Signal): Signal
  /**
   * Run `Array.prototype.reduce()` over query document signals or array item signals.
   * @param callback Function called for each child signal and accumulated value.
   * @param initialValue Initial accumulator value.
   */
  reduce<TResult>(
    callback: (previousValue: TResult, currentValue: Signal, currentIndex: number, array: Signal[]) => TResult,
    initialValue: TResult
  ): TResult
  reduce<TResult>(...args): TResult {
    return this[ARRAY_METHOD]('reduce', undefined, ...args)
  }

  /**
   * Find the first query document signal or array item signal matching a predicate.
   * @param predicate Function called for each child signal.
   * @param thisArg Optional `this` value for the predicate.
   */
  find (predicate: (value: Signal, index: number, obj: Signal[]) => unknown, thisArg?: any): Signal | undefined
  find (...args): Signal | undefined {
    return this[ARRAY_METHOD]('find', undefined, ...args)
  }

  /**
   * Replace this signal's value. Database writes are async and sync through ShareDB.
   * @param value New value to store at this signal path.
   */
  async set (value: TValue): Promise<void> {
    if (arguments.length > 1) throw Error('Signal.set() expects a single argument')
    if (this[SEGMENTS].length === 0) throw Error('Can\'t set the root signal data')
    const idFields = getIdFieldsForSegments(this[SEGMENTS])
    if (isIdFieldPath(this[SEGMENTS], idFields)) return
    if (isPublicDocPath(this[SEGMENTS])) {
      value = normalizeIdFields(value, idFields, this[SEGMENTS][1])
    }
    if (isPublicCollection(this[SEGMENTS][0])) {
      await _setPublicDoc(this[SEGMENTS], value)
    } else {
      if (isPrivateMutationForbidden()) throw Error(ERRORS.publicOnly)
      setPrivateData(getOwningRootId(this), this[SEGMENTS], value)
    }
  }

  /**
   * Set multiple object fields at once. Fields set to `null` or `undefined` are deleted.
   * @param value Object containing fields to set or delete.
   */
  async assign (value: NonNullable<TValue> extends object ? Partial<NonNullable<TValue>> : never): Promise<void> {
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

  /**
   * Append one item to an array signal.
   * @param value Item to append.
   */
  async push (value: NonNullable<TValue> extends ReadonlyArray<infer Item> ? Item : unknown): Promise<unknown> {
    if (arguments.length > 1) throw Error('Signal.push() expects a single argument')
    const segments = ensureArrayTarget(this)
    const idFields = getIdFieldsForSegments(segments)
    if (isIdFieldPath(segments, idFields)) return
    if (isPublicCollection(segments[0])) return _arrayPushPublic(segments, value)
    if (isPrivateMutationForbidden()) throw Error(ERRORS.publicOnly)
    return arrayPushPrivateData(getOwningRootId(this), segments, value)
  }

  /** Remove and return the last item from an array signal. */
  async pop (): Promise<NonNullable<TValue> extends ReadonlyArray<infer Item> ? Item | undefined : unknown> {
    if (arguments.length > 0) throw Error('Signal.pop() does not accept any arguments')
    const segments = ensureArrayTarget(this)
    const idFields = getIdFieldsForSegments(segments)
    if (isIdFieldPath(segments, idFields)) return
    if (isPublicCollection(segments[0])) return _arrayPopPublic(segments)
    if (isPrivateMutationForbidden()) throw Error(ERRORS.publicOnly)
    return arrayPopPrivateData(getOwningRootId(this), segments)
  }

  /**
   * Insert one item at the beginning of an array signal.
   * @param value Item to insert.
   */
  async unshift (value: NonNullable<TValue> extends ReadonlyArray<infer Item> ? Item : unknown): Promise<unknown> {
    if (arguments.length > 1) throw Error('Signal.unshift() expects a single argument')
    const segments = ensureArrayTarget(this)
    const idFields = getIdFieldsForSegments(segments)
    if (isIdFieldPath(segments, idFields)) return
    if (isPublicCollection(segments[0])) return _arrayUnshiftPublic(segments, value)
    if (isPrivateMutationForbidden()) throw Error(ERRORS.publicOnly)
    return arrayUnshiftPrivateData(getOwningRootId(this), segments, value)
  }

  /** Remove and return the first item from an array signal. */
  async shift (): Promise<NonNullable<TValue> extends ReadonlyArray<infer Item> ? Item | undefined : unknown> {
    if (arguments.length > 0) throw Error('Signal.shift() does not accept any arguments')
    const segments = ensureArrayTarget(this)
    const idFields = getIdFieldsForSegments(segments)
    if (isIdFieldPath(segments, idFields)) return
    if (isPublicCollection(segments[0])) return _arrayShiftPublic(segments)
    if (isPrivateMutationForbidden()) throw Error(ERRORS.publicOnly)
    return arrayShiftPrivateData(getOwningRootId(this), segments)
  }

  /**
   * Insert one or more items into an array signal at the given index.
   * @param index Array index where the new item or items should be inserted.
   * @param values Item or items to insert.
   */
  async insert (index: number, values: NonNullable<TValue> extends ReadonlyArray<infer Item> ? Item | Item[] : unknown): Promise<unknown> {
    if (arguments.length < 2) throw Error('Not enough arguments for insert')
    if (arguments.length > 2) throw Error('Signal.insert() expects two arguments')
    if (typeof index !== 'number' || !Number.isFinite(index)) {
      throw Error('Signal.insert() expects a numeric index')
    }
    const segments = ensureArrayTarget(this)
    const idFields = getIdFieldsForSegments(segments)
    if (isIdFieldPath(segments, idFields)) return
    if (isPublicCollection(segments[0])) return _arrayInsertPublic(segments, index, values)
    if (isPrivateMutationForbidden()) throw Error(ERRORS.publicOnly)
    return arrayInsertPrivateData(getOwningRootId(this), segments, index, values)
  }

  /**
   * Remove `howMany` items from an array signal starting at `index`.
   * @param index Array index to start removing from.
   * @param howMany Number of items to remove. Defaults to `1`.
   */
  async remove (index: number, howMany = 1): Promise<unknown> {
    if (arguments.length < 1) throw Error('Not enough arguments for remove')
    if (arguments.length > 2) throw Error('Signal.remove() expects one or two arguments')
    if (typeof index !== 'number' || !Number.isFinite(index)) {
      throw Error('Signal.remove() expects a numeric index')
    }
    const segments = ensureArrayTarget(this)
    const idFields = getIdFieldsForSegments(segments)
    if (isIdFieldPath(segments, idFields)) return
    if (isPublicCollection(segments[0])) return _arrayRemovePublic(segments, index, howMany)
    if (isPrivateMutationForbidden()) throw Error(ERRORS.publicOnly)
    return arrayRemovePrivateData(getOwningRootId(this), segments, index, howMany)
  }

  /**
   * Move `howMany` array items from one index to another.
   * @param from Source array index.
   * @param to Destination array index.
   * @param howMany Number of items to move. Defaults to `1`.
   */
  async move (from: number, to: number, howMany = 1): Promise<unknown> {
    if (arguments.length < 2) throw Error('Not enough arguments for move')
    if (arguments.length > 3) throw Error('Signal.move() expects two or three arguments')
    if (typeof from !== 'number' || !Number.isFinite(from) || typeof to !== 'number' || !Number.isFinite(to)) {
      throw Error('Signal.move() expects numeric from/to')
    }
    const segments = ensureArrayTarget(this)
    const idFields = getIdFieldsForSegments(segments)
    if (isIdFieldPath(segments, idFields)) return
    if (isPublicCollection(segments[0])) return _arrayMovePublic(segments, from, to, howMany)
    if (isPrivateMutationForbidden()) throw Error(ERRORS.publicOnly)
    return arrayMovePrivateData(getOwningRootId(this), segments, from, to, howMany)
  }

  /**
   * Insert text into a string signal at the given character index.
   * @param index Character index where text should be inserted.
   * @param text Text to insert.
   */
  async stringInsert (index: number, text: string): Promise<unknown> {
    if (arguments.length < 2) throw Error('Not enough arguments for stringInsert')
    if (arguments.length > 2) throw Error('Signal.stringInsert() expects two arguments')
    if (typeof index !== 'number' || !Number.isFinite(index)) {
      throw Error('Signal.stringInsert() expects a numeric index')
    }
    const segments = ensureValueTarget(this)
    const idFields = getIdFieldsForSegments(segments)
    if (isIdFieldPath(segments, idFields)) return
    if (isPublicCollection(segments[0])) return _stringInsertPublic(segments, index, text)
    if (isPrivateMutationForbidden()) throw Error(ERRORS.publicOnly)
    return stringInsertPrivateData(getOwningRootId(this), segments, index, text)
  }

  /**
   * Remove `howMany` characters from a string signal starting at `index`.
   * @param index Character index to start removing from.
   * @param howMany Number of characters to remove. Defaults to `1`.
   */
  async stringRemove (index: number, howMany = 1): Promise<unknown> {
    if (arguments.length < 2) throw Error('Not enough arguments for stringRemove')
    if (arguments.length > 2) throw Error('Signal.stringRemove() expects two arguments')
    if (typeof index !== 'number' || !Number.isFinite(index)) {
      throw Error('Signal.stringRemove() expects a numeric index')
    }
    const segments = ensureValueTarget(this)
    const idFields = getIdFieldsForSegments(segments)
    if (isIdFieldPath(segments, idFields)) return
    if (isPublicCollection(segments[0])) return _stringRemovePublic(segments, index, howMany)
    if (isPrivateMutationForbidden()) throw Error(ERRORS.publicOnly)
    return stringRemovePrivateData(getOwningRootId(this), segments, index, howMany)
  }

  /**
   * Add `value` to a number signal and return the new number. Defaults to `1`.
   * @param value Amount to add to the current number. Defaults to `1`.
   */
  async increment (value?: number): Promise<number> {
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
    if (isPrivateMutationForbidden()) throw Error(ERRORS.publicOnly)
    setReplacePrivateData(getOwningRootId(this), segments, currentValue + value)
    return currentValue + value
  }

  /**
   * Add a document to a collection signal and return the new document id.
   * @param value Document value to create. May include an explicit `id` field.
   */
  async add (value: unknown): Promise<string> {
    if (arguments.length > 1) throw Error('Signal.add() expects a single argument')
    const id = resolveAddDocId(value, uuid)
    const idFields = getIdFieldsForSegments([this[SEGMENTS][0], id])
    await this[id].set(prepareAddPayload(value, idFields, id))
    return id
  }

  /** Delete this document or field. Whole collections and the root signal cannot be deleted. */
  async del (): Promise<void> {
    if (arguments.length > 0) throw Error('Signal.del() does not accept any arguments')
    if (this[SEGMENTS].length === 0) throw Error('Can\'t delete the root signal data')
    const idFields = getIdFieldsForSegments(this[SEGMENTS])
    if (isIdFieldPath(this[SEGMENTS], idFields)) return
    if (isPublicCollection(this[SEGMENTS][0])) {
      if (this[SEGMENTS].length === 1) throw Error('Can\'t delete the whole collection')
      await _setPublicDoc(this[SEGMENTS], undefined, true)
    } else {
      if (isPrivateMutationForbidden()) throw Error(ERRORS.publicOnly)
      delPrivateData(getOwningRootId(this), this[SEGMENTS])
    }
  }

  // clone () {}
  // async assign () {}
  // async splice () {}
}

function ensureArrayTarget ($signal) {
  return ensureArrayTargetSegments($signal[SEGMENTS], !!$signal[IS_QUERY])
}

function ensureValueTarget ($signal) {
  return ensureValueTargetSegments($signal[SEGMENTS], !!$signal[IS_QUERY])
}

function getStorageSegmentsForSignal ($signal, segments = $signal[SEGMENTS]) {
  return segments
}

function getOwningRootId ($signal) {
  const $root = getRoot($signal) || $signal
  return $root?.[ROOT_ID]
}

function isPrivateSignalSegments (segments) {
  return isPrivateCollectionSegments(segments)
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
const AGGREGATION_ALLOWED_METHODS = ['subscribe', 'unsubscribe', 'fetch', 'unfetch', 'ref', 'removeRef', 'refExtra', 'refIds']

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
      const aggregationDocId = getAggregationDocId(segments, getRoot(signal)?.[ROOT_ID])
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
      } else if (!DEFAULT_GETTERS.includes(key) && !AGGREGATION_ALLOWED_METHODS.includes(key)) {
        throw Error(ERRORS.aggregationSetter(segments, key))
      }
    }
    const $parent = getSignal(getRoot(signal), segments)
    const rawParent = rawSignal($parent)
    if (key in rawParent) return Reflect.apply(rawParent[key], $parent, argumentsList)

    if (isCompatEnv()) {
      const $resolvedParent = resolveRefSignalSafe($parent)
      if ($resolvedParent && $resolvedParent !== $parent) {
        const rawResolvedParent = rawSignal($resolvedParent)
        if (rawResolvedParent && key in rawResolvedParent) {
          return Reflect.apply(rawResolvedParent[key], $resolvedParent, argumentsList)
        }
      } else {
        const resolvedSegments = resolveRefSegmentsSafe(
          segments,
          (getRoot(signal) || signal)?.[ROOT_ID]
        )
        if (resolvedSegments) {
          const $resolvedByPath = getSignal(getRoot(signal), resolvedSegments)
          const rawResolvedByPath = rawSignal($resolvedByPath)
          if (rawResolvedByPath && key in rawResolvedByPath) {
            return Reflect.apply(rawResolvedByPath[key], $resolvedByPath, argumentsList)
          }
        }
      }

      if (key === 'start') {
        const [relativePath, ...depsAndGetter] = argumentsList
        if (typeof relativePath !== 'string') throw Error('Signal.start() expects targetPath to be a string')
        const absolutePath = joinScopePath($parent.path(), relativePath)
        return compatStartOnRoot(getRoot($parent) || $parent, absolutePath, ...depsAndGetter)
      }
      if (key === 'stop') {
        if (argumentsList.length > 1) throw Error('Signal.stop() expects zero or one argument')
        const relativePath = argumentsList.length === 0 ? '' : argumentsList[0]
        if (relativePath != null && typeof relativePath !== 'string') {
          throw Error('Signal.stop() expects targetPath to be a string')
        }
        const absolutePath = joinScopePath($parent.path(), relativePath || '')
        return compatStopOnRoot(getRoot($parent) || $parent, absolutePath)
      }
    }

    throw Error(ERRORS.noSignalKey($parent, key))
  },
  get (signal, key, receiver) {
    if (typeof key === 'symbol') return Reflect.get(signal, key, receiver)
    if (key === 'then') return undefined // handle checks for whether the symbol is a Promise
    if (key === 'constructor') return signal.constructor
    key = normalizeSignalPropertyKey(signal[SEGMENTS], key)
    if (signal[IS_QUERY]) {
      if (key === 'ids') return getSignal(getRoot(signal), [QUERIES, signal[HASH], 'ids'])
      if (key === 'extra') return getSignal(getRoot(signal), [QUERIES, signal[HASH], 'extra'])
      if (QUERY_METHODS.includes(key)) return Reflect.get(signal, key, receiver)
    }
    return getSignal(getRoot(signal), [...signal[SEGMENTS], key])
  }
}

export function isPublicCollectionSignal ($signal) {
  return $signal instanceof Signal && $signal[SEGMENTS].length === 1 && isPublicCollection($signal[SEGMENTS][0])
}

export function isPublicDocumentSignal ($signal) {
  return $signal instanceof Signal && $signal[SEGMENTS].length === 2 && isPublicCollection($signal[SEGMENTS][0])
}

export { isPrivateCollection, isPublicCollection } from './signalPathKind.ts'

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
