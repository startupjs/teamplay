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
import { raw } from '@nx-js/observer-util'
import arrayDiff from 'arraydiff'
import uuid from '@teamplay/utils/uuid'
import {
  get as _get,
  setPublicDoc as _setPublicDoc,
  setPublicDocReplace as _setPublicDocReplace,
  del as _del,
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
import {
  ROOT_FUNCTION,
  ROOT_ID,
  closeRootSignal,
  getRoot
} from './Root.ts'
import {
  getDefaultIdFields,
  getIdFieldsForSegments,
  isIdFieldPath,
  isPlainObject,
  isPublicDocPath,
  normalizeIdFields,
  prepareAddPayload,
  resolveAddDocId
} from './idFields.ts'
import { runInBatch } from './batchScheduler.js'
import { isPublicCollection } from './signalPathKind.ts'
import {
  ARRAY_METHOD,
  DEFAULT_GETTERS,
  GET,
  GETTERS,
  SEGMENTS
} from './signalSymbols.ts'
import { normalizeSignalPropertyKey } from './signalPathRules.ts'
import {
  ensureArraySignalTarget,
  ensureValueSignalTarget,
  getSignalOwningRootId,
  getSignalStorageSegments,
  isPrivateSignalSegments
} from './signalRuntimeAccess.ts'
import {
  getSignalAssociations,
  getSignalCollection,
  getSignalId,
  getSignalLeaf,
  getSignalParentSegments,
  getSignalPath
} from './signalMetadata.ts'
import {
  iterateSignalArrayChildren,
  runSignalArrayMethod
} from './signalArrayReaders.ts'
import {
  getSignalIds,
  getSignalValue,
  readSignalValue
} from './signalReads.ts'
import { runSignalStorageMutation } from './signalStorageMutations.ts'
import {
  deleteSignalValue,
  setSignalValue
} from './signalValueMutations.ts'
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

export { SEGMENTS, ARRAY_METHOD, GET, GETTERS, DEFAULT_GETTERS }

const SIGNAL_ARRAY_READER_CONTEXT = {
  getRoot ($signal) {
    return getRoot($signal)
  },
  readQueryIds ($signal) {
    const $root = getRoot($signal) || $signal
    return getPrivateData($root?.[ROOT_ID], [QUERIES, $signal[HASH], 'ids'])
  },
  readArrayValue ($signal) {
    const $root = getRoot($signal) || $signal
    return isPrivateSignalSegments($signal[SEGMENTS])
      ? getPrivateData($root?.[ROOT_ID], $signal[SEGMENTS])
      : _get(getSignalStorageSegments($signal))
  },
  createSignal: getSignal,
  warn (message, ...args) {
    console.warn(message, ...args)
  }
}

const SIGNAL_READ_CONTEXT = {
  getOwningRootId ($signal) {
    const $root = getRoot($signal) || $signal
    return $root?.[ROOT_ID]
  },
  getStorageSegments: getSignalStorageSegments,
  isPrivateSegments: isPrivateSignalSegments,
  readLogicalRootSnapshot (rootId, raw) {
    return getLogicalRootSnapshot(rootId, raw ? dataTreeRaw : undefined)
  },
  readPrivateData (rootId, segments, raw) {
    return getPrivateData(rootId, segments, raw)
  },
  readPublicData (segments, method) {
    return method(segments)
  },
  warn (message, ...args) {
    console.warn(message, ...args)
  },
  error (message) {
    console.error(message)
  }
}

const SIGNAL_VALUE_MUTATION_CONTEXT = {
  getOwningRootId: getSignalOwningRootId,
  isPublicCollection,
  setPublicDoc: _setPublicDoc,
  setPrivateData,
  deletePublicDoc (segments) {
    return _setPublicDoc(segments, undefined, true)
  },
  deletePrivateData: delPrivateData
}

export class Signal<TValue = unknown> extends Function {
  /** Fields that are treated as document ids and mirror the document id segment. */
  static get ID_FIELDS () {
    return getDefaultIdFields()
  }

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
    return getSignalPath(this)
  }

  /** Return the last segment of this signal path, or an empty string for the root signal. */
  leaf (): string {
    if (arguments.length > 0) throw Error('Signal.leaf() does not accept any arguments')
    return getSignalLeaf(this)
  }

  /** Return the signal path when JavaScript coerces this signal to a primitive value. */
  [Symbol.toPrimitive] (_hint?: string): string {
    return getSignalPath(this)
  }

  /** Return a debug label for this signal. Primitive coercion returns only the path. */
  toString (): string {
    const path = getSignalPath(this)
    return `[Signal ${path || '<root>'}]`
  }

  /** Customize Object.prototype.toString.call($signal) for debugging. */
  get [Symbol.toStringTag] (): string {
    return 'Signal'
  }

  /** Return the owning root signal. */
  root () {
    if (arguments.length > 0) throw Error('Signal.root() does not accept any arguments')
    return getRoot(this) || this
  }

  /**
   * Return the parent signal `levels` above this signal.
   * @param levels Number of parent levels to walk upward. Defaults to `1`.
   */
  parent (levels = 1): Signal {
    const targetSegments = getSignalParentSegments(this, levels, arguments.length)
    const $root = getRoot(this) || this
    if (targetSegments.length === 0) return $root
    let $cursor = $root
    for (const segment of targetSegments) {
      $cursor = $cursor[segment]
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

  close (): Promise<void>
  close (callback: (err?: unknown) => void): void
  close (callback?: (err?: unknown) => void): Promise<void> | void {
    if (arguments.length > 1) throw Error('Signal.close() expects zero or one argument')
    if (callback != null && typeof callback !== 'function') {
      throw Error('Signal.close() expects callback to be a function')
    }
    return callback ? closeRootSignal(this, callback) : closeRootSignal(this)
  }

  /**
   * Internal read hook used by `.get()` and `.peek()`.
   * @param method Storage read function to use for the current signal path.
   */
  [GET] (method: (segments: Array<string | number>) => TValue): TValue {
    if (arguments.length > 1) throw Error('Signal[GET]() only accepts method as an argument')
    return readSignalValue(this, SIGNAL_READ_CONTEXT, method, getRaw)
  }

  /** Read the current value and track it for reactive rendering. */
  get (): TValue {
    if (arguments.length > 0) throw Error('Signal.get() does not accept any arguments')
    return getSignalValue(this, SIGNAL_READ_CONTEXT, _get, getRaw)
  }

  /** Return document ids for a query or aggregation signal. */
  getIds (): string[] {
    if (arguments.length > 0) throw Error('Signal.getIds() does not accept any arguments')
    return getSignalIds(this, SIGNAL_READ_CONTEXT)
  }

  /** Return query extra data, aggregation data, or undefined for ordinary signals. */
  getExtra (): unknown {
    if (arguments.length > 0) throw Error('Signal.getExtra() does not accept any arguments')
    if (this[IS_AGGREGATION]) return this.get()
    if (this[IS_QUERY]) return this.extra.get()
    return undefined
  }

  /** Return a shallow copy of the current value. */
  getCopy (): TValue {
    if (arguments.length > 0) throw Error('Signal.getCopy() does not accept any arguments')
    return shallowCopy(this.get())
  }

  /** Return a deep copy of the current value. */
  getDeepCopy (): TValue {
    if (arguments.length > 0) throw Error('Signal.getDeepCopy() does not accept any arguments')
    return deepCopy(this.get())
  }

  /** Read the current value without tracking it for reactive rendering. */
  peek (): TValue {
    if (arguments.length > 0) throw Error('Signal.peek() does not accept any arguments')
    return this[GET](getRaw)
  }

  /** Return the document id represented by this document signal. */
  getId (): string | undefined {
    const $root = getRoot(this) || this
    const rootId = $root?.[ROOT_ID]
    return getSignalId(this, rootId, segments => (
      isPrivateSignalSegments(segments)
        ? getPrivateData(rootId, segments)
        : _get(getSignalStorageSegments({ [SEGMENTS]: segments }))
    ))
  }

  /** Return the public collection name this signal belongs to. */
  getCollection (): string {
    return getSignalCollection(this)
  }

  /** Return association metadata registered on this signal's model class. */
  getAssociations (): readonly unknown[] {
    const $raw = rawSignal(this) || this
    return getSignalAssociations($raw)
  }

  /** Iterate child document signals for query signals, or item signals for array signals. */
  * [Symbol.iterator] (): IterableIterator<Signal> {
    yield * iterateSignalArrayChildren(this, SIGNAL_ARRAY_READER_CONTEXT, {
      message: 'Signal iterator on Query didn\'t find ids'
    })
  }

  /** Internal helper used to run array-style methods on query and array signals. */
  [ARRAY_METHOD] (method: string, nonArrayReturnValue: unknown, ...args: unknown[]): unknown {
    return runSignalArrayMethod(this, SIGNAL_ARRAY_READER_CONTEXT, method, nonArrayReturnValue, args, {
      message: 'Signal array method on Query didn\'t find ids',
      method
    })
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
    await setSignalValue(this, SIGNAL_VALUE_MUTATION_CONTEXT, value)
  }

  /**
   * Replace this signal's value without deep-diffing object/array branches.
   * @param value New value to store at this signal path.
   */
  async setReplace (value: TValue): Promise<void> {
    if (arguments.length > 1) throw Error('Signal.setReplace() expects a single argument')
    const segments = this[SEGMENTS]
    if (segments.length === 0) throw Error('Can\'t set the root signal data')

    const idFields = getIdFieldsForSegments(segments)
    if (isIdFieldPath(segments, idFields)) return

    const nextValue = isPublicDocPath(segments)
      ? normalizeIdFields(value, idFields, segments[1])
      : value

    if (isPublicCollection(segments[0])) {
      if (value === undefined) {
        await _setPublicDoc(segments, nextValue)
        if (segments.length === 2) {
          _del(segments)
        }
      } else {
        await _setPublicDocReplace(segments, nextValue)
      }
      return
    }

    setReplacePrivateData(getSignalOwningRootId(this), segments, nextValue)
  }

  /** Set the current value only when it is null or undefined. */
  async setNull (value: TValue): Promise<void> {
    if (arguments.length > 1) throw Error('Signal.setNull() expects a single argument')
    if (this.get() != null) return
    await this.setReplace(value)
  }

  /** Replace the current value unless it is exactly equal to the new value. */
  async setDiff (value: TValue): Promise<void> {
    if (arguments.length > 1) throw Error('Signal.setDiff() expects a single argument')
    const before = this.peek()
    if (racerEqual(before, value)) return
    await this.setReplace(value)
  }

  /** Recursively diff objects and arrays at the current signal path. */
  async setDiffDeep (value: TValue): Promise<void> {
    if (arguments.length > 1) throw Error('Signal.setDiffDeep() expects a single argument')
    await runInBatch(() => setDiffDeepOnSignal(this, value))
  }

  /**
   * Set multiple object fields with per-key replace semantics.
   * Unlike assign(), null is stored as null and undefined follows setReplace() semantics.
   * @param object Object containing fields to set.
   */
  async setEach (object: NonNullable<TValue> extends object ? Partial<NonNullable<TValue>> : never): Promise<void> {
    if (arguments.length > 1) throw Error('Signal.setEach() expects a single argument')
    if (!object) return
    if (typeof object !== 'object') {
      throw Error('Signal.setEach() expects an object argument, got: ' + typeof object)
    }
    await runInBatch(async () => {
      const promises = []
      for (const key of Object.keys(object)) {
        promises.push(this[key].setReplace(object[key]))
      }
      await Promise.all(promises)
    })
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
    const segments = ensureArraySignalTarget(this)
    const result = await runSignalStorageMutation(this, SIGNAL_VALUE_MUTATION_CONTEXT, segments, {
      public: segments => _arrayPushPublic(segments, value),
      private: (rootId, segments) => arrayPushPrivateData(rootId, segments, value)
    })
    return result.value
  }

  /** Remove and return the last item from an array signal. */
  async pop (): Promise<NonNullable<TValue> extends ReadonlyArray<infer Item> ? Item | undefined : unknown> {
    if (arguments.length > 0) throw Error('Signal.pop() does not accept any arguments')
    const segments = ensureArraySignalTarget(this)
    const result = await runSignalStorageMutation(this, SIGNAL_VALUE_MUTATION_CONTEXT, segments, {
      public: segments => _arrayPopPublic(segments),
      private: (rootId, segments) => arrayPopPrivateData(rootId, segments)
    })
    return result.value
  }

  /**
   * Insert one item at the beginning of an array signal.
   * @param value Item to insert.
   */
  async unshift (value: NonNullable<TValue> extends ReadonlyArray<infer Item> ? Item : unknown): Promise<unknown> {
    if (arguments.length > 1) throw Error('Signal.unshift() expects a single argument')
    const segments = ensureArraySignalTarget(this)
    const result = await runSignalStorageMutation(this, SIGNAL_VALUE_MUTATION_CONTEXT, segments, {
      public: segments => _arrayUnshiftPublic(segments, value),
      private: (rootId, segments) => arrayUnshiftPrivateData(rootId, segments, value)
    })
    return result.value
  }

  /** Remove and return the first item from an array signal. */
  async shift (): Promise<NonNullable<TValue> extends ReadonlyArray<infer Item> ? Item | undefined : unknown> {
    if (arguments.length > 0) throw Error('Signal.shift() does not accept any arguments')
    const segments = ensureArraySignalTarget(this)
    const result = await runSignalStorageMutation(this, SIGNAL_VALUE_MUTATION_CONTEXT, segments, {
      public: segments => _arrayShiftPublic(segments),
      private: (rootId, segments) => arrayShiftPrivateData(rootId, segments)
    })
    return result.value
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
    const segments = ensureArraySignalTarget(this)
    const result = await runSignalStorageMutation(this, SIGNAL_VALUE_MUTATION_CONTEXT, segments, {
      public: segments => _arrayInsertPublic(segments, index, values),
      private: (rootId, segments) => arrayInsertPrivateData(rootId, segments, index, values)
    })
    return result.value
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
    const segments = ensureArraySignalTarget(this)
    const result = await runSignalStorageMutation(this, SIGNAL_VALUE_MUTATION_CONTEXT, segments, {
      public: segments => _arrayRemovePublic(segments, index, howMany),
      private: (rootId, segments) => arrayRemovePrivateData(rootId, segments, index, howMany)
    })
    return result.value
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
    const segments = ensureArraySignalTarget(this)
    const result = await runSignalStorageMutation(this, SIGNAL_VALUE_MUTATION_CONTEXT, segments, {
      public: segments => _arrayMovePublic(segments, from, to, howMany),
      private: (rootId, segments) => arrayMovePrivateData(rootId, segments, from, to, howMany)
    })
    return result.value
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
    const segments = ensureValueSignalTarget(this)
    const result = await runSignalStorageMutation(this, SIGNAL_VALUE_MUTATION_CONTEXT, segments, {
      public: segments => _stringInsertPublic(segments, index, text),
      private: (rootId, segments) => stringInsertPrivateData(rootId, segments, index, text)
    })
    return result.value
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
    const segments = ensureValueSignalTarget(this)
    const result = await runSignalStorageMutation(this, SIGNAL_VALUE_MUTATION_CONTEXT, segments, {
      public: segments => _stringRemovePublic(segments, index, howMany),
      private: (rootId, segments) => stringRemovePrivateData(rootId, segments, index, howMany)
    })
    return result.value
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
    const result = await runSignalStorageMutation(this, SIGNAL_VALUE_MUTATION_CONTEXT, segments, {
      public: async segments => {
        await _incrementPublic(segments, value)
        return currentValue + value
      },
      private: (rootId, segments) => {
        setReplacePrivateData(rootId, segments, currentValue + value)
        return currentValue + value
      }
    })
    if (result.skipped) return currentValue
    return result.value
  }

  /**
   * Add a document to a collection signal and return the new document id.
   * @param value Document value to create. May include an explicit `id` field.
   */
  async add (value: unknown): Promise<string> {
    if (arguments.length > 1) throw Error('Signal.add() expects a single argument')
    const collection = this[SEGMENTS][0]
    const collectionIdFields = getIdFieldsForSegments([collection, ''])
    const id = resolveAddDocId(value, collectionIdFields, uuid)
    const idFields = getIdFieldsForSegments([collection, id])
    await this[id].set(prepareAddPayload(value, idFields, id))
    return id
  }

  /** Delete this document or field. Whole collections and the root signal cannot be deleted. */
  async del (): Promise<void> {
    if (arguments.length > 0) throw Error('Signal.del() does not accept any arguments')
    await deleteSignalValue(this, SIGNAL_VALUE_MUTATION_CONTEXT)
  }

  // clone () {}
  // async assign () {}
  // async splice () {}
}

async function setDiffDeepOnSignal ($target, value) {
  if ($target[SEGMENTS].length === 0) throw Error('Can\'t set the root signal data')
  await diffDeepOnSignal($target, $target.peek(), value)
}

async function diffDeepOnSignal ($signal, before, after) {
  if (before === after) return

  if (Array.isArray(before) && Array.isArray(after)) {
    const diff = arrayDiff(before, after, deepEqual)
    if (!diff.length) return
    const index = getSingleArrayReplacementIndex(diff)
    if (index != null) {
      await diffDeepOnSignal(getChildSignal($signal, index), before[index], after[index])
      return
    }
    await applyArrayDiff($signal, diff)
    return
  }

  if (isDiffableObject(before, after)) {
    const preservePath = $signal[SEGMENTS]
    for (const key of Object.keys(before)) {
      if (Object.prototype.hasOwnProperty.call(after, key)) continue
      await deleteForDiffDeep(getChildSignal($signal, key), preservePath)
    }
    for (const key of Object.keys(after)) {
      await diffDeepOnSignal(getChildSignal($signal, key), before[key], after[key])
    }
    return
  }

  await $signal.setReplace(after)
}

function isDiffableObject (before, after) {
  if (!isPlainObject(before) || !isPlainObject(after)) return false
  if (isReactLike(before) || isReactLike(after)) return false
  return true
}

function isReactLike (value) {
  return !!(value && typeof value === 'object' && typeof value.$$typeof === 'symbol')
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

async function applyArrayDiff ($signal, diff) {
  for (const item of diff) {
    if (item instanceof arrayDiff.InsertDiff) {
      await $signal.insert(item.index, item.values)
      continue
    }
    if (item instanceof arrayDiff.RemoveDiff) {
      await $signal.remove(item.index, item.howMany)
      continue
    }
    if (item instanceof arrayDiff.MoveDiff) {
      await $signal.move(item.from, item.to, item.howMany)
    }
  }
}

async function deleteForDiffDeep ($signal, preservePath) {
  const segments = $signal[SEGMENTS]
  const idFields = getIdFieldsForSegments(segments)
  if (isIdFieldPath(segments, idFields)) return
  if (isPublicCollection(segments[0])) {
    await $signal.del()
    return
  }
  delPrivateData(getSignalOwningRootId($signal), segments, { preservePath })
}

function getChildSignal ($parent, key) {
  return getSignal(getRoot($parent) || $parent, [...$parent[SEGMENTS], key])
}

function deepEqual (left, right) {
  if (left === right) return true
  if (left == null || right == null) return false
  if (typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) !== Array.isArray(right)) return false

  if (Array.isArray(left)) {
    if (left.length !== right.length) return false
    for (let i = 0; i < left.length; i++) {
      if (!deepEqual(left[i], right[i])) return false
    }
    return true
  }

  if (!isPlainObject(left) || !isPlainObject(right)) return false
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false
    if (!deepEqual(left[key], right[key])) return false
  }
  return true
}

function racerEqual (left, right) {
  return left === right || (Number.isNaN(left) && Number.isNaN(right))
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

const QUERY_METHODS = ['map', 'reduce', 'find', 'get', 'getIds', 'getExtra', 'fetch', 'unfetch']
const AGGREGATION_ALLOWED_METHODS = ['fetch', 'unfetch']

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
        if (segments.length === 3 && (key === 'set' || key === 'setReplace')) {
          throw Error(ERRORS.setAggregationDoc(segments, key))
        }
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
