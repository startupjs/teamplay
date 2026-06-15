import { before, afterEach, describe, it } from 'mocha'
import { strict as assert } from 'node:assert'

import connect from '../src/connect/test.js'
import {
  del,
  getRaw,
  set,
  setPublicDocReplace,
  setReplace
} from '../src/orm/dataTree.js'

const PUBLIC_COLLECTION = 'nullishPublic'
let publicDocCounter = 0

function nextPublicDocId () {
  publicDocCounter += 1
  return `_nullish_${publicDocCounter}`
}

describe('dataTree nullish semantics', () => {
  before(() => {
    connect()
  })

  afterEach(() => {
    del([PUBLIC_COLLECTION])
  })

  it('set preserves null on object properties like racer LocalDoc.set', () => {
    const tree = {}
    set(['doc', 'flag'], null, tree)

    assert.ok(Object.prototype.hasOwnProperty.call(tree.doc, 'flag'))
    assert.equal(tree.doc.flag, null)
  })

  it('set preserves undefined on object properties like racer LocalDoc.set', () => {
    const tree = {}
    set(['doc', 'flag'], undefined, tree)

    assert.ok(Object.prototype.hasOwnProperty.call(tree.doc, 'flag'))
    assert.equal(tree.doc.flag, undefined)
  })

  it('set preserves sparse array holes when writing undefined out of bounds like racer LocalDoc.set', () => {
    const tree = {}
    set(['doc', 'items', 2], undefined, tree)
    const items = tree.doc.items

    assert.equal(items.length, 3)
    assert.equal(0 in items, false)
    assert.equal(1 in items, false)
    assert.equal(2 in items, true)
    assert.equal(items[2], undefined)
  })

  it('set preserves sparse array holes when writing null out of bounds like racer LocalDoc.set', () => {
    const tree = {}
    set(['doc', 'items', 2], null, tree)
    const items = tree.doc.items

    assert.equal(items.length, 3)
    assert.equal(0 in items, false)
    assert.equal(1 in items, false)
    assert.equal(2 in items, true)
    assert.equal(items[2], null)
  })

  it('setReplace preserves explicit undefined object properties as provided', () => {
    const tree = {}
    setReplace(['doc'], { flag: undefined }, tree)

    assert.ok(Object.prototype.hasOwnProperty.call(tree.doc, 'flag'))
    assert.equal(tree.doc.flag, undefined)
  })

  it('setReplace preserves sparse array shape as provided', () => {
    const tree = {}
    const items = []
    items[2] = 'Z'
    setReplace(['doc', 'items'], items, tree)

    assert.equal(tree.doc.items.length, 3)
    assert.equal(0 in tree.doc.items, false)
    assert.equal(1 in tree.doc.items, false)
    assert.equal(2 in tree.doc.items, true)
    assert.equal(tree.doc.items[2], 'Z')
  })

  it('public replace normalizes undefined object fields to null like racer RemoteDoc ops', async () => {
    const docId = nextPublicDocId()
    await setPublicDocReplace([PUBLIC_COLLECTION, docId], { flag: true })
    await setPublicDocReplace([PUBLIC_COLLECTION, docId, 'flag'], undefined)
    const snapshot = getRaw([PUBLIC_COLLECTION, docId])

    assert.ok(Object.prototype.hasOwnProperty.call(snapshot, 'flag'))
    assert.equal(snapshot.flag, null)
  })

  it('public replace normalizes undefined array items to null like racer RemoteDoc ops', async () => {
    const docId = nextPublicDocId()
    await setPublicDocReplace([PUBLIC_COLLECTION, docId], { items: ['A'] })
    await setPublicDocReplace([PUBLIC_COLLECTION, docId, 'items', 0], undefined)

    assert.deepEqual(getRaw([PUBLIC_COLLECTION, docId, 'items']), [null])
  })
})
