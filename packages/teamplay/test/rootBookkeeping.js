// Per-root bookkeeping must stay bounded for long-lived roots and for
// processes that create and close one root per request.
import { before, describe, it } from 'mocha'
import { strict as assert } from 'node:assert'
import { getRootSignal, diagnostics, __DEBUG_SIGNALS_CACHE__ as signalsCache } from '../src/index.ts'
import connect from '../src/connect/test.js'
import { __getRootContextForTests } from '../src/orm/rootContext.ts'
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
