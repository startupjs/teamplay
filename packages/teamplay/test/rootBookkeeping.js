// Per-root bookkeeping must stay bounded for long-lived roots and for
// processes that create and close one root per request.
import { before, describe, it } from 'mocha'
import { strict as assert } from 'node:assert'
import { getRootSignal, diagnostics, __DEBUG_SIGNALS_CACHE__ as signalsCache } from '../src/index.ts'
import connect from '../src/connect/test.js'
import { getPendingRootDisposeCount } from '../src/orm/disposeRootContext.ts'
import {
  __getRootContextForTests,
  getClosedRootContextCount,
  isRootContextClosed
} from '../src/orm/rootContext.ts'
import { getSignalIdentityHash } from '../src/orm/rootScope.ts'
import { runGc } from './_helpers.js'

before(connect)

function touch () {}

describe('long-lived root: signal hashes', () => {
  it('forgets the hash of every signal that was garbage collected', async () => {
    const rootId = 'bookkeeping-long-lived'
    const $root = getRootSignal({ rootId })
    const context = __getRootContextForTests(rootId)
    await runGc()
    const baseline = context.signalHashes.size
    const cacheBaseline = signalsCache.size

    for (let round = 0; round < 3; round++) {
      ;(() => {
        for (let i = 0; i < 1000; i++) touch($root.bookkeepingDocs['doc' + i]['field' + round])
      })()
    }
    assert.ok(context.signalHashes.size > 3000, 'hashes are registered while the signals live')

    await runGc()
    assert.equal(signalsCache.size, cacheBaseline, 'the signals were collected')
    assert.equal(context.signalHashes.size, baseline, 'the root forgot the collected signals')

    diagnostics.enable()
    try {
      const root = diagnostics.snapshot({ details: true }).roots
      assert.equal(root.staleSignalHashes, 0)
    } finally {
      diagnostics.disable()
    }

    // close() still purges what is alive
    const $alive = $root.bookkeepingDocs.alive.name
    const aliveHash = Array.from(context.signalHashes).find(hash => signalsCache.get(hash) === $alive)
    assert.ok(aliveHash)
    await $root.close()
    assert.equal(signalsCache.get(aliveHash), undefined)
  })
})

describe('closed roots', () => {
  it('forgets a closed root id once nothing can reach the root any more', async () => {
    await runGc()
    const before = getClosedRootContextCount()
    // closed explicitly, then dropped
    await (async () => {
      for (let i = 0; i < 20; i++) {
        const $root = getRootSignal()
        await $root._session.userId.set('user' + i)
        await $root.close()
      }
    })()
    assert.ok(getClosedRootContextCount() > before, 'closed roots are remembered while referenced')
    // never closed: disposed by the root finalizer
    ;(() => {
      for (let i = 0; i < 20; i++) getRootSignal()._session.userId.set('dropped' + i)
    })()
    await runGc()
    await waitFor(() => getPendingRootDisposeCount() === 0)
    await runGc()
    assert.equal(getClosedRootContextCount(), before)
  })

  it('keeps a closed root inert while one of its signals is still referenced', async () => {
    const rootId = 'bookkeeping-closed-held'
    const $root = getRootSignal({ rootId })
    const $userId = $root._session.userId
    await $userId.set('before')
    await $root.close()
    await runGc()

    assert.equal(isRootContextClosed(rootId), true)
    await $userId.set('late')
    assert.equal($userId.get(), undefined)
    assert.equal(__getRootContextForTests(rootId), undefined, 'a late write does not recreate the context')
    const $late = $root.bookkeepingDocs.late
    assert.notStrictEqual(signalsCache.get(getSignalIdentityHash(rootId, ['bookkeepingDocs', 'late'])), $late)

    // the same id can be opened again and gets fresh signals
    const $again = getRootSignal({ rootId })
    assert.equal(isRootContextClosed(rootId), false)
    assert.notStrictEqual($again, $root)
    assert.equal($again._session.userId.get(), undefined)
    await $again.close()
  })
})

async function waitFor (predicate, timeoutMs = 2000) {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw Error('waitFor timed out')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}
