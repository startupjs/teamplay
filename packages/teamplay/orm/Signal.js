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

export default globalThis?.teamplayCompatibilityMode ? SignalCompat : Signal
