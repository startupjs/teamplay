import type { Signal as BaseSignal } from '../SignalBase.ts'
import type {
  CollectionSpec,
  JsonSchemaSpec,
  SignalClass
} from './signal.ts'

export interface ModelEntry<
  TModel extends SignalClass<any> = SignalClass<any>,
  TSchema = unknown
> {
  default?: TModel
  schema?: TSchema
  access?: unknown
  [key: string]: unknown
}

export type ModelManifest = Record<string, ModelEntry>

type StringKey<TValue> = Extract<keyof TValue, string>

type CollectionManifestKey<TKey extends string> =
  TKey extends ''
    ? never
    : TKey extends `${string}.${string}`
      ? never
      : TKey extends `${string}*${string}`
        ? never
        : TKey

type CollectionManifestKeys<TModels> = {
  [K in StringKey<TModels>]: CollectionManifestKey<K>
}[StringKey<TModels>]

type ModelPathManifestKey<TKey extends string> =
  TKey extends ''
    ? never
    : TKey extends `${string}*${string}`
      ? TKey
      : never

type ModelPathManifestKeys<TModels> = {
  [K in StringKey<TModels>]: ModelPathManifestKey<K>
}[StringKey<TModels>]

type ManifestEntry<TModels, TKey extends string> =
  TKey extends keyof TModels ? TModels[TKey] : {}

type ModelFromEntry<
  TEntry,
  TFallback extends SignalClass<any> = typeof BaseSignal
> =
  TEntry extends { default: infer TModel }
    ? TModel extends SignalClass<any>
      ? TModel
      : TFallback
    : TFallback

type SchemaFromEntry<TEntry> =
  TEntry extends { schema: infer TSchema } ? TSchema : never

type CollectionSpecFromManifestEntry<TModels, TCollection extends string> =
  [SchemaFromEntry<ManifestEntry<TModels, TCollection>>] extends [never]
    ? CollectionSpec<
        unknown,
        ModelFromEntry<ManifestEntry<TModels, TCollection>>,
        ModelFromEntry<ManifestEntry<TModels, `${TCollection}.*`>>
      >
    : JsonSchemaSpec<
        SchemaFromEntry<ManifestEntry<TModels, TCollection>>,
        ModelFromEntry<ManifestEntry<TModels, TCollection>>,
        ModelFromEntry<ManifestEntry<TModels, `${TCollection}.*`>>
      >

export type CollectionsFromManifest<TModels extends Record<string, any>> = {
  [K in CollectionManifestKeys<TModels>]: CollectionSpecFromManifestEntry<TModels, K>
}

export type PathModelsFromManifest<TModels extends Record<string, any>> = {
  [K in ModelPathManifestKeys<TModels> as ManifestEntry<TModels, K> extends { default: any } ? K : never]: ModelFromEntry<ManifestEntry<TModels, K>>
}
