import {
  getIdFieldsForSegments,
  isIdFieldPath
} from './idFields.ts'
import type { PathSegment } from './types/path.ts'

type MaybePromise<TValue> = TValue | Promise<TValue>

export interface SignalStorageMutationContext<TSignal> {
  getOwningRootId: ($signal: TSignal) => string | undefined
  isPublicCollection: (segment: PathSegment | undefined) => boolean
}

export interface SignalStorageMutationHandlers<TResult> {
  public: (segments: PathSegment[]) => MaybePromise<TResult>
  private: (rootId: string | undefined, segments: PathSegment[]) => MaybePromise<TResult>
}

export interface SignalStorageMutationResult<TResult> {
  skipped: boolean
  value: TResult | undefined
}

export async function runSignalStorageMutation<TSignal, TResult> (
  $signal: TSignal,
  context: SignalStorageMutationContext<TSignal>,
  segments: PathSegment[],
  handlers: SignalStorageMutationHandlers<TResult>
): Promise<SignalStorageMutationResult<TResult>> {
  const idFields = getIdFieldsForSegments(segments)
  if (isIdFieldPath(segments, idFields)) {
    return { skipped: true, value: undefined }
  }

  if (context.isPublicCollection(segments[0])) {
    return {
      skipped: false,
      value: await handlers.public(segments)
    }
  }

  return {
    skipped: false,
    value: await handlers.private(context.getOwningRootId($signal), segments)
  }
}
