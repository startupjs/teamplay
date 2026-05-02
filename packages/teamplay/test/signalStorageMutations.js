import { strict as assert } from 'node:assert'
import { describe, it } from 'mocha'
import { SEGMENTS } from '../orm/Signal.ts'
import { runSignalStorageMutation } from '../orm/signalStorageMutations.ts'

describe('signal storage mutation helpers', () => {
  it('skips protected public id-field paths before running handlers', async () => {
    const calls = []
    const result = await runSignalStorageMutation(
      mutationSignal(['storageMutationDocs', 'doc-1', '_id']),
      structuralStorageContext({ calls }),
      ['storageMutationDocs', 'doc-1', '_id'],
      storageHandlers(calls)
    )

    assert.deepEqual(result, { skipped: true, value: undefined })
    assert.deepEqual(calls, [])
  })

  it('routes public mutations to public handlers', async () => {
    const calls = []
    const result = await runSignalStorageMutation(
      mutationSignal(['storageMutationDocs', 'doc-1', 'tags']),
      structuralStorageContext({ calls }),
      ['storageMutationDocs', 'doc-1', 'tags'],
      storageHandlers(calls)
    )

    assert.deepEqual(result, { skipped: false, value: 'public-result' })
    assert.deepEqual(calls, [
      { type: 'public', segments: ['storageMutationDocs', 'doc-1', 'tags'] }
    ])
  })

  it('routes private mutations through the owning root', async () => {
    const calls = []
    const result = await runSignalStorageMutation(
      mutationSignal(['_session', 'tags']),
      structuralStorageContext({ calls, rootId: 'storage-root' }),
      ['_session', 'tags'],
      storageHandlers(calls)
    )

    assert.deepEqual(result, { skipped: false, value: 'private-result' })
    assert.deepEqual(calls, [
      { type: 'private', rootId: 'storage-root', segments: ['_session', 'tags'] }
    ])
  })

  it('rejects private mutations when publicOnly is active', async () => {
    await assert.rejects(
      () => runSignalStorageMutation(
        mutationSignal(['_session', 'tags']),
        structuralStorageContext({ privateMutationForbidden: true }),
        ['_session', 'tags'],
        storageHandlers([])
      ),
      /Can't modify private collections data when 'publicOnly' is enabled/
    )
  })
})

function structuralStorageContext ({
  rootId = 'storage-mutation-root',
  privateMutationForbidden = false
} = {}) {
  return {
    getOwningRootId: () => rootId,
    isPublicCollection: segment => typeof segment === 'string' && segment[0] !== '_' && segment[0] !== '$',
    isPrivateMutationForbidden: () => privateMutationForbidden
  }
}

function storageHandlers (calls) {
  return {
    public (segments) {
      calls.push({ type: 'public', segments: [...segments] })
      return 'public-result'
    },
    private (rootId, segments) {
      calls.push({ type: 'private', rootId, segments: [...segments] })
      return 'private-result'
    }
  }
}

function mutationSignal (segments) {
  return { [SEGMENTS]: segments }
}
