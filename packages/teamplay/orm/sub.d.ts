import type {
  AggregationSignal,
  CollectionDocument,
  CollectionDocumentModel,
  CollectionSignal,
  QuerySignal,
  Signal
} from './Signal.js'
import type { TeamplayCollections } from '../index.js'

export default function sub<TSignal extends Signal<any>> (
  $signal: TSignal
): TSignal | Promise<TSignal>

export default function sub<TDocument, TDocumentModel extends new (...args: any[]) => any> (
  $collection: CollectionSignal<TDocument, any, TDocumentModel>,
  params: Record<string, any>
): QuerySignal<TDocument, TDocumentModel> | Promise<QuerySignal<TDocument, TDocumentModel>>

export default function sub<TCollection extends keyof TeamplayCollections & string> (
  $aggregation: {
    readonly __isAggregation: true
    readonly collection: TCollection
  },
  params?: Record<string, any>
): AggregationSignal<
CollectionDocument<TeamplayCollections[TCollection]>,
CollectionDocumentModel<TeamplayCollections[TCollection]>
> | Promise<AggregationSignal<
CollectionDocument<TeamplayCollections[TCollection]>,
CollectionDocumentModel<TeamplayCollections[TCollection]>
>>

export default function sub<TDocument, TDocumentModel extends new (...args: any[]) => any> (
  $aggregation: {
    readonly __isAggregation: true
    readonly collection: string
    readonly __teamplayDocument?: TDocument
    readonly __teamplayDocumentModel?: TDocumentModel
  },
  params?: Record<string, any>
): AggregationSignal<TDocument, TDocumentModel> | Promise<AggregationSignal<TDocument, TDocumentModel>>

export default function sub<TSignal, TParams> (
  $signal: TSignal,
  params?: TParams
): any
