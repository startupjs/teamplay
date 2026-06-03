import { it, describe, afterEach, before, after } from 'mocha'
import { strict as assert } from 'node:assert'
import { raw, observe, unobserve } from '@nx-js/observer-util'
import { $, sub, addModel, aggregation, getRootSignal } from '../src/index.ts'
import { get as _get, set as _set, del as _del } from '../src/orm/dataTree.js'
import { getConnection, setConnection, getDefaultFetchOnly, setDefaultFetchOnly } from '../src/orm/connection.ts'
import getSignal from '../src/orm/getSignal.ts'
import connect from '../src/connect/test.js'
import SignalCompat from '../src/orm/Compat/SignalCompat.js'
import { Signal as BaseSignal } from '../src/orm/SignalBase.ts'
import { scheduleReaction } from '../src/orm/batchScheduler.js'
import { __resetModelEventsForTests } from '../src/orm/Compat/modelEvents.js'
import { __resetRefLinksForTests } from '../src/orm/Compat/refRegistry.js'
import { __resetSilentContextForTests, isSilentContextActive } from '../src/orm/Compat/silentContext.js'
import { isMissingShareDoc } from '../src/orm/missingDoc.js'
import { ROOT, ROOT_ID } from '../src/orm/Root.ts'
import { PARAMS, HASH as QUERY_HASH, QUERIES, querySubscriptions } from '../src/orm/Query.js'
import { AGGREGATIONS, aggregationSubscriptions } from '../src/orm/Aggregation.js'
import { delPrivateData, setPrivateData } from '../src/orm/privateData.js'
import { getSubscriptionGcDelay, setSubscriptionGcDelay } from '../src/orm/subscriptionGcDelay.ts'
import { __resetRootContextsForTests, getRootContext } from '../src/orm/rootContext.ts'
import {
  __setImperativeQueryReadyTimeoutForTests,
  __resetImperativeQueryReadyTimeoutForTests
} from '../src/orm/Compat/queryReadiness.js'

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
const describeCompat = process.env.TEAMPLAY_COMPAT === '1' ? describe : describe.skip

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
  return $query[QUERY_HASH]
}

function getAggregationRuntimeHash ($aggregation) {
  return $aggregation[QUERY_HASH]
}

function getRootIdForRuntime ($signal) {
  return ($signal[ROOT] || $signal)?.[ROOT_ID]
}

function setQueryRuntime ($query, key, value) {
  return setPrivateData(getRootIdForRuntime($query), [QUERIES, getQueryRuntimeHash($query), key], value)
}

function setAggregationRuntime ($aggregation, value) {
  return setPrivateData(getRootIdForRuntime($aggregation), [AGGREGATIONS, getAggregationRuntimeHash($aggregation)], value)
}

describe('SignalCompat removed path helpers', () => {
  let basePath
  let cleanupSegments
  let $root
  let $base

  function setup (suffix) {
    basePath = `_compatNoPathHelpers_${suffix}`
    cleanupSegments = [[basePath]]
    $root = createCompatRoot()
    $base = $root[basePath]
  }

  afterEach(() => {
    if (!cleanupSegments) return
    for (const segments of cleanupSegments) _del(segments)
  })

  it('does not reserve at/scope as compat methods anymore', async () => {
    setup('fields')

    await $base.at.set('at field')
    await $base.scope.set('scope field')

    assert.equal($base.at.get(), 'at field')
    assert.equal($base.scope.get(), 'scope field')
  })

  it('root() returns the owning root', () => {
    setup('root')

    assert.equal($base.root(), $root)
    assert.equal($root.root(), $root)
  })

  it('does not reserve root as a compat property anymore', () => {
    const $root = getRootSignal({ rootId: 'compat-root-property-path' })
    const $base = $root._compatRootProperty.base

    assert.equal($base.root(), $root)
    assert.equal($base.root.path(), '_compatRootProperty.base.root')
    assert.notEqual($base.root, $root)
  })

  it('path only returns the current signal path', () => {
    setup('path')

    assert.equal($base.path(), basePath)
    assert.equal($base.a.b.path(), `${basePath}.a.b`)
  })

  it('path rejects subpath arguments', () => {
    setup('args')

    assert.throws(() => $base.path('a'), /does not accept any arguments/)
    assert.throws(() => $base.path(1), /does not accept any arguments/)
  })
})

describe('SignalCompat get/peek without subpath', () => {
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

  it('reads only the current signal', async () => {
    setup('current')
    await $base.set(5)

    assert.equal($base.get(), 5)
    assert.equal($base.peek(), 5)
  })

  it('rejects subpath arguments', () => {
    setup('args')

    assert.throws(() => $base.get('a'), /does not accept any arguments/)
    assert.throws(() => $base.peek('a'), /does not accept any arguments/)
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

  it('rejects root add(collection, value)', async () => {
    setup('root')
    cleanupSegments.push(['_users'])
    await assert.rejects(
      $root.add('_users', { title: 'Ann' }),
      /Signal\.add\(\) expects a single argument/
    )
  })

  it('rejects root() with add(collection, value)', async () => {
    setup('rootProp')
    cleanupSegments.push(['_users'])
    await assert.rejects(
      $root._users.root().add('_users', { title: 'Zoe' }),
      /Signal\.add\(\) expects a single argument/
    )
  })

  it('rejects root add(collection, value) when in compat mode', async () => {
    setup('rootCompat')
    cleanupSegments.push(['_tenants'])
    const prevCompat = globalThis.teamplayCompatibilityMode
    globalThis.teamplayCompatibilityMode = true
    try {
      await assert.rejects(
        $root._tenants.root().add('_tenants', { title: 'Acme' }),
        /Signal\.add\(\) expects a single argument/
      )
    } finally {
      globalThis.teamplayCompatibilityMode = prevCompat
    }
  })

  it('rejects raw-signal root add(collection, value) via model.root()', async function () {
    if (!(typeof process !== 'undefined' && process?.env?.TEAMPLAY_COMPAT === '1')) {
      this.skip()
    }
    const prevCompat = globalThis.teamplayCompatibilityMode
    globalThis.teamplayCompatibilityMode = true
    try {
      const $root = getRootSignal({ rootId: 'compat_root_add' })
      await assert.rejects(
        $root._tenants.root().add('_tenants', { title: 'Tenant 1' }),
        /Signal\.add\(\) expects a single argument/
      )
    } finally {
      globalThis.teamplayCompatibilityMode = prevCompat
    }
  })

  it('supports collection add(value)', async () => {
    setup('collection')
    const id = await $base.add({ title: 'Kate' })
    assert.equal($base[id].title.get(), 'Kate')
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
    await $base.set({ a: nested })
    const original = raw($base.get())
    const copy = $base.getCopy()
    assert.deepEqual(copy, original)
    assert.notEqual(copy, original)
    assert.equal(copy.a, original.a)
  })

  it('getDeepCopy returns a deep copy for objects', async () => {
    setup('deep')
    const nested = { b: 1 }
    await $base.set({ a: nested })
    const original = raw($base.get())
    const copy = $base.getDeepCopy()
    assert.deepEqual(copy, original)
    assert.notEqual(copy, original)
    assert.notEqual(copy.a, original.a)
  })

  it('throws on invalid arguments', () => {
    setup('args')
    assert.throws(() => $base.getCopy(1), /does not accept any arguments/)
    assert.throws(() => $base.getDeepCopy(null), /does not accept any arguments/)
  })
})

describe('SignalCompat root-scoped private storage', () => {
  afterEach(() => {
    __resetRootContextsForTests()
  })

  it('isolates compat get/set on _session between roots', async () => {
    const $rootA = createCompatRoot('_compat_private_A')
    const $rootB = createCompatRoot('_compat_private_B')

    await $rootA._session.userId.set('a')
    await $rootB._session.userId.set('b')

    assert.equal($rootA._session.userId.get(), 'a')
    assert.equal($rootB._session.userId.get(), 'b')
  })

  it('isolates compat mutators on private paths between roots', async () => {
    const $rootA = createCompatRoot('_compat_private_mut_A')
    const $rootB = createCompatRoot('_compat_private_mut_B')

    await $rootA._session.items.set([])
    await $rootB._session.items.set([])
    await $rootA._session.items.push('a1')
    await $rootB._session.items.push('b1')
    await $rootA._session.count.set(0)
    await $rootB._session.count.set(0)
    await $rootA._session.count.increment()
    await $rootB._session.count.increment(2)

    assert.deepEqual($rootA._session.items.get(), ['a1'])
    assert.deepEqual($rootB._session.items.get(), ['b1'])
    assert.equal($rootA._session.count.get(), 1)
    assert.equal($rootB._session.count.get(), 2)
  })

  it('root get/peek expose only owning private data', async () => {
    const $rootA = createCompatRoot('_compat_private_snapshot_A')
    const $rootB = createCompatRoot('_compat_private_snapshot_B')

    await $rootA._session.userId.set('a')
    await $rootB._session.userId.set('b')
    const snapshot = $rootA.get()
    const rawSnapshot = $rootA.peek()

    assert.equal(snapshot.__roots, undefined)
    assert.equal(rawSnapshot.__roots, undefined)
    assert.equal(snapshot._session.userId, 'a')
    assert.equal(rawSnapshot._session.userId, 'a')
  })
})

describe('SignalCompat mutators without subpath overloads', () => {
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

  it('set uses child signals instead of subpath arguments', async () => {
    setup('set')
    await $base.a.b.set(1)
    assert.equal($base.a.b.get(), 1)
  })

  it('materializes missing nested object parents on local child paths', async () => {
    if (process.env.TEAMPLAY_COMPAT !== '1') return
    setup('root-set-missing-local-object')

    await $base.doc.__dummyField.test.set('123')

    assert.equal($base.doc.__dummyField.test.get(), '123')
    assert.deepEqual($base.doc.get(), {
      __dummyField: {
        test: '123'
      }
    })
  })

  it('set supports numeric child paths', async () => {
    setup('setnum')
    await $base.arr.set([0, 1, 2])
    await $base.arr[1].set(9)
    assert.equal($base.arr[1].get(), 9)
  })

  it('set replaces value with null (no deep merge/delete semantics)', async () => {
    setup('setnull-delete')
    await $base.obj.set({ a: 1, b: 2 })
    await $base.obj.a.set(null)
    assert.equal($base.obj.a.get(), null)
    assert.deepEqual($base.obj.get(), { a: null, b: 2 })
  })

  it('set with undefined matches racer local semantics on object keys', async () => {
    setup('set-undefined')
    await $base.set({ a: 1, b: 2 })
    await $base.a.set(undefined)
    assert.equal($base.a.get(), undefined)
    assert.ok(Object.prototype.hasOwnProperty.call(raw($base.get()), 'a'))
    assert.deepEqual($base.get(), { a: undefined, b: 2 })
  })

  it('set with undefined matches racer local sparse-array semantics', async () => {
    setup('set-undefined-array')
    await $base.arr[2].set(undefined)
    const items = raw($base.arr.get())
    assert.equal(items.length, 3)
    assert.equal(0 in items, false)
    assert.equal(1 in items, false)
    assert.equal(2 in items, true)
    assert.equal($base.arr[2].get(), undefined)
  })

  it('direct child set(undefined) matches racer local object semantics', async () => {
    setup('set-undefined-child-object')
    await $base.set({ a: 1, b: 2 })
    await $base.a.set(undefined)
    assert.equal($base.a.get(), undefined)
    assert.ok(Object.prototype.hasOwnProperty.call(raw($base.get()), 'a'))
    assert.deepEqual($base.get(), { a: undefined, b: 2 })
  })

  it('direct child set(undefined) matches racer local sparse-array semantics', async () => {
    setup('set-undefined-child-array')
    await $base.arr[2].set(undefined)
    const items = raw($base.arr.get())
    assert.equal(items.length, 3)
    assert.equal(0 in items, false)
    assert.equal(1 in items, false)
    assert.equal(2 in items, true)
    assert.equal($base.arr[2].get(), undefined)
  })

  it('set uses replace semantics for nested objects', async () => {
    setup('set-replace')
    await $base.set({ a: { x: 1, y: 2 } })
    await $base.a.set({ x: 9 })
    assert.deepEqual($base.get(), { a: { x: 9 } })
  })

  it('setReplace on child signal matches compat set replace semantics', async () => {
    setup('setreplace-subpath')
    await $base.set({ a: { x: 1, y: 2 } })

    await $base.a.setReplace({ x: 9 })

    assert.deepEqual($base.get(), { a: { x: 9 } })
  })

  it('setReplace with undefined matches compat set local semantics', async () => {
    setup('setreplace-undefined')
    await $base.set({ a: 1, b: 2 })

    await $base.a.setReplace(undefined)

    assert.equal($base.a.get(), undefined)
    assert.ok(Object.prototype.hasOwnProperty.call(raw($base.get()), 'a'))
    assert.deepEqual($base.get(), { a: undefined, b: 2 })
  })

  it('del uses child signals instead of subpath arguments', async () => {
    setup('del')
    await $base.a.b.set(1)
    await $base.a.b.del()
    assert.equal($base.a.b.get(), undefined)
  })

  it('setNull only sets when value is nullish', async () => {
    setup('setnull')
    await $base.a.set(1)
    await $base.a.setNull(2)
    await $base.b.setNull(3)
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

  it('create uses child signals instead of subpath arguments', async () => {
    setup('create-child')
    await $base.doc2.create({ title: 'child create' })
    assert.deepEqual($base.doc2.get(), { title: 'child create' })
  })

  it('create throws on non-document paths', async () => {
    setup('create-invalid')
    await assert.rejects(
      $base.create({ a: 1 }),
      /document path/
    )
  })

  it('setDiffDeep uses child signals instead of subpath arguments', async () => {
    setup('setdiffdeep')
    await $base.obj.setDiffDeep({ a: 1 })
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

  it('setDiffDeep keeps empty top-level target objects materialized', async () => {
    setup('setdiffdeep-empty-top')
    await $base.set({ tab: 'home' })
    await $base.setDiffDeep({})
    assert.deepEqual($base.get(), {})
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

  it('setDiffDeep on child signal applies recursive compat diff on the target path', async () => {
    setup('setdiffdeep-path')
    await $base.set({
      profile: {
        name: 'Ann',
        role: 'student'
      }
    })
    await $base.profile.setDiffDeep({ name: 'Bob' })
    assert.deepEqual($base.profile.get(), { name: 'Bob' })
    assert.deepEqual($base.get(), { profile: { name: 'Bob' } })
  })

  it('setDiffDeep on child signal keeps empty target objects materialized', async () => {
    setup('setdiffdeep-empty-path')
    await $base.set({
      filters: { tab: 'home' },
      other: 1
    })
    await $base.filters.setDiffDeep({})
    assert.deepEqual($base.filters.get(), {})
    assert.deepEqual($base.get(), {
      filters: {},
      other: 1
    })
  })

  it('setDiff(value) skips exact-equal primitive writes', async () => {
    setup('setdiff-primitive-noop')
    await $base.set(1)
    const events = []
    const handler = (value, prevValue) => events.push([value, prevValue])
    $root.on('change', $base.path(), handler)

    await $base.setDiff(1)
    assert.deepEqual(events, [])

    await $base.setDiff(2)
    assert.equal($base.get(), 2)
    if (process?.env?.TEAMPLAY_COMPAT === '1') {
      assert.deepEqual(events, [[2, 1]])
    }
  })

  it('setDiff on child signal emits change for equivalent objects', async () => {
    setup('setdiff-object-change')
    await $base.set({ profile: { name: 'Ann' } })
    const events = []
    const handler = (value, prevValue) => events.push([value, prevValue])
    $root.on('change', `${$base.path()}.profile`, handler)

    await $base.profile.setDiff({ name: 'Ann' })

    assert.deepEqual($base.profile.get(), { name: 'Ann' })
    if (process?.env?.TEAMPLAY_COMPAT === '1') {
      assert.deepEqual(events, [[{ name: 'Ann' }, { name: 'Ann' }]])
    }
  })

  it('setDiff on child signal emits change for equivalent arrays', async () => {
    setup('setdiff-array-change')
    await $base.set({ list: [2, 3, 4] })
    const events = []
    const handler = (value, prevValue) => events.push([value, prevValue])
    $root.on('change', `${$base.path()}.list`, handler)

    await $base.list.setDiff([2, 3, 4])

    assert.deepEqual($base.list.get(), [2, 3, 4])
    if (process?.env?.TEAMPLAY_COMPAT === '1') {
      assert.deepEqual(events, [[[2, 3, 4], [2, 3, 4]]])
    }
  })

  it('setDiff on child signal follows racer replace semantics', async () => {
    setup('setdiffnull')
    await $base.set({ a: 1 })
    await $base.a.setDiff(null)
    assert.equal($base.a.get(), null)
  })

  it('setEach uses child signals instead of subpath arguments', async () => {
    setup('seteach')
    await $base.obj.setEach({ a: 1, b: 2 })
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

  it('setEach with undefined matches racer local semantics (keeps key)', async () => {
    setup('seteach-undefined')
    await $base.set({ a: 1, b: 2 })
    await $base.setEach({ a: undefined })
    assert.equal($base.a.get(), undefined)
    assert.ok(Object.prototype.hasOwnProperty.call(raw($base.get()), 'a'))
    assert.deepEqual($base.get(), { a: undefined, b: 2 })
  })

  it('setEach on child signal with undefined matches racer local semantics (keeps key)', async () => {
    setup('seteach-child-undefined')
    await $base.set({
      obj: {
        a: 1,
        b: 2
      }
    })
    await $base.obj.setEach({ a: undefined })
    assert.equal($base.obj.a.get(), undefined)
    assert.ok(Object.prototype.hasOwnProperty.call(raw($base.obj.get()), 'a'))
    assert.deepEqual($base.obj.get(), { a: undefined, b: 2 })
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

  it('setDiffDeep does not expose undefined when target object becomes empty', async () => {
    setup('setdiffdeep-empty-atomic')
    await $base.set({
      filters: { tab: 'home' }
    })

    const snapshots = []
    const reaction = observe(
      () => {
        const value = $base.filters.get()
        return value == null ? value : deepCopyCompat(value)
      },
      { lazy: true, scheduler: reaction => scheduleReaction(() => snapshots.push(reaction())) }
    )
    snapshots.push(reaction())

    await $base.filters.setDiffDeep({})
    unobserve(reaction)

    assert.deepEqual(snapshots[snapshots.length - 1], {})
    assert.equal(snapshots.some(s => s === undefined), false)
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

    await $base.node.set(reactLikeA)
    await $base.node.set(reactLikeB)
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

    await $base.node.set(guarded)
    await $base.node.set({ storeId: 'new' })
    assert.deepEqual($base.node.get(), { storeId: 'new' })
  })

  it('increment supports child signals and default value', async () => {
    setup('increment')
    await $base.count.increment()
    await $base.count.increment(2)
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
    await $base.menu.open.set(true)
    assert.deepEqual($base.get(), { menu: { open: true } })
    assert.equal($base.menu.open.get(), true)
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

  it('materializes missing nested arrays on local child paths', async () => {
    if (process.env.TEAMPLAY_COMPAT !== '1') return
    setup('root-push-missing-local-array')

    const len = await $base.doc.tags.push('tag-1')

    assert.equal(len, 1)
    assert.deepEqual($base.doc.tags.get(), ['tag-1'])
    assert.deepEqual($base.doc.get(), {
      tags: ['tag-1']
    })
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

describeCompat('SignalCompat public mutators', () => {
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

    const inc = await $game.count.increment(2)
    assert.equal(inc, 2)
    assert.equal($game.count.get(), 2)

    const len1 = await $game.list.push(4)
    assert.equal(len1, 4)
    const len2 = await $game.list.unshift(0)
    assert.equal(len2, 5)
    const len3 = await $game.list.insert(2, ['a', 'b'])
    assert.equal(len3, 7)
    const popped = await $game.list.pop()
    assert.equal(popped, 4)
    const shifted = await $game.list.shift()
    assert.equal(shifted, 0)
    const removed = await $game.list.remove(1, 2)
    assert.deepEqual(removed, ['a', 'b'])
    const moved = await $game.list.move(1, 0)
    assert.deepEqual(moved, [2])
    assert.deepEqual($game.list.get(), [2, 1, 3])

    const prev1 = await $game.text.stringInsert(3, 'l')
    assert.equal(prev1, 'helo')
    assert.equal($game.text.get(), 'hello')
    const prev2 = await $game.text.stringRemove(1, 2)
    assert.equal(prev2, 'hello')
    assert.equal($game.text.get(), 'hlo')
  })

  it('uses direct replace ops for compat set on public array slots and object subpaths', async () => {
    const gameId = '_compat_public_set_replace_ops'
    const $game = await sub($.compatGames[gameId])
    await $game.set({
      list: ['one', 'two', 'three'],
      profile: {
        name: 'Ann',
        role: 'student'
      }
    })

    const doc = getConnection().get('compatGames', gameId)
    const originalSubmitOp = doc.submitOp.bind(doc)
    const submittedOps = []
    doc.submitOp = (op, cb) => {
      submittedOps.push(JSON.parse(JSON.stringify(op)))
      return originalSubmitOp(op, cb)
    }

    try {
      await $game.list[1].set('TWO')
      assert.deepEqual(submittedOps.at(-1), [
        { p: ['list', 1], ld: 'two', li: 'TWO' }
      ])
      assert.deepEqual($game.list.get(), ['one', 'TWO', 'three'])

      await $game.profile.set({ name: 'Kate' })
      assert.deepEqual(submittedOps.at(-1), [
        {
          p: ['profile'],
          od: { name: 'Ann', role: 'student' },
          oi: { name: 'Kate' }
        }
      ])
      assert.deepEqual($game.profile.get(), { name: 'Kate' })
    } finally {
      doc.submitOp = originalSubmitOp
    }
  })

  it('uses direct replace ops for compat setReplace on public paths', async () => {
    const gameId = '_compat_public_setreplace_ops'
    const $game = await sub($.compatGames[gameId])
    await $game.set({
      list: ['one', 'two', 'three'],
      profile: {
        name: 'Ann',
        role: 'student'
      }
    })

    const doc = getConnection().get('compatGames', gameId)
    const originalSubmitOp = doc.submitOp.bind(doc)
    const submittedOps = []
    doc.submitOp = (op, cb) => {
      submittedOps.push(JSON.parse(JSON.stringify(op)))
      return originalSubmitOp(op, cb)
    }

    try {
      await $game.list[1].setReplace('TWO')
      assert.deepEqual(submittedOps.at(-1), [
        { p: ['list', 1], ld: 'two', li: 'TWO' }
      ])
      assert.deepEqual($game.list.get(), ['one', 'TWO', 'three'])

      await $game.profile.setReplace({ name: 'Kate' })
      assert.deepEqual(submittedOps.at(-1), [
        {
          p: ['profile'],
          od: { name: 'Ann', role: 'student' },
          oi: { name: 'Kate' }
        }
      ])
      assert.deepEqual($game.profile.get(), { name: 'Kate' })
    } finally {
      doc.submitOp = originalSubmitOp
    }
  })

  it('uses compat set semantics for setReplace(undefined) on public documents', async () => {
    const gameId = '_compat_public_setreplace_undefined'
    const $game = await sub($.compatGames[gameId])
    await $game.set({ name: 'One' })

    const doc = getConnection().get('compatGames', gameId)
    const originalSubmitOp = doc.submitOp.bind(doc)
    const originalDel = doc.del.bind(doc)
    const submittedOps = []
    let delCalls = 0
    doc.submitOp = (op, cb) => {
      submittedOps.push(JSON.parse(JSON.stringify(op)))
      return originalSubmitOp(op, cb)
    }
    doc.del = cb => {
      delCalls += 1
      return originalDel(cb)
    }

    try {
      await $game.setReplace(undefined)

      assert.equal(delCalls, 1)
      assert.deepEqual(submittedOps, [])
      assert.equal($game.get(), undefined)
      assert.ok(doc.data, 'subscribed deleted docs must restore the empty missing-doc placeholder')
      assert.deepEqual(doc.data, {})
    } finally {
      doc.submitOp = originalSubmitOp
      doc.del = originalDel
    }
  })

  it('public child set materializes missing nested object parents', async () => {
    if (process.env.TEAMPLAY_COMPAT !== '1') return

    const gameId = '_compat_public_missing_object_parent'
    const $game = await sub($.compatGames[gameId])
    await $game.set({ name: 'Missing Object' })

    await $game.__dummyField.test.set('123')

    assert.equal($game.__dummyField.test.get(), '123')
    assert.deepEqual($game.get(), {
      _id: gameId,
      id: gameId,
      name: 'Missing Object',
      __dummyField: {
        test: '123'
      }
    })
  })

  it('materializes nested objects when setting a child under a primitive value on public docs', async () => {
    if (process.env.TEAMPLAY_COMPAT !== '1') return

    const gameId = '_compat_public_primitive_parent'
    const $game = await sub($.compatGames[gameId])
    await $game.set({ profile: 'legacy' })

    await $game.profile.name.set('Kate')

    assert.deepEqual($game.profile.get(), { name: 'Kate' })
    assert.deepEqual($game.get(), {
      _id: gameId,
      id: gameId,
      profile: {
        name: 'Kate'
      }
    })
  })

  it('uses racer-like setDiff semantics on public docs', async () => {
    const gameId = '_compat_public_setdiff'
    const $game = await sub($.compatGames[gameId])
    await $game.set({
      count: 1,
      profile: { name: 'Ann' },
      list: [2, 3, 4]
    })

    const doc = getConnection().get('compatGames', gameId)
    const originalSubmitOp = doc.submitOp.bind(doc)
    const submittedOps = []
    doc.submitOp = (op, cb) => {
      submittedOps.push(JSON.parse(JSON.stringify(op)))
      return originalSubmitOp(op, cb)
    }

    try {
      await $game.count.setDiff(1)
      assert.equal(submittedOps.length, 0)

      await $game.profile.setDiff({ name: 'Ann' })
      assert.deepEqual(submittedOps.at(-1), [
        { p: ['profile'], od: { name: 'Ann' }, oi: { name: 'Ann' } }
      ])
      assert.deepEqual($game.profile.get(), { name: 'Ann' })

      await $game.list.setDiff([2, 3, 4])
      assert.deepEqual(submittedOps.at(-1), [
        { p: ['list'], od: [2, 3, 4], oi: [2, 3, 4] }
      ])
      assert.deepEqual($game.list.get(), [2, 3, 4])
    } finally {
      doc.submitOp = originalSubmitOp
    }
  })

  it('treats missing public numeric compat paths as zero on increment', async () => {
    const gameId = '_compat_public_increment_missing'
    const $game = await sub($.compatGames[gameId])
    await $game.set({ title: 'Game' })

    const direct = await $game.count.increment(1)
    assert.equal(direct, 1)
    assert.equal($game.count.get(), 1)

    const nested = await $game.stats.entriesNum.increment(2)
    assert.equal(nested, 2)
    assert.equal($game.stats.entriesNum.get(), 2)
    assert.deepEqual($game.stats.get(), { entriesNum: 2 })
  })

  it('handles edge cases for public array/string mutators', async () => {
    const gameId = '_compat_public_2'
    const $game = await sub($.compatGames[gameId])
    await $game.set({ list: [], text: 'abc' })

    const popEmpty = await $game.list.pop()
    const shiftEmpty = await $game.list.shift()
    assert.equal(popEmpty, undefined)
    assert.equal(shiftEmpty, undefined)

    await $game.list.push(1)
    await $game.list.push(2)
    await $game.list.push(3)
    const movedNeg = await $game.list.move(-1, 0)
    assert.deepEqual(movedNeg, [3])
    assert.deepEqual($game.list.get(), [3, 1, 2])

    await $game.text.stringInsert(0, 'X')
    await $game.text.stringInsert(4, 'Y')
    assert.equal($game.text.get(), 'XabcY')
    await $game.text.stringRemove(1, 10)
    assert.equal($game.text.get(), 'X')
  })

  it('creates missing public arrays on push', async () => {
    const gameId = '_compat_public_missing_array'
    const $game = await sub($.compatGames[gameId])
    await $game.set({ name: 'Missing Array' })

    const len = await $game.list.push(1)
    assert.equal(len, 1)
    assert.deepEqual($game.list.get(), [1])
  })

  it('public child push materializes missing nested arrays through missing object parents', async () => {
    if (process.env.TEAMPLAY_COMPAT !== '1') return

    const gameId = '_compat_public_missing_nested_array'
    const $game = await sub($.compatGames[gameId])
    await $game.set({ name: 'Missing Nested Array' })

    const len = await $game.stats.tags.push('tag-1')

    assert.equal(len, 1)
    assert.deepEqual($game.stats.tags.get(), ['tag-1'])
    assert.deepEqual($game.get(), {
      _id: gameId,
      id: gameId,
      name: 'Missing Nested Array',
      stats: {
        tags: ['tag-1']
      }
    })
  })

  it('keeps racer-like missing-path semantics for public compat string/array mutators', async () => {
    const gameId = '_compat_public_missing_string_array'
    const $game = await sub($.compatGames[gameId])
    await $game.set({ title: 'Game' })

    const prevString = await $game.text.stringInsert(0, 'abc')
    assert.equal(prevString, undefined)
    assert.equal($game.text.get(), 'abc')

    const removedMissingString = await $game.missingText.stringRemove(0, 1)
    assert.equal(removedMissingString, undefined)

    const popMissingArray = await $game.missingList.pop()
    assert.equal(popMissingArray, undefined)
    const shiftMissingArray = await $game.missingList.shift()
    assert.equal(shiftMissingArray, undefined)
  })

  it('throws when pushing to non-array on public docs', async () => {
    const gameId = '_compat_public_non_array'
    const $game = await sub($.compatGames[gameId])
    await $game.set({ list: 'nope' })

    await assert.rejects(
      () => $game.list.push(1),
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
    await $game.name.del()
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

    await $game.media.set({
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

    $._session.activeGame.ref($game)

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

  it('public ref child set materializes missing nested object parents', async () => {
    if (process.env.TEAMPLAY_COMPAT !== '1') return

    const gameId = '_compat_public_ref_missing_object_parent'
    const $game = await sub($.compatGames[gameId])
    await $game.set({ name: 'Compat Ref Missing Object' })

    $._session.activeGame.ref($game)
    await $._session.activeGame.__dummyField.test.set('123')

    assert.equal($._session.activeGame.__dummyField.test.get(), '123')
    assert.equal($game.__dummyField.test.get(), '123')
    assert.deepEqual($game.get(), {
      _id: gameId,
      id: gameId,
      name: 'Compat Ref Missing Object',
      __dummyField: {
        test: '123'
      }
    })
  })

  it('public ref child push materializes missing nested arrays', async () => {
    if (process.env.TEAMPLAY_COMPAT !== '1') return

    const gameId = '_compat_public_ref_missing_array'
    const $game = await sub($.compatGames[gameId])
    await $game.set({ name: 'Compat Ref Missing Array' })

    $._session.activeGame.ref($game)
    const len = await $._session.activeGame.stats.tags.push('tag-1')

    assert.equal(len, 1)
    assert.deepEqual($._session.activeGame.stats.tags.get(), ['tag-1'])
    assert.deepEqual($game.stats.tags.get(), ['tag-1'])
    assert.deepEqual($game.get(), {
      _id: gameId,
      id: gameId,
      name: 'Compat Ref Missing Array',
      stats: {
        tags: ['tag-1']
      }
    })
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

    const _agg = aggregation(({ active }) => [{ $match: { active } }])
    const $agg = await sub(_agg, { $collection: 'compatGames', active: true })
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

    const nextCount = await $game.count.increment(1)
    assert.equal(nextCount, 1)
    assert.equal($game.count.get(), 1)

    const len = await $game.list.push(2)
    assert.equal(len, 2)
    assert.deepEqual($game.list.get(), [1, 2])

    const prevText = await $game.text.stringInsert(2, 'c')
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
    $root._session.user.ref(`${collection}.123`)
    assert.equal($sessionUser.path(), '_session.user')
    assert.equal($sessionUser.joinCourse('course_1'), `${collection}.123:course_1`)
  })

  it('session alias resolves ref target methods when ref is created via canonical _session path', () => {
    const $aliasSessionUser = $root.session.user
    const $canonicalSessionUser = $root._session.user

    assert.equal($aliasSessionUser, $canonicalSessionUser)
    assert.equal($aliasSessionUser.path(), '_session.user')

    $root._session.user.ref(`${collection}.123`)

    assert.equal($aliasSessionUser.joinCourse('course_alias_1'), `${collection}.123:course_alias_1`)
    assert.equal($canonicalSessionUser.joinCourse('course_alias_2'), `${collection}.123:course_alias_2`)
  })

  it('session alias resolves ref target methods when ref is created via alias path', () => {
    const $aliasSessionUser = $root.session.user
    const $canonicalSessionUser = $root._session.user

    assert.equal($aliasSessionUser, $canonicalSessionUser)
    assert.equal($aliasSessionUser.path(), '_session.user')

    $root.session.user.ref(`${collection}.xyz`)

    assert.equal($aliasSessionUser.joinCourse('course_alias_3'), `${collection}.xyz:course_alias_3`)
    assert.equal($canonicalSessionUser.joinCourse('course_alias_4'), `${collection}.xyz:course_alias_4`)
  })

  it('non-ref model method still works', () => {
    const $user = $root[collection].abc
    assert.equal($user.joinCourse('course_2'), `${collection}.abc:course_2`)
  })

  it('ref cycle does not loop infinitely and fails gracefully', () => {
    $root._session.a.ref('_session.b')
    $root._session.b.ref('_session.a')
    assert.throws(() => {
      $root._session.a.joinCourse('course_3')
    }, /Method "joinCourse" does not exist on signal "_session.a"/)
  })

  it('keeps raw signal identity and path unchanged', () => {
    const $before = $root._session.user
    $root._session.user.ref(`${collection}.xyz`)
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
  const courseIdCollection = 'compatCourseIdAggregationRows'
  let cleanupQueryHashes = []
  let cleanupQueryRuntimeHashes = []
  let cleanupAggregationHashes = []
  let cleanupAggregationRuntimeHashes = []
  let $compatRoot
  let prevSubscriptionGcDelay

  before(() => {
    connect()
    addModel(`${collection}.*`, SignalCompat)
    class CourseIdAggregationRow extends SignalCompat {
      static ID_FIELDS = ['courseId']
    }
    addModel(`${courseIdCollection}.*`, CourseIdAggregationRow)
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
    aggregationSubscriptions.subscribe = AggregationSubscriptionsSubscribe
    for (const collectionName of [collection, courseIdCollection]) {
      const docs = getConnection().collections?.[collectionName] || {}
      for (const id of Object.keys(docs)) {
        const doc = getConnection().get(collectionName, id)
        if (doc?.data && !isMissingShareDoc(doc)) await cbPromise(cb => doc.del(cb))
        delete getConnection().collections?.[collectionName]?.[id]
      }
    }
    for (const hash of cleanupQueryRuntimeHashes) delPrivateData($compatRoot[ROOT_ID], [QUERIES, hash])
    for (const hash of cleanupQueryHashes) delPrivateData($compatRoot[ROOT_ID], [QUERIES, hash])
    for (const hash of cleanupAggregationRuntimeHashes) delPrivateData($compatRoot[ROOT_ID], [AGGREGATIONS, hash])
    for (const hash of cleanupAggregationHashes) delPrivateData($compatRoot[ROOT_ID], [AGGREGATIONS, hash])
    cleanupQueryHashes = []
    cleanupQueryRuntimeHashes = []
    cleanupAggregationHashes = []
    cleanupAggregationRuntimeHashes = []
    __resetImperativeQueryReadyTimeoutForTests()
    _del([collection])
    _del([courseIdCollection])
  })

  afterEach(() => {
    setSubscriptionGcDelay(0)
  })

  after(() => {
    setSubscriptionGcDelay(prevSubscriptionGcDelay)
  })

  const QuerySubscriptionsSubscribe = querySubscriptions.subscribe.bind(querySubscriptions)
  const AggregationSubscriptionsSubscribe = aggregationSubscriptions.subscribe.bind(aggregationSubscriptions)

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

    setQueryRuntime($query, 'extra', { count: 3 })
    assert.deepEqual($query.getExtra(), { count: 3 })

    const $agg = $compatRoot.query(collection, { $aggregate: [{ $match: { active: true } }] })
    cleanupAggregationHashes.push($agg[QUERY_HASH])
    cleanupAggregationRuntimeHashes.push(getAggregationRuntimeHash($agg))
    setAggregationRuntime($agg, [{ _id: 'a' }, { _id: 'b' }])
    assert.deepEqual($agg.getExtra(), [{ _id: 'a' }, { _id: 'b' }])
  })

  it('aggregation row getId uses source collection id fields in compat mode', () => {
    const $agg = $compatRoot.query(courseIdCollection, { $aggregate: [] })
    const aggregationRuntimeHash = getAggregationRuntimeHash($agg)
    cleanupAggregationRuntimeHashes.push(aggregationRuntimeHash)

    setAggregationRuntime($agg, [{
      _id: aggregationRuntimeHash,
      courseId: 'course-row-1',
      name: 'Course Row'
    }])

    assert.equal($agg[0]._id.get(), aggregationRuntimeHash)
    assert.equal($agg[0].courseId.get(), 'course-row-1')
    assert.equal($agg[0].getId(), 'course-row-1')
    assert.deepEqual($agg.getIds(), ['course-row-1'])
  })

  it('fetch() does not toggle the global fetchOnly default', async () => {
    const previousDefaultFetchOnly = getDefaultFetchOnly()
    setDefaultFetchOnly(false)
    try {
      const $query = $compatRoot.query(collection, { active: true })
      cleanupQueryHashes.push($query[QUERY_HASH])
      cleanupQueryRuntimeHashes.push(getQueryRuntimeHash($query))

      await $query.fetch()

      assert.equal(getDefaultFetchOnly(), false)
      await $query.unfetch()
    } finally {
      setDefaultFetchOnly(previousDefaultFetchOnly)
    }
  })

  it('uses root-level fetchOnly to choose query transport method', async () => {
    const connection = getConnection()
    const originalCreateFetchQuery = connection.createFetchQuery.bind(connection)
    const originalCreateSubscribeQuery = connection.createSubscribeQuery.bind(connection)
    const calls = []

    connection.createFetchQuery = function (...args) {
      calls.push('fetch')
      return originalCreateFetchQuery(...args)
    }
    connection.createSubscribeQuery = function (...args) {
      calls.push('subscribe')
      return originalCreateSubscribeQuery(...args)
    }

    try {
      getRootContext('compat-fetch-root', true, { fetchOnly: true })
      getRootContext('compat-live-root', true, { fetchOnly: false })
      const $fetchRoot = createCompatRoot('compat-fetch-root')
      const $liveRoot = createCompatRoot('compat-live-root')

      const $fetchQuery = $fetchRoot.query(collection, { mode: 'fetchOnly' })
      const $liveQuery = $liveRoot.query(collection, { mode: 'live' })
      cleanupQueryHashes.push($fetchQuery[QUERY_HASH], $liveQuery[QUERY_HASH])
      cleanupQueryRuntimeHashes.push(getQueryRuntimeHash($fetchQuery), getQueryRuntimeHash($liveQuery))

      await $fetchQuery.subscribe()
      await $liveQuery.subscribe()

      assert.deepEqual(calls, ['fetch', 'subscribe'])

      await $fetchQuery.unsubscribe()
      await $liveQuery.unsubscribe()
    } finally {
      connection.createFetchQuery = originalCreateFetchQuery
      connection.createSubscribeQuery = originalCreateSubscribeQuery
    }
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

    querySubscriptions.subscribe = async () => {
      setQueryRuntime($query, 'ids', ['doc1', 'doc2'])
      setQueryRuntime($query, 'docs', [{ _id: 'doc1', id: 'doc1', active: true }, undefined])
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

    querySubscriptions.subscribe = async () => {
      setQueryRuntime($query, 'ids', ['doc3', 'doc4'])
      setQueryRuntime($query, 'docs', [undefined, { _id: 'doc4', id: 'doc4', active: true }])
      setTimeout(() => {
        _set([collection, 'doc3'], { _id: 'doc3', id: 'doc3', active: true })
        _set([collection, 'doc4'], { _id: 'doc4', id: 'doc4', active: true })
      }, 5)
    }

    await $compatRoot.subscribe($query)

    assert.deepEqual($query.get().map(doc => doc.id), ['doc3', 'doc4'])
  })

  it('supports imperative query from a rootless public collection signal', async () => {
    const id = '_compat_query_api_rootless'
    const $doc = await sub($[collection][id])
    await $doc.set({ active: true })

    const $collection = getSignal(undefined, [collection])
    const $query = $collection.query(collection, { active: true })

    await $query.subscribe()

    assert.deepEqual($query.getIds(), [id])
    assert.deepEqual($query.get().map(doc => doc.id), [id])
    await $query.unsubscribe()
  })

  it('await query.fetch also waits for full materialization', async () => {
    const $query = $compatRoot.query(collection, { active: true })
    cleanupQueryHashes.push($query[QUERY_HASH])
    cleanupQueryRuntimeHashes.push(getQueryRuntimeHash($query))

    querySubscriptions.subscribe = async () => {
      setQueryRuntime($query, 'ids', ['doc6', 'doc7'])
      setQueryRuntime($query, 'docs', [{ _id: 'doc6', id: 'doc6', active: true }, undefined])
      setTimeout(() => {
        _set([collection, 'doc6'], { _id: 'doc6', id: 'doc6', active: true })
        _set([collection, 'doc7'], { _id: 'doc7', id: 'doc7', active: true })
      }, 5)
    }

    await $query.fetch()

    assert.deepEqual($query.get().map(doc => doc.id), ['doc6', 'doc7'])
  })

  it('stops waiting when owner is destroyed during imperative query materialization', async () => {
    const $root = createCompatRoot('_compat_query_owner_cancel_root')
    const $query = $root.query(collection, { active: true })
    cleanupQueryHashes.push($query[QUERY_HASH])
    cleanupQueryRuntimeHashes.push(getQueryRuntimeHash($query))
    __setImperativeQueryReadyTimeoutForTests(60)

    querySubscriptions.subscribe = async ($signal, options) => {
      await QuerySubscriptionsSubscribe($signal, options)
      setQueryRuntime($query, 'ids', ['doc_owner_cancel'])
      setQueryRuntime($query, 'docs', [undefined])
    }

    const destroyPromise = new Promise((resolve, reject) => {
      setTimeout(() => {
        querySubscriptions.destroyByRuntimeHash(getQueryRuntimeHash($query), {
          rootId: $root[ROOT_ID],
          force: true
        }).then(resolve, reject)
      }, 5)
    })

    await assert.doesNotReject($query.subscribe())
    await destroyPromise
    await new Promise((resolve, reject) => {
      $root.close(err => err ? reject(err) : resolve())
    })
  })

  it('stops waiting when root closes during imperative query materialization', async () => {
    const $root = createCompatRoot('_compat_query_root_cancel_root')
    const $query = $root.query(collection, { active: true })
    cleanupQueryHashes.push($query[QUERY_HASH])
    cleanupQueryRuntimeHashes.push(getQueryRuntimeHash($query))
    __setImperativeQueryReadyTimeoutForTests(60)

    querySubscriptions.subscribe = async ($signal, options) => {
      await QuerySubscriptionsSubscribe($signal, options)
      setQueryRuntime($query, 'ids', ['doc_root_cancel'])
      setQueryRuntime($query, 'docs', [undefined])
    }

    const closePromise = new Promise((resolve, reject) => {
      setTimeout(() => {
        $root.close(err => err ? reject(err) : resolve())
      }, 5)
    })

    await assert.doesNotReject($query.subscribe())
    await closePromise
  })

  it('stops waiting when root closes during imperative aggregation materialization', async () => {
    const $root = createCompatRoot('_compat_aggregation_root_cancel_root')
    const $aggregation = $root.query(collection, { $aggregate: [{ $match: { active: true } }] })
    cleanupAggregationHashes.push($aggregation[QUERY_HASH])
    cleanupAggregationRuntimeHashes.push(getAggregationRuntimeHash($aggregation))
    __setImperativeQueryReadyTimeoutForTests(60)

    aggregationSubscriptions.subscribe = async () => {}

    const closePromise = new Promise((resolve, reject) => {
      setTimeout(() => {
        $root.close(err => err ? reject(err) : resolve())
      }, 5)
    })

    await assert.doesNotReject($aggregation.subscribe())
    await closePromise
  })

  it('throws when imperative compat query never fully materializes', async () => {
    const $query = $compatRoot.query(collection, { active: true })
    cleanupQueryHashes.push($query[QUERY_HASH])
    cleanupQueryRuntimeHashes.push(getQueryRuntimeHash($query))
    __setImperativeQueryReadyTimeoutForTests(20)

    querySubscriptions.subscribe = async () => {
      setQueryRuntime($query, 'ids', ['doc5'])
      setQueryRuntime($query, 'docs', [undefined])
    }

    await assert.rejects(
      $query.subscribe(),
      /Compat query did not fully materialize/
    )
  })
})

;(isCompatMode ? describe : describe.skip)('SignalCompat ref/removeRef', () => {
  let cleanupSegments
  let cleanupAggregationRuntimeHashes
  let $root

  function setup (suffix) {
    const basePath = `_compatRef_${suffix}`
    cleanupSegments = [[basePath]]
    cleanupAggregationRuntimeHashes = []
    $root = createCompatRoot()
    return $root[basePath]
  }

  afterEach(() => {
    if (!cleanupSegments) return
    for (const segments of cleanupSegments) _del(segments)
    for (const hash of cleanupAggregationRuntimeHashes || []) {
      delPrivateData($root?.[ROOT_ID], [AGGREGATIONS, hash])
    }
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

  it('allows refs only from private source paths', async () => {
    const $base = setup('privateSourceOnly')
    cleanupSegments.push(['users'])
    await $root.users.u1.set({ title: 'Alice' })

    assert.throws(
      () => $root.users.alias.ref($root.users.u1),
      /source path must be in a private collection/
    )

    $base.user.ref($root.users.u1)
    assert.equal($base.user.title.get(), 'Alice')
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

  it('does not mirror local target updates twice', async () => {
    const $base = setup('noDoubleMirror')
    const $from = $base.from
    const $to = $base.to
    await $base.set({ from: {}, to: {} })
    $from.ref($to)

    const updates = []
    const reaction = observe(
      () => deepCopyCompat($from.get()),
      { lazy: true, scheduler: job => updates.push(job()) }
    )

    reaction()
    updates.length = 0

    await $to.set({ name: 'Alice' })
    assert.equal(updates.length, 1)
    assert.deepEqual(updates[0], { name: 'Alice' })

    unobserve(reaction)
  })

  it('supports refs from child signals', async () => {
    const $base = setup('subpath')
    const $session = $base.session
    const $target = $base.target
    $session.tutoringSession.ref($target)

    await $target.set({ active: true })
    assert.deepEqual($session.tutoringSession.get(), { active: true })

    await $session.tutoringSession.set({ active: false })
    assert.deepEqual($target.get(), { active: false })
  })

  it('set(value) on child signal resolves refs inside the path', async () => {
    const $base = setup('setPathRef')
    const $session = $base.session
    const $target = $base.target
    $session.user.ref($target)

    await $session.user.superField.set('superValue')

    assert.equal($target.superField.get(), 'superValue')
    assert.equal($session.user.superField.get(), 'superValue')
  })

  it('set(value) on local child signals works when root pointer is raw', async () => {
    setup('rawRootPathSet')
    const localId = '_raw_local_0'
    const cache = new Map()
    const $local = createCompatSignal(['$local', localId], raw($root), cache)
    cleanupSegments.push(['$local', localId])

    await $local.set({ nodes: {} })
    await $local.nodes.dropdown.set({ open: true })

    assert.deepEqual($local.nodes.dropdown.get(), { open: true })
  })

  it('removeRef stops syncing', async () => {
    const $base = setup('remove')
    const $session = $base.session
    const $target = $base.target
    $session.tutoringSession.ref($target)

    await $target.set({ value: 1 })
    assert.deepEqual($session.tutoringSession.get(), { value: 1 })

    $session.tutoringSession.removeRef()

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
    cleanupAggregationRuntimeHashes.push(aggregationRuntimeHash)

    const rows1 = [{ _id: 'row1', name: 'First' }, { _id: 'row2', name: 'Second' }]
    setAggregationRuntime($agg, rows1)
    $agg.refExtra(`${$base.path()}.dataSource`)

    assert.deepEqual($base.dataSource.get(), rows1)

    const rows2 = [{ _id: 'row3', name: 'Third' }]
    setAggregationRuntime($agg, rows2)

    assert.deepEqual($base.dataSource.get(), rows2)
  })

  it('child access on aggregation rows is synchronous and returns a signal', () => {
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
    cleanupAggregationRuntimeHashes.push(aggregationRuntimeHash)

    setAggregationRuntime($agg, [
      {
        _id: 'row-sync-at',
        description: { text: 'hello' }
      }
    ])

    const $fromChild = $agg[0].description.text
    assert.equal(typeof $fromChild, 'function')
    assert.equal(typeof $fromChild.get, 'function')
    assert.equal($fromChild.get(), 'hello')
    assert.equal($fromChild.path(), `${AGGREGATIONS}.${aggregationRuntimeHash}.0.description.text`)
  })

  it('root() on aggregation rows is synchronous and does not return a promise', () => {
    setup('aggRowScopeSync')
    const $agg = $root.query('courses', {
      $aggregate: [
        { $match: { kind: 'template' } },
        { $limit: 1 }
      ]
    })
    const aggregationRuntimeHash = getAggregationRuntimeHash($agg)
    cleanupAggregationRuntimeHashes.push(aggregationRuntimeHash)

    setAggregationRuntime($agg, [
      {
        _id: 'row-sync-scope',
        description: { text: 'world' }
      }
    ])

    const $fromRoot = $agg[0].root()
    assert.equal(typeof $fromRoot, 'function')
    assert.equal(typeof $fromRoot.get, 'function')
    assert.equal($fromRoot instanceof Promise, false)
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
    cleanupAggregationRuntimeHashes.push(aggregationRuntimeHash)

    const sourceRows = [{ _id: 's1', name: 'Source' }]
    setAggregationRuntime($agg, sourceRows)
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

    assert.equal($base.virtual.config.enabled.get(), true)
    assert.equal($base.virtual.config.nested.mode.get(), 'voice')
    assert.equal($base.doc.config.enabled.get(), false)
    assert.equal($base.doc.config.nested.mode.get(), 'text')

    await $base.doc.set({
      config: {
        enabled: true,
        nested: { mode: 'audio' }
      }
    })
    assert.equal($base.virtual.config.enabled.get(), true)
    assert.equal($base.virtual.config.nested.mode.get(), 'audio')
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

    assert.deepEqual($base.virtual.config.realtimeConfig.get(), { voice: 'alloy' })

    await $base.doc.config.realtimeConfig.useProxyForVoice.set(true)
    assert.deepEqual($base.virtual.config.realtimeConfig.get(), {
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

    assert.equal($base.virtual.final.get(), true)
    assert.equal($base.virtual.prompt.get(), 'Draft prompt')
    assert.equal($base.doc.final.get(), undefined)
    assert.equal($base.doc.prompt.get(), undefined)

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

  it('keeps pre-bound sparse array child signals reactive after reverse sync with null-normalized source', async () => {
    const $base = setup('sparseArrayChildSignals')
    await $base.doc.set({
      options: ['A']
    })

    const targetPath = `${$base.path()}.virtual`
    cleanupStartPaths = [targetPath]
    const $hole = $base.virtual.options[2]
    const $tail = $base.virtual.options[4]
    $root.start(targetPath, $base.doc, doc => doc)

    const snapshots = []
    const reaction = observe(
      () => ({
        hole: $hole.get(),
        tail: $tail.get()
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

    await $tail.set('Z')
    await $base.doc.set({
      options: ['A', null, null, null, 'Z']
    })
    await $hole.set('Draft')

    unobserve(reaction)

    assert.equal($base.virtual.options[2].get(), 'Draft')
    assert.equal($base.virtual.options[4].get(), 'Z')
    assert.deepEqual(snapshots, [
      { hole: undefined, tail: undefined },
      { hole: undefined, tail: 'Z' },
      { hole: null, tail: 'Z' },
      { hole: 'Draft', tail: 'Z' }
    ])
  })

  it('keeps sparse array child signals writable across repeated reverse sync leaf updates', async () => {
    const $base = setup('sparseArrayRepeatedLeafSync')
    await $base.doc.set({
      options: ['A']
    })

    const targetPath = `${$base.path()}.virtual`
    cleanupStartPaths = [targetPath]
    const $slot = $base.virtual.options[2]
    $root.start(targetPath, $base.doc, doc => doc)

    const snapshots = []
    const reaction = observe(
      () => $slot.get(),
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

    await $base.virtual.options[4].set('Z')
    await $base.doc.set({
      options: ['A', null, null, null, 'Z']
    })
    await $slot.set('Draft 1')
    await $base.doc.set({
      options: ['A', null, 'Saved 1', null, 'Z']
    })
    await $slot.set('Draft 2')

    unobserve(reaction)

    assert.equal($base.virtual.options[2].get(), 'Draft 2')
    assert.deepEqual(snapshots, [
      undefined,
      null,
      'Draft 1',
      'Saved 1',
      'Draft 2'
    ])
  })

  it('syncs public doc array leaf updates into started targets', async () => {
    const $base = setup('publicStartSanity')
    const $doc = $root[domainCollection]._compatPublicStartSanity
    await $doc.create({
      title: 'Stage 1',
      options: ['A']
    })

    const targetPath = `${$base.path()}.virtual`
    cleanupStartPaths = [targetPath]
    $root.start(targetPath, $doc, doc => doc)

    assert.equal($base.virtual.title.get(), 'Stage 1')
    assert.deepEqual($base.virtual.options.get(), ['A'])

    await $doc.options[0].set('B')

    assert.deepEqual($base.virtual.options.get(), ['B'])
  })

  it('syncs public doc array replace updates into started targets', async () => {
    const $base = setup('publicStartArrayReplace')
    const $doc = $root[domainCollection]._compatPublicStartArrayReplace
    await $doc.create({
      title: 'Stage 1',
      options: ['A']
    })

    const targetPath = `${$base.path()}.virtual`
    cleanupStartPaths = [targetPath]
    $root.start(targetPath, $doc, doc => doc)

    await $doc.title.set('Stage 2')
    await $doc.options.set(['B'])

    assert.equal($doc.title.get(), 'Stage 2')
    assert.deepEqual($doc.options.get(), ['B'])
    assert.equal($base.virtual.title.get(), 'Stage 2')
    assert.deepEqual($base.virtual.options.get(), ['B'])
  })

  it('keeps immediate local sparse writes after public start before the next tick', async () => {
    const $base = setup('publicStartImmediateLocalWrite')
    const $doc = $root[domainCollection]._compatPublicStartImmediateLocalWrite
    await $doc.create({
      options: ['A']
    })

    const targetPath = `${$base.path()}.virtual`
    cleanupStartPaths = [targetPath]
    $root.start(targetPath, $doc, doc => doc)

    await $base.virtual.options[4].set('Z')

    const options = raw($base.virtual.options.get())
    assert.equal(options.length, 5)
    assert.equal(options[0], 'A')
    assert.equal(options[1], undefined)
    assert.equal(options[2], undefined)
    assert.equal(options[3], undefined)
    assert.equal(options[4], 'Z')
    assert.equal(Object.prototype.hasOwnProperty.call(options, 1), false)
    assert.equal(Object.prototype.hasOwnProperty.call(options, 2), false)
    assert.equal(Object.prototype.hasOwnProperty.call(options, 3), false)
  })

  it('public compat set(undefined) keeps object keys as null like racer remote semantics', async () => {
    const $base = setup('publicSetUndefinedObject')
    const $doc = $root[domainCollection]._compatPublicSetUndefinedObject
    await $doc.create({
      title: 'Stage 1',
      flag: true
    })

    const targetPath = `${$base.path()}.virtual`
    cleanupStartPaths = [targetPath]
    $root.start(targetPath, $doc, doc => doc)

    await $doc.flag.set(undefined)

    assert.equal($doc.flag.get(), null)
    assert.equal($base.virtual.flag.get(), null)
    assert.ok(Object.prototype.hasOwnProperty.call(raw($doc.get()), 'flag'))
    assert.ok(Object.prototype.hasOwnProperty.call(raw($base.virtual.get()), 'flag'))
  })

  it('public compat set(undefined) keeps array slots as null like racer remote semantics', async () => {
    const $base = setup('publicSetUndefinedArray')
    const $doc = $root[domainCollection]._compatPublicSetUndefinedArray
    await $doc.create({
      title: 'Stage 1',
      options: ['A', 'B', 'C']
    })

    const targetPath = `${$base.path()}.virtual`
    cleanupStartPaths = [targetPath]
    $root.start(targetPath, $doc, doc => doc)

    await $doc.options[1].set(undefined)

    const sourceOptions = raw($doc.options.get())
    const targetOptions = raw($base.virtual.options.get())
    assert.equal($doc.options[1].get(), null)
    assert.equal($base.virtual.options[1].get(), null)
    assert.equal(sourceOptions[1], null)
    assert.equal(targetOptions[1], null)
    assert.equal(Object.prototype.hasOwnProperty.call(sourceOptions, 1), true)
    assert.equal(Object.prototype.hasOwnProperty.call(targetOptions, 1), true)
  })

  it('public compat setEach(object) on child signal keeps undefined keys as null like racer remote semantics', async () => {
    const $base = setup('publicSetEachUndefinedObject')
    const $doc = $root[domainCollection]._compatPublicSetEachUndefinedObject
    await $doc.create({
      profile: {
        name: 'Ann',
        role: 'student'
      }
    })

    const targetPath = `${$base.path()}.virtual`
    cleanupStartPaths = [targetPath]
    $root.start(targetPath, $doc, doc => doc)

    await $doc.profile.setEach({ role: undefined })

    assert.deepEqual($doc.profile.get(), {
      name: 'Ann',
      role: null
    })
    assert.deepEqual($base.virtual.profile.get(), {
      name: 'Ann',
      role: null
    })
    assert.ok(Object.prototype.hasOwnProperty.call(raw($doc.profile.get()), 'role'))
    assert.ok(Object.prototype.hasOwnProperty.call(raw($base.virtual.profile.get()), 'role'))
  })

  it('keeps pre-bound sparse array child signals reactive after public reverse sync with null-normalized source', async () => {
    const $base = setup('publicSparseArrayChildSignals')
    const $doc = $root[domainCollection]._compatPublicSparseArrayChildSignals
    await $doc.create({
      options: ['A']
    })

    const targetPath = `${$base.path()}.virtual`
    cleanupStartPaths = [targetPath]
    const $hole = $base.virtual.options[2]
    const $tail = $base.virtual.options[4]
    $root.start(targetPath, $doc, doc => doc)

    const snapshots = []
    const reaction = observe(
      () => ({
        hole: $hole.get(),
        tail: $tail.get()
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

    await $tail.set('Z')
    await $doc.options.set(['A', null, null, null, 'Z'])
    await $hole.set('Draft')

    unobserve(reaction)

    assert.equal($base.virtual.options[2].get(), 'Draft')
    assert.equal($base.virtual.options[4].get(), 'Z')
    assert.deepEqual(snapshots, [
      { hole: undefined, tail: undefined },
      { hole: undefined, tail: 'Z' },
      { hole: null, tail: 'Z' },
      { hole: 'Draft', tail: 'Z' }
    ])
  })

  it('keeps sparse array child signals writable across repeated public reverse sync leaf updates', async () => {
    const $base = setup('publicSparseArrayRepeatedLeafSync')
    const $doc = $root[domainCollection]._compatPublicSparseArrayRepeatedLeafSync
    await $doc.create({
      options: ['A']
    })

    const targetPath = `${$base.path()}.virtual`
    cleanupStartPaths = [targetPath]
    const $slot = $base.virtual.options[2]
    $root.start(targetPath, $doc, doc => doc)

    const snapshots = []
    const reaction = observe(
      () => $slot.get(),
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

    await $base.virtual.options[4].set('Z')
    await $doc.options.set(['A', null, null, null, 'Z'])
    await $slot.set('Draft 1')
    await $doc.options.set(['A', null, 'Saved 1', null, 'Z'])
    await $slot.set('Draft 2')

    unobserve(reaction)

    assert.equal($base.virtual.options[2].get(), 'Draft 2')
    assert.deepEqual(snapshots, [
      undefined,
      null,
      'Draft 1',
      'Saved 1',
      'Draft 2'
    ])
  })

  it('does not overwrite a dirty started target from a delayed local public doc op', async () => {
    const $base = setup('publicStartLocalSourceDirty')
    const docId = '_compatPublicStartLocalSourceDirty'
    const $doc = $root[domainCollection][docId]
    await $doc.create({
      title: 'A'
    })
    await $doc.subscribe()

    const shareDoc = getConnection().get(domainCollection, docId)
    const originalSubmitOp = shareDoc.submitOp.bind(shareDoc)
    shareDoc.submitOp = (op, options, cb) => {
      if (typeof options === 'function') {
        cb = options
        options = undefined
      }
      setTimeout(() => originalSubmitOp(op, options, cb), 25)
    }

    const targetPath = `${$base.path()}.virtual`
    cleanupStartPaths = [targetPath]
    $root.start(targetPath, $doc, doc => doc)

    let syncTimer
    const listener = $root.on('all', `${$base.virtual.path()}.**`, () => {
      clearTimeout(syncTimer)
      syncTimer = setTimeout(() => {
        $doc.silent().setDiffDeep($base.virtual.getDeepCopy())
      }, 10)
    })

    try {
      await $base.virtual.title.set('AB')
      await new Promise(resolve => setTimeout(resolve, 15))
      await $base.virtual.title.set('ABC')
      await new Promise(resolve => setTimeout(resolve, 200))

      assert.equal($doc.title.get(), 'ABC')
      assert.equal($base.virtual.title.get(), 'ABC')
    } finally {
      clearTimeout(syncTimer)
      $root.removeListener('all', listener)
      shareDoc.submitOp = originalSubmitOp
    }
  })

  it('priority: domain model method start() wins over compat fallback', () => {
    const $session = $root[domainCollection].session1
    assert.equal($session.start('chat', 'u1'), `domain:${domainCollection}.session1:chat:u1`)
  })

  it('priority: deref model method start() wins over compat fallback', () => {
    $root._session.activeUser.ref(`${domainCollection}.user2`)
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

    assert.equal($doc.start.get(), 'A')
    assert.equal($doc.stop.get(), 'B')

    await $doc.start.set('C')
    await $doc.stop.set('D')
    assert.equal($doc.start.get(), 'C')
    assert.equal($doc.stop.get(), 'D')
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
