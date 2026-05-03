import { strict as assert } from 'node:assert'
import { describe, it } from 'mocha'
import { getRootSignal, ROOT_ID } from '../orm/Root.ts'
import { IS_QUERY } from '../orm/Query.js'
import { SEGMENTS } from '../orm/Signal.ts'
import {
  ensureArraySignalTarget,
  ensureValueSignalTarget,
  getSignalOwningRootId,
  getSignalSegments,
  getSignalStorageSegments,
  isPrivateSignalSegments
} from '../orm/signalRuntimeAccess.ts'

describe('signal runtime access helpers', () => {
  it('reads signal segments and storage overrides through the shared symbol', () => {
    const segments = ['games', 'game-1', 'tags']
    const override = ['games', 'game-2', 'tags']
    const $signal = { [SEGMENTS]: segments }

    assert.equal(getSignalSegments($signal), segments)
    assert.equal(getSignalStorageSegments($signal), segments)
    assert.equal(getSignalStorageSegments($signal, override), override)
  })

  it('resolves owning root ids from roots and child signals', () => {
    const $root = getRootSignal({ rootId: 'runtime-access-root' })

    assert.equal(getSignalOwningRootId($root), 'runtime-access-root')
    assert.equal(getSignalOwningRootId($root._session.userId), 'runtime-access-root')
    assert.equal(getSignalOwningRootId({ [SEGMENTS]: [], [ROOT_ID]: 'direct-root' }), 'direct-root')
  })

  it('keeps private path detection centralized', () => {
    assert.equal(isPrivateSignalSegments(['_session', 'userId']), true)
    assert.equal(isPrivateSignalSegments(['$queries', 'hash', 'ids']), true)
    assert.equal(isPrivateSignalSegments(['games', 'game-1']), false)
    assert.equal(isPrivateSignalSegments([]), false)
  })

  it('wraps mutation target checks with signal query state', () => {
    const $array = { [SEGMENTS]: ['games', 'game-1', 'tags'] }
    const $value = { [SEGMENTS]: ['games', 'game-1', 'title'] }
    const $query = { [SEGMENTS]: ['games', 'game-1', 'tags'], [IS_QUERY]: true }

    assert.equal(ensureArraySignalTarget($array), $array[SEGMENTS])
    assert.equal(ensureValueSignalTarget($value), $value[SEGMENTS])
    assert.throws(
      () => ensureArraySignalTarget({ [SEGMENTS]: ['games'] }),
      /Can't mutate array on a collection or root signal/
    )
    assert.throws(
      () => ensureValueSignalTarget({ [SEGMENTS]: [] }),
      /Can't mutate on a collection or root signal/
    )
    assert.throws(
      () => ensureArraySignalTarget($query),
      /Array mutators can't be used on a query signal/
    )
  })
})
