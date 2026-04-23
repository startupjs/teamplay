type IsPlainObject<TValue> =
  NonNullable<TValue> extends readonly unknown[] ? false
    : NonNullable<TValue> extends object ? true
      : false

type QueryPath<TValue> =
  NonNullable<TValue> extends object
    ? {
        [K in keyof NonNullable<TValue> & string]:
        IsPlainObject<NonNullable<TValue>[K]> extends true
          ? K | `${K}.${QueryPath<NonNullable<TValue>[K]>}`
          : K
      }[keyof NonNullable<TValue> & string]
    : never

type QueryPathValue<TValue, TPath extends string> =
  TPath extends `${infer Head}.${infer Tail}`
    ? Head extends keyof NonNullable<TValue>
      ? QueryPathValue<NonNullable<TValue>[Head], Tail>
      : never
    : TPath extends keyof NonNullable<TValue>
      ? NonNullable<TValue>[TPath]
      : never

type QueryComparable<TValue> =
  NonNullable<TValue> extends ReadonlyArray<infer Item>
    ? Item | NonNullable<TValue>
    : NonNullable<TValue>

type QueryValue<TValue> =
  | QueryComparable<TValue>
  | {
    $eq?: QueryComparable<TValue>
    $ne?: QueryComparable<TValue>
    $in?: Array<QueryComparable<TValue>>
    $nin?: Array<QueryComparable<TValue>>
    $gt?: QueryComparable<TValue>
    $gte?: QueryComparable<TValue>
    $lt?: QueryComparable<TValue>
    $lte?: QueryComparable<TValue>
    $exists?: boolean
    $regex?: TValue extends string ? string | RegExp : never
  }

export type QueryParams<TDocument> = {
  [K in QueryPath<TDocument>]?: QueryValue<QueryPathValue<TDocument, K>>
} & {
  [K in `$${string}`]?: unknown
}
