// Docs written through a root without a subscription (add(), set() of a new
// doc, writes to a doc nothing tracks) used to stay in the data tree and in the
// ShareDB connection for the lifetime of the process. Racer had one model and
// connection per request on the server, so such docs ended with the request.
// A non-global root now holds what it wrote until it is closed (or collected);
// read-after-write through any root keeps working while it is open. Writes
// through the global root are unchanged (kept, as on a racer client page).
import { afterEach, before, describe, it } from 'mocha'
import { strict as assert } from 'node:assert'
import { $, sub, unsub, getRootSignal, diagnostics } from '../src/index.ts'
import connect from '../src/connect/test.js'
import { getConnection } from '../src/orm/connection.ts'
import { docSubscriptions } from '../src/orm/Doc.js'
import { getRaw, del as _del } from '../src/orm/dataTree.js'
import { getPendingRootDisposeCount } from '../src/orm/disposeRootContext.ts'
import { getSubscriptionGcDelay, setSubscriptionGcDelay } from '../src/orm/subscriptionGcDelay.ts'
import { runGc } from './_helpers.js'

before(connect)

const COLLECTION = 'rootWrittenDocs'
let counter = 0

function inConnection (id) {
  return !!getConnection().collections?.[COLLECTION]?.[id]
}

function cbPromise (fn) {
  return new Promise((resolve, reject) => fn(err => err ? reject(err) : resolve()))
}

async function waitFor (predicate, timeoutMs = 2000) {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw Error('waitFor timed out')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

describe('docs written through a root without a subscription', () => {
  const baselineGcDelay = getSubscriptionGcDelay()

  afterEach(async () => {
    diagnostics.disable()
    setSubscriptionGcDelay(0)
    await docSubscriptions.flushPendingDestroys()
    setSubscriptionGcDelay(baselineGcDelay)
  })

  it('are readable while the root is open and released when it closes', async () => {
    diagnostics.enable()
    const $root = getRootSignal({ rootId: 'written-docs-' + ++counter })
    const id = await $root[COLLECTION].add({ name: 'created' })
    await $root[COLLECTION][id].name.set('renamed')
    assert.equal($root[COLLECTION][id].name.get(), 'renamed', 'read-after-write through the root')
    assert.equal($[COLLECTION][id].name.get(), 'renamed', 'and through the global root')
    assert.equal(inConnection(id), true)

    await $root.close()
    assert.equal(getRaw([COLLECTION, id]), undefined, 'the data tree no longer holds it')
    assert.equal(inConnection(id), false, 'the ShareDB connection no longer holds it')
    const findings = diagnostics.checkLeaks().findings
      .filter(finding => JSON.stringify(finding.examples || []).includes(id))
    assert.deepEqual(findings.map(finding => finding.code), [])

    // it was persisted
    const $doc = await sub($[COLLECTION][id])
    assert.equal($doc.name.get(), 'renamed')
    await unsub($doc)
  })

  it('stay bounded with one root per request', async () => {
    setSubscriptionGcDelay(3000)
    const ids = []
    for (let i = 0; i < 20; i++) {
      const $root = getRootSignal()
      ids.push(await $root[COLLECTION].add({ name: 'request ' + i }))
      await $root.close()
    }
    assert.deepEqual(ids.filter(inConnection), [])
    assert.deepEqual(ids.filter(id => getRaw([COLLECTION, id]) !== undefined), [])
  })

  it('stay loaded for another root that subscribed them', async () => {
    const $writer = getRootSignal({ rootId: 'written-docs-writer-' + ++counter })
    const $reader = getRootSignal({ rootId: 'written-docs-reader-' + counter })
    const id = await $writer[COLLECTION].add({ name: 'shared' })
    const $doc = await sub($reader[COLLECTION][id])
    await $writer.close()
    assert.equal($doc.name.get(), 'shared')
    assert.equal(inConnection(id), true)
    await $reader.close()
    assert.equal(inConnection(id), false)
  })

  it('are released when the root is collected without close()', async function () {
    this.timeout(10000)
    let id
    await (async () => {
      const $root = getRootSignal()
      id = await $root[COLLECTION].add({ name: 'forgotten' })
    })()
    assert.equal(inConnection(id), true)
    await runGc()
    await waitFor(() => getPendingRootDisposeCount() === 0)
    await waitFor(() => !inConnection(id))
    assert.equal(getRaw([COLLECTION, id]), undefined)
  })

  it('a delete through a root does not leave the deleted doc behind', async () => {
    const $root = getRootSignal({ rootId: 'written-docs-delete-' + ++counter })
    const id = await $root[COLLECTION].add({ name: 'to delete' })
    await $root[COLLECTION][id].del()
    await $root.close()
    assert.equal(inConnection(id), false)
  })

  it('keeps docs written through the global root (unchanged)', async () => {
    const id = await $[COLLECTION].add({ name: 'global' })
    assert.equal($[COLLECTION][id].name.get(), 'global')
    assert.equal(inConnection(id), true)
    // cleanup
    _del([COLLECTION, id])
    await cbPromise(cb => getConnection().get(COLLECTION, id).destroy(cb))
  })
})
