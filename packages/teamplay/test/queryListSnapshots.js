import { describe, it, before, afterEach } from 'mocha'
import { strict as assert } from 'node:assert'
import { raw } from '@nx-js/observer-util'
import { $, sub, unsub } from '../src/index.ts'
import connect from '../src/connect/test.js'
import { getConnection } from '../src/orm/connection.ts'

before(connect)

// What $query.get() and getIds() return is a snapshot: it is never changed
// afterwards. A change of the listed docs (a delete, a create again, the
// server's inserts, moves and removals) gives the query new lists; without
// one, get() keeps returning the same array with the same doc objects.
describe('query lists are snapshots', () => {
  const collection = 'querySnapshotGames'
  const owned = []
  let counter = 0

  afterEach(async () => {
    for (const $signal of owned.splice(0).reverse()) await unsub($signal)
  })

  async function own (promise) {
    const $signal = await promise
    owned.push($signal)
    return $signal
  }

  // eight docs created by another client, and a query listing them
  async function subscribeEight (mode) {
    counter += 1
    const kind = `kind_${mode}_${counter}_${Date.now()}`
    const writer = getConnection().agent.backend.connect()
    try {
      await Promise.all(Array.from({ length: 8 }, (_, n) => new Promise((resolve, reject) => {
        writer.get(collection, `r${n}_${kind}`).create({ kind, n }, err => err ? reject(err) : resolve())
      })))
    } finally {
      writer.close()
    }
    const $query = await own(sub($[collection], { kind, $sort: { n: 1 } }, { mode }))
    assert.equal($query.get().length, 8)
    return { $query, kind }
  }

  const deleteLoops = {
    'for...of over get()': $query => { for (const doc of $query.get()) $[collection][doc._id].del() },
    'get().map()': $query => { $query.get().map(doc => $[collection][doc._id].del()) },
    'get().forEach()': $query => { $query.get().forEach(doc => { $[collection][doc._id].del() }) },
    'for...of over getIds()': $query => { for (const id of $query.getIds()) $[collection][id].del() },
    'for...of over the query signal': $query => { for (const $doc of $query) $doc.del() },
    'map() over the query signal': $query => { $query.map($doc => $doc.del()) }
  }

  for (const mode of ['subscribe', 'fetch']) {
    for (const [name, deleteAll] of Object.entries(deleteLoops)) {
      it(`a loop deleting every listed doc deletes all of them: ${name} (${mode} query)`, async () => {
        const { $query } = await subscribeEight(mode)
        const docs = raw($query.get())
        const names = docs.map(doc => doc.n)
        deleteAll($query)
        assert.deepEqual($query.get(), [], 'every doc is deleted')
        assert.deepEqual($query.getIds(), [])
        assert.deepEqual(docs.map(doc => doc.n), names, 'the array handed out before is unchanged')
        await new Promise(resolve => setTimeout(resolve, 50))
        assert.deepEqual($query.get(), [])
      })
    }
  }

  it('get() returns the same array (and doc objects) until the listed docs change', async () => {
    const { $query } = await subscribeEight('subscribe')
    const first = raw($query.get())
    assert.equal(raw($query.get()), first, 'reads do not copy')
    const $first = $[collection][first[0]._id]
    await $first.name.set('renamed')
    assert.equal(raw($query.get()), first, 'an update of a listed doc keeps the array')
    assert.equal(raw($query.get()[0]), raw($first.get()))

    await $[collection][first[1]._id].del()
    const second = raw($query.get())
    assert.notEqual(second, first, 'a delete gives a new array')
    assert.equal(first.length, 8, 'the previous array is unchanged')
    assert.equal(second.length, 7)
    for (const doc of second) assert.ok(first.includes(doc), 'unchanged docs keep their objects')
  })

  it('an async loop over get() keeps its snapshot while the server inserts docs', async () => {
    const { $query, kind } = await subscribeEight('subscribe')
    const snapshot = $query.get()
    const seen = []
    for (const doc of snapshot) {
      seen.push(doc.n)
      if (doc.n === 0) await $.querySnapshotGames.add({ kind, n: 8 })
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6, 7])
    assert.equal(snapshot.length, 8)
    await waitFor(() => $query.get().length === 9)
    assert.notEqual(raw($query.get()), raw(snapshot))
    for (const doc of $query.get()) await $[collection][doc._id].del()
  })
})

async function waitFor (check, timeout = 2000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeout) throw Error('waitFor timed out')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}
