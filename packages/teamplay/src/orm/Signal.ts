import { Signal } from './SignalBase.ts'
import type { SignalConstructor } from './types/signal.ts'

export type {
  FromJsonSchema,
  InferZodSchema,
  JsonSchema,
  JsonSchemaObject,
  ZodLikeSchema
} from './types/jsonSchema.ts'
export type { ComputedQueryParamsInput, QueryParams, QueryParamsInput } from './types/query.ts'
export type {
  SignalArrayMutatorMethods,
  SignalArrayReaderMethods,
  SignalCollectionMethods,
  SignalMetadataMethods,
  SignalStringMutatorMethods,
  SignalValueMethods
} from './types/baseMethods.ts'
export type {
  AppendPath,
  JoinPath,
  PathSegment,
  SignalPath,
  WildcardPathSegment,
  WildcardSignalPath
} from './types/path.ts'
export type {
  AggregationSignal,
  AnySignal,
  ArraySignal,
  CollectionAggregationSignal,
  CollectionDocument,
  CollectionDocumentModel,
  CollectionQuerySignal,
  CollectionSignal,
  CollectionSignalFromSpec,
  CollectionSpec,
  DocumentSignal,
  JsonSchemaSpec,
  MaybePromise,
  MaybePromiseSubResult,
  PublicSignal,
  LocalSignalFactory,
  RegisteredAggregationInput,
  RuntimeSignalConstructor,
  RuntimeSignalInstance,
  QuerySignal,
  RootCollections,
  RootSignal,
  SignalBaseInstance,
  SignalChild,
  SignalChildren,
  SignalClass,
  SignalConstructor,
  SignalForKind,
  SignalKind,
  SignalInstance,
  SignalModelConstructor,
  PrivateSignalFromSpec,
  RootPrivateCollections,
  SubResult,
  TypedAggregationInput,
  TypedAggregationSignal,
  TypedSignal,
  ZodSchemaSpec
} from './types/signal.ts'
export type {
  CollectionsFromManifest,
  ModelEntry,
  ModelManifest,
  PathModelsFromManifest,
  PrivateCollectionsFromManifest
} from './types/modelManifest.ts'

export {
  Signal,
  SEGMENTS,
  ARRAY_METHOD,
  GET,
  GETTERS,
  DEFAULT_GETTERS,
  regularBindings,
  extremelyLateBindings,
  isPublicCollectionSignal,
  isPublicDocumentSignal,
  isPublicCollection,
  isPrivateCollection
} from './SignalBase.ts'

const DefaultSignal = Signal as unknown as SignalConstructor

export default DefaultSignal
