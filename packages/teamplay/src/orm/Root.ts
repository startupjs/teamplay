import getSignal from './getSignal.ts'
import disposeRootContext from './disposeRootContext.ts'
import { getRootContext, reviveRootContext } from './rootContext.ts'
import { isGlobalRootId, normalizeRootId } from './rootScope.ts'
import ExportedFinalizationRegistry from '../utils/MockFinalizationRegistry.ts'
import type { SignalBaseInstance } from './Signal.ts'

export const ROOT_FUNCTION = Symbol('root function')
// TODO: in future make a connection spawnable instead of a singleton
// export const CONNECTION = Symbol('sharedb connection, used by sub() function')
export const ROOT = Symbol('root signal')
export const ROOT_ID = Symbol('root signal id. Used for caching')

export const GLOBAL_ROOT_ID = '__global__'

export interface RootSignalOptions extends Record<string, unknown> {
  rootFunction?: unknown
  fetchOnly?: boolean
  rootId?: string
}

export type RootTransportIntent = 'fetch' | 'subscribe'

export type RootSignalRuntime = SignalBaseInstance & {
  [ROOT_FUNCTION]?: unknown
  [ROOT]?: RootSignalRuntime
  [ROOT_ID]?: string
}

type FinalizationRegistryConstructor = new (
  cleanupCallback: (heldValue: string) => void
) => {
  register: (target: RootSignalRuntime, value: string, token?: RootSignalRuntime) => void
  unregister: (token: RootSignalRuntime) => void
}

type RuntimeGetSignal = (
  root: unknown,
  segments: readonly [],
  options: Record<string, unknown>
) => unknown

const getRuntimeSignal = getSignal as unknown as RuntimeGetSignal
const RootFinalizationRegistry = ExportedFinalizationRegistry as unknown as FinalizationRegistryConstructor

const ROOT_FINALIZATION_REGISTRY = new RootFinalizationRegistry((rootId: string) => {
  disposeRootContext(rootId).catch(err => {
    console.error(err)
  })
})
const REGISTERED_ROOT_SIGNALS = new WeakSet<RootSignalRuntime>()

// TODO: create a separate local root for private collections
export function getRootSignal ({
  rootFunction,
  fetchOnly,
  // connection,
  rootId = '_' + createRandomString(8),
  ...options
}: RootSignalOptions = {}): RootSignalRuntime {
  reviveRootContext(rootId)
  getRootContext(rootId, true, { fetchOnly })
  const $root = getRuntimeSignal(undefined, [], {
    rootId,
    ...options
  }) as RootSignalRuntime
  $root[ROOT_FUNCTION] ??= rootFunction
  // $root[CONNECTION] ??= connection
  $root[ROOT_ID] ??= rootId
  registerRootFinalizer($root)
  return $root
}

export function getRoot (signal: RootSignalRuntime | undefined): RootSignalRuntime | undefined {
  if (!signal) return undefined
  if (signal[ROOT]) return signal[ROOT]
  else if (signal[ROOT_ID]) return signal
  else return undefined
}

export function getRootFetchOnly (rootOrRootId: RootSignalRuntime | string | undefined): boolean {
  const $root = typeof rootOrRootId === 'string'
    ? undefined
    : (getRoot(rootOrRootId) || rootOrRootId)
  const rootId = typeof rootOrRootId === 'string'
    ? rootOrRootId
    : $root?.[ROOT_ID]
  const context = getRootContext(rootId, false)
  return context?.getFetchOnly() ?? false
}

export function getRootTransportMode (
  rootOrRootId: RootSignalRuntime | string | undefined,
  intent: RootTransportIntent = 'subscribe'
): RootTransportIntent {
  if (intent === 'fetch') return 'fetch'
  return getRootFetchOnly(rootOrRootId) ? 'fetch' : 'subscribe'
}

export function registerRootFinalizer ($root: RootSignalRuntime | undefined): void {
  if (!$root?.[ROOT_ID]) return
  if (REGISTERED_ROOT_SIGNALS.has($root)) return
  const rootId = normalizeRootId($root[ROOT_ID])
  if (isGlobalRootId(rootId)) return
  ROOT_FINALIZATION_REGISTRY.register($root, rootId, $root)
  REGISTERED_ROOT_SIGNALS.add($root)
}

export function unregisterRootFinalizer ($root: RootSignalRuntime | undefined): void {
  if (!$root) return
  ROOT_FINALIZATION_REGISTRY.unregister($root)
  REGISTERED_ROOT_SIGNALS.delete($root)
}

function createRandomString (length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}
