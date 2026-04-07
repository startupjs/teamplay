import { it, describe, afterEach, before, after } from 'mocha'
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
import { isMissingShareDoc } from '../orm/missingDoc.js'
import { ROOT, ROOT_ID } from '../orm/Root.js'
import { PARAMS, HASH as QUERY_HASH, VIEW_HASH as QUERY_VIEW_HASH, QUERIES, querySubscriptions } from '../orm/Query.js'
import { AGGREGATIONS } from '../orm/Aggregation.js'
import { getSubscriptionGcDelay, setSubscriptionGcDelay } from '../orm/subscriptionGcDelay.js'
import {
  __setImperativeQueryReadyTimeoutForTests,
  __resetImperativeQueryReadyTimeoutForTests
} from '../orm/Compat/queryReadiness.js'

const REGEX_POSITIVE_INTEGER = /^(?:0|[1-9]\d*)$/
function maybeTransformToArrayIndex (key) {
  if (typeof key === 'string' && REGEX_POSITIVE_INTEGER.test(key)) return +key
  return key
}

function deepCopyCompat (value) {
  if (!value || typeof value !== 'object') return value
  return JSON.parse(JSON.stringify(value))
}

let compatRootCounter = 0

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

function createCompatRoot (rootId = `_compat_root_${compatRootCounter++}`) {
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
  rootSignal[ROOT] = rootProxy
  rootSignal[ROOT_ID] = rootId
  cache.set('', rootProxy)
  return rootProxy
}

function getQueryRuntimeHash ($query) {
  return $query[QUERY_VIEW_HASH] || $query[QUERY_HASH]
}

function getAggregationRuntimeHash ($aggregation) {
  return $aggregation[QUERY_VIEW_HASH] || $aggregation[QUERY_HASH]
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

  it('keeps dot/at equivalence for chained read-write access', async () => {
    setup('chain')
    await $base.a.b.c.d.set(1)
    assert.equal($base.a.b.at('c.d').get(), 1)

    await $base.a.b.at('c.d').set(2)
    assert.equal($base.a.b.c.d.get(), 2)
    assert.equal($base.at('a.b.c.d').get(), 2)
  })

  it('resolves refs in relative path segments', async () => {
    setup('refs')
    cleanupSegments.push(['_users'])
    await $root._users.u1.set({ profile: { title: 'Alice' } })
    $base.ref('user', '_users.u1')

    assert.equal($base.get('user.profile.title'), 'Alice')
    assert.equal($base.at('user.profile').get('title'), 'Alice')
    assert.equal($base.user.profile.title.get(), 'Alice')

    await $base.at('user.profile').set('title', 'Bob')
    assert.equal($root._users.u1.get('profile.title'), 'Bob')
    assert.equal($base.user.profile.title.get(), 'Bob')
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
  it('returns undefined and supports optional callback', async () => {
    const $root = createCompatRoot()
    let called = 0
    const result = $root.close(err => {
      assert.equal(err, undefined)
      called++
    })
    assert.equal(result, undefined)
    await new Promise(resolve => setTimeout(resolve, 0))
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

  it('resolves refs in scoped path', async () => {
    setup('refs')
    cleanupSegments.push(['_users'], ['_session'])
    await $root._users.u1.set({ title: 'admin' })
    $root._session.ref('user', '_users.u1')

    assert.equal($base.scope('_session.user.title').get(), 'admin')
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

  it('resolves refs in subpath for copy helpers', async () => {
    setup('refs')
    cleanupSegments.push(['_users'])
    await $root._users.u1.set({
      profile: {
        flags: { active: true }
      }
    })
    $base.ref('user', '_users.u1')

    const deepCopy = $base.getDeepCopy('user.profile')
    const shallowCopy = $base.getCopy('user.profile')

    assert.deepEqual(deepCopy, { flags: { active: true } })
    assert.deepEqual(shallowCopy, { flags: { active: true } })
    assert.notEqual(deepCopy, $root._users.u1.get('profile'))
    assert.notEqual(shallowCopy, $root._users.u1.get('profile'))
  })

  it('throws on invalid arguments', () => {
    setup('args')
    assert.throws(() => $base.getCopy(1, 2), /expects a single argument/)
    assert.throws(() => $base.getCopy(1.5), /expects a string or integer argument/)
    assert.throws(() => $base.getDeepCopy(null), /expects a string or integer argument/)
  })
})

describe('SignalCompat root-scoped private storage', () => {
  afterEach(() => {
    _del(['__roots'])
  })

  it('isolates compat get/set on _session between roots', async () => {
    const $rootA = createCompatRoot('_compat_private_A')
    const $rootB = createCompatRoot('_compat_private_B')

    await $rootA.set('_session.userId', 'a')
    await $rootB.set('_session.userId', 'b')

    assert.equal($rootA.get('_session.userId'), 'a')
    assert.equal($rootB.get('_session.userId'), 'b')
  })

  it('isolates compat mutators on private paths between roots', async () => {
    const $rootA = createCompatRoot('_compat_private_mut_A')
    const $rootB = createCompatRoot('_compat_private_mut_B')

    await $rootA.set('_session.items', [])
    await $rootB.set('_session.items', [])
    await $rootA.scope('_session.items').push('a1')
    await $rootB.scope('_session.items').push('b1')
    await $rootA.set('_session.count', 0)
    await $rootB.set('_session.count', 0)
    await $rootA.scope('_session.count').increment()
    await $rootB.scope('_session.count').increment(2)

    assert.deepEqual($rootA.get('_session.items'), ['a1'])
    assert.deepEqual($rootB.get('_session.items'), ['b1'])
    assert.equal($rootA.get('_session.count'), 1)
    assert.equal($rootB.get('_session.count'), 2)
  })

  it('root get/peek expose only owning private data', async () => {
    const $rootA = createCompatRoot('_compat_private_snapshot_A')
    const $rootB = createCompatRoot('_compat_private_snapshot_B')

    await $rootA.set('_session.userId', 'a')
    await $rootB.set('_session.userId', 'b')
    const snapshot = $rootA.get()
    const rawSnapshot = $rootA.peek()

    assert.equal(snapshot.__roots, undefined)
    assert.equal(rawSnapshot.__roots, undefined)
    assert.equal(snapshot._session.userId, 'a')
    assert.equal(rawSnapshot._session.userId, 'a')
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

describe('SignalCompat relative path split equivalence', () => {
  let cleanupSegments
  let $root

  function setupPair (suffix) {
    const leftPath = `_compatSplit_${suffix}_left`
    const rightPath = `_compatSplit_${suffix}_right`
    cleanupSegments = [[leftPath], [rightPath]]
    $root = createCompatRoot()
    return {
      $left: $root[leftPath],
      $right: $root[rightPath]
    }
  }

  afterEach(() => {
    if (!cleanupSegments) return
    for (const segments of cleanupSegments) _del(segments)
  })

  it('get/peek return the same value regardless of path split', async () => {
    const { $left, $right } = setupPair('getpeek')
    await $left.a.b.c.d.e.f.set(17)
    await $right.a.b.c.d.e.f.set(17)

    assert.equal($left.a.b.c.get('d.e.f'), $right.a.b.get('c.d.e.f'))
    assert.equal($left.a.b.c.peek('d.e.f'), $right.a.b.peek('c.d.e.f'))
  })

  it('set-like path methods resolve to the same absolute target', async () => {
    const { $left, $right } = setupPair('setlike')

    await $left.a.b.c.set('d.e.f', 1)
    await $right.a.b.set('c.d.e.f', 1)
    assert.deepEqual($left.get(), $right.get())

    await $left.a.b.c.setNull('d.e.f', 2)
    await $right.a.b.setNull('c.d.e.f', 2)
    assert.deepEqual($left.get(), $right.get())

    await $left.create('docs_left', { title: 'x' })
    await $right.set('docs_left', { title: 'x' })
    await $right.create('docs_right', { title: 'x' })
    await $left.set('docs_right', { title: 'x' })
    assert.deepEqual($left.get(), $right.get())

    await $left.a.b.c.setDiffDeep('d', { only: 'new' })
    await $right.a.b.setDiffDeep('c.d', { only: 'new' })
    assert.deepEqual($left.get(), $right.get())

    await $left.a.b.c.setEach('d', { x: 1, y: 2 })
    await $right.a.b.setEach('c.d', { x: 1, y: 2 })
    assert.deepEqual($left.get(), $right.get())

    await $left.a.b.c.del('d.y')
    await $right.a.b.del('c.d.y')
    assert.deepEqual($left.get(), $right.get())

    await $left.a.b.c.increment('counter', 3)
    await $right.a.b.increment('c.counter', 3)
    assert.deepEqual($left.get(), $right.get())
  })

  it('array path methods resolve to the same absolute target', async () => {
    const { $left, $right } = setupPair('arrays')

    const pushLeft = await $left.a.b.c.push('list', 1)
    const pushRight = await $right.a.b.push('c.list', 1)
    assert.equal(pushLeft, pushRight)

    const unshiftLeft = await $left.a.b.c.unshift('list', 0)
    const unshiftRight = await $right.a.b.unshift('c.list', 0)
    assert.equal(unshiftLeft, unshiftRight)

    const insertLeft = await $left.a.b.c.insert('list', 1, ['x', 'y'])
    const insertRight = await $right.a.b.insert('c.list', 1, ['x', 'y'])
    assert.equal(insertLeft, insertRight)

    const moveLeft = await $left.a.b.c.move('list', 0, 2)
    const moveRight = await $right.a.b.move('c.list', 0, 2)
    assert.deepEqual(moveLeft, moveRight)

    const removeLeft = await $left.a.b.c.remove('list', 1, 2)
    const removeRight = await $right.a.b.remove('c.list', 1, 2)
    assert.deepEqual(removeLeft, removeRight)

    const popLeft = await $left.a.b.c.pop('list')
    const popRight = await $right.a.b.pop('c.list')
    assert.equal(popLeft, popRight)

    const shiftLeft = await $left.a.b.c.shift('list')
    const shiftRight = await $right.a.b.shift('c.list')
    assert.equal(shiftLeft, shiftRight)

    assert.deepEqual($left.get(), $right.get())
  })

  it('string path methods resolve to the same absolute target', async () => {
    const { $left, $right } = setupPair('strings')
    await $left.a.b.c.set('text', 'helo')
    await $right.a.b.set('c.text', 'helo')

    const prevInsertLeft = await $left.a.b.c.stringInsert('text', 3, 'l')
    const prevInsertRight = await $right.a.b.stringInsert('c.text', 3, 'l')
    assert.equal(prevInsertLeft, prevInsertRight)

    const prevRemoveLeft = await $left.a.b.c.stringRemove('text', 1, 2)
    const prevRemoveRight = await $right.a.b.stringRemove('c.text', 1, 2)
    assert.equal(prevRemoveLeft, prevRemoveRight)

    assert.deepEqual($left.get(), $right.get())
  })

  it('path split equivalence is preserved when refs are inside the path', async () => {
    if (process.env.TEAMPLAY_COMPAT !== '1') return
    const leftPath = '_compatSplit_refs_left'
    const rightPath = '_compatSplit_refs_right'
    cleanupSegments = [[leftPath], [rightPath]]
    const $realRoot = getRootSignal({ rootId: '_compat_split_refs_root' })
    const $left = $realRoot[leftPath]
    const $right = $realRoot[rightPath]
    $left.a.b.ref('c', $left.target)
    $right.a.b.ref('c', $right.target)

    await $left.a.b.set('c.profile.name', 'Alice')
    await $right.a.set('b.c.profile.name', 'Alice')

    assert.equal($left.a.b.get('c.profile.name'), $right.a.get('b.c.profile.name'))
    assert.equal($left.target.profile.name.get(), $right.target.profile.name.get())
    assert.deepEqual($left.get(), $right.get())
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
      if (doc?.data && !isMissingShareDoc(doc)) await cbPromise(cb => doc.del(cb))
      delete getConnection().collections?.compatGames?.[id]
    }
    __resetRefLinksForTests()
    _del(['_session'])
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

  it('treats missing public numeric compat paths as zero on increment', async () => {
    const gameId = '_compat_public_increment_missing'
    const $game = await sub($.compatGames[gameId])
    await $game.set({ title: 'Game' })

    const direct = await $game.increment('count', 1)
    assert.equal(direct, 1)
    assert.equal($game.count.get(), 1)

    const nested = await $game.increment('stats.entriesNum', 2)
    assert.equal(nested, 2)
    assert.equal($game.stats.entriesNum.get(), 2)
    assert.deepEqual($game.stats.get(), { entriesNum: 2 })
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

  it('keeps racer-like missing-path semantics for public compat string/array mutators', async () => {
    const gameId = '_compat_public_missing_string_array'
    const $game = await sub($.compatGames[gameId])
    await $game.set({ title: 'Game' })

    const prevString = await $game.stringInsert('text', 0, 'abc')
    assert.equal(prevString, undefined)
    assert.equal($game.text.get(), 'abc')

    const removedMissingString = await $game.stringRemove('missingText', 0, 1)
    assert.equal(removedMissingString, undefined)

    const popMissingArray = await $game.pop('missingList')
    assert.equal(popMissingArray, undefined)
    const shiftMissingArray = await $game.shift('missingList')
    assert.equal(shiftMissingArray, undefined)
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

  it('injects _id/id into compat docs and protects top-level identity fields', async () => {
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

  it('allows nested id/_id mutations on compat docs', async () => {
    const gameId = '_compat_public_nested_ids'
    const $game = await sub($.compatGames[gameId])
    await $game.set({
      name: 'Compat Nested',
      profile: {
        id: 'profile-1',
        _id: 'profile-1',
        nested: { id: 'nested-1', _id: 'nested-1' }
      }
    })

    await $game.profile.id.set('profile-2')
    await $game.profile._id.set('profile-3')
    await $game.setDiffDeep({
      name: 'Compat Nested',
      profile: {
        id: 'profile-4',
        _id: 'profile-5',
        nested: { id: 'nested-2', _id: 'nested-3' }
      }
    })

    assert.equal($game.id.get(), gameId)
    assert.equal($game._id.get(), gameId)
    assert.equal($game.profile.id.get(), 'profile-4')
    assert.equal($game.profile._id.get(), 'profile-5')
    assert.equal($game.profile.nested.id.get(), 'nested-2')
    assert.equal($game.profile.nested._id.get(), 'nested-3')
  })

  it('preserves nested id/_id on compat public subpath writes', async () => {
    const gameId = '_compat_public_nested_subpath_ids'
    const $game = await sub($.compatGames[gameId])
    await $game.set({ name: 'Compat Nested Subpath' })

    await $game.set('media', {
      id: 'media-1',
      _id: 'media-2',
      type: 'uploadedPDF'
    })

    assert.deepEqual($game.media.get(), {
      id: 'media-1',
      _id: 'media-2',
      type: 'uploadedPDF'
    })
  })

  it('ref forwards nested id/_id writes while preserving public doc identity', async () => {
    if (process.env.TEAMPLAY_COMPAT !== '1') return
    const gameId = '_compat_public_ref_ids'
    const $game = await sub($.compatGames[gameId])
    await $game.set({
      name: 'Compat Ref',
      profile: { id: 'profile-1', _id: 'profile-1' }
    })

    $._session.ref('activeGame', $game)

    await $._session.activeGame.id.set('other')
    await $._session.activeGame._id.set('other2')
    await $._session.activeGame.profile.id.set('profile-2')
    await $._session.activeGame.profile._id.set('profile-3')

    assert.equal($game.id.get(), gameId)
    assert.equal($game._id.get(), gameId)
    assert.equal($game.profile.id.get(), 'profile-2')
    assert.equal($game.profile._id.get(), 'profile-3')
    assert.equal($._session.activeGame.profile.id.get(), 'profile-2')
    assert.equal($._session.activeGame.profile._id.get(), 'profile-3')
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

  it('compat local add injects both id fields for all accepted top-level variants', async () => {
    const collection = '_compatLocalAdd'
    addModel(`${collection}.*`, SignalCompat)
    const $collection = $[collection]
    try {
      const generatedId = await $collection.add({ name: 'Generated' })
      assert.equal($collection[generatedId]._id.get(), generatedId)
      assert.equal($collection[generatedId].id.get(), generatedId)

      const fromId = await $collection.add({ id: 'local-id', name: 'From Id' })
      assert.equal($collection[fromId]._id.get(), 'local-id')
      assert.equal($collection[fromId].id.get(), 'local-id')

      const fromUnderscoreId = await $collection.add({ _id: 'local-underscore-id', name: 'From _id' })
      assert.equal($collection[fromUnderscoreId]._id.get(), 'local-underscore-id')
      assert.equal($collection[fromUnderscoreId].id.get(), 'local-underscore-id')

      const fromBoth = await $collection.add({ id: 'local-both', _id: 'local-both', name: 'From Both' })
      assert.equal($collection[fromBoth]._id.get(), 'local-both')
      assert.equal($collection[fromBoth].id.get(), 'local-both')
    } finally {
      _del([collection])
    }
  })

  it('compat local add does not normalize nested id/_id fields', async () => {
    const collection = '_compatLocalNestedAdd'
    addModel(`${collection}.*`, SignalCompat)
    const $collection = $[collection]
    try {
      const createdId = await $collection.add({
        name: 'Compat Nested Local',
        profile: { id: 'profile-1', _id: 'profile-2' }
      })
      const data = $collection[createdId].get()
      assert.equal(data._id, createdId)
      assert.equal(data.id, createdId)
      assert.equal(data.profile.id, 'profile-1')
      assert.equal(data.profile._id, 'profile-2')
    } finally {
      _del([collection])
    }
  })

  it('compat local add throws on conflicting id and _id', async () => {
    const collection = '_compatLocalAddConflict'
    addModel(`${collection}.*`, SignalCompat)
    const $collection = $[collection]
    await assert.rejects(
      $collection.add({ id: 'custom', _id: 'other', name: 'Compat Local Add' }),
      /conflicting "id".*"_id"/
    )
    assert.equal($collection.get(), undefined)
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
  let cleanupQueryRuntimeHashes = []
  let cleanupAggregationHashes = []
  let cleanupAggregationRuntimeHashes = []
  let $compatRoot
  let prevSubscriptionGcDelay

  before(() => {
    connect()
    addModel(`${collection}.*`, SignalCompat)
    $compatRoot = createCompatRoot()
    prevSubscriptionGcDelay = getSubscriptionGcDelay()
    setSubscriptionGcDelay(0)
  })

  function cbPromise (fn) {
    return new Promise((resolve, reject) => {
      fn((err, result) => err ? reject(err) : resolve(result))
    })
  }

  afterEach(async () => {
    querySubscriptions.subscribe = QuerySubscriptionsSubscribe
    const docs = getConnection().collections?.[collection] || {}
    for (const id of Object.keys(docs)) {
      const doc = getConnection().get(collection, id)
      if (doc?.data && !isMissingShareDoc(doc)) await cbPromise(cb => doc.del(cb))
      delete getConnection().collections?.[collection]?.[id]
    }
    for (const hash of cleanupQueryRuntimeHashes) _del([QUERIES, hash])
    for (const hash of cleanupQueryHashes) _del([QUERIES, hash])
    for (const hash of cleanupAggregationRuntimeHashes) _del([AGGREGATIONS, hash])
    for (const hash of cleanupAggregationHashes) _del([AGGREGATIONS, hash])
    cleanupQueryHashes = []
    cleanupQueryRuntimeHashes = []
    cleanupAggregationHashes = []
    cleanupAggregationRuntimeHashes = []
    __resetImperativeQueryReadyTimeoutForTests()
    _del([collection])
  })

  afterEach(() => {
    setSubscriptionGcDelay(0)
  })

  after(() => {
    setSubscriptionGcDelay(prevSubscriptionGcDelay)
  })

  const QuerySubscriptionsSubscribe = querySubscriptions.subscribe.bind(querySubscriptions)

  it('query() normalizes shorthand params', () => {
    const $byIds = $compatRoot.query(collection, ['a', 'b'])
    cleanupQueryHashes.push($byIds[QUERY_HASH])
    cleanupQueryRuntimeHashes.push(getQueryRuntimeHash($byIds))
    assert.deepEqual($byIds[PARAMS], { _id: { $in: ['a', 'b'] } })

    const $byId = $compatRoot.query(collection, 'a')
    cleanupQueryHashes.push($byId[QUERY_HASH])
    cleanupQueryRuntimeHashes.push(getQueryRuntimeHash($byId))
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
    cleanupQueryRuntimeHashes.push(getQueryRuntimeHash($query))
    await $query.subscribe()
    assert.deepEqual($query.getIds().slice().sort(), [id1])
    await $query.unsubscribe()
    assert.equal($query.get(), undefined)

    _set([QUERIES, getQueryRuntimeHash($query), 'extra'], { count: 3 })
    assert.deepEqual($query.getExtra(), { count: 3 })

    const $agg = $compatRoot.query(collection, { $aggregate: [{ $match: { active: true } }] })
    cleanupAggregationHashes.push($agg[QUERY_HASH])
    cleanupAggregationRuntimeHashes.push(getAggregationRuntimeHash($agg))
    _set([AGGREGATIONS, getAggregationRuntimeHash($agg)], [{ _id: 'a' }, { _id: 'b' }])
    assert.deepEqual($agg.getExtra(), [{ _id: 'a' }, { _id: 'b' }])
  })

  it('root subscribe/unsubscribe flattens arrays and ignores falsy values', async () => {
    const id = '_compat_query_api_root'
    const $doc = await sub($[collection][id])
    await $doc.set({ active: true })

    const $query = $compatRoot.query(collection, { active: true })
    cleanupQueryHashes.push($query[QUERY_HASH])
    cleanupQueryRuntimeHashes.push(getQueryRuntimeHash($query))
    await $compatRoot.subscribe([$query, null], undefined)
    assert.deepEqual($query.getIds(), [id])
    await $compatRoot.unsubscribe([$query, undefined])
  })

  it('await query.subscribe waits for full materialization and returns dense docs', async () => {
    const $query = $compatRoot.query(collection, { active: true })
    cleanupQueryHashes.push($query[QUERY_HASH])
    cleanupQueryRuntimeHashes.push(getQueryRuntimeHash($query))
    const queryRuntimeHash = getQueryRuntimeHash($query)

    querySubscriptions.subscribe = async () => {
      _set([QUERIES, queryRuntimeHash, 'ids'], ['doc1', 'doc2'])
      _set([QUERIES, queryRuntimeHash, 'docs'], [{ _id: 'doc1', id: 'doc1', active: true }, undefined])
      setTimeout(() => {
        _set([collection, 'doc1'], { _id: 'doc1', id: 'doc1', active: true })
        _set([collection, 'doc2'], { _id: 'doc2', id: 'doc2', active: true })
      }, 5)
    }

    await $query.subscribe()

    assert.deepEqual($query.getIds(), ['doc1', 'doc2'])
    assert.deepEqual($query.get().map(doc => doc.id), ['doc1', 'doc2'])
  })

  it('await root.subscribe($query) also waits for full materialization', async () => {
    const $query = $compatRoot.query(collection, { active: true })
    cleanupQueryHashes.push($query[QUERY_HASH])
    cleanupQueryRuntimeHashes.push(getQueryRuntimeHash($query))
    const queryRuntimeHash = getQueryRuntimeHash($query)

    querySubscriptions.subscribe = async () => {
      _set([QUERIES, queryRuntimeHash, 'ids'], ['doc3', 'doc4'])
      _set([QUERIES, queryRuntimeHash, 'docs'], [undefined, { _id: 'doc4', id: 'doc4', active: true }])
      setTimeout(() => {
        _set([collection, 'doc3'], { _id: 'doc3', id: 'doc3', active: true })
        _set([collection, 'doc4'], { _id: 'doc4', id: 'doc4', active: true })
      }, 5)
    }

    await $compatRoot.subscribe($query)

    assert.deepEqual($query.get().map(doc => doc.id), ['doc3', 'doc4'])
  })

  it('await query.fetch also waits for full materialization', async () => {
    const $query = $compatRoot.query(collection, { active: true })
    cleanupQueryHashes.push($query[QUERY_HASH])
    cleanupQueryRuntimeHashes.push(getQueryRuntimeHash($query))
    const queryRuntimeHash = getQueryRuntimeHash($query)

    querySubscriptions.subscribe = async () => {
      _set([QUERIES, queryRuntimeHash, 'ids'], ['doc6', 'doc7'])
      _set([QUERIES, queryRuntimeHash, 'docs'], [{ _id: 'doc6', id: 'doc6', active: true }, undefined])
      setTimeout(() => {
        _set([collection, 'doc6'], { _id: 'doc6', id: 'doc6', active: true })
        _set([collection, 'doc7'], { _id: 'doc7', id: 'doc7', active: true })
      }, 5)
    }

    await $query.fetch()

    assert.deepEqual($query.get().map(doc => doc.id), ['doc6', 'doc7'])
  })

  it('throws when imperative compat query never fully materializes', async () => {
    const $query = $compatRoot.query(collection, { active: true })
    cleanupQueryHashes.push($query[QUERY_HASH])
    cleanupQueryRuntimeHashes.push(getQueryRuntimeHash($query))
    __setImperativeQueryReadyTimeoutForTests(20)
    const queryRuntimeHash = getQueryRuntimeHash($query)

    querySubscriptions.subscribe = async () => {
      _set([QUERIES, queryRuntimeHash, 'ids'], ['doc5'])
      _set([QUERIES, queryRuntimeHash, 'docs'], [undefined])
    }

    await assert.rejects(
      $query.subscribe(),
      /Compat query did not fully materialize/
    )
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

  it('set(path, value) on local signals works when root pointer is raw', async () => {
    setup('rawRootPathSet')
    const localId = '_raw_local_0'
    const cache = new Map()
    const $local = createCompatSignal(['$local', localId], raw($root), cache)
    cleanupSegments.push(['$local', localId])

    await $local.set({ nodes: {} })
    await $local.set('nodes.dropdown', { open: true })

    assert.deepEqual($local.nodes.dropdown.get(), { open: true })
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

  it('refExtra from aggregation keeps target readable for hash paths with dots', async () => {
    const $base = setup('refExtraAggReadable')
    const query = {
      $aggregate: [
        {
          $match: {
            kind: 'template',
            forceUpdate: { $ne: 0 }
          }
        },
        {
          $lookup: {
            from: 'courses',
            let: { courseId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$nodeRefs.courseTemplateNodeId', '$$courseId'] }
                    ]
                  }
                }
              }
            ],
            as: 'courses'
          }
        },
        { $sort: { createdAt: -1, name: 1 } },
        { $limit: 15 }
      ]
    }
    const $agg = $root.query('courses', query)
    const aggregationRuntimeHash = getAggregationRuntimeHash($agg)
    cleanupSegments.push([AGGREGATIONS, aggregationRuntimeHash])

    const rows1 = [{ _id: 'row1', name: 'First' }, { _id: 'row2', name: 'Second' }]
    _set([AGGREGATIONS, aggregationRuntimeHash], rows1)
    $agg.refExtra(`${$base.path()}.dataSource`)

    assert.deepEqual($base.dataSource.get(), rows1)
    assert.deepEqual($base.at('dataSource').get(), rows1)
    assert.deepEqual($root.get(`${$base.path()}.dataSource`), rows1)

    const rows2 = [{ _id: 'row3', name: 'Third' }]
    _set([AGGREGATIONS, aggregationRuntimeHash], rows2)

    assert.deepEqual($base.dataSource.get(), rows2)
    assert.deepEqual($base.at('dataSource').get(), rows2)
    assert.deepEqual($root.get(`${$base.path()}.dataSource`), rows2)
  })

  it('at() on aggregation rows is synchronous and returns a signal', () => {
    setup('aggRowAtSync')
    const $agg = $root.query('courses', {
      $aggregate: [
        { $match: { kind: 'template' } },
        { $sort: { createdAt: -1, name: 1 } },
        { $limit: 5 },
        { $project: { _id: 1, description: 1 } }
      ]
    })
    const aggregationRuntimeHash = getAggregationRuntimeHash($agg)
    cleanupSegments.push([AGGREGATIONS, aggregationRuntimeHash])

    _set([AGGREGATIONS, aggregationRuntimeHash], [
      {
        _id: 'row-sync-at',
        description: { text: 'hello' }
      }
    ])

    const $fromAt = $agg[0].at('description.text')
    assert.equal(typeof $fromAt, 'function')
    assert.equal(typeof $fromAt.get, 'function')
    assert.equal($fromAt.get(), 'hello')
    assert.equal($fromAt.path(), `${AGGREGATIONS}.${aggregationRuntimeHash}.0.description.text`)
  })

  it('scope() on aggregation rows is synchronous and does not return a promise', () => {
    setup('aggRowScopeSync')
    const $agg = $root.query('courses', {
      $aggregate: [
        { $match: { kind: 'template' } },
        { $limit: 1 }
      ]
    })
    const aggregationRuntimeHash = getAggregationRuntimeHash($agg)
    cleanupSegments.push([AGGREGATIONS, aggregationRuntimeHash])

    _set([AGGREGATIONS, aggregationRuntimeHash], [
      {
        _id: 'row-sync-scope',
        description: { text: 'world' }
      }
    ])

    const $fromScope = $agg[0].scope('_session')
    assert.equal(typeof $fromScope, 'function')
    assert.equal(typeof $fromScope.get, 'function')
    assert.equal($fromScope instanceof Promise, false)
  })

  it('refExtra from aggregation is mirror-only and does not mutate source on target writes', async () => {
    const $base = setup('refExtraAggMirrorOnly')
    const $agg = $root.query('courses', {
      $aggregate: [
        { $match: { kind: 'template' } },
        { $sort: { createdAt: -1, name: 1 } },
        { $limit: 5 }
      ]
    })
    const aggregationRuntimeHash = getAggregationRuntimeHash($agg)
    cleanupSegments.push([AGGREGATIONS, aggregationRuntimeHash])

    const sourceRows = [{ _id: 's1', name: 'Source' }]
    _set([AGGREGATIONS, aggregationRuntimeHash], sourceRows)
    $agg.refExtra(`${$base.path()}.dataSource`)
    assert.deepEqual($base.dataSource.get(), sourceRows)

    const localRows = [{ _id: 'l1', name: 'Local' }]
    await $base.dataSource.set(localRows)

    assert.deepEqual($base.dataSource.get(), localRows)
    assert.deepEqual($agg.get(), sourceRows)
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

  it('reacts to deep source mutations even when getter only returns the whole object', async () => {
    const $base = setup('deepMutation')
    await $base.doc.set({
      config: {
        realtimeConfig: {
          voice: 'alloy'
        }
      }
    })

    const targetPath = `${$base.path()}.virtual`
    cleanupStartPaths = [targetPath]
    $root.start(targetPath, $base.doc, doc => doc)

    assert.deepEqual($base.virtual.get('config.realtimeConfig'), { voice: 'alloy' })

    await $base.doc.set('config.realtimeConfig.useProxyForVoice', true)
    assert.deepEqual($base.virtual.get('config.realtimeConfig'), {
      voice: 'alloy',
      useProxyForVoice: true
    })
  })

  it('keeps child-signal observers reactive after syncing object targets', async () => {
    const $base = setup('childSignalReactivity')
    await $base.doc.set({
      name: 'Stage 1',
      config: {
        realtimeConfig: {
          voice: 'alloy'
        }
      }
    })

    const targetPath = `${$base.path()}.virtual`
    cleanupStartPaths = [targetPath]
    const $name = $base.virtual.name
    const $voice = $base.virtual.config.realtimeConfig.voice
    $root.start(targetPath, $base.doc, doc => doc)
    const snapshots = []
    const reaction = observe(
      () => ({
        name: $name.get(),
        voice: $voice.get()
      }),
      {
        lazy: true,
        scheduler: job => scheduleReaction(() => {
          const snapshot = job()
          const prev = snapshots[snapshots.length - 1]
          if (JSON.stringify(prev) !== JSON.stringify(snapshot)) snapshots.push(snapshot)
        })
      }
    )
    snapshots.push(reaction())

    await $base.doc.name.set('Stage 2')
    await $base.doc.config.realtimeConfig.voice.set('echo')
    await $base.virtual.name.set('Draft')
    await $base.virtual.config.realtimeConfig.voice.set('nova')
    await $base.doc.set({
      name: 'Stage 3',
      config: {
        realtimeConfig: {
          voice: 'shimmer'
        }
      }
    })

    unobserve(reaction)

    assert.deepEqual(snapshots, [
      { name: 'Stage 1', voice: 'alloy' },
      { name: 'Stage 2', voice: 'alloy' },
      { name: 'Stage 2', voice: 'echo' },
      { name: 'Draft', voice: 'echo' },
      { name: 'Draft', voice: 'nova' },
      { name: 'Stage 3', voice: 'shimmer' }
    ])
  })

  it('keeps pre-bound undefined boolean and text child signals writable after object syncs', async () => {
    const $base = setup('undefinedChildFields')
    await $base.doc.set({
      name: 'Stage 1',
      config: {}
    })

    const targetPath = `${$base.path()}.virtual`
    cleanupStartPaths = [targetPath]
    const $final = $base.virtual.final
    const $prompt = $base.virtual.prompt
    $root.start(targetPath, $base.doc, doc => doc)

    const snapshots = []
    const reaction = observe(
      () => ({
        final: $final.get(),
        prompt: $prompt.get()
      }),
      {
        lazy: true,
        scheduler: job => scheduleReaction(() => {
          const snapshot = job()
          const prev = snapshots[snapshots.length - 1]
          if (JSON.stringify(prev) !== JSON.stringify(snapshot)) snapshots.push(snapshot)
        })
      }
    )
    snapshots.push(reaction())

    await $final.set(true)
    await $prompt.set('Draft prompt')

    assert.equal($base.virtual.get('final'), true)
    assert.equal($base.virtual.get('prompt'), 'Draft prompt')
    assert.equal($base.doc.get('final'), undefined)
    assert.equal($base.doc.get('prompt'), undefined)

    await $base.doc.set({
      name: 'Stage 2',
      final: true,
      prompt: 'Saved prompt',
      config: {}
    })

    unobserve(reaction)

    assert.deepEqual(snapshots, [
      { final: undefined, prompt: undefined },
      { final: true, prompt: undefined },
      { final: true, prompt: 'Draft prompt' },
      { final: true, prompt: 'Saved prompt' }
    ])
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
