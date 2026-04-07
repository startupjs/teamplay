import getSignal from './getSignal.js'
import disposeRootContext from './disposeRootContext.js'
import { reviveRootContext } from './rootContext.js'
import { isGlobalRootId, normalizeRootId } from './rootScope.js'
import FinalizationRegistry from '../utils/MockFinalizationRegistry.js'

export const ROOT_FUNCTION = Symbol('root function')
// TODO: in future make a connection spawnable instead of a singleton
// export const CONNECTION = Symbol('sharedb connection, used by sub() function')
export const ROOT = Symbol('root signal')
export const ROOT_ID = Symbol('root signal id. Used for caching')

export const GLOBAL_ROOT_ID = '__global__'

const ROOT_FINALIZATION_REGISTRY = new FinalizationRegistry(rootId => {
  disposeRootContext(rootId).catch(err => {
    console.error(err)
  })
})
const REGISTERED_ROOT_SIGNALS = new WeakSet()

// TODO: create a separate local root for private collections
export function getRootSignal ({
  rootFunction,
  // connection,
  rootId = '_' + createRandomString(8),
  ...options
}) {
  reviveRootContext(rootId)
  const $root = getSignal(undefined, [], {
    rootId,
    ...options
  })
  $root[ROOT_FUNCTION] ??= rootFunction
  // $root[CONNECTION] ??= connection
  $root[ROOT_ID] ??= rootId
  registerRootFinalizer($root)
  return $root
}

export function getRoot (signal) {
  if (signal[ROOT]) return signal[ROOT]
  else if (signal[ROOT_ID]) return signal
  else return undefined
}

export function registerRootFinalizer ($root) {
  if (!$root?.[ROOT_ID]) return
  if (REGISTERED_ROOT_SIGNALS.has($root)) return
  const rootId = normalizeRootId($root[ROOT_ID])
  if (isGlobalRootId(rootId)) return
  ROOT_FINALIZATION_REGISTRY.register($root, rootId, $root)
  REGISTERED_ROOT_SIGNALS.add($root)
}

export function unregisterRootFinalizer ($root) {
  if (!$root) return
  ROOT_FINALIZATION_REGISTRY.unregister($root)
  REGISTERED_ROOT_SIGNALS.delete($root)
}

function createRandomString (length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}
