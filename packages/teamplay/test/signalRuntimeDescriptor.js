import { it, describe } from 'mocha'
import { strict as assert } from 'node:assert'
import { $, Signal, addModel } from '../src/index.ts'
import { getQuerySignal, HASH, QUERIES } from '../src/orm/Query.js'
import { SEGMENTS } from '../src/orm/Signal.ts'
import { getAggregationSignal } from '../src/orm/Aggregation.js'
import {
  SIGNAL_RUNTIME_DESCRIPTOR,
  describeSignalRuntime,
  getSignalRuntimeDescriptor
} from '../src/orm/signalRuntimeDescriptor.ts'

describe('signal runtime descriptors', () => {
  it('describes root, collection, document, and nested value signals', async () => {
    assert.deepEqual(getSignalRuntimeDescriptor($), {
      kind: 'root',
      segments: []
    })

    assert.deepEqual(getSignalRuntimeDescriptor($.games), {
      kind: 'collection',
      segments: ['games'],
      collectionName: 'games',
      itemPattern: ['games', '*']
    })

    assert.deepEqual(getSignalRuntimeDescriptor($.games._descriptorGame), {
      kind: 'document',
      segments: ['games', '_descriptorGame'],
      collectionName: 'games',
      documentId: '_descriptorGame'
    })

    try {
      await $._session.descriptor.tags.set(['board', 'turn'])
      assert.deepEqual(describeSignalRuntime($._session.descriptor.tags, {
        value: $._session.descriptor.tags.peek()
      }), {
        kind: 'nestedValue',
        segments: ['_session', 'descriptor', 'tags'],
        itemPattern: ['_session', 'descriptor', 'tags', '*']
      })
    } finally {
      await $._session.descriptor.del()
    }
  })

  it('describes local array signals', () => {
    const $numbers = $([1, 2, 3])

    assert.deepEqual(describeSignalRuntime($numbers, { value: $numbers.peek() }), {
      kind: 'localArray',
      segments: $numbers.path().split('.'),
      itemPattern: [...$numbers.path().split('.'), '*']
    })
  })

  it('stores explicit descriptors on query and aggregation signals', () => {
    const $query = getQuerySignal('games', { active: true })
    const queryDescriptor = getSignalRuntimeDescriptor($query)

    assert.equal($query[SIGNAL_RUNTIME_DESCRIPTOR], queryDescriptor)
    assert.deepEqual(queryDescriptor, {
      kind: 'query',
      segments: ['games'],
      collectionName: 'games',
      itemPattern: ['games', '*']
    })

    const $aggregation = getAggregationSignal('games', { $aggregate: [{ $match: { active: true } }] })
    const aggregationDescriptor = getSignalRuntimeDescriptor($aggregation)

    assert.equal($aggregation[SIGNAL_RUNTIME_DESCRIPTOR], aggregationDescriptor)
    assert.deepEqual(aggregationDescriptor, {
      kind: 'aggregation',
      segments: $aggregation.path().split('.'),
      collectionName: 'games',
      itemPattern: ['games', '*']
    })
  })

  it('keeps document ids distinct from special query fields and collection model methods', () => {
    class DescriptorCollisionCollection extends Signal {
      ids () {
        return `ids method on ${this.path()}`
      }

      extra () {
        return `extra method on ${this.path()}`
      }
    }

    addModel('descriptorCollisions', DescriptorCollisionCollection)

    assert.equal($.descriptorCollisions.ids.path(), 'descriptorCollisions.ids')
    assert.equal($.descriptorCollisions.extra.path(), 'descriptorCollisions.extra')
    assert.equal($.descriptorCollisions.ids(), 'ids method on descriptorCollisions')
    assert.equal($.descriptorCollisions.extra(), 'extra method on descriptorCollisions')

    const $query = getQuerySignal('descriptorCollisions', {})

    assert.deepEqual($query.ids[SEGMENTS], [QUERIES, $query[HASH], 'ids'])
    assert.deepEqual($query.extra[SEGMENTS], [QUERIES, $query[HASH], 'extra'])
  })
})
