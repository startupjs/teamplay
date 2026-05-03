import { strict as assert } from 'node:assert'

const TRANSPORT_MODES = new Set(['idle', 'fetch', 'subscribe'])
const TRANSPORT_PHASES = new Set(['stable', 'transition'])

function assertSetEqual (actual, expected, message) {
  const actualValues = actual ? Array.from(actual).sort() : []
  const expectedValues = expected ? Array.from(expected).sort() : []
  assert.deepEqual(actualValues, expectedValues, message)
}

export function assertQuerySubscriptionsConsistent (manager) {
  let pendingDestroyCount = 0
  const trackedOwnerKeys = new Set(manager.ownerRecords.keys())

  for (const [ownerKey, record] of manager.ownerRecords.entries()) {
    assert.ok(record.transportHash, `query owner ${ownerKey} must have transportHash`)
    const entry = manager.entries.get(record.transportHash)
    assert.ok(entry, `query owner ${ownerKey} must point to an existing entry`)
    assert.ok(entry.owners.has(ownerKey), `query entry ${record.transportHash} must include owner ${ownerKey}`)

    const total = record.fetchCount + record.subscribeCount
    assert.equal(manager.subCount.get(ownerKey), total, `query subCount for owner ${ownerKey} must match canonical count`)
    assert.equal(manager.ownerToTransport.get(ownerKey), record.transportHash, `query ownerToTransport for ${ownerKey} must match canonical transportHash`)
    assert.deepEqual(
      manager.ownerMeta.get(ownerKey),
      {
        collectionName: record.collectionName,
        params: record.params,
        transportHash: record.transportHash,
        rootId: record.rootId
      },
      `query ownerMeta for ${ownerKey} must match canonical record`
    )
    assert.equal(
      manager.ownerFetchCount.get(ownerKey),
      record.fetchCount > 0 ? record.fetchCount : undefined,
      `query ownerFetchCount for ${ownerKey} must match canonical record`
    )
    assert.equal(
      manager.ownerSubscribeCount.get(ownerKey),
      record.subscribeCount > 0 ? record.subscribeCount : undefined,
      `query ownerSubscribeCount for ${ownerKey} must match canonical record`
    )
  }

  for (const [transportHash, entry] of manager.entries.entries()) {
    assert.ok(TRANSPORT_MODES.has(entry.mode), `query entry ${transportHash} has invalid mode ${entry.mode}`)
    assert.ok(TRANSPORT_MODES.has(entry.targetMode), `query entry ${transportHash} has invalid targetMode ${entry.targetMode}`)
    assert.ok(TRANSPORT_PHASES.has(entry.phase), `query entry ${transportHash} has invalid phase ${entry.phase}`)

    assert.equal(
      manager.queries.get(transportHash),
      entry.runtime || undefined,
      `query runtime view for ${transportHash} must match canonical entry`
    )
    assert.equal(
      manager.transportSubCount.get(transportHash),
      entry.owners.size > 0 || entry.runtime ? entry.owners.size : undefined,
      `query transportSubCount for ${transportHash} must match canonical owners`
    )
    assertSetEqual(
      manager.ownerKeysByTransport.get(transportHash),
      entry.owners.size > 0 ? entry.owners : undefined,
      `query ownerKeysByTransport for ${transportHash} must match canonical owners`
    )

    for (const ownerKey of entry.owners) {
      const record = manager.ownerRecords.get(ownerKey)
      assert.ok(record, `query entry ${transportHash} has missing owner record ${ownerKey}`)
      assert.equal(record.transportHash, transportHash, `query owner ${ownerKey} must point back to transport ${transportHash}`)
    }

    for (const [ownerKey, pendingDestroy] of entry.pendingDestroyByOwner.entries()) {
      pendingDestroyCount += 1
      trackedOwnerKeys.add(ownerKey)
      assert.equal(
        manager.pendingDestroyTimers.get(ownerKey),
        pendingDestroy,
        `query pendingDestroy view for owner ${ownerKey} must match canonical entry`
      )
    }

    if (
      entry.phase === 'stable' &&
      !entry.runtime &&
      entry.owners.size === 0 &&
      entry.pendingDestroyByOwner.size === 0
    ) {
      assert.fail(`query entry ${transportHash} is empty and should have been pruned`)
    }
  }

  assert.equal(manager.pendingDestroyTimers.size, pendingDestroyCount, 'query pendingDestroy view size must match canonical entries')
  assert.equal(manager.subCount.size, trackedOwnerKeys.size, 'query tracked owner count size must match canonical owner + pending destroy keys')

  for (const ownerKey of trackedOwnerKeys) {
    const record = manager.ownerRecords.get(ownerKey)
    const expectedCount = record ? record.fetchCount + record.subscribeCount : 0
    assert.equal(manager.subCount.get(ownerKey), expectedCount, `query tracked count for ${ownerKey} must match canonical state`)
  }
}

export function assertDocSubscriptionsConsistent (manager) {
  let pendingDestroyCount = 0

  for (const [ownerKey, record] of manager.ownerRecords.entries()) {
    assert.ok(record.hash, `doc owner ${ownerKey} must have hash`)
    const entry = manager.entries.get(record.hash)
    assert.ok(entry, `doc owner ${ownerKey} must point to an existing entry`)
    assert.ok(entry.owners.has(ownerKey), `doc entry ${record.hash} must include owner ${ownerKey}`)

    assert.deepEqual(
      manager.ownerMeta.get(ownerKey),
      {
        hash: record.hash,
        segments: [...record.segments],
        rootId: record.rootId
      },
      `doc ownerMeta for ${ownerKey} must match canonical record`
    )
    assert.equal(
      manager.ownerFetchCount.get(ownerKey),
      record.fetchCount > 0 ? record.fetchCount : undefined,
      `doc ownerFetchCount for ${ownerKey} must match canonical record`
    )
    assert.equal(
      manager.ownerSubscribeCount.get(ownerKey),
      record.subscribeCount > 0 ? record.subscribeCount : undefined,
      `doc ownerSubscribeCount for ${ownerKey} must match canonical record`
    )
  }

  let trackedHashCount = 0
  for (const [hash, entry] of manager.entries.entries()) {
    assert.ok(TRANSPORT_MODES.has(entry.mode), `doc entry ${hash} has invalid mode ${entry.mode}`)
    assert.ok(TRANSPORT_MODES.has(entry.targetMode), `doc entry ${hash} has invalid targetMode ${entry.targetMode}`)
    assert.ok(TRANSPORT_PHASES.has(entry.phase), `doc entry ${hash} has invalid phase ${entry.phase}`)

    const total = entry.retainCount + Array.from(entry.owners).reduce((sum, ownerKey) => {
      const record = manager.ownerRecords.get(ownerKey)
      return sum + (record ? record.fetchCount + record.subscribeCount : 0)
    }, 0)
    const expectedTrackedCount = total > 0 || entry.pendingDestroy ? total : undefined
    if (expectedTrackedCount !== undefined) trackedHashCount += 1

    assert.equal(
      manager.subCount.get(hash),
      expectedTrackedCount,
      `doc subCount for ${hash} must match canonical entry`
    )
    assert.equal(
      manager.docs.get(hash),
      entry.runtime || undefined,
      `doc runtime view for ${hash} must match canonical entry`
    )
    assertSetEqual(
      manager.ownerKeysByHash.get(hash),
      entry.owners.size > 0 ? entry.owners : undefined,
      `doc ownerKeysByHash for ${hash} must match canonical owners`
    )

    if (entry.pendingDestroy) {
      pendingDestroyCount += 1
      assert.equal(
        manager.pendingDestroyTimers.get(hash),
        entry.pendingDestroy,
        `doc pendingDestroy view for ${hash} must match canonical entry`
      )
    }

    for (const ownerKey of entry.owners) {
      const record = manager.ownerRecords.get(ownerKey)
      assert.ok(record, `doc entry ${hash} has missing owner record ${ownerKey}`)
      assert.equal(record.hash, hash, `doc owner ${ownerKey} must point back to hash ${hash}`)
    }

    if (
      entry.phase === 'stable' &&
      !entry.runtime &&
      entry.owners.size === 0 &&
      entry.retainCount === 0 &&
      !entry.pendingDestroy
    ) {
      assert.fail(`doc entry ${hash} is empty and should have been pruned`)
    }
  }

  assert.equal(manager.pendingDestroyTimers.size, pendingDestroyCount, 'doc pendingDestroy view size must match canonical entries')
  assert.equal(manager.subCount.size, trackedHashCount, 'doc tracked hash count size must match canonical entries')
}
