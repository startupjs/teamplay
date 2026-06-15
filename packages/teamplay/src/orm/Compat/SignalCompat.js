import {
  Signal,
  SEGMENTS,
  isPublicCollection
} from '../SignalBase.ts'
import { getRoot, ROOT_ID } from '../Root.ts'
import { getIdFieldsForSegments, isIdFieldPath } from '../idFields.ts'
import { incrementPublic as _incrementPublic } from '../dataTree.js'
import { setReplacePrivateData } from '../privateData.js'

class SignalCompat extends Signal {
  async increment (byNumber) {
    if (arguments.length > 1) throw Error('Signal.increment() expects a single argument')
    return incrementOnSignal(this, byNumber)
  }
}

async function incrementOnSignal ($signal, byNumber) {
  const segments = $signal[SEGMENTS]
  if (segments.length === 0) throw Error('Can\'t increment the root signal data')
  const idFields = getIdFieldsForSegments(segments)
  if (isIdFieldPath(segments, idFields)) return $signal.get()
  if (byNumber === undefined) byNumber = 1
  if (typeof byNumber !== 'number') throw Error('Signal.increment() expects a number argument')
  let currentValue = $signal.get()
  if (currentValue === undefined) currentValue = 0
  if (typeof currentValue !== 'number') throw Error('Signal.increment() tried to increment a non-number value')
  if (isPublicCollection(segments[0])) {
    await _incrementPublic(segments, byNumber)
    return currentValue + byNumber
  }
  setReplacePrivateData(getOwningRootId($signal), segments, currentValue + byNumber)
  return currentValue + byNumber
}

function getOwningRootId ($signal) {
  const $root = getRoot($signal) || $signal
  return $root?.[ROOT_ID]
}

export { SignalCompat }
export default SignalCompat
