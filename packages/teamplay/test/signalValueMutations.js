import { strict as assert } from 'node:assert'
import { afterEach, describe, it } from 'mocha'
import { getRootSignal } from '../src/index.ts'
import { del as delPublicData, get as getPublicData } from '../src/orm/dataTree.js'
import { delPrivateData, getPrivateData } from '../src/orm/privateData.js'
import { __resetRootContextsForTests } from '../src/orm/rootContext.ts'
import { SEGMENTS } from '../src/orm/Signal.ts'
import {
  deleteSignalValue,
  setSignalValue
} from '../src/orm/signalValueMutations.ts'

describe('signal value mutation helpers', () => {
  afterEach(() => {
    delPublicData(['mutationDocs'])
    delPublicData(['signalValueMutationDocs'])
    __resetRootContextsForTests()
  })

  it('routes public set/delete writes and normalizes protected id fields', async () => {
    const calls = []
    const context = structuralMutationContext({ calls })

    await setSignalValue(mutationSignal(['mutationDocs', 'doc-1']), context, {
      _id: 'wrong',
      title: 'One'
    })
    assert.deepEqual(calls, [
      {
        type: 'setPublicDoc',
        segments: ['mutationDocs', 'doc-1'],
        value: { _id: 'doc-1', title: 'One' }
      }
    ])

    await deleteSignalValue(mutationSignal(['mutationDocs', 'doc-1', 'title']), context)
    assert.deepEqual(calls[1], {
      type: 'deletePublicDoc',
      segments: ['mutationDocs', 'doc-1', 'title']
    })
  })

  it('skips direct id-field mutations', async () => {
    const calls = []
    const context = structuralMutationContext({ calls })

    await setSignalValue(mutationSignal(['mutationDocs', 'doc-1', '_id']), context, 'wrong')
    await deleteSignalValue(mutationSignal(['mutationDocs', 'doc-1', '_id']), context)

    assert.deepEqual(calls, [])
  })

  it('routes private set/delete writes through the owning root', async () => {
    const calls = []
    const context = structuralMutationContext({ calls, rootId: 'mutation-root' })

    await setSignalValue(mutationSignal(['_session', 'flag']), context, true)
    await deleteSignalValue(mutationSignal(['_session', 'flag']), context)

    assert.deepEqual(calls, [
      {
        type: 'setPrivateData',
        rootId: 'mutation-root',
        segments: ['_session', 'flag'],
        value: true
      },
      {
        type: 'deletePrivateData',
        rootId: 'mutation-root',
        segments: ['_session', 'flag']
      }
    ])
  })

  it('protects root, whole public collections, and publicOnly private writes', async () => {
    const forbiddenContext = structuralMutationContext({ privateMutationForbidden: true })

    await assert.rejects(
      () => setSignalValue(mutationSignal([]), forbiddenContext, true),
      /Can't set the root signal data/
    )
    await assert.rejects(
      () => deleteSignalValue(mutationSignal([]), forbiddenContext),
      /Can't delete the root signal data/
    )
    await assert.rejects(
      () => deleteSignalValue(mutationSignal(['mutationDocs']), forbiddenContext),
      /Can't delete the whole collection/
    )
    await assert.rejects(
      () => setSignalValue(mutationSignal(['_session', 'flag']), forbiddenContext, true),
      /Can't modify private collections data when 'publicOnly' is enabled/
    )
    await assert.rejects(
      () => deleteSignalValue(mutationSignal(['_session', 'flag']), forbiddenContext),
      /Can't modify private collections data when 'publicOnly' is enabled/
    )
  })

  it('preserves runtime set/delete behavior for private data and id-field no-ops', async () => {
    const rootId = 'signal-value-mutation-runtime-root'
    const $root = getRootSignal({ rootId })

    await $root._session.flag.set(true)
    assert.equal(getPrivateData(rootId, ['_session', 'flag'], true), true)
    await $root._session.flag.del()
    assert.equal(getPrivateData(rootId, ['_session', 'flag'], true), undefined)

    await $root.signalValueMutationDocs['doc-1'].set({ _id: 'doc-1', title: 'One' })
    await $root.signalValueMutationDocs['doc-1']._id.set('wrong')
    assert.equal(getPublicData(['signalValueMutationDocs', 'doc-1', '_id']), 'doc-1')

    await $root.signalValueMutationDocs['doc-1']._id.del()
    assert.equal(getPublicData(['signalValueMutationDocs', 'doc-1', '_id']), 'doc-1')

    delPrivateData(rootId, ['_session'])
  })
})

function structuralMutationContext ({
  calls = [],
  rootId = 'structural-mutation-root',
  privateMutationForbidden = false
} = {}) {
  return {
    getOwningRootId: () => rootId,
    isPublicCollection: segment => typeof segment === 'string' && segment[0] !== '_' && segment[0] !== '$',
    isPrivateMutationForbidden: () => privateMutationForbidden,
    setPublicDoc (segments, value) {
      calls.push({ type: 'setPublicDoc', segments: [...segments], value })
    },
    setPrivateData (rootId, segments, value) {
      calls.push({ type: 'setPrivateData', rootId, segments: [...segments], value })
    },
    deletePublicDoc (segments) {
      calls.push({ type: 'deletePublicDoc', segments: [...segments] })
    },
    deletePrivateData (rootId, segments) {
      calls.push({ type: 'deletePrivateData', rootId, segments: [...segments] })
    }
  }
}

function mutationSignal (segments) {
  return { [SEGMENTS]: segments }
}
