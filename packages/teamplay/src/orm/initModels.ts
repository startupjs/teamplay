import addModel, { MODELS } from './addModel.ts'
import type { ModelManifest } from './Signal.ts'
import { isDefinedSchema } from '@teamplay/schema'

let models: ModelManifest = {}
const warnedUnwrappedSchemaPatterns = new Set<string>()

export default function initModels<TModels extends ModelManifest = ModelManifest> (
  nextModels?: TModels | null
): TModels | ModelManifest {
  const resolvedModels: ModelManifest = nextModels || {}

  for (const [pattern, model] of Object.entries(resolvedModels)) {
    warnIfSchemaWasNotDefined(pattern, model?.schema)
    if (model?.default) addModel(pattern, model.default)
  }

  models = resolvedModels
  return resolvedModels
}

export function defineModels<TModels extends ModelManifest> (nextModels: TModels): TModels {
  return nextModels
}

export function getModels (): ModelManifest {
  return models
}

export function resetModelsForTests (): void {
  models = {}
  warnedUnwrappedSchemaPatterns.clear()
  for (const pattern of Object.keys(MODELS)) delete MODELS[pattern]
}

function warnIfSchemaWasNotDefined (pattern: string, schema: unknown): void {
  if (!schema) return
  if (isDefinedSchema(schema)) return
  if (!shouldWarnAboutUnwrappedSchemas()) return
  if (warnedUnwrappedSchemaPatterns.has(pattern)) return
  warnedUnwrappedSchemaPatterns.add(pattern)
  console.warn(
    `[teamplay] Schema for model "${pattern}" was loaded as a plain object. ` +
    'Wrap it with defineSchema(schema) to enable the conventional schema setup. ' +
    'Plain schemas still work.'
  )
}

function shouldWarnAboutUnwrappedSchemas (): boolean {
  const env = getProcessEnv()
  if (!env) return false
  if (env.TEAMPLAY_WARN_UNWRAPPED_SCHEMAS === '1') return true
  if (env.TEAMPLAY_WARN_UNWRAPPED_SCHEMAS === '0') return false
  if (env.NODE_ENV === 'production' || env.NODE_ENV === 'test') return false
  if (isTestProcess()) return false
  return true
}

function getProcessEnv (): Record<string, string | undefined> | undefined {
  return getProcessLike()?.env
}

function isTestProcess (): boolean {
  const processLike = getProcessLike()
  if (!processLike) return false
  if (processLike.env.JEST_WORKER_ID || processLike.env.VITEST) return true
  return processLike.argv.some((arg: string) => /(?:^|[/\\])(mocha|jest|vitest)(?:$|\.)/.test(arg))
}

function getProcessLike (): {
  env: Record<string, string | undefined>
  argv: string[]
} | undefined {
  const processLike = (globalThis as unknown as {
    process?: {
      env?: Record<string, string | undefined>
      argv?: string[]
    }
  }).process
  if (!processLike?.env || !processLike?.argv) return undefined
  return {
    env: processLike.env,
    argv: processLike.argv
  }
}
