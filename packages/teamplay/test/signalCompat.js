import { it, describe, afterEach, before } from 'mocha'
import { strict as assert } from 'node:assert'
import { raw, observe, unobserve } from '@nx-js/observer-util'
import { $, sub, addModel, aggregation, getRootSignal } from '../index.js'
import { get as _get, set as _set, del as _del } from '../orm/dataTree.js'
import { getConnection, setConnection } from '../orm/connection.js'
import connect from '../connect/test.js'
import SignalCompat from '../orm/Compat/SignalCompat.js'
import { Signal as BaseSignal } from '../orm/SignalBase.js'
import { scheduleReaction } from '../orm/batchScheduler.js'
import { __resetModelEventsForTests } from '../orm/Compat/modelEvents.js'
import { __resetRefLinksForTests } from '../orm/Compat/refRegistry.js'
import { __resetSilentContextForTests, isSilentContextActive } from '../orm/Compat/silentContext.js'
import { ROOT, ROOT_ID } from '../orm/Root.js'
import { PARAMS, HASH as QUERY_HASH, QUERIES } from '../orm/Query.js'
import { AGGREGATIONS } from '../orm/Aggregation.js'

const REGEX_POSITIVE_INTEGER = /^(?:0|[1-9]\d*)$/
function maybeTransformToArrayIndex (key) {
  if (typeof key === 'string' && REGEX_POSITIVE_INTEGER.test(key)) return +key
  return key
}

function deepCopyCompat (value) {
  if (!value || typeof value !== 'object') return value
  return JSON.parse(JSON.stringify(value))
}

function createCompatSignal (segments = [], rootProxy, cache) {
  const cacheKey = segments.join('.')
  const existing = cache?.get(cacheKey)
  if (existing) return existing
  const signal = new SignalCompat(segments)
  if (rootProxy && segments.length > 0) signal[ROOT] = rootProxy
  const proxy = new Proxy(signal, {
    get (target, key, receiver) {
      if (typeof key === 'symbol') return Reflect.get(target, key, receiver)
      if (key in target) return Reflect.get(target, key, receiver)
      key = maybeTransformToArrayIndex(key)
      return createCompatSignal([...segments, key], rootProxy, cache)
    }
  })
  cache?.set(cacheKey, proxy)
  return proxy
}

function createCompatRoot () {
  const cache = new Map()
  const rootSignal = new SignalCompat([])
  const rootProxy = new Proxy(rootSignal, {
    get (target, key, receiver) {
      if (typeof key === 'symbol') return Reflect.get(target, key, receiver)
      if (key in target) return Reflect.get(target, key, receiver)
      key = maybeTransformToArrayIndex(key)
      return createCompatSignal([key], rootProxy, cache)
    }
  })
  rootSignal[ROOT_ID] = '_compat_root_'
  cache.set('', rootProxy)
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

  it('supports multiple path segments', async () => {
    setup('multi')
    await $base.a.b.set(11)
    assert.equal($base.at('a', 'b').get(), 11)
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
    assert.throws(() => $base.at({}, 'b'), /expects string or integer path segments/)
    assert.throws(() => $base.at(1.5), /expects a string or integer argument/)
    assert.throws(() => $base.at(null), /expects a string or integer argument/)
  })

  it('returns current signal when called without arguments', () => {
    setup('optional')
    assert.equal($base.at(), $base)
  })
})

describe('SignalCompat.path(subpath)', () => {
  let basePath
  let cleanupSegments
  let $root
  let $base

  function setup (suffix) {
    basePath = `_compatPath_${suffix}`
    cleanupSegments = [[basePath]]
    $root = createCompatRoot()
    $base = $root[basePath]
  }

  afterEach(() => {
    if (!cleanupSegments) return
    for (const segments of cleanupSegments) _del(segments)
  })

  it('returns nested path string without creating a signal', () => {
    setup('nested')
    assert.equal($base.path('a.b'), `${basePath}.a.b`)
    assert.equal($base.a.path('b'), `${basePath}.a.b`)
  })

  it('supports numeric subpath segment', () => {
    setup('array')
    assert.equal($base.path(0), `${basePath}.0`)
    assert.equal($base.items.path(3), `${basePath}.items.3`)
  })

  it('returns base path for empty subpath', () => {
    setup('empty')
    assert.equal($base.path(''), basePath)
    assert.equal($base.path('.'), basePath)
    assert.equal($base.path('...'), basePath)
  })

  it('throws on invalid arguments', () => {
    setup('args')
    assert.throws(() => $base.path('a', 'b'), /expects a single argument/)
    assert.throws(() => $base.path(1.5), /expects a string or integer argument/)
    assert.throws(() => $base.path(null), /expects a string or integer argument/)
  })
})

describe('SignalCompat.get(subpath)', () => {
  let cleanupSegments
  let $root
  let $base

  function setup (suffix) {
    const basePath = `_compatGet_${suffix}`
    cleanupSegments = [[basePath]]
    $root = createCompatRoot()
    $base = $root[basePath]
  }

  afterEach(() => {
    if (!cleanupSegments) return
    for (const segments of cleanupSegments) _del(segments)
  })

  it('supports string subpath on root', async () => {
    setup('root')
    await $root.$render.url.set('/test')
    cleanupSegments.push(['$render'])
    assert.equal($root.get('$render.url'), '/test')
  })

  it('supports multiple path segments', async () => {
    setup('multi')
    await $base.a.b.set(5)
    assert.equal($base.get('a', 'b'), 5)
  })

  it('supports numeric segments in string subpath', async () => {
    setup('array')
    await $base.items[0].set('x')
    assert.equal($base.get('items.0'), 'x')
  })

  it('treats nullish path as current signal', async () => {
    setup('nullish')
    await $base.set(5)
    assert.equal($base.get(undefined), 5)
    assert.equal($base.get(null), 5)
  })

  it('throws on invalid arguments', () => {
    setup('args')
    assert.throws(() => $base.get({}, 'b'), /expects string or integer path segments/)
    assert.throws(() => $base.get(1.5), /expects a string or integer argument/)
  })
})

describe('SignalCompat.peek(subpath)', () => {
  let cleanupSegments
  let $root
  let $base

  function setup (suffix) {
    const basePath = `_compatPeek_${suffix}`
    cleanupSegments = [[basePath]]
    $root = createCompatRoot()
    $base = $root[basePath]
  }

  afterEach(() => {
    if (!cleanupSegments) return
    for (const segments of cleanupSegments) _del(segments)
  })

  it('supports string subpath', async () => {
    setup('nested')
    await $base.a.b.set(10)
    assert.equal($base.peek('a.b'), 10)
  })

  it('supports multiple path segments', async () => {
    setup('multi')
    await $base.a.b.set(12)
    assert.equal($base.peek('a', 'b'), 12)
  })

  it('treats nullish path as current signal', async () => {
    setup('nullish')
    await $base.set(7)
    assert.equal($base.peek(undefined), 7)
    assert.equal($base.peek(null), 7)
  })

  it('throws on invalid arguments', () => {
    setup('args')
    assert.throws(() => $base.peek({}, 'b'), /expects string or integer path segments/)
    assert.throws(() => $base.peek(1.5), /expects a string or integer argument/)
  })
})

describe('SignalCompat.add()', () => {
  let cleanupSegments
  let $root
  let $base

  function setup (suffix) {
    const basePath = `_compatAdd_${suffix}`
    cleanupSegments = [[basePath]]
    $root = createCompatRoot()
    $base = $root[basePath]
  }

  afterEach(() => {
    if (!cleanupSegments) return
    for (const segments of cleanupSegments) _del(segments)
  })

  it('supports root add(collection, value)', async () => {
    setup('root')
    cleanupSegments.push(['_users'])
    const id = await $root.add('_users', { title: 'Ann' })
    assert.equal($root._users[id].get('title'), 'Ann')
  })

  it('supports root property with add(collection, value)', async () => {
    setup('rootProp')
    cleanupSegments.push(['_users'])
    const id = await $root._users.root.add('_users', { title: 'Zoe' })
    assert.equal($root._users[id].get('title'), 'Zoe')
  })

  it('uses root getter instead of path when in compat mode', async () => {
    setup('rootCompat')
    cleanupSegments.push(['_tenants'])
    const prevCompat = globalThis.teamplayCompatibilityMode
    globalThis.teamplayCompatibilityMode = true
    try {
      const id = await $root._tenants.root.add('_tenants', { title: 'Acme' })
      assert.equal($root._tenants[id].get('title'), 'Acme')
    } finally {
      globalThis.teamplayCompatibilityMode = prevCompat
    }
  })

  it('uses raw-signal root to add via model.root', async function () {
    if (!(typeof process !== 'undefined' && process?.env?.TEAMPLAY_COMPAT === '1')) {
      this.skip()
    }
    const prevCompat = globalThis.teamplayCompatibilityMode
    globalThis.teamplayCompatibilityMode = true
    try {
      const $root = getRootSignal({ rootId: 'compat_root_add' })
      const id = await $root._tenants.root.add('_tenants', { title: 'Tenant 1' })
      assert.equal($root._tenants[id].get('title'), 'Tenant 1')
    } finally {
      globalThis.teamplayCompatibilityMode = prevCompat
    }
  })

  it('supports collection add(value)', async () => {
    setup('collection')
    const id = await $base.add({ title: 'Kate' })
    assert.equal($base[id].get('title'), 'Kate')
  })
})

describe('SignalCompat.root.connection', () => {
  it('returns ShareDB connection in compat mode', () => {
    const prevCompat = globalThis.teamplayCompatibilityMode
    globalThis.teamplayCompatibilityMode = true
    const prevConnection = (() => {
      try {
        return getConnection()
      } catch {
        return undefined
      }
    })()

    try {
      const $root = getRootSignal({ rootId: 'compat_conn' })
      if (prevConnection) {
        assert.equal($root.connection, prevConnection)
      }
      const dummyConnection = { get: () => null }
      setConnection(dummyConnection)
      assert.equal($root.connection, dummyConnection)
    } finally {
      setConnection(prevConnection)
      globalThis.teamplayCompatibilityMode = prevCompat
    }
  })
})

describe('SignalCompat.close()', () => {
  it('is a no-op compat shim and supports optional callback', () => {
    const $root = createCompatRoot()
    let called = 0
    const result = $root.close(() => { called++ })
    assert.equal(result, undefined)
    assert.equal(called, 1)
  })

  it('throws on invalid callback type', () => {
    const $root = createCompatRoot()
    assert.throws(() => $root.close(123), /expects callback to be a function/)
    assert.throws(() => $root.close(() => {}, () => {}), /expects zero or one argument/)
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

  it('supports multiple path segments', async () => {
    setup('multi')
    await $root._a.b.set(7)
    cleanupSegments.push(['_a'])
    assert.equal($base.scope('_a', 'b').get(), 7)
  })

  it('throws on invalid arguments', () => {
    setup('args')
    assert.throws(() => $base.scope({}, 'b'), /expects string or integer path segments/)
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

  it('set replaces value with null (no deep merge/delete semantics)', async () => {
    setup('setnull-delete')
    await $base.set('obj', { a: 1, b: 2 })
    await $base.set('obj.a', null)
    assert.equal($base.obj.a.get(), null)
    assert.deepEqual($base.obj.get(), { a: null, b: 2 })
  })

  it('set with undefined follows compat delete semantics', async () => {
    setup('set-undefined')
    await $base.set({ a: 1, b: 2 })
    await $base.set('a', undefined)
    assert.equal($base.a.get(), undefined)
    assert.deepEqual($base.get(), { b: 2 })
  })

  it('set uses replace semantics for nested objects', async () => {
    setup('set-replace')
    await $base.set({ a: { x: 1, y: 2 } })
    await $base.set('a', { x: 9 })
    assert.deepEqual($base.get(), { a: { x: 9 } })
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

  it('create creates a non-existing document and throws on second create', async () => {
    setup('create')
    const $doc = $base.doc1
    await $doc.create({ title: 'first' })
    assert.deepEqual($doc.get(), { title: 'first' })
    await assert.rejects(
      $doc.create({ title: 'second' }),
      /non-existing document path/
    )
    assert.deepEqual($doc.get(), { title: 'first' })
  })

  it('create(path, value) resolves path relative to current signal', async () => {
    setup('create-path')
    await $base.create('doc2', { title: 'path create' })
    assert.deepEqual($base.doc2.get(), { title: 'path create' })
  })

  it('create throws on non-document paths', async () => {
    setup('create-invalid')
    await assert.rejects(
      $base.create({ a: 1 }),
      /document path/
    )
  })

  it('setDiffDeep supports subpath', async () => {
    setup('setdiffdeep')
    await $base.setDiffDeep('obj', { a: 1 })
    assert.equal($base.obj.a.get(), 1)
  })

  it('setDiffDeep removes stale object keys recursively', async () => {
    setup('setdiffdeep-remove')
    await $base.set({
      profile: {
        name: 'Ann',
        role: 'student'
      }
    })
    await $base.setDiffDeep({
      profile: {
        name: 'Kate'
      }
    })
    assert.deepEqual($base.get(), {
      profile: {
        name: 'Kate'
      }
    })
  })

  it('setDiffDeep handles nested arrays in object branches', async () => {
    setup('setdiffdeep-arrays')
    await $base.set({
      lists: {
        a: [1, 2],
        b: [1]
      }
    })
    await $base.setDiffDeep({
      lists: {
        a: [2, 3],
        b: [1]
      }
    })
    assert.deepEqual($base.get(), {
      lists: {
        a: [2, 3],
        b: [1]
      }
    })
  })

  it('setDiffDeep(path, value) applies recursive compat diff on the target path', async () => {
    setup('setdiffdeep-path')
    await $base.set({
      profile: {
        name: 'Ann',
        role: 'student'
      }
    })
    await $base.setDiffDeep('profile', { name: 'Bob' })
    assert.deepEqual($base.profile.get(), { name: 'Bob' })
    assert.deepEqual($base.get(), { profile: { name: 'Bob' } })
  })

  it('setDiff(value) is an alias to compat set(value)', async () => {
    setup('setdiff-alias')
    await $base.set({ a: { x: 1, y: 2 } })
    await $base.setDiff({ a: { x: 9 } })
    assert.deepEqual($base.get(), { a: { x: 9 } })
  })

  it('setDiff on child signal follows compat set semantics', async () => {
    setup('setdiffnull')
    await $base.set({ a: 1 })
    await $base.a.setDiff(null)
    assert.equal($base.a.get(), null)
  })

  it('setDiff(path, value) delegates to compat set semantics', async () => {
    setup('setdiff-path-delegates')
    await $base.set({ a: 1, b: 2 })
    await $base.setDiff('a', null)
    assert.equal($base.a.get(), null)
    assert.deepEqual($base.get(), { a: null, b: 2 })
  })

  it('setEach supports subpath', async () => {
    setup('seteach')
    await $base.setEach('obj', { a: 1, b: 2 })
    assert.equal($base.obj.a.get(), 1)
    assert.equal($base.obj.b.get(), 2)
  })

  it('setEach replaces each key value (racer-like set per key)', async () => {
    setup('seteach-replace')
    await $base.set({
      props: {
        old: 1,
        nested: { stale: true }
      }
    })

    await $base.setEach({
      props: {
        nested: { fresh: true }
      }
    })

    assert.deepEqual($base.props.get(), { nested: { fresh: true } })
  })

  it('setEach with null sets null (does not delete key)', async () => {
    setup('seteach-null')
    await $base.set({ a: 1, b: 2 })
    await $base.setEach({ a: null })
    assert.equal($base.a.get(), null)
    assert.deepEqual($base.get(), { a: null, b: 2 })
  })

  it('setEach with undefined follows compat set semantics (deletes key)', async () => {
    setup('seteach-undefined')
    await $base.set({ a: 1, b: 2 })
    await $base.setEach({ a: undefined })
    assert.equal($base.a.get(), undefined)
    assert.deepEqual($base.get(), { b: 2 })
  })

  it('setEach applies updates atomically for scheduled observers', async () => {
    setup('seteach-atomic')
    await $base.set({ a: 0, b: 0 })

    const snapshots = []
    const reaction = observe(
      () => ({ a: $base.a.get(), b: $base.b.get() }),
      { lazy: true, scheduler: reaction => scheduleReaction(() => snapshots.push(reaction())) }
    )
    snapshots.push(reaction())

    await $base.setEach({ a: 1, b: 2 })
    unobserve(reaction)

    assert.deepEqual(snapshots[snapshots.length - 1], { a: 1, b: 2 })
    assert.equal(snapshots.some(s => s.a === 1 && s.b === 0), false)
  })

  it('setDiffDeep applies updates atomically for scheduled observers', async () => {
    setup('setdiffdeep-atomic')
    await $base.set({
      profile: {
        name: 'Ann',
        role: 'student'
      }
    })

    const snapshots = []
    const reaction = observe(
      () => deepCopyCompat($base.profile.get()),
      { lazy: true, scheduler: reaction => scheduleReaction(() => snapshots.push(reaction())) }
    )
    snapshots.push(reaction())

    await $base.setDiffDeep({ profile: { name: 'Kate' } })
    unobserve(reaction)

    assert.deepEqual(snapshots[snapshots.length - 1], { name: 'Kate' })
    assert.equal(snapshots.some(s => s && s.name === 'Ann' && !('role' in s)), false)
  })

  it('set fully replaces react-like values without crashing', async () => {
    setup('set-react-like')
    const reactLikeA = {
      $$typeof: Symbol.for('react.element'),
      type: 'div',
      props: { a: 1, b: 2 }
    }
    const reactLikeB = {
      $$typeof: Symbol.for('react.element'),
      type: 'span',
      props: { a: 9 }
    }

    await $base.set('node', reactLikeA)
    await $base.set('node', reactLikeB)
    assert.equal($base.node.get().type, 'span')
    assert.deepEqual($base.node.get().props, { a: 9 })
  })

  it('set replaces proxy-like existing values without mutating them in place', async () => {
    setup('set-proxy-like')
    const guarded = new Proxy({ storeId: 'old' }, {
      set () {
        return false
      }
    })

    await $base.set('node', guarded)
    await $base.set('node', { storeId: 'new' })
    assert.deepEqual($base.node.get(), { storeId: 'new' })
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

  it('materializes nested objects when setting a child under a primitive value', async () => {
    setup('primitive-child-set')
    await $base.set(false)
    await $base.at('menu.open').set(true)
    assert.deepEqual($base.get(), { menu: { open: true } })
    assert.equal($base.at('menu.open').get(), true)
  })

  it('initializes missing nested array paths for all array mutators', async () => {
    setup('array-implied-missing-path')

    const len1 = await $base.ui.toasts.push('a')
    assert.equal(len1, 1)
    assert.deepEqual($base.ui.toasts.get(), ['a'])

    const len2 = await $base.ui.toasts.unshift('b')
    assert.equal(len2, 2)
    assert.deepEqual($base.ui.toasts.get(), ['b', 'a'])

    const len3 = await $base.ui.toasts.insert(1, ['x', 'y'])
    assert.equal(len3, 4)
    assert.deepEqual($base.ui.toasts.get(), ['b', 'x', 'y', 'a'])

    const popped = await $base.ui.toasts.pop()
    assert.equal(popped, 'a')
    assert.deepEqual($base.ui.toasts.get(), ['b', 'x', 'y'])

    const shifted = await $base.ui.toasts.shift()
    assert.equal(shifted, 'b')
    assert.deepEqual($base.ui.toasts.get(), ['x', 'y'])

    const removed = await $base.ui.toasts.remove(0, 1)
    assert.deepEqual(removed, ['x'])
    assert.deepEqual($base.ui.toasts.get(), ['y'])

    const moved = await $base.ui.toasts.move(0, 0)
    assert.deepEqual(moved, ['y'])
    assert.deepEqual($base.ui.toasts.get(), ['y'])

    const popMissing = await $base.ui.missing.pop()
    assert.equal(popMissing, undefined)
    assert.deepEqual($base.ui.missing.get(), [])

    const shiftMissing = await $base.ui.missing.shift()
    assert.equal(shiftMissing, undefined)
    assert.deepEqual($base.ui.missing.get(), [])

    const removeMissing = await $base.ui.missing.remove(0, 1)
    assert.deepEqual(removeMissing, [])
    assert.deepEqual($base.ui.missing.get(), [])

    const moveMissing = await $base.ui.missing.move(0, 0)
    assert.deepEqual(moveMissing, [])
    assert.deepEqual($base.ui.missing.get(), [])
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

  it('creates missing public arrays on push', async () => {
    const gameId = '_compat_public_missing_array'
    const $game = await sub($.compatGames[gameId])
    await $game.set({ name: 'Missing Array' })

    const len = await $game.push('list', 1)
    assert.equal(len, 1)
    assert.deepEqual($game.list.get(), [1])
  })

  it('throws when pushing to non-array on public docs', async () => {
    const gameId = '_compat_public_non_array'
    const $game = await sub($.compatGames[gameId])
    await $game.set({ list: 'nope' })

    await assert.rejects(
      () => $game.push('list', 1),
      /Expected array at/
    )
  })

  it('treats del on non-existing public docs as no-op', async () => {
    // Ensure the collection exists in the local data tree so this test can run in isolation.
    const $seed = await sub($.compatGames._compat_public_seed)
    await $seed.set({ ok: true })
    await $seed.del()

    const gameId = '_compat_public_missing_del'
    const $game = await sub($.compatGames[gameId])
    assert.equal($game.get(), undefined)

    await $game.del()
    await $game.del('name')
    assert.equal($game.get(), undefined)
  })

  it('injects _id/id into compat docs and ignores id changes', async () => {
    const gameId = '_compat_public_ids'
    const $game = await sub($.compatGames[gameId])
    await $game.set({ name: 'Compat' })

    const data = $game.get()
    assert.equal(data._id, gameId)
    assert.equal(data.id, gameId)

    await $game.id.set('other')
    await $game._id.set('other2')
    assert.equal($game.id.get(), gameId)
    assert.equal($game._id.get(), gameId)
  })

  it('injects _id/id in compat queries', async () => {
    const id1 = '_compat_query_1'
    const id2 = '_compat_query_2'
    const $game1 = await sub($.compatGames[id1])
    const $game2 = await sub($.compatGames[id2])
    await $game1.set({ name: 'Query One', active: true })
    await $game2.set({ name: 'Query Two', active: true })

    const $query = await sub($.compatGames, { active: true })
    const results = $query.get()
    assert.equal(results.length, 2)
    assert.ok(results.every(doc => doc._id && doc.id))
    assert.deepEqual($query.getIds().slice().sort(), [id1, id2])
  })

  it('compat aggregations expose _id/id by default', async () => {
    const id1 = '_compat_agg_1'
    const id2 = '_compat_agg_2'
    const $game1 = await sub($.compatGames[id1])
    const $game2 = await sub($.compatGames[id2])
    await $game1.set({ name: 'Agg One', active: true })
    await $game2.set({ name: 'Agg Two', active: true })

    const $$agg = aggregation(({ active }) => [{ $match: { active } }])
    const $agg = await sub($$agg, { $collection: 'compatGames', active: true })
    const results = $agg.get()
    assert.ok(results.length >= 2)
    assert.ok(results.every(doc => doc._id))
    assert.ok(results.every(doc => doc.id))
  })

  it('compat add accepts equal id and _id', async () => {
    const id = await $.compatGames.add({ id: 'custom', _id: 'custom', name: 'Compat Add' })
    const $doc = await sub($.compatGames[id])
    const data = $doc.get()
    assert.equal(data._id, id)
    assert.equal(data.id, id)
  })

  it('compat add throws on conflicting id and _id', async () => {
    await assert.rejects(
      $.compatGames.add({ id: 'custom', _id: 'other', name: 'Compat Add' }),
      /conflicting "id".*"_id"/
    )
  })

  it('compat: public increment/array/string mutators work after ShareDB snapshot drop', async () => {
    if (process.env.TEAMPLAY_COMPAT !== '1') return

    const gameId = '_compat_public_snapshot_drop'
    const $game = $.compatGames[gameId]
    await $game.create({ count: 0, list: [1], text: 'ab' })
    await new Promise(resolve => setTimeout(resolve, 10))

    const connection = getConnection()
    delete connection.collections.compatGames[gameId]
    _del(['compatGames', gameId])

    const nextCount = await $game.increment('count', 1)
    assert.equal(nextCount, 1)
    assert.equal($game.count.get(), 1)

    const len = await $game.push('list', 2)
    assert.equal(len, 2)
    assert.deepEqual($game.list.get(), [1, 2])

    const prevText = await $game.stringInsert('text', 2, 'c')
    assert.equal(prevText, 'ab')
    assert.equal($game.text.get(), 'abc')

    await sub($game)
    await $game.del()
  })
})

const isCompatMode = process.env.TEAMPLAY_COMPAT === '1'

class CompatRefUserModel extends SignalCompat {
  joinCourse (courseId) {
    return `${this.path()}:${courseId}`
  }
}

class CompatDomainStartModel extends SignalCompat {
  start (type, id) {
    return `domain:${this.path()}:${type}:${id}`
  }

  stop (id) {
    return `domain-stop:${this.path()}:${id}`
  }
}

class NonCompatRefUserModel extends BaseSignal {
  joinCourse (courseId) {
    return `${this.path()}:${courseId}`
  }
}

;(isCompatMode ? describe : describe.skip)('SignalCompat ref model method fallback', () => {
  const collection = 'compatRefUsers'
  let $root

  before(() => {
    connect()
    addModel(`${collection}.*`, CompatRefUserModel)
    $root = getRootSignal({ rootId: '_compat_ref_method_root' })
  })

  afterEach(() => {
    __resetRefLinksForTests()
    _del(['_session'])
    _del([collection])
  })

  it('calls model method via ref target in compat mode', () => {
    const $sessionUser = $root._session.user
    $root._session.ref('user', `${collection}.123`)
    assert.equal($sessionUser.path(), '_session.user')
    assert.equal($sessionUser.joinCourse('course_1'), `${collection}.123:course_1`)
  })

  it('session alias resolves ref target methods when ref is created via canonical _session path', () => {
    const $aliasSessionUser = $root.session.user
    const $canonicalSessionUser = $root._session.user

    assert.equal($aliasSessionUser, $canonicalSessionUser)
    assert.equal($aliasSessionUser.path(), '_session.user')

    $root._session.ref('user', `${collection}.123`)

    assert.equal($aliasSessionUser.joinCourse('course_alias_1'), `${collection}.123:course_alias_1`)
    assert.equal($canonicalSessionUser.joinCourse('course_alias_2'), `${collection}.123:course_alias_2`)
  })

  it('session alias resolves ref target methods when ref is created via alias path', () => {
    const $aliasSessionUser = $root.session.user
    const $canonicalSessionUser = $root._session.user

    assert.equal($aliasSessionUser, $canonicalSessionUser)
    assert.equal($aliasSessionUser.path(), '_session.user')

    $root.session.ref('user', `${collection}.xyz`)

    assert.equal($aliasSessionUser.joinCourse('course_alias_3'), `${collection}.xyz:course_alias_3`)
    assert.equal($canonicalSessionUser.joinCourse('course_alias_4'), `${collection}.xyz:course_alias_4`)
  })

  it('non-ref model method still works', () => {
    const $user = $root[collection].abc
    assert.equal($user.joinCourse('course_2'), `${collection}.abc:course_2`)
  })

  it('ref cycle does not loop infinitely and fails gracefully', () => {
    $root._session.ref('a', '_session.b')
    $root._session.ref('b', '_session.a')
    assert.throws(() => {
      $root._session.a.joinCourse('course_3')
    }, /Method "joinCourse" does not exist on signal "_session.a"/)
  })

  it('keeps raw signal identity and path unchanged', () => {
    const $before = $root._session.user
    $root._session.ref('user', `${collection}.xyz`)
    const $after = $root._session.user
    assert.equal($before, $after)
    assert.equal($after.path(), '_session.user')
    assert.equal($after.joinCourse('course_4'), `${collection}.xyz:course_4`)
  })
})

;(!isCompatMode ? describe : describe.skip)('Non-compat model method behavior', () => {
  const collection = 'nonCompatRefUsers'
  let $root

  before(() => {
    connect()
    addModel(`${collection}.*`, NonCompatRefUserModel)
    $root = getRootSignal({ rootId: '_non_compat_ref_method_root' })
  })

  afterEach(() => {
    _del([collection])
    _del(['_session'])
  })

  it('keeps strict missing-method error for unresolved path', () => {
    assert.throws(() => {
      $root._session.user.joinCourse('course_1')
    }, /Method "joinCourse" does not exist on signal "_session.user"/)
  })

  it('regular model method lookup still works', () => {
    assert.equal($root[collection].abc.joinCourse('course_2'), `${collection}.abc:course_2`)
  })
})

;(isCompatMode ? describe : describe.skip)('SignalCompat query API', () => {
  const collection = 'compatQueryApi'
  let cleanupQueryHashes = []
  let cleanupAggregationHashes = []
  let $compatRoot

  before(() => {
    connect()
    addModel(`${collection}.*`, SignalCompat)
    $compatRoot = createCompatRoot()
  })

  function cbPromise (fn) {
    return new Promise((resolve, reject) => {
      fn((err, result) => err ? reject(err) : resolve(result))
    })
  }

  afterEach(async () => {
    const docs = getConnection().collections?.[collection] || {}
    for (const id of Object.keys(docs)) {
      const doc = getConnection().get(collection, id)
      if (doc?.data) await cbPromise(cb => doc.del(cb))
      delete getConnection().collections?.[collection]?.[id]
    }
    for (const hash of cleanupQueryHashes) _del([QUERIES, hash])
    for (const hash of cleanupAggregationHashes) _del([AGGREGATIONS, hash])
    cleanupQueryHashes = []
    cleanupAggregationHashes = []
    _del([collection])
  })

  it('query() normalizes shorthand params', () => {
    const $byIds = $compatRoot.query(collection, ['a', 'b'])
    cleanupQueryHashes.push($byIds[QUERY_HASH])
    assert.deepEqual($byIds[PARAMS], { _id: { $in: ['a', 'b'] } })

    const $byId = $compatRoot.query(collection, 'a')
    cleanupQueryHashes.push($byId[QUERY_HASH])
    assert.deepEqual($byId[PARAMS], { _id: 'a' })
  })

  it('query subscribe/unsubscribe and getExtra work', async () => {
    const id1 = '_compat_query_api_1'
    const id2 = '_compat_query_api_2'
    const $doc1 = await sub($[collection][id1])
    const $doc2 = await sub($[collection][id2])
    await $doc1.set({ name: 'First', active: true })
    await $doc2.set({ name: 'Second', active: false })

    const $query = $compatRoot.query(collection, { active: true })
    cleanupQueryHashes.push($query[QUERY_HASH])
    await $query.subscribe()
    assert.deepEqual($query.getIds().slice().sort(), [id1])
    await $query.unsubscribe()
    assert.equal($query.get(), undefined)

    _set([QUERIES, $query[QUERY_HASH], 'extra'], { count: 3 })
    assert.deepEqual($query.getExtra(), { count: 3 })

    const $agg = $compatRoot.query(collection, { $aggregate: [{ $match: { active: true } }] })
    cleanupAggregationHashes.push($agg[QUERY_HASH])
    _set([AGGREGATIONS, $agg[QUERY_HASH]], [{ _id: 'a' }, { _id: 'b' }])
    assert.deepEqual($agg.getExtra(), [{ _id: 'a' }, { _id: 'b' }])
  })

  it('root subscribe/unsubscribe flattens arrays and ignores falsy values', async () => {
    const id = '_compat_query_api_root'
    const $doc = await sub($[collection][id])
    await $doc.set({ active: true })

    const $query = $compatRoot.query(collection, { active: true })
    cleanupQueryHashes.push($query[QUERY_HASH])
    await $compatRoot.subscribe([$query, null], undefined)
    assert.deepEqual($query.getIds(), [id])
    await $compatRoot.unsubscribe([$query, undefined])
  })
})

;(isCompatMode ? describe : describe.skip)('SignalCompat ref/removeRef', () => {
  let cleanupSegments
  let $root

  function setup (suffix) {
    const basePath = `_compatRef_${suffix}`
    cleanupSegments = [[basePath]]
    $root = createCompatRoot()
    return $root[basePath]
  }

  afterEach(() => {
    if (!cleanupSegments) return
    for (const segments of cleanupSegments) _del(segments)
  })

  it('syncs values both ways for direct signals', async () => {
    const $base = setup('direct')
    const $from = $base.from
    const $to = $base.to
    $from.ref($to)

    await $to.set({ name: 'Alice' })
    assert.deepEqual($from.get(), { name: 'Alice' })

    await $from.set({ name: 'Bob' })
    assert.deepEqual($to.get(), { name: 'Bob' })
  })

  it('routes ref syncing through scheduler in batch mode (no intermediate alias snapshots)', async () => {
    const $base = setup('batch')
    const $from = $base.from
    const $to = $base.to

    $from.ref($to)
    await $to.set({ a: 0, b: 0 })

    const snapshots = []
    const reaction = observe(
      () => deepCopyCompat($from.get()),
      { lazy: true, scheduler: job => scheduleReaction(() => snapshots.push(job())) }
    )
    snapshots.push(reaction())
    await $root.batch(async () => {
      await $to.set({ a: 1, b: 0 })
      await $to.set({ a: 1, b: 2 })
    })

    unobserve(reaction)

    assert.deepEqual($from.get(), { a: 1, b: 2 })
    assert.deepEqual(snapshots[snapshots.length - 1], { a: 1, b: 2 })
    assert.equal(snapshots.some(s => s && s.a === 1 && s.b === 0), false)
  })

  it('supports subpath refs from root', async () => {
    const $base = setup('subpath')
    const $session = $base.session
    const $target = $base.target
    $session.ref('tutoringSession', $target)

    await $target.set({ active: true })
    assert.deepEqual($session.tutoringSession.get(), { active: true })

    await $session.tutoringSession.set({ active: false })
    assert.deepEqual($target.get(), { active: false })
  })

  it('set(path, value) on root resolves refs inside the path', async () => {
    const $base = setup('setPathRef')
    const $session = $base.session
    const $target = $base.target
    $session.ref('user', $target)

    const path = `${$session.path()}.user.superField`
    await $root.set(path, 'superValue')

    assert.equal($target.superField.get(), 'superValue')
    assert.equal($session.user.superField.get(), 'superValue')
  })

  it('removeRef stops syncing', async () => {
    const $base = setup('remove')
    const $session = $base.session
    const $target = $base.target
    $session.ref('tutoringSession', $target)

    await $target.set({ value: 1 })
    assert.deepEqual($session.tutoringSession.get(), { value: 1 })

    $session.removeRef('tutoringSession')

    await $target.set({ value: 2 })
    assert.deepEqual($session.tutoringSession.get(), { value: 1 })

    await $session.tutoringSession.set({ value: 3 })
    assert.deepEqual($target.get(), { value: 2 })
  })
})

;(isCompatMode ? describe : describe.skip)('SignalCompat.start()/stop()', () => {
  const domainCollection = 'compatStartDomain'
  let cleanupSegments
  let cleanupStartPaths
  let $root

  before(() => {
    connect()
    addModel(`${domainCollection}.*`, CompatDomainStartModel)
    $root = getRootSignal({ rootId: '_compat_start_stop_root' })
  })

  function setup (suffix) {
    const basePath = `_compatStart_${suffix}`
    cleanupSegments ??= []
    cleanupSegments.push([basePath])
    return $root[basePath]
  }

  afterEach(() => {
    for (const path of cleanupStartPaths || []) {
      try {
        $root.stop(path)
      } catch {}
    }
    cleanupStartPaths = []
    for (const segments of cleanupSegments || []) _del(segments)
    cleanupSegments = []
    _del([domainCollection])
    _del(['_session'])
  })

  it('$root.start/$root.stop compute and update value', async () => {
    const $base = setup('writes')
    await $base.dep.set({ stageIds: ['s1'] })
    const targetPath = `${$base.path()}.virtual`
    cleanupStartPaths = [targetPath]

    $root.start(targetPath, $base.dep, dep => ({
      stageIds: dep.stageIds.slice(),
      total: dep.stageIds.length
    }))

    assert.deepEqual($base.virtual.get(), { stageIds: ['s1'], total: 1 })

    await $base.dep.set({ stageIds: ['s1', 's2'] })
    assert.deepEqual($base.virtual.get(), { stageIds: ['s1', 's2'], total: 2 })
    $root.stop(targetPath)
    cleanupStartPaths = []
    await $base.dep.set({ stageIds: ['s1', 's2', 's3'] })
    assert.deepEqual($base.virtual.get(), { stageIds: ['s1', 's2'], total: 2 })
  })

  it('non-root start/stop delegate to root (compat sugar)', async () => {
    const $base = setup('sugar')
    await $base.dep.set({ count: 1 })
    const absTargetPath = `${$base.path()}.virtual.value`
    cleanupStartPaths = [absTargetPath]

    $base.start('virtual.value', $base.dep, dep => dep.count)
    assert.equal($base.virtual.value.get(), 1)

    await $base.dep.count.set(2)
    assert.equal($base.virtual.value.get(), 2)

    $base.stop('virtual.value')
    cleanupStartPaths = []
    await $base.dep.count.set(3)
    assert.equal($base.virtual.value.get(), 2)
  })

  it('supports mixed dependencies (signal + string path + plain value)', async () => {
    const $base = setup('mixed')
    await $base.doc.set({ stageIds: ['a', 'b'] })
    await $base.overrides.set({ bonus: 3 })

    const targetPath = `${$base.path()}.virtual`
    cleanupStartPaths = [targetPath]
    $root.start(targetPath, $base.doc, `${$base.path()}.overrides`, 10, (doc, overrides, extra) => {
      return {
        total: doc.stageIds.length + (overrides?.bonus || 0) + extra
      }
    })
    assert.deepEqual($base.virtual.get(), { total: 15 })

    await $base.overrides.bonus.set(5)
    assert.deepEqual($base.virtual.get(), { total: 17 })
    $root.stop(targetPath)
    cleanupStartPaths = []
  })

  it('detaches started object snapshots so target mutations do not alias source', async () => {
    const $base = setup('detached')
    await $base.doc.set({
      config: {
        enabled: false,
        nested: { mode: 'text' }
      }
    })

    const targetPath = `${$base.path()}.virtual`
    cleanupStartPaths = [targetPath]
    $root.start(targetPath, $base.doc, doc => doc)

    assert.deepEqual($base.virtual.get(), $base.doc.get())
    assert.notEqual($base.virtual.get(), $base.doc.get())
    assert.notEqual($base.virtual.get().config, $base.doc.get().config)
    assert.notEqual($base.virtual.get().config.nested, $base.doc.get().config.nested)

    await $base.virtual.config.enabled.set(true)
    await $base.virtual.config.nested.mode.set('voice')

    assert.equal($base.virtual.get('config.enabled'), true)
    assert.equal($base.virtual.get('config.nested.mode'), 'voice')
    assert.equal($base.doc.get('config.enabled'), false)
    assert.equal($base.doc.get('config.nested.mode'), 'text')

    await $base.doc.set({
      config: {
        enabled: true,
        nested: { mode: 'audio' }
      }
    })
    assert.equal($base.virtual.get('config.enabled'), true)
    assert.equal($base.virtual.get('config.nested.mode'), 'audio')
  })

  it('priority: domain model method start() wins over compat fallback', () => {
    const $session = $root[domainCollection].session1
    assert.equal($session.start('chat', 'u1'), `domain:${domainCollection}.session1:chat:u1`)
  })

  it('priority: deref model method start() wins over compat fallback', () => {
    $root._session.ref('activeUser', `${domainCollection}.user2`)
    assert.equal(
      $root._session.activeUser.start('chat', 'u2'),
      `domain:${domainCollection}.user2:chat:u2`
    )
  })

  it('throws a clear error when getter is not a function', () => {
    const $base = setup('getter')
    const targetPath = `${$base.path()}.virtual`
    assert.throws(
      () => $root.start(targetPath, $base.dep, null),
      /Signal\.start\(\) expects the last argument to be a getter function/
    )
  })

  it('skips the tick when dependency is suspended (no getter call, no write)', async () => {
    const $base = setup('suspendedDep')
    const targetPath = `${$base.path()}.virtual`
    cleanupStartPaths = [targetPath]
    await $base.virtual.set('stable')
    const suspendedDep = {
      path: () => '_fake.suspendedDep',
      get () { throw Promise.resolve() }
    }
    let getterCalls = 0

    assert.doesNotThrow(() => {
      $root.start(targetPath, suspendedDep, value => {
        getterCalls += 1
        return value ?? 'fallback'
      })
    })
    assert.equal(getterCalls, 0)
    assert.equal($base.virtual.get(), 'stable')
    $root.stop(targetPath)
    cleanupStartPaths = []
  })

  it('rethrows non-thenable dependency errors', () => {
    const $base = setup('depError')
    const targetPath = `${$base.path()}.virtual`
    const badDep = {
      path: () => '_fake.badDep',
      get () { throw new Error('boom') }
    }

    assert.throws(
      () => $root.start(targetPath, badDep, value => value),
      /boom/
    )
  })

  it('skips the tick when getter throws thenable (no write)', async () => {
    const $base = setup('getterThenable')
    const targetPath = `${$base.path()}.virtual`
    cleanupStartPaths = [targetPath]
    await $base.virtual.set('stable')
    await $base.dep.set({ value: 1 })
    let getterCalls = 0

    assert.doesNotThrow(() => {
      $root.start(targetPath, $base.dep, () => {
        getterCalls += 1
        throw Promise.resolve()
      })
    })

    assert.equal(getterCalls, 1)
    assert.equal($base.virtual.get(), 'stable')
    $root.stop(targetPath)
    cleanupStartPaths = []
  })

  it('rethrows non-thenable getter errors', async () => {
    const $base = setup('getterError')
    const targetPath = `${$base.path()}.virtual`
    assert.throws(
      () => $root.start(targetPath, 1, () => {
        throw new Error('getter-boom')
      }),
      /getter-boom/
    )
  })

  it('fields named start/stop remain regular data fields', async () => {
    const $base = setup('fields')
    const $doc = $base.doc
    await $doc.set({ start: 'A', stop: 'B' })

    assert.equal($doc.get('start'), 'A')
    assert.equal($doc.get('stop'), 'B')

    await $doc.start.set('C')
    await $doc.stop.set('D')
    assert.equal($doc.get('start'), 'C')
    assert.equal($doc.get('stop'), 'D')
  })
})

;(isCompatMode ? describe : describe.skip)('Compat model events', () => {
  let cleanupSegments
  let $root

  function setup (suffix) {
    const basePath = `_compatEvents_${suffix}`
    cleanupSegments = [[basePath]]
    $root = createCompatRoot()
    return $root[basePath]
  }

  afterEach(() => {
    __resetModelEventsForTests()
    __resetRefLinksForTests()
    __resetSilentContextForTests()
    if (!cleanupSegments) return
    for (const segments of cleanupSegments) _del(segments)
  })

  it('emits change with prevValue for exact path', async () => {
    const $base = setup('exact')
    const events = []
    const handler = (value, prevValue) => events.push([value, prevValue])
    $root.on('change', `${$base.path()}.count`, handler)
    await $base.count.set(1)
    await $base.count.set(2)
    $root.removeListener('change', handler)
    await $base.count.set(3)
    assert.deepEqual(events, [[1, undefined], [2, 1]])
  })

  it('passes "*" captures to the handler', async () => {
    const $base = setup('star')
    const events = []
    const handler = (key, value, prevValue) => events.push([key, value, prevValue])
    $root.on('change', `${$base.path()}.items.*`, handler)
    await $base.items.first.set('a')
    await $base.items.second.set('b')
    assert.deepEqual(events, [['first', 'a', undefined], ['second', 'b', undefined]])
  })

  it('passes "**" capture and eventName for "all"', async () => {
    const $base = setup('starstar')
    const events = []
    const handler = (path, eventName, value) => events.push([path, eventName, value])
    $root.on('all', `${$base.path()}.**`, handler)
    await $base.a.b.set(7)
    assert.deepEqual(events, [['a.b', 'change', 7]])
  })

  it('supports once() for compat model events', async () => {
    const $base = setup('once')
    const events = []
    $root.once('change', `${$base.path()}.count`, (value, prevValue) => {
      events.push([value, prevValue])
    })

    await $base.count.set(1)
    await $base.count.set(2)

    assert.deepEqual(events, [[1, undefined]])
  })

  it('propagates events through refs', async () => {
    const $base = setup('ref')
    const $from = $base.alias
    const $to = $base.source
    $from.ref($to)
    const events = []
    const handler = value => events.push(value)
    $root.on('change', `${$from.path()}.title`, handler)
    await $to.title.set('One')
    assert.deepEqual(events, ['One'])
  })

  it('silent() suppresses compat model events for direct mutator call', async () => {
    const $base = setup('silentDirect')
    const events = []
    const handler = (value, prevValue) => events.push([value, prevValue])
    $root.on('change', `${$base.path()}.count`, handler)

    await $base.count.silent().set(1)
    assert.deepEqual(events, [])

    await $base.count.set(2)
    assert.deepEqual(events, [[2, 1]])
  })

  it('silent() suppresses compat model events when mutating through child path', async () => {
    const $base = setup('silentChild')
    const events = []
    const handler = value => events.push(value)
    $root.on('change', `${$base.path()}.profile.title`, handler)

    await $base.silent().profile.title.set('Kate')
    assert.deepEqual(events, [])

    await $base.profile.title.set('Ann')
    assert.deepEqual(events, ['Ann'])
  })

  it('silent(false) keeps compat model events enabled', async () => {
    const $base = setup('silentDisabled')
    const events = []
    const handler = value => events.push(value)
    $root.on('change', `${$base.path()}.title`, handler)

    await $base.title.silent(false).set('One')
    assert.deepEqual(events, ['One'])
  })

  it('silent() suppresses reactive updates scheduled via observe()', async () => {
    const $base = setup('silentReaction')
    await $base.count.set(0)
    const snapshots = []
    const reaction = observe(
      () => $base.count.get(),
      { lazy: true, scheduler: job => scheduleReaction(() => snapshots.push(job())) }
    )
    try {
      snapshots.push(reaction())
      await $base.count.silent().set(1)
      assert.equal(isSilentContextActive(), false)
      assert.deepEqual(snapshots, [0])

      await $base.count.set(2)
      assert.deepEqual(snapshots, [0, 2])
    } finally {
      unobserve(reaction)
    }
  })
})
