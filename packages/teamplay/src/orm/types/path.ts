export type PathSegment = string | number
export type SignalPath = readonly PathSegment[]
export type WildcardPathSegment = PathSegment | '*'
export type WildcardSignalPath = readonly WildcardPathSegment[]

export type AppendPath<TPath extends WildcardSignalPath, TSegment extends WildcardPathSegment> =
  readonly [...TPath, TSegment]

type SegmentPattern<TSegment> =
  TSegment extends '*' ? '*'
    : TSegment extends number ? '*'
      : TSegment extends string ? TSegment
        : never

export type JoinPath<TPath extends WildcardSignalPath> =
  TPath extends readonly []
    ? ''
    : TPath extends readonly [infer Head]
      ? SegmentPattern<Head>
      : TPath extends readonly [infer Head, ...infer Rest]
        ? Rest extends WildcardSignalPath
          ? `${SegmentPattern<Head>}.${JoinPath<Rest>}`
          : never
        : string
