export function useId (): string
export function useNow (interval?: number): number
export function useScheduleUpdate (): (delay?: number) => void
export function useTriggerUpdate (): () => void
export type EffectCleanup = () => void
export type EffectCallback = () => undefined | EffectCleanup

export function useDidUpdate (fn: EffectCallback, deps?: any[]): void
export function useOnce (condition: any, fn: EffectCallback): void
export function useSyncEffect (fn: EffectCallback, deps?: any[]): void
