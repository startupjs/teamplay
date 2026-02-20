import { it, describe, before, afterEach } from 'mocha'
import { strict as assert } from 'node:assert'
import { $, sub, aggregation } from '../index.js'
import { getConnection } from '../orm/connection.js'
import { afterEachTestGc } from './_helpers.js'
import connect from '../connect/test.js'

before(connect)

function cbPromise (fn) {
  return new Promise((resolve, reject) => {
    fn((err, result) => err ? reject(err) : resolve(result))
  })
}

describe('Id fields in docs, queries, aggregations', () => {
  afterEachTestGc()

  const cleanup = []
  afterEach(async () => {
    for (const { collection, id } of cleanup.splice(0)) {
      const doc = getConnection().get(collection, id)
      if (doc?.data) await cbPromise(cb => doc.del(cb))
      delete getConnection().collections?.[collection]?.[id]
    }
  })

  it('individual doc subscription adds _id automatically', async () => {
    const collection = 'idTestDocs'
    const id = '_1'
    cleanup.push({ collection, id })
    const $doc = await sub($[collection][id])
    await $doc.set({ name: 'Doc 1' })

    const data = $doc.get()
    assert.equal(data._id, id)
    assert.ok(!('id' in data))

    const doc = getConnection().get(collection, id)
    assert.equal(doc.data._id, id)
    assert.ok(!('id' in doc.data))
  })

  it('query results inject _id into data and use doc.id for ids', async () => {
    const collection = 'idTestQuery'
    const id1 = '_1'
    const id2 = '_2'
    cleanup.push({ collection, id: id1 }, { collection, id: id2 })

    const $doc1 = await sub($[collection][id1])
    const $doc2 = await sub($[collection][id2])
    await $doc1.set({ name: 'One' })
    await $doc2.set({ name: 'Two' })

    const $query = await sub($[collection], {})
    const results = $query.get()

    for (const doc of results) {
      assert.ok('_id' in doc)
      assert.ok(!('id' in doc))
    }

    const ids = $query.getIds().slice().sort()
    assert.deepEqual(ids, [id1, id2])
  })

  it('aggregation results include _id by default and can be projected out', async () => {
    const collection = 'idTestAgg'
    const id1 = '_1'
    const id2 = '_2'
    cleanup.push({ collection, id: id1 }, { collection, id: id2 })

    const $doc1 = await sub($[collection][id1])
    const $doc2 = await sub($[collection][id2])
    await $doc1.set({ name: 'A', active: true })
    await $doc2.set({ name: 'B', active: true })

    const $$withId = aggregation(({ active }) => [{ $match: { active } }])
    const $withId = await sub($$withId, { $collection: collection, active: true })
    const withId = $withId.get()
    assert.ok(withId.length >= 2)
    assert.ok(withId.every(doc => ('_id' in doc) || ('id' in doc)))

    const $$noId = aggregation(() => [
      { $match: { active: true } },
      { $project: { _id: 0, name: 1 } }
    ])
    const $noId = await sub($$noId, { $collection: collection })
    const noId = $noId.get()
    assert.ok(noId.length >= 2)
    assert.ok(noId.every(doc => !('_id' in doc) && !('id' in doc)))

    const ids = $noId.getIds()
    assert.ok(ids.every(id => id === undefined))
  })

  it('aggregation results do not include id in base mode', async () => {
    const collection = 'idTestAggBase'
    const id1 = '_1'
    const id2 = '_2'
    cleanup.push({ collection, id: id1 }, { collection, id: id2 })

    const $doc1 = await sub($[collection][id1])
    const $doc2 = await sub($[collection][id2])
    await $doc1.set({ name: 'A', active: true })
    await $doc2.set({ name: 'B', active: true })

    const $$withId = aggregation(({ active }) => [{ $match: { active } }])
    const $withId = await sub($$withId, { $collection: collection, active: true })
    const withId = $withId.get()
    assert.ok(withId.length >= 2)
    assert.ok(withId.every(doc => doc._id))
    assert.ok(withId.every(doc => !('id' in doc)))
  })

  it('public docs ignore _id changes on set and subpath', async () => {
    const collection = 'idTestPublic'
    const id = '_1'
    cleanup.push({ collection, id })
    const $doc = await sub($[collection][id])
    await $doc.set({ name: 'Doc', _id: 'other' })
    assert.equal($doc.get()._id, id)
    assert.equal($doc.get().name, 'Doc')

    await $doc._id.set('another')
    assert.equal($doc.get()._id, id)
  })

  it('local add uses provided id and does not keep id field', async () => {
    const collection = '_localIdAdd'
    const createdId = await $[collection].add({ id: 'custom', name: 'Local' })
    assert.equal(createdId, 'custom')
    const data = $[collection][createdId].get()
    assert.equal(data._id, 'custom')
    assert.ok(!('id' in data))
  })

  it('local docs only get _id when created via add()', async () => {
    const collection = '_localIdTest'
    const id = '_1'

    await $[collection][id].set({ name: 'Local Doc' })
    const data = $[collection][id].get()
    assert.ok(!('_id' in data))

    const createdId = await $[collection].add({ name: 'Added Local' })
    const added = $[collection][createdId].get()
    assert.equal(added._id, createdId)
  })
})
