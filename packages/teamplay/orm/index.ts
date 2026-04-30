// @ts-nocheck
import Signal from './Signal.ts'
export { belongsTo, hasMany, hasOne } from './associations.js'
export type {
  AggregationSignal,
  ArraySignal,
  CollectionAggregationSignal,
  CollectionQuerySignal,
  CollectionSignal,
  CollectionSignalFromSpec,
  CollectionSpec,
  CollectionsFromManifest,
  DocumentSignal,
  FromJsonSchema,
  JsonSchema,
  JsonSchemaSpec,
  ModelEntry,
  ModelManifest,
  PathModelsFromManifest,
  WildcardPathSegment,
  WildcardSignalPath,
  AppendPath,
  QueryParams,
  QuerySignal,
  RegisteredAggregationInput,
  SignalClass,
  SignalChild,
  SignalConstructor,
  SignalForKind,
  SignalKind,
  TypedAggregationInput,
  TypedAggregationSignal,
  TypedSignal,
  ZodLikeSchema,
  ZodSchemaSpec
} from './Signal.ts'
export type { RootSignal, TeamplayCollections, TeamplayModels, TeamplaySignalFields } from '../index.ts'

export const BaseModel = Signal
export default BaseModel
export {
  defineModels,
  default as initModels,
  getModels,
  resetModelsForTests
} from './initModels.ts'
