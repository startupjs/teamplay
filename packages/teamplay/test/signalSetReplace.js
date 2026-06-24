import { before, afterEach, describe, it } from 'mocha'
import { strict as assert } from 'node:assert'

import connect from '../src/connect/test.js'
import { getRootSignal } from '../src/index.ts'
import { del as delPublicData, getRaw } from '../src/orm/dataTree.js'
import { getPrivateData } from '../src/orm/privateData.js'
import { __resetRootContextsForTests } from '../src/orm/rootContext.ts'

const PUBLIC_COLLECTION = 'signalSetReplaceDocs'

let docCounter = 0

function nextDocId () {
  docCounter += 1
  return `_set_replace_${docCounter}`
}

function createRoot (suffix) {
  return getRootSignal({ rootId: `set-replace-${suffix}` })
}

describe('Signal.setReplace()', () => {
  before(connect)

  afterEach(() => {
    delPublicData([PUBLIC_COLLECTION])
    __resetRootContextsForTests()
  })

  it('replaces private object values instead of deep-diffing them in place', async () => {
    const $root = createRoot('private-object')
    await $root._session.profile.set({ name: 'Ann', role: 'admin' })
    const previousProfile = $root._session.profile.peek()

    await $root._session.profile.setReplace({ name: 'Bob' })

    assert.deepEqual($root._session.profile.get(), { name: 'Bob' })
    assert.notEqual($root._session.profile.peek(), previousProfile)
  })

  it('preserves explicit private undefined values and sparse arrays', async () => {
    const rootId = 'set-replace-private-nullish'
    const $root = getRootSignal({ rootId })
    const sparseItems = []
    sparseItems[2] = 'Z'

    await $root._session.doc.setReplace({ flag: undefined })
    await $root._session.items.setReplace(sparseItems)

    const doc = getPrivateData(rootId, ['_session', 'doc'], true)
    const items = getPrivateData(rootId, ['_session', 'items'], true)
    assert.ok(Object.prototype.hasOwnProperty.call(doc, 'flag'))
    assert.equal(doc.flag, undefined)
    assert.equal(items.length, 3)
    assert.equal(0 in items, false)
    assert.equal(1 in items, false)
    assert.equal(2 in items, true)
    assert.equal(items[2], 'Z')
  })

  it('creates and replaces public documents while preserving the document id', async () => {
    const docId = nextDocId()
    const $root = createRoot('public-doc')
    const $doc = $root[PUBLIC_COLLECTION][docId]

    await $doc.setReplace({ _id: 'wrong-id', title: 'One', stale: true })
    assert.deepEqual($doc.get(), { _id: docId, title: 'One', stale: true })

    await $doc.setReplace({ title: 'Two' })
    assert.deepEqual($doc.get(), { _id: docId, title: 'Two' })
    assert.deepEqual(getRaw([PUBLIC_COLLECTION, docId]), { _id: docId, title: 'Two' })
  })

  it('replaces public object subpaths without keeping stale keys', async () => {
    const docId = nextDocId()
    const $doc = createRoot('public-subpath')[PUBLIC_COLLECTION][docId]
    await $doc.setReplace({
      profile: {
        name: 'Ann',
        role: 'admin'
      }
    })

    await $doc.profile.setReplace({ name: 'Bob' })

    assert.deepEqual($doc.profile.get(), { name: 'Bob' })
  })

  it('normalizes public undefined subpaths to null', async () => {
    const docId = nextDocId()
    const $doc = createRoot('public-undefined-subpath')[PUBLIC_COLLECTION][docId]
    await $doc.setReplace({ flag: true, items: ['A'] })

    await $doc.flag.setReplace(undefined)
    await $doc.items[0].setReplace(undefined)

    assert.equal($doc.flag.get(), null)
    assert.deepEqual($doc.items.get(), [null])
  })

  it('deletes a public document in replacing the whole document with undefined', async () => {
    const docId = nextDocId()
    const $doc = createRoot('public-undefined-doc')[PUBLIC_COLLECTION][docId]
    await $doc.setReplace({ title: 'One' })

    await $doc.setReplace(undefined)

    assert.equal($doc.get(), undefined)
    assert.equal(getRaw([PUBLIC_COLLECTION, docId]), undefined)
  })

  it('skips protected public id fields', async () => {
    const docId = nextDocId()
    const $doc = createRoot('public-id')[PUBLIC_COLLECTION][docId]
    await $doc.setReplace({ title: 'One' })

    await $doc._id.setReplace('wrong-id')

    assert.deepEqual($doc.get(), { _id: docId, title: 'One' })
  })

  it('rejects root writes and extra arguments', async () => {
    const $root = createRoot('errors')

    await assert.rejects(
      () => $root.setReplace({}),
      /Can't set the root signal data/
    )

    await assert.rejects(
      () => $root._session.value.setReplace('path', 1),
      /Signal\.setReplace\(\) expects a single argument/
    )
  })
})
