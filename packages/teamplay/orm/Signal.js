import { Signal } from './SignalBase.js'
import SignalCompat from './SignalCompat.js'

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

export default globalThis?.teamplayCompartabilityMode ? SignalCompat : Signal
