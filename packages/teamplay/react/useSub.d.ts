import type {
  AggregationSignal,
  CollectionDocument,
  CollectionDocumentModel,
  CollectionSignal,
  QuerySignal,
  Signal
} from '../orm/Signal.js'
import type { TeamplayCollections } from '../index.js'

export interface UseSubOptions {
  async?: boolean
  defer?: boolean | number
  batch?: boolean
  compatAttemptCleanup?: boolean
}

export default function useSub<TSignal extends Signal<any>> (
  signal: TSignal,
  params?: undefined,
  options?: UseSubOptions
): TSignal

export default function useSub<TDocument, TDocumentModel extends new (...args: any[]) => any> (
  signal: CollectionSignal<TDocument, any, TDocumentModel>,
  params: Record<string, any>,
  options?: UseSubOptions
): QuerySignal<TDocument, TDocumentModel>

export default function useSub<TCollection extends keyof TeamplayCollections & string> (
  signal: {
    readonly __isAggregation: true
    readonly collection: TCollection
  },
  params?: Record<string, any>,
  options?: UseSubOptions
): AggregationSignal<
CollectionDocument<TeamplayCollections[TCollection]>,
CollectionDocumentModel<TeamplayCollections[TCollection]>
>

export default function useSub<TDocument, TDocumentModel extends new (...args: any[]) => any> (
  signal: {
    readonly __isAggregation: true
    readonly collection: string
    readonly __teamplayDocument?: TDocument
    readonly __teamplayDocumentModel?: TDocumentModel
  },
  params?: Record<string, any>,
  options?: UseSubOptions
): AggregationSignal<TDocument, TDocumentModel>

export default function useSub (signal: any, params?: any, options?: UseSubOptions): any

export function useAsyncSub<TSignal extends Signal<any>> (
  signal: TSignal,
  params?: undefined,
  options?: UseSubOptions
): TSignal

export function useAsyncSub<TDocument, TDocumentModel extends new (...args: any[]) => any> (
  signal: CollectionSignal<TDocument, any, TDocumentModel>,
  params: Record<string, any>,
  options?: UseSubOptions
): QuerySignal<TDocument, TDocumentModel>

export function useAsyncSub<TCollection extends keyof TeamplayCollections & string> (
  signal: {
    readonly __isAggregation: true
    readonly collection: TCollection
  },
  params?: Record<string, any>,
  options?: UseSubOptions
): AggregationSignal<
CollectionDocument<TeamplayCollections[TCollection]>,
CollectionDocumentModel<TeamplayCollections[TCollection]>
>

export function useAsyncSub<TDocument, TDocumentModel extends new (...args: any[]) => any> (
  signal: {
    readonly __isAggregation: true
    readonly collection: string
    readonly __teamplayDocument?: TDocument
    readonly __teamplayDocumentModel?: TDocumentModel
  },
  params?: Record<string, any>,
  options?: UseSubOptions
): AggregationSignal<TDocument, TDocumentModel>

export function useAsyncSub (signal: any, params?: any, options?: UseSubOptions): any
export function setUseDeferredValue (enabled: boolean): void
export function setDefaultDefer (value?: boolean | number): boolean | number | undefined
