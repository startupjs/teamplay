import { describe, it, before, afterEach } from 'mocha'
import { strict as assert } from 'node:assert'
import { $, getConnection, sub } from '../src/index.ts'
import connect from '../src/connect/test.js'
import { docSubscriptions } from '../src/orm/Doc.js'

before(connect)

describe('Public doc create consistency', () => {
  const collection = 'compatCreateConsistencyCourses'
  const createdIds = []

  afterEach(async () => {
    const connection = getConnection()
    const ids = createdIds.splice(0)
    await Promise.all(ids.map(id => {
      const doc = connection.get(collection, id)
      return new Promise(resolve => {
        doc.del(() => resolve())
      })
    }))
  })

  it('keeps created doc available immediately after add and after subscribe', async () => {
    for (let i = 0; i < 30; i++) {
      const id = `course_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 10)}`
      createdIds.push(id)

      await $[collection].add({ id, name: `Course ${i}` })

      const $doc = $[collection][id]
      const immediateDoc = $doc.get()
      assert.ok(immediateDoc, `doc is missing right after add (iteration ${i}, id ${id})`)

      await sub($doc)
      const subscribedDoc = $doc.get()
      assert.ok(subscribedDoc, `doc is missing after subscribe (iteration ${i}, id ${id})`)
      assert.equal(subscribedDoc._id || subscribedDoc.id, id)
      await docSubscriptions.unsubscribe($doc)
    }
  })
})
