import {
  getIdFieldsForSegments,
  isIdFieldPath
} from './idFields.ts'
import type { PathSegment } from './types/path.ts'

type MaybePromise<TValue> = TValue | Promise<TValue>

export interface SignalStorageMutationContext<TSignal> {
  getOwningRootId: ($signal: TSignal) => string | undefined
  isPublicCollection: (segment: PathSegment | undefined) => boolean
  isPrivateMutationForbidden: () => boolean
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

  ensurePrivateMutationAllowed(context)
  return {
    skipped: false,
    value: await handlers.private(context.getOwningRootId($signal), segments)
  }
}

export function ensurePrivateMutationAllowed<TSignal> (
  context: Pick<SignalStorageMutationContext<TSignal>, 'isPrivateMutationForbidden'>
): void {
  if (!context.isPrivateMutationForbidden()) return
  throw Error(`
    Can't modify private collections data when 'publicOnly' is enabled.
    On the server you can only work with public collections.
  `)
}
