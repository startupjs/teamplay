import { strict as assert } from 'node:assert'
import { afterEach, describe, it } from 'mocha'
import { getRootSignal } from '../src/index.ts'
import { HASH, IS_QUERY, QUERIES, getQuerySignal } from '../src/orm/Query.js'
import { delPrivateData, setPrivateData } from '../src/orm/privateData.js'
import { SEGMENTS } from '../src/orm/Signal.ts'
import {
  getSignalArrayChildren,
  iterateSignalArrayChildren,
  runSignalArrayMethod
} from '../src/orm/signalArrayReaders.ts'

describe('signal array reader helpers', () => {
  const cleanupRootIds = []

  afterEach(() => {
    for (const rootId of cleanupRootIds.splice(0)) {
      delPrivateData(rootId, ['_session'])
      delPrivateData(rootId, [QUERIES])
    }
  })

  it('maps query ids to document child signals', () => {
    const $query = structuralSignal(['games'], { query: true, hash: 'query-hash' })
    const { context, root } = structuralContext({ queryIds: ['game-1', 'game-2'] })

    const children = getSignalArrayChildren($query, context)

    assert.deepEqual(children.map($child => $child[SEGMENTS]), [
      ['games', 'game-1'],
      ['games', 'game-2']
    ])
    assert.ok(children.every($child => $child.rootArg === root))
  })

  it('maps array indexes to item child signals and array method callbacks', () => {
    const $items = structuralSignal(['_session', 'items'])
    const { context } = structuralContext({ arrayValue: ['a', 'b'] })

    assert.deepEqual([...iterateSignalArrayChildren($items, context)].map($item => $item[SEGMENTS]), [
      ['_session', 'items', 0],
      ['_session', 'items', 1]
    ])

    const paths = runSignalArrayMethod($items, context, 'map', [], [
      ($item, index) => `${$item[SEGMENTS].join('.')}:${index}`
    ])

    assert.deepEqual(paths, ['_session.items.0:0', '_session.items.1:1'])
  })

  it('warns and returns the fallback value when query ids are missing', () => {
    const warnings = []
    const $query = structuralSignal(['games'], { query: true, hash: 'query-hash' })
    const { context } = structuralContext({ queryIds: undefined, warnings })

    const result = runSignalArrayMethod($query, context, 'find', undefined, [], {
      message: 'Signal array method on Query didn\'t find ids',
      method: 'find'
    })

    assert.equal(result, undefined)
    assert.deepEqual(warnings, [
      ['Signal array method on Query didn\'t find ids', [QUERIES, 'query-hash', 'ids'], 'find']
    ])
  })

  it('preserves runtime reader behavior for private arrays and query signals', () => {
    const rootId = 'signal-array-readers-runtime-root'
    cleanupRootIds.push(rootId)
    const $root = getRootSignal({ rootId })

    setPrivateData(rootId, ['_session', 'players'], [
      { name: 'A' },
      { name: 'B' }
    ])
    const $players = $root._session.players

    assert.deepEqual([...$players].map($player => $player.path()), [
      '_session.players.0',
      '_session.players.1'
    ])
    assert.deepEqual($players.map($player => $player.name.get()), ['A', 'B'])
    assert.equal($players.find($player => $player.name.get() === 'B').path(), '_session.players.1')
    assert.equal($players.reduce((count) => count + 1, 0), 2)

    const $query = getQuerySignal('arrayReaderGames', { active: true }, { root: $root })
    setPrivateData(rootId, [QUERIES, $query[HASH], 'ids'], ['game-1', 'game-2'])

    assert.deepEqual([...$query].map($game => $game.path()), [
      'arrayReaderGames.game-1',
      'arrayReaderGames.game-2'
    ])
    assert.deepEqual($query.map($game => $game.getId()), ['game-1', 'game-2'])
    assert.equal($query.find($game => $game.getId() === 'game-2').path(), 'arrayReaderGames.game-2')
    assert.equal($query.reduce((count) => count + 1, 0), 2)
  })
})

function structuralContext ({
  queryIds,
  arrayValue,
  warnings = []
} = {}) {
  const root = structuralSignal([])
  return {
    root,
    context: {
      getRoot: () => root,
      readQueryIds: () => queryIds,
      readArrayValue: () => arrayValue,
      createSignal ($root, segments) {
        return {
          ...structuralSignal(segments),
          rootArg: $root
        }
      },
      warn (message, ...args) {
        warnings.push([message, ...args])
      }
    }
  }
}

function structuralSignal (segments, {
  query = false,
  hash
} = {}) {
  const $signal = { [SEGMENTS]: segments }
  if (query) $signal[IS_QUERY] = true
  if (hash) $signal[HASH] = hash
  return $signal
}
