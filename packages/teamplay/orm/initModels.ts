// @ts-nocheck
import addModel, { MODELS } from './addModel.ts'

let models = {}

export default function initModels (nextModels = {}) {
  nextModels = nextModels || {}

  for (const [pattern, model] of Object.entries(nextModels)) {
    if (model?.default) addModel(pattern, model.default)
  }

  models = nextModels
  return models
}

export function getModels () {
  return models
}

export function resetModelsForTests () {
  models = {}
  for (const pattern of Object.keys(MODELS)) delete MODELS[pattern]
}
