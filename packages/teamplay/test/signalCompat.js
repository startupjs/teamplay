import { it, describe, afterEach, before } from 'mocha'
import { strict as assert } from 'node:assert'
import { raw } from '@nx-js/observer-util'
import { $, sub, addModel } from '../index.js'
import { get as _get, del as _del } from '../orm/dataTree.js'
import { getConnection } from '../orm/connection.js'
import connect from '../connect/test.js'
import SignalCompat from '../orm/SignalCompat.js'
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

  it('supports numeric subpath for array index', async () => {
    setup('num')
    await $base[3].set('v')
    assert.equal($base.at(3).get(), 'v')
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
    assert.throws(() => $base.at('a', 'b'), /expects a single argument/)
    assert.throws(() => $base.at(1.5), /expects a string or integer argument/)
    assert.throws(() => $base.at(null), /expects a string or integer argument/)
  })

  it('returns current signal when called without arguments', () => {
    setup('optional')
    assert.equal($base.at(), $base)
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

describe('SignalCompat.getCopy()/getDeepCopy()', () => {
  let basePath
  let cleanupSegments
  let $root
  let $base

  function setup (suffix) {
    basePath = `_compatCopy_${suffix}`
    cleanupSegments = [[basePath]]
    $root = createCompatRoot()
    $base = $root[basePath]
  }

  afterEach(() => {
    if (!cleanupSegments) return
    for (const segments of cleanupSegments) _del(segments)
  })

  it('getCopy returns a shallow copy for objects', async () => {
    setup('shallow')
    const nested = { b: 1 }
    await $base.obj.set({ a: nested })
    const original = raw($base.obj.get())
    const copy = $base.getCopy('obj')
    assert.deepEqual(copy, original)
    assert.notEqual(copy, original)
    assert.equal(copy.a, original.a)
  })

  it('getDeepCopy returns a deep copy for objects', async () => {
    setup('deep')
    const nested = { b: 1 }
    await $base.obj.set({ a: nested })
    const original = raw($base.obj.get())
    const copy = $base.getDeepCopy('obj')
    assert.deepEqual(copy, original)
    assert.notEqual(copy, original)
    assert.notEqual(copy.a, original.a)
  })

  it('supports numeric subpath for array index', async () => {
    setup('num')
    await $base.arr.set([1, 2, 3, 4])
    assert.equal($base.arr.getDeepCopy(2), 3)
    assert.equal($base.arr.getCopy(3), 4)
  })

  it('throws on invalid arguments', () => {
    setup('args')
    assert.throws(() => $base.getCopy(1, 2), /expects a single argument/)
    assert.throws(() => $base.getCopy(1.5), /expects a string or integer argument/)
    assert.throws(() => $base.getDeepCopy(null), /expects a string or integer argument/)
  })
})

describe('SignalCompat mutators with path', () => {
  let basePath
  let cleanupSegments
  let $root
  let $base

  function setup (suffix) {
    basePath = `_compatMutators_${suffix}`
    cleanupSegments = [[basePath]]
    $root = createCompatRoot()
    $base = $root[basePath]
  }

  afterEach(() => {
    if (!cleanupSegments) return
    for (const segments of cleanupSegments) _del(segments)
  })

  it('set supports subpath', async () => {
    setup('set')
    await $base.set('a.b', 1)
    assert.equal($base.a.b.get(), 1)
  })

  it('set supports numeric subpath', async () => {
    setup('setnum')
    await $base.arr.set([0, 1, 2])
    await $base.arr.set(1, 9)
    assert.equal($base.arr[1].get(), 9)
  })

  it('del supports subpath', async () => {
    setup('del')
    await $base.a.b.set(1)
    await $base.del('a.b')
    assert.equal($base.a.b.get(), undefined)
  })

  it('setNull only sets when value is nullish', async () => {
    setup('setnull')
    await $base.a.set(1)
    await $base.setNull('a', 2)
    await $base.setNull('b', 3)
    assert.equal($base.a.get(), 1)
    assert.equal($base.b.get(), 3)
  })

  it('setDiffDeep supports subpath', async () => {
    setup('setdiffdeep')
    await $base.setDiffDeep('obj', { a: 1 })
    assert.equal($base.obj.a.get(), 1)
  })

  it('setEach supports subpath', async () => {
    setup('seteach')
    await $base.setEach('obj', { a: 1, b: 2 })
    assert.equal($base.obj.a.get(), 1)
    assert.equal($base.obj.b.get(), 2)
  })

  it('increment supports subpath and default value', async () => {
    setup('increment')
    await $base.increment('count')
    await $base.increment('count', 2)
    assert.equal($base.count.get(), 3)
  })

  it('array mutators return values and modify array', async () => {
    setup('array')
    await $base.list.set([1, 2, 3])
    const len1 = await $base.list.push(4)
    assert.equal(len1, 4)
    const len2 = await $base.list.unshift(0)
    assert.equal(len2, 5)
    const len3 = await $base.list.insert(2, ['a', 'b'])
    assert.equal(len3, 7)
    const popped = await $base.list.pop()
    assert.equal(popped, 4)
    const shifted = await $base.list.shift()
    assert.equal(shifted, 0)
    const removed = await $base.list.remove(1, 2)
    assert.deepEqual(removed, ['a', 'b'])
    const moved = await $base.list.move(1, 0)
    assert.deepEqual(moved, [2])
    assert.deepEqual($base.list.get(), [2, 1, 3])
  })

  it('remove with no args removes array element', async () => {
    setup('remove-no-args')
    await $base.list.set([10, 20, 30])
    const removed = await $base.list[1].remove()
    assert.deepEqual(removed, [20])
    assert.deepEqual($base.list.get(), [10, 30])
  })

  it('stringInsert/stringRemove work on strings', async () => {
    setup('strings')
    await $base.text.set('helo')
    const prev1 = await $base.text.stringInsert(3, 'l')
    assert.equal(prev1, 'helo')
    assert.equal($base.text.get(), 'hello')
    const prev2 = await $base.text.stringRemove(1, 2)
    assert.equal(prev2, 'hello')
    assert.equal($base.text.get(), 'hlo')
  })

  it('handles edge cases for local array/string mutators', async () => {
    setup('edge-local')
    await $base.list.set([])
    const popEmpty = await $base.list.pop()
    const shiftEmpty = await $base.list.shift()
    assert.equal(popEmpty, undefined)
    assert.equal(shiftEmpty, undefined)

    await $base.list.push(1)
    await $base.list.push(2)
    await $base.list.push(3)
    const movedNeg = await $base.list.move(-1, 0)
    assert.deepEqual(movedNeg, [3])
    assert.deepEqual($base.list.get(), [3, 1, 2])

    await $base.text.set('abc')
    await $base.text.stringInsert(0, 'X')
    await $base.text.stringInsert(4, 'Y')
    assert.equal($base.text.get(), 'XabcY')
    await $base.text.stringRemove(1, 10)
    assert.equal($base.text.get(), 'X')
  })
})

describe('SignalCompat.parent()', () => {
  let basePath
  let cleanupSegments
  let $root
  let $base

  function setup (suffix) {
    basePath = `_compatParent_${suffix}`
    cleanupSegments = [[basePath]]
    $root = createCompatRoot()
    $base = $root[basePath]
  }

  afterEach(() => {
    if (!cleanupSegments) return
    for (const segments of cleanupSegments) _del(segments)
  })

  it('returns direct parent by default', () => {
    setup('default')
    assert.equal($base.a.b.parent().path(), $base.a.path())
  })

  it('returns ancestor for higher levels', () => {
    setup('levels')
    assert.equal($base.a.b.c.parent(2).path(), $base.a.path())
  })

  it('returns root when exceeding depth', () => {
    setup('root')
    assert.equal($base.a.parent(3), $root)
  })

  it('returns root when called on root', () => {
    setup('rootself')
    assert.equal($root.parent(), $root)
  })

  it('throws on invalid arguments', () => {
    setup('args')
    assert.throws(() => $base.parent(1, 2), /expects a single argument/)
    assert.throws(() => $base.parent('1'), /expects an integer argument/)
    assert.throws(() => $base.parent(0), /expects a positive integer/)
    assert.throws(() => $base.parent(-1), /expects a positive integer/)
    assert.throws(() => $base.parent(1.5), /expects an integer argument/)
  })
})

describe('SignalCompat public mutators', () => {
  before(() => {
    connect()
    addModel('compatGames.*', SignalCompat)
  })

  function cbPromise (fn) {
    return new Promise((resolve, reject) => {
      fn((err, result) => err ? reject(err) : resolve(result))
    })
  }

  afterEach(async () => {
    // ensure games collection is cleaned up in both dataTree and ShareDB connection
    const games = getConnection().collections?.compatGames || {}
    for (const id of Object.keys(games)) {
      const doc = getConnection().get('compatGames', id)
      if (doc?.data) await cbPromise(cb => doc.del(cb))
      delete getConnection().collections?.compatGames?.[id]
    }
    assert.deepEqual(_get(['compatGames']), {}, 'compatGames collection is empty in signal\'s data tree')
    assert.equal(Object.keys(getConnection().collections?.compatGames || {}).length, 0, 'no games in ShareDB connection')
  })

  it('uses json0 ops for increment/array/string mutators on public docs', async () => {
    const gameId = '_compat_public_1'
    const $game = await sub($.compatGames[gameId])
    await $game.set({ count: 0, list: [1, 2, 3], text: 'helo' })

    const inc = await $game.increment('count', 2)
    assert.equal(inc, 2)
    assert.equal($game.count.get(), 2)

    const len1 = await $game.push('list', 4)
    assert.equal(len1, 4)
    const len2 = await $game.unshift('list', 0)
    assert.equal(len2, 5)
    const len3 = await $game.insert('list', 2, ['a', 'b'])
    assert.equal(len3, 7)
    const popped = await $game.pop('list')
    assert.equal(popped, 4)
    const shifted = await $game.shift('list')
    assert.equal(shifted, 0)
    const removed = await $game.remove('list', 1, 2)
    assert.deepEqual(removed, ['a', 'b'])
    const moved = await $game.move('list', 1, 0)
    assert.deepEqual(moved, [2])
    assert.deepEqual($game.list.get(), [2, 1, 3])

    const prev1 = await $game.stringInsert('text', 3, 'l')
    assert.equal(prev1, 'helo')
    assert.equal($game.text.get(), 'hello')
    const prev2 = await $game.stringRemove('text', 1, 2)
    assert.equal(prev2, 'hello')
    assert.equal($game.text.get(), 'hlo')
  })

  it('handles edge cases for public array/string mutators', async () => {
    const gameId = '_compat_public_2'
    const $game = await sub($.compatGames[gameId])
    await $game.set({ list: [], text: 'abc' })

    const popEmpty = await $game.pop('list')
    const shiftEmpty = await $game.shift('list')
    assert.equal(popEmpty, undefined)
    assert.equal(shiftEmpty, undefined)

    await $game.push('list', 1)
    await $game.push('list', 2)
    await $game.push('list', 3)
    const movedNeg = await $game.move('list', -1, 0)
    assert.deepEqual(movedNeg, [3])
    assert.deepEqual($game.list.get(), [3, 1, 2])

    await $game.stringInsert('text', 0, 'X')
    await $game.stringInsert('text', 4, 'Y')
    assert.equal($game.text.get(), 'XabcY')
    await $game.stringRemove('text', 1, 10)
    assert.equal($game.text.get(), 'X')
  })
})
