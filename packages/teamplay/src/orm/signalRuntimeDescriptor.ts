import { SEGMENTS } from './Signal.ts'
import { isPrivateCollection, isPublicCollection } from './signalPathKind.ts'

const LOCAL_COLLECTION = '$local'

export type SignalRuntimeKind =
  | 'root'
  | 'collection'
  | 'document'
  | 'nestedValue'
  | 'localArray'
  | 'query'
  | 'aggregation'

export interface SignalRuntimeDescriptor {
  readonly kind: SignalRuntimeKind
  readonly segments: ReadonlyArray<string | number>
  readonly collectionName?: string
  readonly documentId?: string | number
  readonly itemPattern?: ReadonlyArray<string | number>
}

export interface SignalRuntimeDescriptorOptions {
  readonly kind?: SignalRuntimeKind
  readonly collectionName?: string
  readonly documentId?: string | number
  readonly itemPattern?: ReadonlyArray<string | number>
  readonly value?: unknown
}

export const SIGNAL_RUNTIME_DESCRIPTOR = Symbol('teamplay signal runtime descriptor')

export function setSignalRuntimeDescriptor (
  $signal: unknown,
  options: SignalRuntimeDescriptorOptions = {}
): SignalRuntimeDescriptor {
  const descriptor = describeSignalRuntime($signal, options)
  Object.defineProperty($signal, SIGNAL_RUNTIME_DESCRIPTOR, {
    configurable: true,
    value: descriptor
  })
  return descriptor
}

export function getSignalRuntimeDescriptor (
  $signal: unknown,
  options: SignalRuntimeDescriptorOptions = {}
): SignalRuntimeDescriptor {
  return getStoredSignalRuntimeDescriptor($signal) ?? describeSignalRuntime($signal, options)
}

export function describeSignalRuntime (
  signalOrSegments: unknown,
  options: SignalRuntimeDescriptorOptions = {}
): SignalRuntimeDescriptor {
  const segments = getDescriptorSegments(signalOrSegments)
  const kind = options.kind ?? inferSignalRuntimeKind(segments, options.value)
  const collectionName = options.collectionName ?? inferCollectionName(kind, segments)
  const documentId = options.documentId ?? inferDocumentId(kind, segments)
  const itemPattern = options.itemPattern ?? inferItemPattern(kind, segments, collectionName, options.value)

  return compactDescriptor({
    kind,
    segments,
    collectionName,
    documentId,
    itemPattern
  })
}

function getStoredSignalRuntimeDescriptor ($signal: unknown): SignalRuntimeDescriptor | undefined {
  if (!$signal || (typeof $signal !== 'object' && typeof $signal !== 'function')) return undefined
  return ($signal as { [SIGNAL_RUNTIME_DESCRIPTOR]?: SignalRuntimeDescriptor })[SIGNAL_RUNTIME_DESCRIPTOR]
}

function getDescriptorSegments (signalOrSegments: unknown): ReadonlyArray<string | number> {
  if (Array.isArray(signalOrSegments)) return signalOrSegments.slice()
  if (!signalOrSegments || (typeof signalOrSegments !== 'object' && typeof signalOrSegments !== 'function')) return []
  const segments = (signalOrSegments as { [SEGMENTS]?: Array<string | number> })[SEGMENTS]
  return Array.isArray(segments) ? segments.slice() : []
}

function inferSignalRuntimeKind (
  segments: ReadonlyArray<string | number>,
  value: unknown
): SignalRuntimeKind {
  if (segments.length === 0) return 'root'
  if (segments[0] === LOCAL_COLLECTION && Array.isArray(value)) return 'localArray'
  if (typeof segments[0] === 'string' && isPublicCollection(segments[0])) {
    if (segments.length === 1) return 'collection'
    if (segments.length === 2) return 'document'
  }
  return 'nestedValue'
}

function inferCollectionName (
  kind: SignalRuntimeKind,
  segments: ReadonlyArray<string | number>
): string | undefined {
  if (kind === 'query' || kind === 'aggregation') return undefined
  const firstSegment = segments[0]
  if (typeof firstSegment !== 'string') return undefined
  if (isPrivateCollection(firstSegment)) return undefined
  return firstSegment
}

function inferDocumentId (
  kind: SignalRuntimeKind,
  segments: ReadonlyArray<string | number>
): string | number | undefined {
  if (kind !== 'document' && kind !== 'nestedValue') return undefined
  if (typeof segments[0] !== 'string' || !isPublicCollection(segments[0])) return undefined
  return segments.length >= 2 ? segments[1] : undefined
}

function inferItemPattern (
  kind: SignalRuntimeKind,
  segments: ReadonlyArray<string | number>,
  collectionName: string | undefined,
  value: unknown
): ReadonlyArray<string | number> | undefined {
  if (kind === 'collection' || kind === 'query' || kind === 'aggregation') {
    if (!collectionName) return undefined
    return [collectionName, '*']
  }
  if (kind === 'localArray') return [...segments, '*']
  if (kind === 'nestedValue' && Array.isArray(value)) return [...segments, '*']
  return undefined
}

function compactDescriptor (descriptor: {
  kind: SignalRuntimeKind
  segments: ReadonlyArray<string | number>
  collectionName?: string
  documentId?: string | number
  itemPattern?: ReadonlyArray<string | number>
}): SignalRuntimeDescriptor {
  const result: {
    kind: SignalRuntimeKind
    segments: ReadonlyArray<string | number>
    collectionName?: string
    documentId?: string | number
    itemPattern?: ReadonlyArray<string | number>
  } = {
    kind: descriptor.kind,
    segments: Object.freeze(descriptor.segments.slice())
  }
  if (descriptor.collectionName !== undefined) result.collectionName = descriptor.collectionName
  if (descriptor.documentId !== undefined) result.documentId = descriptor.documentId
  if (descriptor.itemPattern !== undefined) result.itemPattern = Object.freeze(descriptor.itemPattern.slice())
  return Object.freeze(result)
}
