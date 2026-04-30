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
  DocumentSignal,
  FromJsonSchema,
  JsonSchema,
  JsonSchemaSpec,
  WildcardPathSegment,
  WildcardSignalPath,
  AppendPath,
  QueryParams,
  QuerySignal,
  RegisteredAggregationInput,
  SignalClass,
  SignalChild,
  SignalConstructor,
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
  default as initModels,
  getModels,
  resetModelsForTests
} from './initModels.ts'
