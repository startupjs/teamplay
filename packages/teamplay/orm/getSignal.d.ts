import type { AnySignal, SignalClass, SignalPath } from './Signal.js'

export default function getSignal (
  $root?: AnySignal,
  segments?: SignalPath,
  options?: {
    useExtremelyLateBindings?: boolean
    rootId?: string
    signalHash?: string
    proxyHandlers?: ProxyHandler<any>
  }
): AnySignal

export function getSignalClass (segments: SignalPath, rootId?: string): SignalClass<any>
export function rawSignal<TSignal extends object> (proxy: TSignal): TSignal | undefined
// eslint-disable-next-line @typescript-eslint/naming-convention
export const __DEBUG_SIGNALS_CACHE__: {
  readonly size: number
  get: (key: string) => unknown
  set: (key: string, value: unknown, dependencies?: unknown[]) => void
  delete: (key: string) => void
}
export function purgeSignalHashes (hashes: Iterable<string>): void
