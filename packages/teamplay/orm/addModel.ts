import type { SignalClass } from './Signal.ts'
import type { TeamplayModels } from '../index.ts'
import type { PathSegment } from './types/path.ts'

export const MODELS: Record<string, SignalClass<any>> = {}

export default function addModel<TPattern extends string> (
  pattern: TPattern,
  Model: TPattern extends keyof TeamplayModels ? TeamplayModels[TPattern] : SignalClass<any>
): void {
  if (typeof pattern !== 'string') throw Error('Model pattern must be a string, e.g. "users.*"')
  if (/\s/.test(pattern)) throw Error('Model pattern can not have spaces')
  if (typeof Model !== 'function') throw Error('Model must be a class')
  const normalizedPattern = pattern.replace(/\[[^\]]+\]/g, '*') // replace `[id]` with `*`
  if (normalizedPattern !== '' && normalizedPattern.split('.').some(segment => segment === '')) {
    throw Error('Model pattern can not have empty segments')
  }
  if (MODELS[normalizedPattern]) {
    if (MODELS[normalizedPattern] === Model) return
    throw Error(`Model for pattern "${normalizedPattern}" already exists`)
  }
  MODELS[normalizedPattern] = Model
}

export function findModel (segments: PathSegment[]): SignalClass<any> | undefined {
  // if segments is an empty array, treat it as a top-level signal.
  // Top-level signal class is the one that has an empty string as a pattern.
  if (segments.length === 0) segments = ['']
  for (const pattern in MODELS) {
    const patternSegments = pattern.split('.')
    if (segments.length !== patternSegments.length) continue
    let match = true
    for (let i = 0; i < segments.length; i++) {
      if (patternSegments[i] !== '*' && patternSegments[i] !== segments[i]) {
        match = false
        break
      }
    }
    if (match) return MODELS[pattern]
  }
}
