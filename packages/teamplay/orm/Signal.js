import { Signal } from './SignalBase.js'
import SignalCompat from './Compat/SignalCompat.js'

export {
  Signal,
  SEGMENTS,
  ARRAY_METHOD,
  GET,
  GETTERS,
  DEFAULT_GETTERS,
  regularBindings,
  extremelyLateBindings,
  isPublicCollectionSignal,
  isPublicDocumentSignal,
  isPublicCollection,
  isPrivateCollection
} from './SignalBase.js'

export { SignalCompat }

const compatEnv =
  globalThis?.teamplayCompatibilityMode ??
  (typeof process !== 'undefined' && process?.env?.TEAMPLAY_COMPAT === '1')

export default compatEnv ? SignalCompat : Signal
