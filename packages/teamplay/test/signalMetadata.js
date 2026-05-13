import { strict as assert } from 'node:assert'
import { observe, unobserve } from '@nx-js/observer-util'
import { describe, it } from 'mocha'
import { addModel, getRootSignal, Signal } from '../src/index.ts'
import { getAggregationSignal } from '../src/orm/Aggregation.js'
import { set as setPublicData } from '../src/orm/dataTree.js'
import { setPrivateData } from '../src/orm/privateData.js'
import { SEGMENTS } from '../src/orm/Signal.ts'
import {
  getSignalCollection,
  getSignalId,
  getSignalLeaf,
  getSignalParentSegments,
  getSignalPath
} from '../src/orm/signalMetadata.ts'

describe('signal metadata helpers', () => {
  it('reads path and leaf metadata from signal segments', () => {
    const $signal = metadataSignal(['games', 'game-1', 'rounds', 0])

    assert.equal(getSignalPath($signal), 'games.game-1.rounds.0')
    assert.equal(getSignalLeaf($signal), '0')
    assert.equal(getSignalPath(metadataSignal([])), '')
    assert.equal(getSignalLeaf(metadataSignal([])), '')
  })

  it('calculates parent segments and validates levels', () => {
    const $signal = metadataSignal(['games', 'game-1', 'rounds', 0])

    assert.deepEqual(getSignalParentSegments($signal, 1, 0), ['games', 'game-1', 'rounds'])
    assert.deepEqual(getSignalParentSegments($signal, 2, 1), ['games', 'game-1'])
    assert.deepEqual(getSignalParentSegments($signal, 10, 1), [])
    assert.throws(() => getSignalParentSegments($signal, 1, 2), /expects a single argument/)
    assert.throws(() => getSignalParentSegments($signal, 1.5, 1), /expects an integer argument/)
    assert.throws(() => getSignalParentSegments($signal, 0, 1), /expects a positive integer/)
  })

  it('returns ids and collection names from structural metadata', () => {
    assert.equal(getSignalId(metadataSignal(['games', 'game-1'])), 'game-1')
    assert.equal(
      getSignalId(metadataSignal(['games', 'game-1']), undefined, path => (
        path[path.length - 1] === '_id' ? 'wrong-doc-id' : undefined
      )),
      'game-1'
    )
    assert.equal(getSignalId(metadataSignal(['games', 'game-1', 'title'])), 'title')
    assert.equal(
      getSignalId(metadataSignal(['games', 'game-1', 'players', 'path-player']), undefined, path => (
        path[path.length - 1] === '_id' ? 'doc-player' : undefined
      )),
      'doc-player'
    )
    assert.equal(
      getSignalId(metadataSignal(['games', 'game-1', 'players', 'path-player']), undefined, path => {
        const leaf = path[path.length - 1]
        if (leaf === '_id') return 123
        if (leaf === 'id') return 'doc-player'
      }),
      'doc-player'
    )
    assert.equal(
      getSignalId(metadataSignal(['games', 'game-1', 'players', 'path-player']), undefined, path => (
        path[path.length - 1] === '_id' ? 123 : undefined
      )),
      undefined
    )
    assert.equal(getSignalId(metadataSignal(['games', 'game-1', 'players', 0])), undefined)
    assert.equal(getSignalCollection(metadataSignal(['games', 'game-1'])), 'games')
    assert.equal(getSignalCollection(metadataSignal(['_virtualFields', 'field-1'], 'fields')), 'fields')
    assert.throws(() => getSignalId(metadataSignal([])), /Can't get the id of the root signal/)
    assert.throws(() => getSignalId(metadataSignal(['games'])), /Can't get the id of a collection/)
    assert.throws(() => getSignalCollection(metadataSignal([])), /Can't get the collection of the root signal/)
  })

  it('preserves public metadata method behavior on real signals', () => {
    class MetadataModel extends Signal {
      static collection = 'metadataDocs'
      static associations = [{ type: 'metadata' }]
    }

    addModel('_metadataVirtual.*', MetadataModel)

    const $root = getRootSignal({ rootId: 'signal-metadata-root' })
    const $field = $root._metadataVirtual.field1.title

    assert.equal($field.path(), '_metadataVirtual.field1.title')
    assert.equal($field.leaf(), 'title')
    assert.equal(String($field), '_metadataVirtual.field1.title')
    assert.equal(`${$field}`, '_metadataVirtual.field1.title')
    assert.equal($field.name + '() {}', '_metadataVirtual.field1.title.name() {}')
    assert.equal($field[Symbol.toPrimitive], $field[Symbol.toPrimitive])
    assert.equal($field.toString(), '[Signal _metadataVirtual.field1.title]')
    assert.equal(Object.prototype.toString.call($field), '[object Signal]')
    assert.equal($root.toString(), '[Signal <root>]')
    assert.equal($field.parent().path(), '_metadataVirtual.field1')
    assert.equal($field.parent(2).path(), '_metadataVirtual')
    assert.equal($field.parent(10), $root)
    assert.equal($root._metadataVirtual.field1.getId(), 'field1')
    assert.equal($root._metadataVirtual.field1.getCollection(), 'metadataDocs')
    assert.deepEqual($root._metadataVirtual.field1.getAssociations(), [{ type: 'metadata' }])
  })

  it('returns the owning root through root() without reserving root as a property', () => {
    const $root = getRootSignal({ rootId: 'signal-metadata-root-method' })
    const $field = $root._metadataVirtual.field1.title

    assert.equal($root.root(), $root)
    assert.equal($field.root(), $root)
    assert.equal($field.root.path(), '_metadataVirtual.field1.title.root')
    assert.notEqual($field.root, $root)
    assert.throws(() => $field.root('nested'), /Signal.root\(\) does not accept any arguments/)
  })

  it('keeps aggregation row metadata routed to the source collection', () => {
    const rootId = 'signal-metadata-aggregation-root'
    const $root = getRootSignal({ rootId })
    const $aggregation = getAggregationSignal('metadataAggDocs', { $aggregate: [] }, { root: $root })
    setPrivateData(rootId, [...$aggregation[SEGMENTS], 0], { _id: 'agg-doc-1' })
    setPrivateData(rootId, [...$aggregation[SEGMENTS], 1], { _id: 123, id: 'agg-doc-2' })
    setPrivateData(rootId, [...$aggregation[SEGMENTS], 2], { _id: 123 })

    assert.equal($aggregation[0].getId(), 'agg-doc-1')
    assert.equal($aggregation[1].getId(), 'agg-doc-2')
    assert.equal($aggregation[2].getId(), undefined)
    assert.equal($aggregation[0].getCollection(), 'metadataAggDocs')
  })

  it('uses the path leaf for direct public document ids without observing id fields', () => {
    const $root = getRootSignal({ rootId: 'signal-metadata-public-id-observable-root' })
    setPublicData(['metadataPublicDocs', 'doc-1'], { _id: 'wrong-doc-id', name: 'Doc 1' })

    const updates = []
    const reaction = observe(
      () => $root.metadataPublicDocs['doc-1'].getId(),
      { lazy: true, scheduler: job => updates.push(job()) }
    )

    assert.equal(reaction(), 'doc-1')
    setPublicData(['metadataPublicDocs', 'doc-1', '_id'], 'another-wrong-doc-id')
    unobserve(reaction)

    assert.deepEqual(updates, [])
  })

  it('observes id fields on private document metadata reads', () => {
    const rootId = 'signal-metadata-doc-id-observable-root'
    const $root = getRootSignal({ rootId })
    setPrivateData(rootId, ['_metadataVirtual', 'field1'], { _id: 'doc-1' })

    const updates = []
    const reaction = observe(
      () => $root._metadataVirtual.field1.getId(),
      { lazy: true, scheduler: job => updates.push(job()) }
    )

    assert.equal(reaction(), 'doc-1')
    setPrivateData(rootId, ['_metadataVirtual', 'field1', '_id'], 'doc-2')
    unobserve(reaction)

    assert.deepEqual(updates, ['doc-2'])
  })

  it('keeps path-leaf fallback stable for unrelated nested document changes', () => {
    const rootId = 'signal-metadata-doc-leaf-observable-root'
    const $root = getRootSignal({ rootId })
    setPrivateData(rootId, ['_session', 'currentOrg'], { name: 'Org 1' })

    const updates = []
    const reaction = observe(
      () => $root._session.currentOrg.getId(),
      { lazy: true, scheduler: job => updates.push(job()) }
    )

    assert.equal(reaction(), 'currentOrg')
    setPrivateData(rootId, ['_session', 'currentOrg', 'name'], 'Org 2')
    unobserve(reaction)

    assert.deepEqual(updates, [])
  })

  it('observes private nested id fields when duplicated session data changes identity', () => {
    const rootId = 'signal-metadata-private-id-observable-root'
    const $root = getRootSignal({ rootId })
    setPrivateData(rootId, ['_session', 'currentOrg'], { id: 'org-1', name: 'Org 1' })

    const updates = []
    const reaction = observe(
      () => $root._session.currentOrg.getId(),
      { lazy: true, scheduler: job => updates.push(job()) }
    )

    assert.equal(reaction(), 'org-1')
    setPrivateData(rootId, ['_session', 'currentOrg'], { id: 'org-2', name: 'Org 2' })
    unobserve(reaction)

    assert.deepEqual(updates, ['org-2'])
  })

  it('preserves observed id field reads on aggregation row metadata', () => {
    const rootId = 'signal-metadata-aggregation-id-observable-root'
    const $root = getRootSignal({ rootId })
    const $aggregation = getAggregationSignal('metadataAggDocs', { $aggregate: [] }, { root: $root })
    setPrivateData(rootId, [...$aggregation[SEGMENTS], 0], { _id: 'agg-doc-1' })

    const updates = []
    const reaction = observe(
      () => $aggregation[0].getId(),
      { lazy: true, scheduler: job => updates.push(job()) }
    )

    assert.equal(reaction(), 'agg-doc-1')
    setPrivateData(rootId, [...$aggregation[SEGMENTS], 0, '_id'], 'agg-doc-2')
    unobserve(reaction)

    assert.deepEqual(updates, ['agg-doc-2'])
  })

  it('observes nested document id fields inside aggregation rows', () => {
    const rootId = 'signal-metadata-nested-aggregation-id-observable-root'
    const $root = getRootSignal({ rootId })
    const $aggregation = getAggregationSignal('metadataAggDocs', { $aggregate: [] }, { root: $root })
    setPrivateData(rootId, [...$aggregation[SEGMENTS], 0], {
      _id: 'agg-doc-1',
      players: [{ _id: 'player-1' }]
    })

    const updates = []
    const reaction = observe(
      () => $aggregation[0].players[0].getId(),
      { lazy: true, scheduler: job => updates.push(job()) }
    )

    assert.equal(reaction(), 'player-1')
    setPrivateData(rootId, [...$aggregation[SEGMENTS], 0, 'players', 0, '_id'], 'player-2')
    unobserve(reaction)

    assert.deepEqual(updates, ['player-2'])
  })
})

function metadataSignal (segments, collection) {
  return {
    [SEGMENTS]: segments,
    constructor: { collection }
  }
}
