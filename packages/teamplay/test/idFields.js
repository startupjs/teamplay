import { it, describe, before, afterEach } from 'mocha'
import { strict as assert } from 'node:assert'
import { $, sub, aggregation } from '../index.js'
import { getConnection } from '../orm/connection.js'
import { afterEachTestGc } from './_helpers.js'
import connect from '../connect/test.js'
import { isMissingShareDoc } from '../orm/missingDoc.js'

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
      if (doc?.data && !isMissingShareDoc(doc)) await cbPromise(cb => doc.del(cb))
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

  it('public docs allow nested id/_id mutations while keeping top-level identity protected', async () => {
    const collection = 'idTestPublicNested'
    const id = '_1'
    cleanup.push({ collection, id })
    const $doc = await sub($[collection][id])
    await $doc.set({
      name: 'Doc',
      profile: {
        id: 'profile-1',
        _id: 'profile-1',
        nested: { id: 'nested-1', _id: 'nested-1' }
      }
    })

    await $doc.profile.id.set('profile-2')
    await $doc.profile._id.set('profile-3')
    await $doc.profile.nested.id.set('nested-2')
    await $doc.profile.nested._id.set('nested-3')
    await $doc._id.set('other-top-level')

    assert.equal($doc.get()._id, id)
    assert.equal($doc.profile.id.get(), 'profile-2')
    assert.equal($doc.profile._id.get(), 'profile-3')
    assert.equal($doc.profile.nested.id.get(), 'nested-2')
    assert.equal($doc.profile.nested._id.get(), 'nested-3')
  })

  it('public nested subpath writes preserve nested id/_id payloads', async () => {
    const collection = 'idTestPublicNestedSubpath'
    const id = '_1'
    cleanup.push({ collection, id })
    const $doc = await sub($[collection][id])
    await $doc.set({ name: 'Doc' })

    await $doc.media.set({
      id: 'media-1',
      _id: 'media-2',
      type: 'uploadedPDF'
    })

    assert.deepEqual($doc.media.get(), {
      id: 'media-1',
      _id: 'media-2',
      type: 'uploadedPDF'
    })
  })

  it('local docs allow id/_id mutations on top-level and nested paths', async () => {
    const collection = '_localMutableIds'
    try {
      await $[collection].doc1.set({
        id: 'local-1',
        _id: 'local-1',
        profile: { id: 'profile-1', _id: 'profile-1' }
      })

      await $[collection].doc1.id.set('local-2')
      await $[collection].doc1._id.set('local-3')
      await $[collection].doc1.profile.id.set('profile-2')
      await $[collection].doc1.profile._id.set('profile-3')

      assert.equal($[collection].doc1.id.get(), 'local-2')
      assert.equal($[collection].doc1._id.get(), 'local-3')
      assert.equal($[collection].doc1.profile.id.get(), 'profile-2')
      assert.equal($[collection].doc1.profile._id.get(), 'profile-3')
    } finally {
      $[collection].del()
    }
  })

  it('local add mirrors public add when only id is provided', async () => {
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

  it('local add accepts _id-only and equal id/_id payloads', async () => {
    const collection = '_localIdAddVariants'

    const underscoreId = await $[collection].add({ _id: 'custom-underscore', name: 'Underscore' })
    assert.equal(underscoreId, 'custom-underscore')
    assert.equal($[collection][underscoreId]._id.get(), 'custom-underscore')
    assert.ok(!('id' in $[collection][underscoreId].get()))

    const sameId = await $[collection].add({ id: 'custom-same', _id: 'custom-same', name: 'Same' })
    assert.equal(sameId, 'custom-same')
    assert.equal($[collection][sameId]._id.get(), 'custom-same')
    assert.ok(!('id' in $[collection][sameId].get()))
  })

  it('local add does not normalize nested id/_id fields', async () => {
    const collection = '_localNestedIdAdd'
    const createdId = await $[collection].add({
      name: 'Nested Local',
      profile: { id: 'profile-1', _id: 'profile-2' }
    })
    const data = $[collection][createdId].get()
    assert.equal(data._id, createdId)
    assert.equal(data.profile.id, 'profile-1')
    assert.equal(data.profile._id, 'profile-2')
  })

  it('local add throws on conflicting id and _id', async () => {
    const collection = '_localIdConflict'
    await assert.rejects(
      $[collection].add({ id: 'custom', _id: 'other', name: 'Conflict' }),
      /conflicting "id".*"_id"/
    )
    assert.equal($[collection].get(), undefined)
  })
})
