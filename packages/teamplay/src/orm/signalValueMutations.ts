import {
  getIdFieldsForSegments,
  isIdFieldPath,
  isPublicDocPath,
  normalizeIdFields
} from './idFields.ts'
import type { SignalStorageMutationContext } from './signalStorageMutations.ts'
import { SEGMENTS } from './signalSymbols.ts'
import type { PathSegment } from './types/path.ts'

export interface SignalValueMutationOwner {
  readonly [SEGMENTS]: PathSegment[]
}

export interface SignalValueMutationContext<TSignal extends SignalValueMutationOwner>
  extends SignalStorageMutationContext<TSignal> {
  setPublicDoc: (segments: PathSegment[], value: unknown) => Promise<unknown> | unknown
  setPrivateData: (
    rootId: string | undefined,
    segments: PathSegment[],
    value: unknown
  ) => void
  deletePublicDoc: (segments: PathSegment[]) => Promise<unknown> | unknown
  deletePrivateData: (rootId: string | undefined, segments: PathSegment[]) => void
}

export async function setSignalValue<TSignal extends SignalValueMutationOwner> (
  $signal: TSignal,
  context: SignalValueMutationContext<TSignal>,
  value: unknown
): Promise<void> {
  const segments = $signal[SEGMENTS]
  if (segments.length === 0) throw Error('Can\'t set the root signal data')

  const idFields = getIdFieldsForSegments(segments)
  if (isIdFieldPath(segments, idFields)) return

  const nextValue = isPublicDocPath(segments)
    ? normalizeIdFields(value, idFields, segments[1])
    : value

  if (context.isPublicCollection(segments[0])) {
    await context.setPublicDoc(segments, nextValue)
    return
  }

  context.setPrivateData(context.getOwningRootId($signal), segments, nextValue)
}

export async function deleteSignalValue<TSignal extends SignalValueMutationOwner> (
  $signal: TSignal,
  context: SignalValueMutationContext<TSignal>
): Promise<void> {
  const segments = $signal[SEGMENTS]
  if (segments.length === 0) throw Error('Can\'t delete the root signal data')

  const idFields = getIdFieldsForSegments(segments)
  if (isIdFieldPath(segments, idFields)) return

  if (context.isPublicCollection(segments[0])) {
    if (segments.length === 1) throw Error('Can\'t delete the whole collection')
    await context.deletePublicDoc(segments)
    return
  }

  context.deletePrivateData(context.getOwningRootId($signal), segments)
}
