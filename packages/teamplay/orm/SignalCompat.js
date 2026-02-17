import { Signal, SEGMENTS } from './SignalBase.js'
import { getRoot } from './Root.js'

class SignalCompat extends Signal {
  at (subpath) {
    if (arguments.length !== 1) throw Error('Signal.at() expects a single argument')
    if (typeof subpath !== 'string') throw Error('Signal.at() expects a string argument')
    const segments = subpath.split('.').filter(Boolean)
    if (segments.length === 0) return this
    let $cursor = this
    for (const segment of segments) {
      $cursor = $cursor[segment]
    }
    return $cursor
  }

  scope (path) {
    if (arguments.length > 1) throw Error('Signal.scope() expects a single argument')
    const $root = getRoot(this) || this
    if (arguments.length === 0) return $root
    if (typeof path !== 'string') throw Error('Signal.scope() expects a string argument')
    const segments = path.split('.').filter(Boolean)
    if (segments.length === 0) return $root
    let $cursor = $root
    for (const segment of segments) {
      $cursor = $cursor[segment]
    }
    return $cursor
  }

  leaf () {
    if (arguments.length > 0) throw Error('Signal.leaf() does not accept any arguments')
    const segments = this[SEGMENTS]
    if (segments.length === 0) return ''
    return String(segments[segments.length - 1])
  }
}

export { SignalCompat }
export default SignalCompat
