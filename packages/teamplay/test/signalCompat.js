import { it, describe, afterEach } from 'mocha'
import { strict as assert } from 'node:assert'
import SignalCompat from '../orm/SignalCompat.js'
import { del as _del } from '../orm/dataTree.js'
import { ROOT, ROOT_ID } from '../orm/Root.js'

const REGEX_POSITIVE_INTEGER = /^(?:0|[1-9]\d*)$/
function maybeTransformToArrayIndex (key) {
  if (typeof key === 'string' && REGEX_POSITIVE_INTEGER.test(key)) return +key
  return key
}

function createCompatSignal (segments = [], rootProxy) {
  const signal = new SignalCompat(segments)
  if (rootProxy && segments.length > 0) signal[ROOT] = rootProxy
  return new Proxy(signal, {
    get (target, key, receiver) {
      if (typeof key === 'symbol') return Reflect.get(target, key, receiver)
      if (key in target) return Reflect.get(target, key, receiver)
      key = maybeTransformToArrayIndex(key)
      return createCompatSignal([...segments, key], rootProxy)
    }
  })
}

function createCompatRoot () {
  const rootSignal = new SignalCompat([])
  const rootProxy = new Proxy(rootSignal, {
    get (target, key, receiver) {
      if (typeof key === 'symbol') return Reflect.get(target, key, receiver)
      if (key in target) return Reflect.get(target, key, receiver)
      key = maybeTransformToArrayIndex(key)
      return createCompatSignal([key], rootProxy)
    }
  })
  rootSignal[ROOT_ID] = '_compat_root_'
  return rootProxy
}

describe('SignalCompat.at()', () => {
  let basePath
  let cleanupSegments
  let $root
  let $base

  function setup (suffix) {
    basePath = `_compatAt_${suffix}`
    cleanupSegments = [[basePath]]
    $root = createCompatRoot()
    $base = $root[basePath]
  }

  afterEach(() => {
    if (!cleanupSegments) return
    for (const segments of cleanupSegments) _del(segments)
  })

  it('matches dot syntax for nested paths', async () => {
    setup('nested')
    await $base.a.b.set(123)
    assert.equal($base.a.b.get(), 123)
    assert.equal($base.at('a.b').get(), 123)
  })

  it('supports numeric segments via "c.0"', async () => {
    setup('array')
    await $base.c[0].set('x')
    assert.equal($base.c[0].get(), 'x')
    assert.equal($base.at('c.0').get(), 'x')
  })

  it('removes empty segments and returns this for empty path', () => {
    setup('empty')
    assert.equal($base.at(''), $base)
    assert.equal($base.at('.'), $base)
    assert.equal($base.at('...'), $base)
    assert.equal($base.at('a..b').path(), $base.a.b.path())
    assert.equal($base.at('.a.b.').path(), $base.a.b.path())
  })

  it('works from child signals', async () => {
    setup('child')
    const $child = $base.a
    await $child.b.set(7)
    assert.equal($child.at('b').get(), 7)
  })

  it('throws on invalid arguments', () => {
    setup('args')
    assert.throws(() => $base.at(), /expects a single argument/)
    assert.throws(() => $base.at('a', 'b'), /expects a single argument/)
    assert.throws(() => $base.at(1), /expects a string argument/)
  })
})

describe('SignalCompat.scope()', () => {
  let basePath
  let cleanupSegments
  let $root
  let $base

  function setup (suffix) {
    basePath = `_compatScope_${suffix}`
    cleanupSegments = [[basePath]]
    $root = createCompatRoot()
    $base = $root[basePath]
  }

  afterEach(() => {
    if (!cleanupSegments) return
    for (const segments of cleanupSegments) _del(segments)
  })

  it('starts from root regardless of current signal', async () => {
    setup('root')
    await $root._a.set('root')
    await $base._a.b.set('child')
    cleanupSegments.push(['_a'])
    assert.equal($base._a.b.scope('_a').get(), 'root')
  })

  it('returns root for empty subpath', () => {
    setup('empty')
    assert.equal($base.scope(''), $root)
    assert.equal($base.scope('.'), $root)
    assert.equal($base.scope('...'), $root)
  })

  it('removes empty segments in subpath', async () => {
    setup('segments')
    await $root._a.b.set(5)
    cleanupSegments.push(['_a'])
    assert.equal($base.scope('_a..b').get(), 5)
  })

  it('throws on invalid arguments', () => {
    setup('args')
    assert.throws(() => $base.scope('a', 'b'), /expects a single argument/)
    assert.throws(() => $base.scope(1), /expects a string argument/)
  })

  it('returns root when subpath is omitted', () => {
    setup('optional')
    assert.equal($base.scope(), $root)
  })
})

describe('SignalCompat.leaf()', () => {
  let basePath
  let cleanupSegments
  let $root
  let $base

  function setup (suffix) {
    basePath = `_compatLeaf_${suffix}`
    cleanupSegments = [[basePath]]
    $root = createCompatRoot()
    $base = $root[basePath]
  }

  afterEach(() => {
    if (!cleanupSegments) return
    for (const segments of cleanupSegments) _del(segments)
  })

  it('returns last path segment as string', () => {
    setup('nested')
    assert.equal($base._a.b.leaf(), 'b')
  })

  it('returns empty string for root', () => {
    setup('root')
    assert.equal($root.leaf(), '')
  })

  it('stringifies numeric segments', () => {
    setup('array')
    assert.equal($base.a[0].leaf(), '0')
  })

  it('throws on arguments', () => {
    setup('args')
    assert.throws(() => $base.leaf(1), /does not accept any arguments/)
  })
})
