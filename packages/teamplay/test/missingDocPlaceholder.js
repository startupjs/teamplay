import { describe, it, before, afterEach } from 'mocha'
import { strict as assert } from 'node:assert'
import { $, getConnection, sub } from '../index.ts'
import connect from '../connect/test.js'
import { docSubscriptions } from '../orm/Doc.js'

before(connect)

describe('Missing doc placeholder parity', () => {
  const collection = 'missingDocPlaceholderGames'
  const createdIds = []

  afterEach(async () => {
    const connection = getConnection()
    const ids = createdIds.splice(0)
    await Promise.all(ids.map(id => {
      const doc = connection.get(collection, id)
      return new Promise(resolve => {
        if (!doc.data) return resolve()
        doc.del(() => resolve())
      })
    }))
  })

  it('keeps model unresolved but makes shareDoc.data truthy after subscribe on missing doc', async () => {
    const id = `missing_${Date.now()}`
    const $doc = $[collection][id]

    await sub($doc)

    const shareDoc = getConnection().get(collection, id)
    assert.equal($doc.get(), undefined, 'model path must stay unresolved for missing docs')
    assert.ok(shareDoc.data, 'shareDoc.data must be truthy for missing docs')
    assert.deepEqual(Object.keys(shareDoc.data), [], 'missing-doc placeholder must be empty')
    assert.equal(shareDoc.type, null)
    assert.equal(shareDoc.version, 0)

    await docSubscriptions.unsubscribe($doc)
  })

  it('replaces placeholder with real data when the doc gets created later', async () => {
    const id = `missing_create_${Date.now()}`
    const $doc = $[collection][id]

    await sub($doc)
    const beforeCreate = getConnection().get(collection, id)
    assert.ok(beforeCreate.data, 'placeholder should exist before create')
    assert.equal($doc.get(), undefined, 'model path must stay unresolved before create')

    createdIds.push(id)
    await new Promise((resolve, reject) => {
      beforeCreate.create({ name: 'Created later' }, err => {
        if (err) return reject(err)
        resolve()
      })
    })

    const created = $doc.get()
    assert.ok(created, 'model path must resolve after create')
    assert.equal(created.name, 'Created later')

    const shareDoc = getConnection().get(collection, id)
    assert.ok(shareDoc.data, 'shareDoc.data must stay truthy after create')
    assert.equal(shareDoc.data.name, 'Created later')

    await docSubscriptions.unsubscribe($doc)
  })

  it('restores an empty missing-doc placeholder after a subscribed doc gets deleted', async () => {
    const id = `missing_delete_${Date.now()}`
    const $doc = $[collection][id]

    await sub($doc)
    const shareDoc = getConnection().get(collection, id)

    createdIds.push(id)
    await new Promise((resolve, reject) => {
      shareDoc.create({ name: 'Created then deleted' }, err => {
        if (err) return reject(err)
        resolve()
      })
    })

    assert.equal($doc.get().name, 'Created then deleted')

    await new Promise((resolve, reject) => {
      shareDoc.del(err => {
        if (err) return reject(err)
        resolve()
      })
    })

    assert.equal($doc.get(), undefined, 'model path must become unresolved again after delete')
    assert.ok(shareDoc.data, 'shareDoc.data must stay truthy after delete')
    assert.deepEqual(Object.keys(shareDoc.data), [], 'deleted doc placeholder must be empty')
    assert.equal(shareDoc.type, null)
    assert.ok(shareDoc.version > 0, 'deleted doc keeps its ShareDB version history')

    await docSubscriptions.unsubscribe($doc)
  })
})
