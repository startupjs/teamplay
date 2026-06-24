import { raw, observe, unobserve } from '@nx-js/observer-util'
import { before, afterEach, describe, it } from 'mocha'
import { strict as assert } from 'node:assert'

import connect from '../src/connect/test.js'
import { getRootSignal } from '../src/index.ts'
import { AGGREGATIONS, getAggregationSignal } from '../src/orm/Aggregation.js'
import { del as delPublicData } from '../src/orm/dataTree.js'
import { delPrivateData, setPrivateData } from '../src/orm/privateData.js'
import { HASH, QUERIES, getQuerySignal } from '../src/orm/Query.js'
import { __resetRootContextsForTests } from '../src/orm/rootContext.ts'
import { scheduleReaction } from '../src/orm/batchScheduler.js'

const PUBLIC_COLLECTION = 'signalConvenienceDocs'

let rootCounter = 0

function createRoot (suffix) {
  rootCounter += 1
  return getRootSignal({ rootId: `signal-convenience-${suffix}-${rootCounter}` })
}

describe('Signal convenience methods', () => {
  before(connect)

  afterEach(() => {
    delPublicData([PUBLIC_COLLECTION])
    __resetRootContextsForTests()
  })

  it('getCopy returns a shallow copy and getDeepCopy returns a deep copy', async () => {
    const $root = createRoot('copy')
    const nested = { value: 1 }
    await $root._session.doc.setReplace({ nested })
    const original = raw($root._session.doc.get())

    const copy = $root._session.doc.getCopy()
    const deepCopy = $root._session.doc.getDeepCopy()

    assert.deepEqual(copy, original)
    assert.notEqual(copy, original)
    assert.equal(copy.nested, original.nested)
    assert.deepEqual(deepCopy, original)
    assert.notEqual(deepCopy, original)
    assert.notEqual(deepCopy.nested, original.nested)
    assert.throws(() => $root._session.doc.getCopy(1), /does not accept any arguments/)
    assert.throws(() => $root._session.doc.getDeepCopy(1), /does not accept any arguments/)
  })

  it('setNull only writes nullish targets', async () => {
    const $root = createRoot('set-null')
    await $root._session.a.setReplace(1)

    await $root._session.a.setNull(2)
    await $root._session.b.setNull(3)

    assert.equal($root._session.a.get(), 1)
    assert.equal($root._session.b.get(), 3)
    await assert.rejects(
      () => $root._session.a.setNull(1, 2),
      /Signal\.setNull\(\) expects a single argument/
    )
  })

  it('setDiff skips exact-equal primitive writes and replaces object values', async () => {
    const $root = createRoot('set-diff')
    await $root._session.value.setReplace(1)
    await $root._session.profile.setReplace({ name: 'Ann' })
    const previousProfile = raw($root._session.profile.peek())

    await $root._session.value.setDiff(1)
    await $root._session.profile.setDiff({ name: 'Ann' })

    assert.equal($root._session.value.get(), 1)
    assert.deepEqual($root._session.profile.get(), { name: 'Ann' })
    assert.notEqual(raw($root._session.profile.peek()), previousProfile)

    await $root._session.value.setDiff(2)
    assert.equal($root._session.value.get(), 2)
  })

  it('setEach writes keys with replace semantics and differs from assign null handling', async () => {
    const $root = createRoot('set-each')
    await $root._session.doc.setReplace({
      props: {
        stale: true,
        nested: { old: true }
      },
      nullable: 1,
      optional: 2
    })

    await $root._session.doc.setEach({
      props: {
        nested: { fresh: true }
      },
      nullable: null,
      optional: undefined
    })

    assert.deepEqual($root._session.doc.props.get(), { nested: { fresh: true } })
    assert.equal($root._session.doc.nullable.get(), null)
    assert.equal($root._session.doc.optional.get(), undefined)
    assert.ok(Object.prototype.hasOwnProperty.call(raw($root._session.doc.get()), 'optional'))
    await assert.rejects(
      () => $root._session.doc.setEach('bad'),
      /Signal\.setEach\(\) expects an object argument/
    )
  })

  it('setEach normalizes public undefined subpaths to null', async () => {
    const $root = createRoot('set-each-public')
    const $doc = $root[PUBLIC_COLLECTION].publicSetEach
    await $doc.setReplace({ profile: { name: 'Ann', role: 'admin' } })

    await $doc.profile.setEach({ role: undefined })

    assert.deepEqual($doc.profile.get(), { name: 'Ann', role: null })
  })

  it('setDiffDeep removes stale keys while preserving empty target objects', async () => {
    const $root = createRoot('set-diff-deep')
    await $root._session.doc.setReplace({
      profile: {
        name: 'Ann',
        role: 'student'
      },
      filters: {
        tab: 'home'
      },
      lists: {
        a: [1, 2],
        b: [1]
      }
    })

    await $root._session.doc.setDiffDeep({
      profile: {
        name: 'Kate'
      },
      filters: {},
      lists: {
        a: [2, 3],
        b: [1]
      }
    })

    assert.deepEqual($root._session.doc.get(), {
      profile: {
        name: 'Kate'
      },
      filters: {},
      lists: {
        a: [2, 3],
        b: [1]
      }
    })
  })

  it('setDiffDeep preserves public empty target objects', async () => {
    const $root = createRoot('set-diff-deep-public')
    const $doc = $root[PUBLIC_COLLECTION].publicSetDiffDeep
    await $doc.setReplace({ filters: { tab: 'home' }, other: 1 })

    await $doc.filters.setDiffDeep({})

    assert.deepEqual($doc.get(), { _id: 'publicSetDiffDeep', filters: {}, other: 1 })
  })

  it('setEach and setDiffDeep apply updates atomically for scheduled observers', async () => {
    const $root = createRoot('atomic')
    await $root._session.doc.setReplace({ a: 0, b: 0, profile: { name: 'Ann', role: 'student' } })

    const setEachSnapshots = []
    const setEachReaction = observe(
      () => ({ a: $root._session.doc.a.get(), b: $root._session.doc.b.get() }),
      { lazy: true, scheduler: reaction => scheduleReaction(() => setEachSnapshots.push(reaction())) }
    )
    setEachSnapshots.push(setEachReaction())

    await $root._session.doc.setEach({ a: 1, b: 2 })
    unobserve(setEachReaction)

    assert.deepEqual(setEachSnapshots[setEachSnapshots.length - 1], { a: 1, b: 2 })
    assert.equal(setEachSnapshots.some(snapshot => snapshot.a === 1 && snapshot.b === 0), false)

    const setDiffDeepSnapshots = []
    const setDiffDeepReaction = observe(
      () => deepCopyObserved($root._session.doc.profile.get()),
      { lazy: true, scheduler: reaction => scheduleReaction(() => setDiffDeepSnapshots.push(reaction())) }
    )
    setDiffDeepSnapshots.push(setDiffDeepReaction())

    await $root._session.doc.profile.setDiffDeep({ name: 'Kate' })
    unobserve(setDiffDeepReaction)

    assert.deepEqual(setDiffDeepSnapshots[setDiffDeepSnapshots.length - 1], { name: 'Kate' })
    assert.equal(
      setDiffDeepSnapshots.some(snapshot => snapshot && snapshot.name === 'Ann' && !('role' in snapshot)),
      false
    )
  })

  it('getExtra reads query extra, aggregation data, and returns undefined for ordinary signals', () => {
    const rootId = 'signal-convenience-extra'
    const $root = getRootSignal({ rootId })
    const $query = getQuerySignal(PUBLIC_COLLECTION, { active: true }, { root: $root })
    const $aggregation = getAggregationSignal(PUBLIC_COLLECTION, { $aggregate: [{ $match: { active: true } }] }, { root: $root })

    setPrivateData(rootId, [QUERIES, $query[HASH], 'extra'], { count: 3 })
    setPrivateData(rootId, [AGGREGATIONS, $aggregation[HASH]], [{ _id: 'row-1' }])

    assert.deepEqual($query.getExtra(), { count: 3 })
    assert.deepEqual($aggregation.getExtra(), [{ _id: 'row-1' }])
    assert.equal($root._session.value.getExtra(), undefined)
    assert.throws(() => $query.getExtra(1), /does not accept any arguments/)

    delPrivateData(rootId, [QUERIES])
    delPrivateData(rootId, [AGGREGATIONS])
  })
})

function deepCopyObserved (value) {
  if (value == null) return value
  return JSON.parse(JSON.stringify(value))
}
