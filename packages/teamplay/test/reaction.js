import { describe, it, afterEach } from 'mocha'
import { strict as assert } from 'node:assert'

import { batch, getRootSignal, reaction } from '../src/index.ts'
import { reaction as ormReaction } from '../src/orm/index.ts'
import { del as delPublicData } from '../src/orm/dataTree.js'
import { __resetBatchSchedulerForTests } from '../src/orm/batchScheduler.js'
import { __resetRootContextsForTests } from '../src/orm/rootContext.ts'

const PUBLIC_COLLECTION = 'reactionTestDocs'

let rootCounter = 0

function createRoot (suffix) {
  rootCounter += 1
  return getRootSignal({ rootId: `reaction-${suffix}-${rootCounter}` })
}

describe('reaction()', () => {
  afterEach(() => {
    delPublicData([PUBLIC_COLLECTION])
    __resetBatchSchedulerForTests()
    __resetRootContextsForTests()
  })

  it('tracks signal reads and stops after dispose', async () => {
    const $root = createRoot('dispose')
    await $root._reaction.setReplace({})
    const snapshots = []

    const handle = reaction(() => {
      snapshots.push($root._reaction.value.get())
    })

    await $root._reaction.value.setReplace('A')
    handle.dispose()
    await $root._reaction.value.setReplace('B')

    assert.deepEqual(snapshots, [undefined, 'A'])
  })

  it('exports the same function from root and orm entrypoints', () => {
    assert.equal(ormReaction, reaction)
  })

  it('validates the reaction callback', () => {
    assert.throws(
      () => reaction(null),
      /reaction\(\) expects a function/
    )
  })

  it('rethrows errors unless onError handles them', async () => {
    const $root = createRoot('errors')
    await $root._reaction.setReplace({ fail: false })
    const handledErrors = []

    assert.throws(
      () => reaction(() => {
        throw new Error('initial-boom')
      }),
      /initial-boom/
    )

    const handle = reaction(() => {
      if ($root._reaction.fail.get()) throw new Error('scheduled-boom')
    }, {
      onError: error => handledErrors.push(error.message)
    })

    await $root._reaction.fail.setReplace(true)
    handle.dispose()

    assert.deepEqual(handledErrors, ['scheduled-boom'])
  })

  it('coalesces invalidations inside batch', async () => {
    const $root = createRoot('batch')
    const snapshots = []

    const handle = reaction(() => {
      snapshots.push({
        a: $root._reaction.a.get(),
        b: $root._reaction.b.get()
      })
    })

    await batch(async () => {
      await $root._reaction.a.setReplace(1)
      await $root._reaction.b.setReplace(2)
    })

    handle.dispose()
    assert.deepEqual(snapshots, [
      { a: undefined, b: undefined },
      { a: 1, b: 2 }
    ])
  })

  it('uses a stable custom scheduler runner and reads the latest value', async () => {
    const $root = createRoot('custom-scheduler')
    await $root._reaction.setReplace({})
    const snapshots = []
    const scheduled = []

    const handle = reaction(() => {
      snapshots.push($root._reaction.value.get())
    }, {
      scheduler: run => scheduled.push(run)
    })

    await $root._reaction.value.setReplace('A')
    await $root._reaction.value.setReplace('B')

    assert.deepEqual(snapshots, [undefined])
    assert.equal(scheduled.length, 2)
    assert.equal(scheduled[0], scheduled[1])

    scheduled[0]()
    handle.dispose()

    assert.deepEqual(snapshots, [undefined, 'B'])
  })

  it('drops pending custom scheduler runs after dispose', async () => {
    const $root = createRoot('dispose-pending')
    await $root._reaction.setReplace({})
    const snapshots = []
    const scheduled = []

    const handle = reaction(() => {
      snapshots.push($root._reaction.value.get())
    }, {
      scheduler: run => scheduled.push(run)
    })

    await $root._reaction.value.setReplace('A')
    handle.dispose()
    scheduled[0]()

    assert.deepEqual(snapshots, [undefined])
  })

  it('updates tracked dependencies when branches change', async () => {
    const $root = createRoot('dynamic-deps')
    await $root._reaction.setReplace({
      selected: 'a',
      a: 1,
      b: 10
    })
    const snapshots = []

    const handle = reaction(() => {
      const selected = $root._reaction.selected.get()
      snapshots.push($root._reaction[selected].get())
    })

    await $root._reaction.b.setReplace(11)
    await $root._reaction.selected.setReplace('b')
    await $root._reaction.a.setReplace(2)
    await $root._reaction.b.setReplace(20)
    handle.dispose()

    assert.deepEqual(snapshots, [1, 11, 20])
  })

  it('does not track peek() reads', async () => {
    const $root = createRoot('peek')
    await $root._reaction.setReplace({})
    let runs = 0

    const handle = reaction(() => {
      $root._reaction.peekOnly.peek()
      runs += 1
    })

    await $root._reaction.peekOnly.setReplace('ignored')
    handle.dispose()

    assert.equal(runs, 1)
  })

  it('supports lazy reactions', async () => {
    const $root = createRoot('lazy')
    await $root._reaction.setReplace({})
    let runs = 0

    const handle = reaction(() => {
      $root._reaction.lazyValue.get()
      runs += 1
    }, { lazy: true })

    await $root._reaction.lazyValue.setReplace('A')
    handle.dispose()

    assert.equal(runs, 0)
  })
})
