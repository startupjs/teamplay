export interface SignalMetadataMethods {
  path: () => string
  leaf: () => string
  [Symbol.toPrimitive]: (hint?: string) => string
  toString: () => string
  readonly [Symbol.toStringTag]: string
  parent: (levels?: number) => unknown
  id: () => string
  getId: () => string | number
  getCollection: () => string
  getAssociations: () => readonly unknown[]
}

export interface SignalValueMethods<TValue> {
  get: () => TValue
  peek: () => TValue
  set: (value: TValue) => Promise<void>
  assign: (value: NonNullable<TValue> extends object ? Partial<NonNullable<TValue>> : never) => Promise<void>
  del: () => Promise<void>
  increment: (value?: number) => Promise<number>
}

export interface SignalArrayReaderMethods<TItem> {
  readonly [Symbol.iterator]: () => IterableIterator<TItem>
  map: <TResult>(callback: (value: TItem, index: number, array: TItem[]) => TResult, thisArg?: any) => TResult[]
  reduce: {
    (callback: (previousValue: TItem, currentValue: TItem, currentIndex: number, array: TItem[]) => TItem): TItem
    (callback: (previousValue: TItem, currentValue: TItem, currentIndex: number, array: TItem[]) => TItem, initialValue: TItem): TItem
    <TResult>(
      callback: (previousValue: TResult, currentValue: TItem, currentIndex: number, array: TItem[]) => TResult,
      initialValue: TResult
    ): TResult
  }
  find: (predicate: (value: TItem, index: number, obj: TItem[]) => unknown, thisArg?: any) => TItem | undefined
}

export interface SignalArrayMutatorMethods<TItem> {
  push: (value: TItem) => Promise<unknown>
  pop: () => Promise<TItem | undefined>
  unshift: (value: TItem) => Promise<unknown>
  shift: () => Promise<TItem | undefined>
  insert: (index: number, values: TItem | TItem[]) => Promise<unknown>
  remove: (index: number, howMany?: number) => Promise<unknown>
  move: (from: number, to: number, howMany?: number) => Promise<unknown>
}

export interface SignalStringMutatorMethods {
  stringInsert: (index: number, text: string) => Promise<unknown>
  stringRemove: (index: number, howMany?: number) => Promise<unknown>
}

export interface SignalCollectionMethods<TDocument> extends SignalArrayReaderMethods<TDocument>, SignalArrayMutatorMethods<TDocument> {
  add: (value: TDocument) => Promise<string>
}
