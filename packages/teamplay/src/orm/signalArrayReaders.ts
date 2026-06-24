import { HASH, IS_QUERY, QUERIES } from './Query.js'
import { SEGMENTS } from './signalSymbols.ts'
import type { PathSegment } from './types/path.ts'

export interface SignalArrayReaderOwner {
  readonly [SEGMENTS]: PathSegment[]
  readonly [HASH]?: string
  readonly [IS_QUERY]?: unknown
}

export interface SignalArrayReaderContext<TSignal extends SignalArrayReaderOwner> {
  getRoot: ($signal: TSignal) => TSignal | undefined
  readQueryIds: ($signal: TSignal) => unknown
  readArrayValue: ($signal: TSignal) => unknown
  createSignal: ($root: TSignal | undefined, segments: PathSegment[]) => TSignal
  warn: (message: string, ...args: unknown[]) => void
}

export interface QueryIdsWarningOptions {
  message: string
  method?: string
}

export function getSignalArrayChildren<TSignal extends SignalArrayReaderOwner> (
  $signal: TSignal,
  context: SignalArrayReaderContext<TSignal>,
  queryIdsWarning?: QueryIdsWarningOptions
): TSignal[] | undefined {
  if ($signal[IS_QUERY]) {
    const ids = context.readQueryIds($signal)
    if (!Array.isArray(ids)) {
      warnMissingQueryIds($signal, context, queryIdsWarning)
      return
    }
    const collection = $signal[SEGMENTS][0]
    const $root = context.getRoot($signal)
    return ids.map(id => context.createSignal($root, [collection, id]))
  }

  const items = context.readArrayValue($signal)
  if (!Array.isArray(items)) return
  const $root = context.getRoot($signal)
  return Array.from({ length: items.length }, (_, index) => (
    context.createSignal($root, [...$signal[SEGMENTS], index])
  ))
}

export function * iterateSignalArrayChildren<TSignal extends SignalArrayReaderOwner> (
  $signal: TSignal,
  context: SignalArrayReaderContext<TSignal>,
  queryIdsWarning?: QueryIdsWarningOptions
): IterableIterator<TSignal> {
  const children = getSignalArrayChildren($signal, context, queryIdsWarning)
  if (!children) return
  yield * children
}

export function runSignalArrayMethod<TSignal extends SignalArrayReaderOwner> (
  $signal: TSignal,
  context: SignalArrayReaderContext<TSignal>,
  method: string,
  nonArrayReturnValue: unknown,
  args: unknown[],
  queryIdsWarning?: QueryIdsWarningOptions
): unknown {
  const children = getSignalArrayChildren($signal, context, queryIdsWarning)
  if (!children) return nonArrayReturnValue
  const arrayReaders = children as unknown as Record<string, (...args: unknown[]) => unknown>
  return arrayReaders[method](...args)
}

function warnMissingQueryIds<TSignal extends SignalArrayReaderOwner> (
  $signal: TSignal,
  context: SignalArrayReaderContext<TSignal>,
  queryIdsWarning?: QueryIdsWarningOptions
): void {
  if (!queryIdsWarning) return
  const warningPath = [QUERIES, $signal[HASH], 'ids']
  if (queryIdsWarning.method) {
    context.warn(queryIdsWarning.message, warningPath, queryIdsWarning.method)
    return
  }
  context.warn(queryIdsWarning.message, warningPath)
}
