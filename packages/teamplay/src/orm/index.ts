import Signal from './Signal.ts'
export { belongsTo, hasMany, hasOne } from './associations.ts'
export type {
  AggregationSignal,
  ArraySignal,
  CollectionAggregationSignal,
  CollectionQuerySignal,
  CollectionSignal,
  CollectionSignalFromSpec,
  CollectionSpec,
  CollectionsFromManifest,
  ComputedQueryParamsInput,
  DocumentSignal,
  FromJsonSchema,
  JsonSchema,
  JsonSchemaSpec,
  ModelEntry,
  ModelManifest,
  PathModelsFromManifest,
  PrivateCollectionsFromManifest,
  PrivateSignalFromSpec,
  PublicSignal,
  RuntimeSignalConstructor,
  RuntimeSignalInstance,
  WildcardPathSegment,
  WildcardSignalPath,
  AppendPath,
  JoinPath,
  QueryParams,
  QueryParamsInput,
  QuerySignal,
  RegisteredAggregationInput,
  RootPrivateCollections,
  SignalBaseInstance,
  SignalClass,
  SignalChild,
  SignalConstructor,
  SignalForKind,
  SignalKind,
  SignalModelConstructor,
  TypedAggregationInput,
  TypedAggregationSignal,
  TypedSignal,
  ZodLikeSchema,
  ZodSchemaSpec
} from './Signal.ts'
export type {
  RootSignal,
  TeamplayCollections,
  TeamplayFeature,
  TeamplayFeatures,
  TeamplayModels,
  TeamplayPluginCollections,
  TeamplayPluginPrivateCollections,
  TeamplayPluginModels,
  TeamplayPluginOption,
  TeamplayPluginOptions,
  TeamplayPluginSignalFields,
  TeamplayPrivateCollections,
  TeamplaySignalFields
} from '../index.ts'

export const BaseModel = Signal
export default BaseModel
export {
  defineModels,
  default as initModels,
  getModels,
  resetModelsForTests
} from './initModels.ts'
export {
  default as reaction
} from './reaction.ts'
export type {
  ReactionHandle,
  ReactionOptions
} from './reaction.ts'
export { defineSchema } from '@teamplay/schema'
