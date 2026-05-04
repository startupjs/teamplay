import { strict as assert } from 'node:assert'
import { afterEach, describe, it } from 'mocha'
import { getRootSignal } from '../src/index.ts'
import { getAggregationSignal, AGGREGATIONS, IS_AGGREGATION } from '../src/orm/Aggregation.js'
import { del as delPublicData, set as setPublicData } from '../src/orm/dataTree.js'
import { HASH, IS_QUERY, QUERIES, getQuerySignal } from '../src/orm/Query.js'
import { delPrivateData, setPrivateData } from '../src/orm/privateData.js'
import { __resetRootContextsForTests } from '../src/orm/rootContext.ts'
import { SEGMENTS } from '../src/orm/Signal.ts'
import {
  getSignalIds,
  getSignalValue,
  readSignalValue
} from '../src/orm/signalReads.ts'

describe('signal read helpers', () => {
  afterEach(() => {
    delPublicData(['signalReadGames'])
    __resetRootContextsForTests()
  })

  it('routes root, query, private, and public reads through explicit read context', () => {
    const reads = []
    const warnings = []
    const { context, observedRead, rawRead } = structuralReadContext({ reads, warnings })

    assert.deepEqual(
      readSignalValue(structuralSignal([]), context, observedRead, rawRead),
      { root: 'observed' }
    )
    assert.deepEqual(reads.pop(), { type: 'root', rootId: 'structural-root', raw: false })

    const $query = structuralSignal(['games'], { query: true, hash: 'query-hash' })
    assert.deepEqual(readSignalValue($query, context, rawRead, rawRead), [{ id: 'raw-doc' }])
    assert.deepEqual(reads.pop(), {
      type: 'private',
      rootId: 'structural-root',
      segments: [QUERIES, 'query-hash', 'docs'],
      raw: true
    })

    assert.equal(readSignalValue(structuralSignal(['_session', 'flag']), context, observedRead, rawRead), true)
    assert.deepEqual(reads.pop(), {
      type: 'private',
      rootId: 'structural-root',
      segments: ['_session', 'flag'],
      raw: false
    })

    assert.equal(readSignalValue(structuralSignal(['games', 'game-1', 'title']), context, observedRead, rawRead), 'One')
    assert.deepEqual(reads.pop(), {
      type: 'public',
      segments: ['games', 'game-1', 'title']
    })

    assert.deepEqual(getSignalValue(structuralSignal([QUERIES, 'missing-hash', 'ids']), context, observedRead, rawRead), [])
    assert.deepEqual(warnings, [
      ['Signal.get() on Query didn\'t find ids', [QUERIES, 'missing-hash', 'ids']]
    ])
  })

  it('reads query ids, aggregation ids, and non-query fallback behavior', () => {
    const warnings = []
    const errors = []
    const { context } = structuralReadContext({ warnings, errors })

    const $query = structuralSignal(['games'], { query: true, hash: 'query-hash' })
    assert.deepEqual(getSignalIds($query, context), ['game-1'])

    const $missingQuery = structuralSignal(['games'], { query: true, hash: 'missing-hash' })
    assert.deepEqual(getSignalIds($missingQuery, context), [])
    assert.deepEqual(warnings, [
      ['Signal.getIds() on Query didn\'t find ids', [QUERIES, 'missing-hash', 'ids']]
    ])

    const $aggregation = structuralSignal([AGGREGATIONS, 'agg-hash'], { aggregation: true })
    assert.deepEqual(getSignalIds($aggregation, context), ['game-1', 'game-2'])

    assert.deepEqual(getSignalIds(structuralSignal(['games']), context), [])
    assert.equal(errors.length, 1)
    assert.match(errors[0], /Signal\.getIds\(\) can only be used on query signals or aggregation signals/)
    assert.match(errors[0], /\["games"\]/)
  })

  it('preserves runtime read behavior across root snapshots, query docs, private storage, and aggregation ids', () => {
    const rootId = 'signal-read-runtime-root'
    const $root = getRootSignal({ rootId })

    setPublicData(['signalReadGames', 'game-1'], { title: 'One' })
    setPrivateData(rootId, ['_session', 'selectedGameId'], 'game-1')

    const snapshot = $root.get()
    const rawSnapshot = $root.peek()
    assert.equal(snapshot.signalReadGames['game-1'].title, 'One')
    assert.equal(rawSnapshot.signalReadGames['game-1'].title, 'One')
    assert.equal(snapshot._session.selectedGameId, 'game-1')
    assert.equal(rawSnapshot._session.selectedGameId, 'game-1')
    assert.equal($root.signalReadGames['game-1'].title.get(), 'One')
    assert.equal($root._session.selectedGameId.peek(), 'game-1')

    const $query = getQuerySignal('signalReadGames', { active: true }, { root: $root })
    setPrivateData(rootId, [QUERIES, $query[HASH], 'docs'], [{ _id: 'game-1', title: 'One' }])
    setPrivateData(rootId, [QUERIES, $query[HASH], 'ids'], ['game-1'])
    assert.deepEqual($query.get(), [{ _id: 'game-1', title: 'One' }])
    assert.deepEqual($query.getIds(), ['game-1'])
    assert.deepEqual($query.ids.get(), ['game-1'])

    const $aggregation = getAggregationSignal('signalReadGames', { $aggregate: [] }, { root: $root })
    setPrivateData(rootId, $aggregation[SEGMENTS], [{ _id: 'game-1' }, { id: 'game-2' }])
    assert.deepEqual($aggregation.getIds(), ['game-1', 'game-2'])

    const errors = captureConsoleErrors(() => {
      assert.deepEqual($root.signalReadGames.getIds(), [])
    })
    assert.equal(errors.length, 1)
    assert.match(errors[0][0], /Signal\.getIds\(\) can only be used on query signals or aggregation signals/)

    delPrivateData(rootId, ['_session'])
    delPrivateData(rootId, [QUERIES])
    delPrivateData(rootId, [AGGREGATIONS])
  })
})

function structuralReadContext ({
  reads = [],
  warnings = [],
  errors = []
} = {}) {
  const values = new Map([
    [pathKey([QUERIES, 'query-hash', 'docs'], true), [{ id: 'raw-doc' }]],
    [pathKey([QUERIES, 'query-hash', 'ids'], false), ['game-1']],
    [pathKey(['_session', 'flag'], false), true],
    [pathKey([AGGREGATIONS, 'agg-hash'], false), [{ _id: 'game-1' }, { id: 'game-2' }]]
  ])

  const observedRead = segments => {
    if (pathKey(segments, false) === pathKey(['games', 'game-1', 'title'], false)) return 'One'
  }
  const rawRead = segments => {
    if (pathKey(segments, true) === pathKey(['games', 'game-1', 'title'], true)) return 'Raw One'
  }

  return {
    observedRead,
    rawRead,
    context: {
      getOwningRootId: () => 'structural-root',
      getStorageSegments: $signal => $signal[SEGMENTS],
      isPrivateSegments: segments => /^[_$]/.test(String(segments[0])),
      readLogicalRootSnapshot (rootId, raw) {
        reads.push({ type: 'root', rootId, raw })
        return raw ? { root: 'raw' } : { root: 'observed' }
      },
      readPrivateData (rootId, segments, raw) {
        reads.push({ type: 'private', rootId, segments: [...segments], raw })
        return values.get(pathKey(segments, raw))
      },
      readPublicData (segments, method) {
        reads.push({ type: 'public', segments: [...segments] })
        return method(segments)
      },
      warn (message, ...args) {
        warnings.push([message, ...args])
      },
      error (message) {
        errors.push(message)
      }
    }
  }
}

function structuralSignal (segments, {
  query = false,
  aggregation = false,
  hash
} = {}) {
  const $signal = { [SEGMENTS]: segments }
  if (query) $signal[IS_QUERY] = true
  if (aggregation) $signal[IS_AGGREGATION] = true
  if (hash) $signal[HASH] = hash
  return $signal
}

function captureConsoleErrors (fn) {
  const originalError = console.error
  const errors = []
  console.error = (...args) => {
    errors.push(args)
  }
  try {
    fn()
  } finally {
    console.error = originalError
  }
  return errors
}

function pathKey (segments, raw) {
  return JSON.stringify({ segments, raw })
}
