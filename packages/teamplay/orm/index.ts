// @ts-nocheck
import Signal from './Signal.ts'
export { belongsTo, hasMany, hasOne } from './associations.js'
export type {
  AggregationSignal,
  CollectionSignal,
  CollectionSignalFromSpec,
  CollectionSpec,
  DocumentSignal,
  FromJsonSchema,
  JsonSchema,
  JsonSchemaSpec,
  QuerySignal,
  SignalClass,
  TypedSignal,
  ZodLikeSchema,
  ZodSchemaSpec
} from './Signal.ts'
export type { RootSignal, TeamplayCollections } from '../index.ts'

export const BaseModel = Signal
export default BaseModel
