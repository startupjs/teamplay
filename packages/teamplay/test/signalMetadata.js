import { strict as assert } from 'node:assert'
import { describe, it } from 'mocha'
import { addModel, getRootSignal, Signal } from '../src/index.ts'
import { getAggregationSignal } from '../src/orm/Aggregation.js'
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
    assert.equal(getSignalId(metadataSignal(['games', 'game-1', 'title'])), 'title')
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

  it('keeps aggregation row metadata routed to the source collection', () => {
    const rootId = 'signal-metadata-aggregation-root'
    const $root = getRootSignal({ rootId })
    const $aggregation = getAggregationSignal('metadataAggDocs', { $aggregate: [] }, { root: $root })
    setPrivateData(rootId, [...$aggregation[SEGMENTS], 0], { _id: 'agg-doc-1' })

    assert.equal($aggregation[0].getId(), 'agg-doc-1')
    assert.equal($aggregation[0].getCollection(), 'metadataAggDocs')
  })
})

function metadataSignal (segments, collection) {
  return {
    [SEGMENTS]: segments,
    constructor: { collection }
  }
}
