import type { Signal } from './Signal.js'

export const BaseModel: typeof Signal
export default BaseModel
export { default as Signal } from './Signal.js'
export type {
  AggregationSignal,
  AnySignal,
  CollectionSignal,
  CollectionSpec,
  DocumentSignal,
  FromJsonSchema,
  JsonSchema,
  JsonSchemaSpec,
  SignalClass,
  TypedSignal,
  ZodLikeSchema,
  ZodSchemaSpec
} from './Signal.js'
export type { RootSignal } from '../index.js'

export function belongsTo (AssociatedOrmEntity: any, options?: Record<string, any>): (OrmEntity: any) => any
export function hasMany (AssociatedOrmEntity: any, options?: Record<string, any>): (OrmEntity: any) => any
export function hasOne (AssociatedOrmEntity: any, options?: Record<string, any>): (OrmEntity: any) => any
