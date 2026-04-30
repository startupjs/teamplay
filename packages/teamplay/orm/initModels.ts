import addModel, { MODELS } from './addModel.ts'
import type { ModelManifest } from './Signal.ts'

let models: ModelManifest = {}

export default function initModels<TModels extends ModelManifest = ModelManifest> (
  nextModels?: TModels | null
): TModels | ModelManifest {
  const resolvedModels: ModelManifest = nextModels || {}

  for (const [pattern, model] of Object.entries(resolvedModels)) {
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
  for (const pattern of Object.keys(MODELS)) delete MODELS[pattern]
}
