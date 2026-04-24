// @ts-nocheck
import Signal from './Signal.ts'
export { belongsTo, hasMany, hasOne } from './associations.js'
export type {
  AggregationSignal,
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
  SignalConstructor,
  TypedAggregationInput,
  TypedAggregationSignal,
  TypedSignal,
  ZodLikeSchema,
  ZodSchemaSpec
} from './Signal.ts'
export type { RootSignal, TeamplayCollections, TeamplayModels } from '../index.ts'

export const BaseModel = Signal
export default BaseModel
