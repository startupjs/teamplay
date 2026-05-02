import type Signal from './Signal.ts'
import type {
  PendingDestroyEntry,
  ReadonlyMapView,
  SubscriptionIntent,
  TransportMode,
  TransportPhase
} from './Doc.js'

export const COLLECTION_NAME: unique symbol
export const PARAMS: unique symbol
export const HASH: unique symbol
export const IS_QUERY: unique symbol
export const QUERIES: '$queries'

export interface QueryHashParts {
  collectionName?: string
  params?: unknown
}

export interface QuerySignalOptions {
  root?: Signal
  rootId?: string
  [option: string]: unknown
}

export interface QueryOwnerMeta {
  collectionName: string
  params: unknown
  transportHash: string
  rootId?: string
}

export interface QueryOwnerRecord extends QueryOwnerMeta {
  ownerKey: string
  fetchCount: number
  subscribeCount: number
}

export interface QueryRuntimeEntry {
  transportHash: string
  mode: TransportMode
  targetMode: TransportMode
  phase: TransportPhase
  runtime: Query | null
  owners: Set<string>
  pendingDestroyByOwner: Map<string, PendingQueryDestroyEntry>
  reconcilePromise: Promise<void> | null
}

export interface PendingQueryDestroyEntry extends PendingDestroyEntry {
  collectionName?: string
  params?: unknown
  transportHash?: string
}

export class Query {
  initialized?: boolean
  collectionName: string
  params: unknown
  hash: string
  rootIds: Set<string>
  docSignals: Set<Signal>
  requestedTransportMode: TransportMode
  activeTransportMode: TransportMode
  readonly subscribed: boolean
  constructor (collectionName: string, params: unknown, options?: { hash?: string })
  init (): void
  subscribe (options?: { mode?: Exclude<TransportMode, 'idle'> }): Promise<void>
  unsubscribe (): Promise<void>
  attachRoot (rootId?: string): void
  detachRoot (rootId?: string): void
}

export type QueryConstructor = new (
  collectionName: string,
  params: unknown,
  options?: { hash?: string }
) => Query

export class QuerySubscriptions {
  QueryClass: QueryConstructor
  runtimeKind: 'query' | 'aggregation'
  ownerRecords: Map<string, QueryOwnerRecord>
  entries: Map<string, QueryRuntimeEntry>
  subCount: ReadonlyMapView<string, number>
  transportSubCount: ReadonlyMapView<string, number>
  ownerFetchCount: ReadonlyMapView<string, number>
  ownerSubscribeCount: ReadonlyMapView<string, number>
  queries: ReadonlyMapView<string, Query>
  ownerToTransport: ReadonlyMapView<string, string>
  ownerMeta: ReadonlyMapView<string, QueryOwnerMeta>
  ownerKeysByTransport: ReadonlyMapView<string, Set<string>>
  pendingDestroyTimers: ReadonlyMapView<string, PendingQueryDestroyEntry>
  constructor (QueryClass?: QueryConstructor)
  subscribe ($query: Signal, options?: { intent?: SubscriptionIntent }): Promise<void> | void
  unsubscribe ($query: Signal, options?: { intent?: SubscriptionIntent }): Promise<void>
  destroy (collectionName: string, params: unknown, options?: { force?: boolean }): Promise<void>
  clear (): Promise<void>
  flushPendingDestroys (): Promise<void>
  scheduleDestroy (
    collectionName: string,
    params: unknown,
    ownerKey?: string,
    options?: { transportHash?: string, force?: boolean }
  ): Promise<void> | void
  cancelDestroy (ownerKey: string, transportHash?: string): void
  destroyByRuntimeHash (runtimeHash: string, options?: { rootId?: string, force?: boolean }): Promise<void>
  getOwnerMeta (ownerKey: string): QueryOwnerMeta | undefined
  getOwnerKeys (transportHash: string): Set<string> | undefined
  getPendingDestroyOwnerKeys (): IterableIterator<string>
}

export const querySubscriptions: QuerySubscriptions
export function getQuerySignal (collectionName: string, params: unknown, options?: QuerySignalOptions): Signal
export function hashQuery (collectionName: string, params: unknown): string
export function parseQueryHash (hash: string): QueryHashParts
