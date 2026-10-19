import { afterEach, before, describe, it } from 'mocha'
import { strict as assert } from 'node:assert'
import { raw } from '@nx-js/observer-util'
import { $, getRootSignal, reaction, sub, unsub } from '../src/index.ts'
import connect from '../src/connect/test.js'
import { getConnection } from '../src/orm/connection.ts'
import { getRaw } from '../src/orm/dataTree.js'
import { docSubscriptions } from '../src/orm/Doc.js'
import { querySubscriptions } from '../src/orm/Query.js'
import { getSubscriptionGcDelay, setSubscriptionGcDelay } from '../src/orm/subscriptionGcDelay.ts'
import { assertDocSubscriptionsConsistent, assertQuerySubscriptionsConsistent } from './_subscriptionAssertions.js'

before(connect)

// An op whose component has an empty path (`{ p: [] }`) replaces the whole
// doc: setReplace() on a doc signal submits one, and so can any other client.
// ShareDB then sets doc.data to a new object. The data tree must follow it, on
// this connection and on every other one, or it keeps reading (and the
// signals keep showing) the data from before the replace.
describe('a doc replaced as a whole', () => {
  const collection = 'docRootReplaceGames'
  const owned = []
  const roots = []
  let writer
  let prevGcDelay

  before(() => {
    writer = getConnection().agent.backend.connect()
  })

  afterEach(async () => {
    for (const $signal of owned.splice(0).reverse()) await unsub($signal)
    for (const $root of roots.splice(0)) await $root.close()
    if (prevGcDelay !== undefined) setSubscriptionGcDelay(prevGcDelay)
    prevGcDelay = undefined
    await querySubscriptions.flushPendingDestroys()
    await docSubscriptions.flushPendingDestroys()
    assertDocSubscriptionsConsistent(docSubscriptions)
    assertQuerySubscriptionsConsistent(querySubscriptions)
  })

  let counter = 0
  function nextId (name) {
    return `${name}_${Date.now()}_${++counter}`
  }

  async function own (promise) {
    const $signal = await promise
    owned.push($signal)
    return $signal
  }

  function useGcDelay (delay) {
    prevGcDelay ??= getSubscriptionGcDelay()
    setSubscriptionGcDelay(delay)
  }

  // another client (another process of the app): its own connection
  async function remoteCreate (id, data) {
    await callback(done => writer.get(collection, id).create(data, done))
  }

  async function remoteOp (id, op) {
    const doc = writer.get(collection, id)
    await callback(done => doc.fetch(done))
    await callback(done => doc.submitOp(op, done))
    return doc.version
  }

  async function remoteReplace (id, next) {
    const doc = writer.get(collection, id)
    await callback(done => doc.fetch(done))
    return await remoteOp(id, [{ p: [], od: doc.data, oi: next }])
  }

  function localShareDoc (id) {
    return getConnection().get(collection, id)
  }

  async function received (id, version) {
    await waitFor(() => localShareDoc(id).version >= version, `the op v${version} reaches this connection`)
  }

  function tree (id) {
    return getRaw([collection, id])
  }

  // the tree reads the same object as ShareDB (what the next ops change)
  function assertLinked (id) {
    assert.equal(tree(id), raw(localShareDoc(id).data), 'the data tree holds ShareDB\'s doc.data')
  }

  it('a field op changes the doc in place: no re-link', async () => {
    const id = nextId('field')
    await remoteCreate(id, { name: 'Ann', score: 1 })
    const $doc = await own(sub($[collection][id]))
    const before = tree(id)
    const refData = spyOnRuntime(id, '_refData')
    const version = await remoteOp(id, [{ p: ['score'], od: 1, oi: 2 }])
    await received(id, version)
    assert.equal($doc.score.get(), 2)
    assert.equal(tree(id), before, 'the same object, changed in place')
    assert.equal(refData.calls, 0, 'nothing to re-link')
    assertLinked(id)
  })

  it('a nested replace (not the root) changes the doc in place: no re-link', async () => {
    const id = nextId('nested')
    await remoteCreate(id, { name: 'Ann', profile: { city: 'Kyiv', tags: ['a'] } })
    const $doc = await own(sub($[collection][id]))
    const before = tree(id)
    const refData = spyOnRuntime(id, '_refData')
    const version = await remoteOp(id, [{ p: ['profile'], od: { city: 'Kyiv', tags: ['a'] }, oi: { city: 'Lviv' } }])
    await received(id, version)
    assert.deepEqual($doc.profile.get(), { city: 'Lviv' })
    assert.equal(tree(id), before)
    assert.equal(refData.calls, 0)
    assertLinked(id)
  })

  it('a subscriber sees a replace from another client', async () => {
    const id = nextId('remote')
    await remoteCreate(id, { name: 'Ann', score: 1 })
    const $doc = await own(sub($[collection][id]))
    const before = tree(id)
    const version = await remoteReplace(id, { name: 'Bob', level: 3 })
    await received(id, version)
    assert.deepEqual($doc.get(), { _id: id, name: 'Bob', level: 3 })
    assert.equal($doc.score.get(), undefined, 'a key the replace removed is gone')
    assert.equal(tree(id), before, 'the tree keeps its object (and the queries listing it)')
    assertLinked(id)
  })

  it('a subscriber sees the ops that follow a replace from another client', async () => {
    const id = nextId('remote_then_field')
    await remoteCreate(id, { name: 'Ann', score: 1 })
    const $doc = await own(sub($[collection][id]))
    await remoteReplace(id, { name: 'Bob', score: 10 })
    const version = await remoteOp(id, [{ p: ['score'], od: 10, oi: 11 }])
    await received(id, version)
    assert.equal($doc.score.get(), 11)
    assert.equal($doc.name.get(), 'Bob')
    assertLinked(id)
  })

  it('a local write after a replace from another client applies to the new data', async () => {
    const id = nextId('remote_then_local')
    await remoteCreate(id, { name: 'Ann', score: 1 })
    const $doc = await own(sub($[collection][id]))
    const version = await remoteReplace(id, { name: 'Bob', score: 10 })
    await received(id, version)
    assert.equal($doc.name.get(), 'Bob', 'read before the write')
    await $doc.score.set(12)
    assert.deepEqual($doc.get(), { _id: id, name: 'Bob', score: 12 })
    const remote = writer.get(collection, id)
    await callback(done => remote.fetch(done))
    assert.deepEqual(remote.data, { name: 'Bob', score: 12 })
  })

  it('a query subscriber sees a replace from another client and the ops after it', async () => {
    const id = nextId('query')
    const kind = `kind_${id}`
    await remoteCreate(id, { kind, name: 'Ann', score: 1 })
    const $query = await sub(root()[collection], { kind })
    await remoteReplace(id, { kind, name: 'Bob', score: 10 })
    const version = await remoteOp(id, [{ p: ['score'], od: 10, oi: 11 }])
    await received(id, version)
    assert.deepEqual($query.get().map(({ name, score }) => ({ name, score })), [{ name: 'Bob', score: 11 }])
    assert.equal($query.get()[0], tree(id), 'the query lists the tree\'s object')
    assertLinked(id)
  })

  it('a doc subscriber and a query subscriber of the same doc both see a replace', async () => {
    const id = nextId('doc_and_query')
    const kind = `kind_${id}`
    await remoteCreate(id, { kind, name: 'Ann' })
    const $doc = await own(sub($[collection][id]))
    const $query = await sub(root()[collection], { kind })
    const version = await remoteReplace(id, { kind, name: 'Bob' })
    await received(id, version)
    assert.equal($doc.name.get(), 'Bob')
    assert.deepEqual($query.get().map(doc => doc.name), ['Bob'])
  })

  it('a replace while another root holds the doc: a new root reads the new data', async () => {
    const id = nextId('held')
    const kind = `kind_${id}`
    await remoteCreate(id, { kind, name: 'Ann' })
    // a long-lived root (a job, a hook) holds the query all along
    const $holder = root()
    const $held = await sub($holder[collection], { kind })
    const version = await remoteReplace(id, { kind, name: 'Bob' })
    await received(id, version)
    const $reader = root()
    const $read = await sub($reader[collection], { kind })
    assert.deepEqual($read.get().map(doc => doc.name), ['Bob'])
    assert.deepEqual($held.get().map(doc => doc.name), ['Bob'])
  })

  it('a doc only a lingering query result holds catches up on a replace when a new query takes it', async () => {
    // A server process with one root per job: the docs a closed job's query
    // read stay for the subscription GC delay, without a subscription of
    // their own; the next job's query gets the ops they missed, not snapshots
    useGcDelay(1000)
    const id = nextId('lingering')
    const kind = `kind_${id}`
    await remoteCreate(id, { kind, names: ['Ann', 'Bob'], startedAt: 1 })
    const readJob = async () => {
      const $root = getRootSignal({ rootId: nextId('job') })
      try {
        const $query = await sub($root[collection], { kind })
        return $query.get().map(({ names, startedAt }) => ({ names, startedAt }))
      } finally {
        $root.close()
      }
    }
    assert.deepEqual(await readJob(), [{ names: ['Ann', 'Bob'], startedAt: 1 }])
    await remoteReplace(id, { kind, names: ['Ann', 'Bob', 'Cid'] })
    assert.deepEqual(await readJob(), [{ names: ['Ann', 'Bob', 'Cid'], startedAt: undefined }])
    await remoteOp(id, [{ p: ['names', 3], li: 'Dee' }])
    assert.deepEqual(await readJob(), [{ names: ['Ann', 'Bob', 'Cid', 'Dee'], startedAt: undefined }])
  })

  it('a reaction that writes to the doc as a replace arrives: the write stays, and so does the link', async () => {
    // The re-link copies the replace into the data tree, which runs the
    // reactions reading the doc: one that writes to the doc must find the
    // doc linked already (it writes to ShareDB's doc.data, the tree's object)
    const id = nextId('reaction_write')
    await remoteCreate(id, { name: 'Ann', seen: 'Ann' })
    const $doc = await own(sub($[collection][id]))
    const seen = []
    const writes = []
    const handle = reaction(() => {
      const name = $doc.name.get()
      if (name === 'Ann' || seen.includes(name)) return
      seen.push(name)
      writes.push($doc.seen.set(name))
    })
    try {
      const version = await remoteReplace(id, { name: 'Bob', seen: 'Ann' })
      await received(id, version)
      assert.equal(writes.length, 1, 'the reaction wrote once')
      await writes[0]
      assertLinked(id)
      assert.equal($doc.seen.get(), 'Bob')
      assert.equal(localShareDoc(id).data.seen, 'Bob', 'ShareDB holds the write')
      const remote = writer.get(collection, id)
      await callback(done => remote.fetch(done))
      assert.deepEqual(remote.data, { name: 'Bob', seen: 'Bob' }, 'the server has the write')
      const after = await remoteOp(id, [{ p: ['score'], oi: 1 }])
      await received(id, after)
      assert.equal($doc.score.get(), 1, 'a later remote op reaches the signals')
      assertLinked(id)
    } finally {
      handle.dispose()
    }
  })

  it('a local replace shows at once, before the server acknowledges it', async () => {
    const id = nextId('local')
    await remoteCreate(id, { name: 'Ann', score: 1 })
    const $doc = await own(sub($[collection][id]))
    const before = tree(id)
    const written = $doc.setReplace({ name: 'Bob', level: 2 })
    // ShareDB applied the op locally; the server has not acknowledged it yet
    assert.ok(localShareDoc(id).hasPending(), 'the op is in flight')
    assert.deepEqual($doc.get(), { _id: id, name: 'Bob', level: 2 })
    assert.equal(tree(id), before)
    assertLinked(id)
    await written
    assert.deepEqual($doc.get(), { _id: id, name: 'Bob', level: 2 })
    // and the ops after it
    const version = await remoteOp(id, [{ p: ['level'], od: 2, oi: 3 }])
    await received(id, version)
    assert.equal($doc.level.get(), 3)
  })

  it('a local replace changes the doc\'s objects in place, as field ops do: the doc and the queries listing it keep them', async () => {
    // As for a load or a replace from another client: the tree keeps its
    // objects and takes the new values, so what reads a changed value runs
    // again, and what holds an object (or a query's list) keeps it
    const id = nextId('in_place')
    const kind = `kind_${id}`
    await remoteCreate(id, { kind, name: 'Ann', profile: { city: 'Kyiv', zip: '01001' } })
    const $root = getRootSignal({ rootId: nextId('in_place_root') })
    roots.push($root)
    const $query = await sub($root[collection], { kind })
    const $doc = $root[collection][id]
    const doc = tree(id)
    const profile = doc.profile
    const list = $query.get()
    const cities = []
    const zips = []
    const handles = [
      reaction(() => { cities.push($doc.profile.city.get()) }),
      reaction(() => { zips.push($doc.profile.zip.get()) })
    ]
    try {
      await $doc.setReplace({ kind, name: 'Bob', profile: { city: 'Lviv', zip: '01001' } })
      assert.equal(tree(id), doc, 'the doc keeps its object')
      assert.equal(tree(id).profile, profile, 'and its nested objects')
      assert.equal($query.get(), list, 'the query keeps its list')
      assert.deepEqual($query.get().map(({ name }) => name), ['Bob'])
      assert.deepEqual(cities, ['Kyiv', 'Lviv'], 'a changed value runs its readers')
      assert.deepEqual(zips, ['01001'], 'an unchanged one does not')
      assertLinked(id)
    } finally {
      for (const handle of handles) handle.dispose()
    }
  })

  it('a replace with null from another client leaves the doc without data, and a later replace brings data back', async () => {
    const id = nextId('null')
    await remoteCreate(id, { name: 'Ann' })
    const $doc = await own(sub($[collection][id]))
    const cleared = await remoteReplace(id, null)
    await received(id, cleared)
    assert.equal($doc.get(), undefined)
    assert.equal(tree(id), undefined)
    const next = await remoteReplace(id, { name: 'Bob' })
    await received(id, next)
    assert.deepEqual($doc.get(), { _id: id, name: 'Bob' })
    assertLinked(id)
  })

  it('a replace by a different shape: keys removed, added, nested objects and arrays', async () => {
    const id = nextId('shape')
    await remoteCreate(id, { name: 'Ann', score: 1, profile: { city: 'Kyiv' }, tags: ['a', 'b'] })
    const $doc = await own(sub($[collection][id]))
    const next = { title: 'T', profile: { country: 'UA', langs: ['uk', 'en'] }, items: [{ n: 1 }, { n: 2 }] }
    const version = await remoteReplace(id, next)
    await received(id, version)
    assert.deepEqual($doc.get(), { _id: id, ...next })
    assert.equal($doc.name.get(), undefined)
    assert.equal($doc.tags.get(), undefined)
    assert.deepEqual($doc.profile.langs.get(), ['uk', 'en'])
    const after = await remoteOp(id, [{ p: ['items', 1, 'n'], od: 2, oi: 20 }])
    await received(id, after)
    assert.equal($doc.items[1].n.get(), 20)
    assertLinked(id)
  })

  it('many replaces in a row, then a field op', async () => {
    const id = nextId('many')
    await remoteCreate(id, { n: 0 })
    const $doc = await own(sub($[collection][id]))
    const before = tree(id)
    for (let n = 1; n <= 50; n++) await remoteReplace(id, { n, [`key${n}`]: n })
    const version = await remoteOp(id, [{ p: ['extra'], oi: true }])
    await received(id, version)
    assert.deepEqual($doc.get(), { _id: id, n: 50, key50: 50, extra: true })
    assert.equal(tree(id), before)
    assertLinked(id)
  })

  it('an op of several components from another client: a replace, then field ops', async () => {
    const id = nextId('components')
    await remoteCreate(id, { name: 'Ann' })
    const $doc = await own(sub($[collection][id]))
    const version = await remoteOp(id, [
      { p: [], od: { name: 'Ann' }, oi: { name: 'Bob', tags: [] } },
      { p: ['tags', 0], li: 'x' },
      { p: ['score'], oi: 5 }
    ])
    await received(id, version)
    assert.deepEqual($doc.get(), { _id: id, name: 'Bob', tags: ['x'], score: 5 })
    assertLinked(id)
  })

  it('a replace, a delete and a create again from another client', async () => {
    const id = nextId('del_create')
    await remoteCreate(id, { name: 'Ann' })
    const $doc = await own(sub($[collection][id]))
    await remoteReplace(id, { name: 'Bob' })
    const remote = writer.get(collection, id)
    await callback(done => remote.del(done))
    await waitFor(() => $doc.get() === undefined, 'the delete reaches this connection')
    await callback(done => remote.create({ name: 'Cid', v: 1 }, done))
    const version = await remoteReplace(id, { name: 'Dee', v: 2 })
    await received(id, version)
    assert.deepEqual($doc.get(), { _id: id, name: 'Dee', v: 2 })
    assertLinked(id)
  })

  it('a replace submitted while a local op is in flight converges to the server\'s data', async () => {
    const id = nextId('concurrent')
    await remoteCreate(id, { name: 'Ann', score: 1 })
    const $doc = await own(sub($[collection][id]))
    const local = $doc.score.set(2)
    const version = await remoteReplace(id, { name: 'Bob', score: 10 })
    await local
    await received(id, version)
    const remote = writer.get(collection, id)
    await waitFor(() => localShareDoc(id).version === remote.version || localShareDoc(id).version > version)
    await callback(done => remote.fetch(done))
    const { _id, ...data } = $doc.get()
    assert.deepEqual(data, remote.data)
    assertLinked(id)
  })

  it('a replace made while this connection was offline is caught up on after the reconnect', async () => {
    const id = nextId('reconnect')
    await remoteCreate(id, { name: 'Ann', score: 1 })
    const $doc = await own(sub($[collection][id]))
    const connection = getConnection()
    const backend = connection.agent.backend
    connection.close()
    const version = await remoteReplace(id, { name: 'Bob', score: 7 })
    backend.connect(connection)
    await received(id, version)
    assert.deepEqual($doc.get(), { _id: id, name: 'Bob', score: 7 })
    const after = await remoteOp(id, [{ p: ['score'], od: 7, oi: 8 }])
    await received(id, after)
    assert.equal($doc.score.get(), 8)
    assertLinked(id)
  })

  it('a ShareDB doc that outlives its runtime no longer feeds the data tree', async () => {
    const id = nextId('outlives')
    await remoteCreate(id, { name: 'Ann' })
    const $doc = await sub($[collection][id])
    const shareDoc = localShareDoc(id)
    assert.equal(countRuntimeListeners(shareDoc), 5, 'load, create, del, op, error')
    // something else asks ShareDB for the doc while teamplay destroys it
    // (ShareDB then keeps it): not a teamplay owner, nothing holds the doc
    const destroy = shareDoc.destroy
    shareDoc.destroy = function (cb) {
      delete shareDoc.destroy
      destroy.call(this, cb)
      getConnection().get(collection, id)
    }
    await unsub($doc)
    await docSubscriptions.flushPendingDestroys()
    assert.equal(docSubscriptions.docs.get(JSON.stringify([collection, id])), undefined, 'the runtime is disposed')
    assert.equal(getConnection().collections[collection][id], shareDoc, 'ShareDB kept the doc')
    assert.equal(tree(id), undefined)
    assert.equal(countRuntimeListeners(shareDoc), 0)
    await remoteReplace(id, { name: 'Bob' })
    await callback(done => shareDoc.fetch(done))
    assert.equal(tree(id), undefined, 'a load of a doc nothing holds stays out of the data tree')
    // a new subscription follows the doc again, with one set of listeners
    const $again = await own(sub($[collection][id]))
    assert.equal($again.name.get(), 'Bob')
    assert.equal(countRuntimeListeners(shareDoc), 5)
    const version = await remoteOp(id, [{ p: ['name'], od: 'Bob', oi: 'Cid' }])
    await received(id, version)
    assert.equal($again.name.get(), 'Cid')
  })

  function root () {
    const $root = getRootSignal({ rootId: nextId('root') })
    roots.push($root)
    return $root
  }

  function spyOnRuntime (id, method) {
    const runtime = docSubscriptions.docs.get(JSON.stringify([collection, id]))
    const spy = { calls: 0 }
    const original = runtime[method]
    runtime[method] = function (...args) {
      spy.calls++
      return original.apply(this, args)
    }
    return spy
  }
})

function countRuntimeListeners (shareDoc) {
  return ['load', 'create', 'del', 'op', 'error'].reduce((sum, event) => sum + shareDoc.listenerCount(event), 0)
}

function callback (run) {
  return new Promise((resolve, reject) => run(err => err ? reject(err) : resolve()))
}

async function waitFor (check, message = 'condition') {
  for (let i = 0; i < 400; i++) {
    if (check()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.fail(`timed out waiting for: ${message}`)
}
