import { Signal } from './SignalBase.ts'
import SignalCompat from './Compat/SignalCompat.js'
import { isCompatEnv } from './compatEnv.js'
import type { SignalConstructor } from './types/signal.ts'

export type {
  FromJsonSchema,
  InferZodSchema,
  JsonSchema,
  JsonSchemaObject,
  ZodLikeSchema
} from './types/jsonSchema.ts'
export type { QueryParams } from './types/query.ts'
export type {
  AppendPath,
  PathSegment,
  SignalPath,
  WildcardPathSegment,
  WildcardSignalPath
} from './types/path.ts'
export type {
  AggregationSignal,
  AnySignal,
  CollectionAggregationSignal,
  CollectionDocument,
  CollectionDocumentModel,
  CollectionQuerySignal,
  CollectionSignal,
  CollectionSignalFromSpec,
  CollectionSpec,
  DocumentSignal,
  JsonSchemaSpec,
  RegisteredAggregationInput,
  QuerySignal,
  SignalChild,
  SignalChildren,
  SignalClass,
  SignalConstructor,
  SignalInstance,
  TypedAggregationInput,
  TypedAggregationSignal,
  TypedSignal,
  ZodSchemaSpec
} from './types/signal.ts'

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

export { SignalCompat }

const DefaultSignal = (isCompatEnv() ? SignalCompat : Signal) as unknown as SignalConstructor

export default DefaultSignal
