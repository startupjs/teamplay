import type { SignalClass } from './Signal.js'

export const MODELS: Record<string, SignalClass<any>>

export default function addModel<TModel extends SignalClass<any>> (
  pattern: string,
  Model: TModel
): void

export function findModel (segments: ReadonlyArray<string | number>): SignalClass<any> | undefined
