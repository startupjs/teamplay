import type Signal from './Signal.ts'

export type SubscriptionIntent = 'fetch' | 'subscribe'
export type TransportMode = 'idle' | 'fetch' | 'subscribe'
export type TransportPhase = 'stable' | 'transition'
export type SignalPathSegments = Array<string | number>

export interface ReadonlyMapView<TKey, TValue> extends Iterable<[TKey, TValue | undefined]> {
  get (key: TKey): TValue | undefined
  has (key: TKey): boolean
  readonly size: number
  keys (): IterableIterator<TKey>
  values (): IterableIterator<TValue | undefined>
  entries (): IterableIterator<[TKey, TValue | undefined]>
}

export interface PendingDestroyEntry {
  timer?: ReturnType<typeof setTimeout>
  force: boolean
  promise: Promise<unknown>
  resolve: () => void
  reject: (error?: unknown) => void
}

export interface DocOwnerMeta {
  hash: string
  segments: SignalPathSegments
  rootId?: string
}

export interface DocOwnerRecord extends DocOwnerMeta {
  ownerKey: string
  fetchCount: number
  subscribeCount: number
}

export interface DocRuntimeEntry {
  hash: string
  segments: SignalPathSegments
  mode: TransportMode
  targetMode: TransportMode
  phase: TransportPhase
  runtime: Doc | null
  owners: Set<string>
  retainCount: number
  pendingDestroy: PendingDestroyEntry | null
  reconcilePromise: Promise<void> | null
}

export class Doc {
  initialized?: boolean
  collection: string
  docId: string | number
  requestedTransportMode: TransportMode
  activeTransportMode: TransportMode
  readonly subscribed: boolean
  constructor (collection: string, docId: string | number)
  init (): void
  subscribe (options?: { mode?: Exclude<TransportMode, 'idle'> }): Promise<void>
  unsubscribe (): Promise<void>
  hasPending (): boolean
  whenNothingPending (fn: () => void): void
  destroy (): Promise<void>
  dispose (): void
}

export type DocConstructor = new (collection: string, docId: string | number) => Doc

export class DocSubscriptions {
  DocClass: DocConstructor
  ownerRecords: Map<string, DocOwnerRecord>
  entries: Map<string, DocRuntimeEntry>
  subCount: ReadonlyMapView<string, number>
  ownerFetchCount: ReadonlyMapView<string, number>
  ownerSubscribeCount: ReadonlyMapView<string, number>
  ownerMeta: ReadonlyMapView<string, DocOwnerMeta>
  ownerKeysByHash: ReadonlyMapView<string, Set<string>>
  docs: ReadonlyMapView<string, Doc>
  pendingDestroyTimers: ReadonlyMapView<string, PendingDestroyEntry>
  constructor (DocClass?: DocConstructor)
  init ($doc: Signal): void
  subscribe ($doc: Signal, options?: { intent?: SubscriptionIntent }): Promise<void> | void
  unsubscribe ($doc: Signal, options?: { intent?: SubscriptionIntent }): Promise<void>
  retain ($doc: Signal): void
  release ($doc: Signal): Promise<void>
  destroy (segments: SignalPathSegments): Promise<void>
  clear (): Promise<void>
  releaseRootOwnedSubscriptions (rootId: string): Promise<void>
  flushPendingDestroys (): Promise<void>
  scheduleDestroy (segments: SignalPathSegments, options?: { force?: boolean }): Promise<void> | void
  cancelDestroy (hash: string): void
  getOwnerMeta (ownerKey: string): DocOwnerMeta | undefined
  getOwnerKeys (hash: string): Set<string> | undefined
}

export const docSubscriptions: DocSubscriptions
