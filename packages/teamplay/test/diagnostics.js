import { after, afterEach, before, describe, it } from 'mocha'
import { strict as assert } from 'node:assert'
import {
  $,
  sub,
  unsub,
  aggregation,
  getRootSignal,
  diagnostics,
  __DEBUG_SIGNALS_CACHE__ as signalsCache
} from '../src/index.ts'
import * as diagnosticsSubpath from '../src/diagnostics/index.ts'
import connect from '../src/connect/test.js'
import { getConnection } from '../src/orm/connection.ts'
import { docSubscriptions } from '../src/orm/Doc.js'
import { querySubscriptions } from '../src/orm/Query.js'
import { aggregationSubscriptions } from '../src/orm/Aggregation.js'
import { del as _del } from '../src/orm/dataTree.js'
import { deleteRootContext, reviveRootContext } from '../src/orm/rootContext.ts'
import { getSubscriptionGcDelay, setSubscriptionGcDelay } from '../src/orm/subscriptionGcDelay.ts'
import { getAllFinalizationRegistryStats } from '../src/utils/MockFinalizationRegistry.ts'
import { runGc } from './_helpers.js'

before(connect)

const COLLECTION = 'diagnosticsDocs'

function cbPromise (fn) {
  return new Promise((resolve, reject) => fn(err => err ? reject(err) : resolve()))
}

async function createDoc (collection, id, data) {
  const doc = getConnection().get(collection, id)
  await cbPromise(cb => doc.fetch(cb))
  if (doc.type == null) await cbPromise(cb => doc.create(data, cb))
}

function delay (ms = 5) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function findingCodes (report) {
  return report.findings.map(finding => finding.code)
}

// Other test files may leave state behind in this process; compare only what
// belongs to this file's collection or what changed relative to a baseline.
function mine (examples = []) {
  return examples.filter(example => JSON.stringify(example).includes(COLLECTION))
}

function errorSignature (report) {
  return report.findings
    .filter(finding => finding.severity === 'error')
    .map(finding => finding.code + ':' + finding.count)
    .sort()
}

// When the suite runs with TEAMPLAY_DIAGNOSTICS set, keep diagnostics on for later files.
const enabledAtStartup = diagnostics.isEnabled()

describe('diagnostics', () => {
  const baselineGcDelay = getSubscriptionGcDelay()

  afterEach(async () => {
    diagnostics.disable()
    setSubscriptionGcDelay(baselineGcDelay)
  })

  after(async () => {
    diagnostics.disable()
    await runGc()
    if (enabledAtStartup) diagnostics.enable({ trace: true })
  })

  it('is exported from the main entry and the subpath with the same API object', () => {
    assert.equal(diagnosticsSubpath.diagnostics, diagnostics)
    for (const method of ['enable', 'disable', 'snapshot', 'checkLeaks', 'diff', 'getTrace', 'forceGc', 'waitForIdle']) {
      assert.equal(typeof diagnostics[method], 'function', method)
    }
  })

  it('collects nothing while disabled', async () => {
    diagnostics.disable()
    setSubscriptionGcDelay(0)
    const registriesBefore = getAllFinalizationRegistryStats().map(stats => stats.registered)
    assert.equal(Object.prototype.hasOwnProperty.call(docSubscriptions, 'subscribe'), false, 'no instrumentation')
    assert.equal(globalThis.__teamplay__?.diagnostics, undefined, 'not exposed globally')

    await createDoc(COLLECTION, 'off1', { name: 'off' })
    const $doc = await sub($[COLLECTION].off1)
    const $query = await sub($[COLLECTION], { name: 'off' })
    await unsub($doc)
    await unsub($query)

    assert.deepEqual(diagnostics.getCounters(), {})
    assert.deepEqual(diagnostics.getTrace(), [])
    assert.deepEqual(getAllFinalizationRegistryStats().map(stats => stats.registered), registriesBefore)
    const snapshot = diagnostics.snapshot()
    assert.equal(snapshot.enabled, false)
    assert.equal(snapshot.react.leases.tracked, 0)
    assert.equal(snapshot.sub.pendingUnsubs.count, 0)
  })

  it('installs and removes instrumentation without leaving own properties behind', () => {
    const DocClass = docSubscriptions.DocClass
    const originalDocSubscribe = DocClass.prototype._subscribe
    const originalManagerSubscribe = docSubscriptions.subscribe
    diagnostics.enable()
    assert.ok(Object.prototype.hasOwnProperty.call(docSubscriptions, 'subscribe'))
    assert.ok(Object.prototype.hasOwnProperty.call(querySubscriptions, 'subscribe'))
    assert.ok(Object.prototype.hasOwnProperty.call(aggregationSubscriptions, 'subscribe'))
    assert.notEqual(DocClass.prototype._subscribe, originalDocSubscribe)
    assert.equal(globalThis.__teamplay__.diagnostics, diagnostics)
    diagnostics.disable()
    assert.equal(Object.prototype.hasOwnProperty.call(docSubscriptions, 'subscribe'), false)
    assert.equal(docSubscriptions.subscribe, originalManagerSubscribe)
    assert.equal(DocClass.prototype._subscribe, originalDocSubscribe)
    assert.equal(globalThis.__teamplay__?.diagnostics, undefined)
  })

  it('snapshot reflects subscribe, unsubscribe, grace and GC', async () => {
    diagnostics.enable()
    setSubscriptionGcDelay(10000)
    await createDoc(COLLECTION, 's1', { name: 'snap' })
    const hash = JSON.stringify([COLLECTION, 's1'])

    let $doc = await sub($[COLLECTION].s1)
    let $query = await sub($[COLLECTION], { name: 'snap' })
    let snapshot = diagnostics.snapshot({ details: true })
    const ownedDocs = mine(snapshot.details['docs.owned'])
    assert.equal(ownedDocs.length, 1, JSON.stringify(ownedDocs))
    assert.equal(ownedDocs[0].hash, hash)
    assert.equal(ownedDocs[0].mode, 'subscribe')
    assert.equal(ownedDocs[0].retain, 1, 'query result retains the doc')
    assert.deepEqual(ownedDocs[0].ownerRoots, ['__global__:1'])
    const ownedQueries = mine(snapshot.details['queries.owned'])
    assert.equal(ownedQueries.length, 1)
    assert.equal(ownedQueries[0].docSignals, 1)
    assert.equal(snapshot.docs.byCollection[COLLECTION], 1)
    assert.equal(snapshot.queries.byCollection[COLLECTION], 1)
    assert.equal(snapshot.roots.privateQueries, 1)
    assert.ok(snapshot.connection.docs.subscribed >= 1)
    assert.equal(snapshot.connection.queries.untracked, 0)
    assert.equal(snapshot.connection.docs.untracked.subscribed, 0)
    assert.ok(snapshot.signals.cache.byKind.doc >= 1)
    assert.ok(snapshot.signals.cache.byKind.query >= 1)
    assert.equal(typeof snapshot.metrics['docs.entries'], 'number')
    assert.doesNotThrow(() => JSON.stringify(snapshot))

    // release: unsub() resolves at release, while the doc and the query linger
    // with live transports (and the query's root data) until their gc timers
    const queryUnsub = unsub($query)
    const docUnsub = unsub($doc)
    const released = await Promise.race([
      Promise.all([queryUnsub, docUnsub]).then(() => true),
      delay(1000).then(() => false)
    ])
    assert.equal(released, true, 'unsub() does not wait for the grace timer')
    snapshot = diagnostics.snapshot({ details: true })
    assert.equal(snapshot.sub.pendingUnsubs.count, 0)
    const queryEntry = mine(snapshot.details['queries.pendingDestroy'])
    assert.equal(queryEntry.length, 1, 'query lingers until its gc timer')
    assert.equal(queryEntry[0].mode, 'subscribe', 'the query transport stays live through the grace')
    assert.equal(queryEntry[0].owners, 0)
    assert.equal(mine(snapshot.details['queries.owned']).length, 0)
    assert.ok(snapshot.queries.categories.graceLive >= 1)
    assert.equal(snapshot.roots.privateQueries, 1, 'root query data is kept through the grace')
    // the released doc stays retained by the lingering query's results
    const docEntry = mine(snapshot.details['docs.retainedOnly']).find(entry => entry.hash === hash)
    assert.equal(docEntry.owners, 0)
    assert.equal(docEntry.retain, 1)
    // a live transport in its grace is expected state, not a leak
    const graceReport = diagnostics.checkLeaks()
    for (const finding of graceReport.findings.filter(item => item.severity === 'error')) {
      assert.deepEqual(mine(finding.examples), [], finding.code)
    }
    assert.deepEqual(mine(snapshot.details['queries.divergent']), [])
    assert.deepEqual(mine(snapshot.details['docs.divergent']), [])

    // finish the grace period
    await querySubscriptions.flushPendingDestroys()
    await docSubscriptions.flushPendingDestroys()
    snapshot = diagnostics.snapshot()
    assert.equal(snapshot.roots.privateQueries, 0, 'root query data is removed when the grace ends')
    $doc = undefined
    $query = undefined
    await runGc()
    snapshot = diagnostics.snapshot({ details: true })
    assert.equal(snapshot.docs.byCollection[COLLECTION], undefined)
    assert.equal(snapshot.queries.byCollection[COLLECTION], undefined)
    assert.equal(snapshot.sub.pendingUnsubs.count, 0)
    assert.equal(mine(snapshot.details['dataTree.orphanDocs']).length, 0)
    assert.equal(snapshot.connection.docs.untracked.subscribed, 0)

    const counters = diagnostics.getCounters()
    assert.equal(counters['doc.subscribe'], 1)
    assert.equal(counters['query.subscribe'], 1)
    assert.equal(counters['doc.unsubscribe'], 1)
    assert.equal(counters['query.unsubscribe'], 1)
    assert.ok(counters['doc.destroyed'] >= 1)
    assert.ok(counters['query.destroyed'] >= 1)
  })

  it('checkLeaks reports nothing for a clean app', async () => {
    diagnostics.enable()
    setSubscriptionGcDelay(0)
    await createDoc(COLLECTION, 'clean1', { name: 'clean' })
    const baseline = errorSignature(diagnostics.checkLeaks())
    const $root = getRootSignal({ rootId: 'diagnostics-clean-root' })
    const $doc = await sub($root[COLLECTION].clean1)
    const $query = await sub($root[COLLECTION], { name: 'clean' })
    const $globalDoc = await sub($[COLLECTION].clean1)
    assert.deepEqual(errorSignature(diagnostics.checkLeaks()), baseline)
    await unsub($doc)
    await unsub($query)
    await unsub($globalDoc)
    await $root.close()
    const report = diagnostics.checkLeaks()
    assert.deepEqual(errorSignature(report), baseline, JSON.stringify(report.findings, null, 2))
    for (const finding of report.findings) {
      assert.deepEqual(mine(finding.examples), [], finding.code)
    }
  })

  it('checkLeaks flags subscriptions leaked by a root that was closed without releasing them', async () => {
    diagnostics.enable()
    setSubscriptionGcDelay(0)
    const rootId = 'diagnostics-leaky-root'
    await createDoc(COLLECTION, 'leak1', { name: 'leak' })
    const $root = getRootSignal({ rootId })
    await sub($root[COLLECTION].leak1)
    // Simulate a lifecycle bug: the root context is dropped but its owners are not released.
    deleteRootContext(rootId, $root)

    const report = diagnostics.checkLeaks()
    assert.equal(report.ok, false)
    assert.ok(report.errors >= 1)
    const finding = report.findings.find(item => item.code === 'docs.ownersOfClosedRoots')
    assert.ok(finding, JSON.stringify(findingCodes(report)))
    assert.equal(finding.severity, 'error')
    assert.equal(finding.examples[0].rootId, rootId)
    assert.equal(finding.examples[0].key, JSON.stringify([COLLECTION, 'leak1']))

    // cleanup
    for (const [ownerKey, record] of docSubscriptions.ownerRecords) {
      if (record.rootId === rootId) await docSubscriptions.destroyByOwnerKey(ownerKey, { force: true })
    }
    reviveRootContext(rootId)
    assert.equal(diagnostics.checkLeaks().findings.some(item => item.code === 'docs.ownersOfClosedRoots'), false)
  })

  it('checkLeaks flags ShareDB transports nobody owns', async () => {
    diagnostics.enable()
    await createDoc(COLLECTION, 'raw1', { name: 'raw' })
    const connection = getConnection()
    const rawDoc = connection.get(COLLECTION, 'raw1')
    await cbPromise(cb => rawDoc.subscribe(cb))
    const rawQuery = await new Promise((resolve, reject) => {
      const query = connection.createSubscribeQuery(COLLECTION, { name: 'raw' }, {}, err => err ? reject(err) : resolve(query))
    })
    const phantom = connection.get(COLLECTION, 'neverFetched')

    const report = diagnostics.checkLeaks()
    const codes = findingCodes(report)
    assert.equal(report.ok, false)
    assert.ok(codes.includes('connection.untrackedSubscribedDocs'), JSON.stringify(codes))
    assert.ok(codes.includes('connection.untrackedQueries'), JSON.stringify(codes))
    assert.ok(codes.includes('connection.phantomDocs'), JSON.stringify(codes))
    const untrackedDoc = report.findings.find(item => item.code === 'connection.untrackedSubscribedDocs')
    assert.deepEqual(
      untrackedDoc.examples.map(example => example.id).sort(),
      ['raw1']
    )
    const ignored = diagnostics.checkLeaks({ ignore: ['connection.*'] })
    assert.equal(findingCodes(ignored).some(code => code.startsWith('connection.')), false)

    // cleanup
    await cbPromise(cb => rawQuery.destroy(cb))
    await cbPromise(cb => rawDoc.destroy(cb))
    await cbPromise(cb => phantom.destroy(cb))
    const after = diagnostics.checkLeaks()
    assert.equal(after.findings.some(item => item.code === 'connection.untrackedSubscribedDocs'), false)
    assert.equal(after.findings.some(item => item.code === 'connection.untrackedQueries'), false)
  })

  it('reports docs written without a subscription as untracked data tree and connection entries', async () => {
    diagnostics.enable()
    await $[COLLECTION].written1.set({ name: 'written' })
    const report = diagnostics.checkLeaks()
    const orphan = report.findings.find(item => item.code === 'dataTree.orphanDocs')
    assert.ok(orphan, JSON.stringify(findingCodes(report)))
    assert.equal(orphan.severity, 'warn')
    assert.ok(orphan.examples.some(example => example.id === 'written1'))
    const loaded = report.findings.find(item => item.code === 'connection.untrackedLoadedDocs')
    assert.ok(loaded?.examples.some(example => example.id === 'written1'))
    const filtered = diagnostics.checkLeaks({ ignoreCollections: [COLLECTION] })
    for (const finding of filtered.findings) {
      assert.deepEqual(mine(finding.examples), [], finding.code)
    }

    // cleanup
    _del([COLLECTION, 'written1'])
    await cbPromise(cb => getConnection().get(COLLECTION, 'written1').destroy(cb))
  })

  it('detects unsubscribe intent mismatches and mixed-intent unsub() calls', async () => {
    diagnostics.enable()
    setSubscriptionGcDelay(0)
    await createDoc(COLLECTION, 'intent1', { name: 'intent' })
    const $doc = await sub($[COLLECTION].intent1, { mode: 'fetch' })
    await sub($[COLLECTION].intent1)
    await unsub($doc)
    await docSubscriptions.unsubscribe($doc, { intent: 'subscribe' })
    const report = diagnostics.checkLeaks()
    const codes = findingCodes(report)
    assert.ok(codes.includes('sub.unsub.mixedIntents'), JSON.stringify(codes))
    assert.ok(codes.includes('doc.unsubscribe.intentMismatch'), JSON.stringify(codes))
    await unsub($doc)
  })

  it('a finalizer releases only the collected signal and does not wipe a live owner', async () => {
    diagnostics.enable()
    setSubscriptionGcDelay(0)
    await createDoc(COLLECTION, 'fr1', { name: 'fr' })
    const hash = JSON.stringify([COLLECTION, 'fr1'])
    // An owner leaks a subscription (sub() without unsub()) and drops its signal.
    await (async () => {
      await sub($[COLLECTION].fr1)
    })()
    await delay()
    global.gc()
    // The first signal is collected but its finalizer has not run yet.
    // A new signal for the same doc subscribes under the same owner key.
    const $live = $[COLLECTION].fr1
    const subscribed = sub($live)
    const finalized = () => diagnostics.getCounters()['doc.fr.ownerFinalized'] || 0
    for (let i = 0; i < 20 && !finalized(); i++) {
      await delay()
      global.gc()
    }
    await subscribed
    await diagnostics.waitForIdle()
    assert.ok(finalized() >= 1, 'the finalizer of the collected signal ran')
    const event = diagnostics.getTrace({ type: 'doc.fr.ownerFinalized', key: hash, limit: 1 })[0]
    if (event) assert.equal(event.data.liveCount, 1)
    assert.deepEqual(diagnostics.getIncidents().filter(item => item.code === 'doc.fr.liveOwnerWiped'), [])
    // The live signal keeps its subscription.
    assert.equal(docSubscriptions.subCount.get(hash), 1)
    assert.equal(docSubscriptions.docs.get(hash)?.activeTransportMode, 'subscribe')
    await unsub($live)
  })

  it('flags a finalizer release that takes the counts of a live owner', async () => {
    diagnostics.enable()
    setSubscriptionGcDelay(0)
    await createDoc(COLLECTION, 'fr2', { name: 'fr' })
    const hash = JSON.stringify([COLLECTION, 'fr2'])
    const $live = await sub($[COLLECTION].fr2)
    const [ownerKey, record] = Array.from(docSubscriptions.ownerRecords).find(([, item]) => item.hash === hash)
    const [liveToken] = record.tokens.keys()
    // Simulate a finalizer releasing the token of a signal that is still alive.
    await docSubscriptions.releaseFinalizedToken(ownerKey, hash, liveToken)
    await diagnostics.waitForIdle()
    const incident = diagnostics.getIncidents().find(item => item.code === 'doc.fr.liveOwnerWiped')
    assert.ok(incident, JSON.stringify(diagnostics.getIncidents()))
    assert.equal(incident.key, hash)
    assert.equal(incident.data.liveCount, 1)
    assert.equal(incident.data.ownerCount, 0)
    const finding = diagnostics.checkLeaks().findings.find(item => item.code === 'doc.fr.liveOwnerWiped')
    assert.equal(finding.severity, 'error')
    // The live signal lost its subscription: the doc manager no longer tracks it.
    assert.equal(docSubscriptions.subCount.get(hash), undefined)
    await unsub($live)
  })

  it('treats a live transport grace as expected and flags dead, open-fetch or overdue grace entries', async () => {
    diagnostics.enable()
    setSubscriptionGcDelay(10000)
    await createDoc(COLLECTION, 'grace1', { name: 'graceDoc' })
    await createDoc(COLLECTION, 'grace2', { name: 'graceFetch' })
    await createDoc(COLLECTION, 'grace3', { name: 'graceQuery' })
    await createDoc(COLLECTION, 'grace4', { name: 'graceAgg' })
    const liveHash = JSON.stringify([COLLECTION, 'grace1'])
    const fetchHash = JSON.stringify([COLLECTION, 'grace2'])
    const errorsOfMine = report => report.findings
      .filter(item => item.severity === 'error' && mine(item.examples).length > 0)
      .map(item => item.code)
      .sort()

    await unsub(await sub($[COLLECTION].grace1))
    const $query = await sub($[COLLECTION], { name: 'graceQuery' })
    const queryHash = Array.from(querySubscriptions.entries.keys()).find(key => key.includes('"graceQuery"'))
    await unsub($query)
    const $rows = await sub(aggregation(({ name }) => [{ $match: { name } }]), { $collection: COLLECTION, name: 'graceAgg' })
    const aggregationHash = Array.from(aggregationSubscriptions.entries.keys()).find(key => key.includes('graceAgg'))
    await unsub($rows)
    await unsub(await sub($[COLLECTION].grace2, { mode: 'fetch' }))

    // live transports and a released fetch (data kept, transport closed) in their grace
    let snapshot = diagnostics.snapshot({ details: true })
    const docGrace = mine(snapshot.details['docs.pendingDestroy'])
    assert.equal(docGrace.find(item => item.hash === liveHash)?.mode, 'subscribe')
    assert.equal(docGrace.find(item => item.hash === fetchHash)?.mode, 'idle')
    assert.ok(snapshot.docs.categories.graceStale >= 1)
    assert.equal(mine(snapshot.details['queries.pendingDestroy'])[0]?.mode, 'subscribe')
    assert.equal(mine(snapshot.details['aggregations.pendingDestroy'])[0]?.mode, 'subscribe')
    assert.deepEqual(errorsOfMine(diagnostics.checkLeaks()), [])

    // overdue grace timers
    assert.deepEqual(
      errorsOfMine(diagnostics.checkLeaks({ thresholds: { pendingDestroyMaxAgeMs: -1 } })),
      ['aggregations.stalePendingDestroy', 'docs.stalePendingDestroy', 'queries.stalePendingDestroy']
    )

    // a lingering 'live' transport whose ShareDB subscription is gone
    const connection = getConnection()
    connection.get(COLLECTION, 'grace1').unsubscribe()
    querySubscriptions.entries.get(queryHash).runtime.shareQuery.destroy()
    aggregationSubscriptions.entries.get(aggregationHash).runtime.shareQuery.destroy()
    // a released fetch whose transport was left open
    const fetchRuntime = docSubscriptions.docs.get(fetchHash)
    fetchRuntime.activeTransportMode = 'fetch'
    const report = diagnostics.checkLeaks()
    assert.deepEqual(errorsOfMine(report), [
      'aggregations.graceTransportNotLive',
      'docs.divergent',
      'docs.graceTransportNotLive',
      'queries.graceTransportNotLive'
    ])
    const divergent = report.findings.find(item => item.code === 'docs.divergent')
    const divergentFetch = mine(divergent.examples).find(item => item.hash === fetchHash)
    assert.equal(divergentFetch.grace, true)
    assert.equal(divergentFetch.desired, 'idle')
    assert.equal(mine(report.findings.find(item => item.code === 'docs.graceTransportNotLive').examples)[0].hash, liveHash)

    // cleanup
    fetchRuntime.activeTransportMode = 'idle'
    await aggregationSubscriptions.flushPendingDestroys()
    await querySubscriptions.flushPendingDestroys()
    await docSubscriptions.flushPendingDestroys()
    snapshot = diagnostics.snapshot({ details: true })
    assert.deepEqual(mine(snapshot.details['docs.pendingDestroy']), [])
    assert.deepEqual(mine(snapshot.details['queries.pendingDestroy']), [])
    assert.deepEqual(mine(snapshot.details['aggregations.pendingDestroy']), [])
    // the aggregation source doc was only loaded by createDoc()
    await cbPromise(cb => connection.get(COLLECTION, 'grace4').destroy(cb))
  })

  it('remembers closed root ids only while their root signals are alive', async () => {
    diagnostics.enable()
    await runGc()
    const before = diagnostics.snapshot().roots.closedRemembered
    await (async () => {
      const roots = []
      for (let i = 0; i < 5; i++) {
        const $root = getRootSignal()
        await $root._session.userId.set('user' + i)
        await $root.close()
        roots.push($root)
      }
      const snapshot = diagnostics.snapshot()
      assert.equal(snapshot.roots.closedRemembered, before + 5)
      const finding = diagnostics.checkLeaks().findings.find(item => item.code === 'roots.closedRemembered')
      assert.equal(finding.severity, 'info')
    })()
    await runGc()
    assert.equal(diagnostics.snapshot().roots.closedRemembered, before)
  })

  it('keeps a bounded, filterable trace with optional stacks', async () => {
    diagnostics.enable({ trace: true, traceSize: 8 })
    setSubscriptionGcDelay(0)
    await createDoc(COLLECTION, 'trace1', { name: 'trace' })
    for (let i = 0; i < 3; i++) {
      const $doc = await sub($[COLLECTION].trace1)
      await unsub($doc)
    }
    const trace = diagnostics.getTrace()
    assert.equal(trace.length, 8)
    assert.ok(trace.every((event, i) => i === 0 || event.seq === trace[i - 1].seq + 1))
    const subscribes = diagnostics.getTrace({ type: 'doc.subscribe' })
    assert.ok(subscribes.every(event => event.type.startsWith('doc.subscribe')))
    assert.equal(diagnostics.getTrace({ key: 'nonexistent' }).length, 0)
    assert.equal(trace[0].stack, undefined)

    diagnostics.enable({ stacks: true })
    const $doc = await sub($[COLLECTION].trace1)
    const event = diagnostics.getTrace({ type: 'doc.subscribe', limit: 1 })[0]
    assert.equal(typeof event.stack, 'string')
    assert.ok(!event.stack.includes('/diagnostics/'), 'diagnostics frames are dropped')
    await unsub($doc)
  })

  function snapshot0QueryCount () {
    return diagnostics.snapshot().queries.byCollection[COLLECTION] ?? 0
  }

  it('does not keep signals alive (finalizers still run with tracing and stacks on)', async () => {
    diagnostics.enable({ trace: true, stacks: true })
    setSubscriptionGcDelay(0)
    await runGc()
    const cacheSize = signalsCache.size
    await createDoc(COLLECTION, 'gc1', { name: 'gc' })
    const hash = JSON.stringify([COLLECTION, 'gc1'])
    const finalizedBefore = diagnostics.getCounters()['fr.finalized'] || 0
    await (async () => {
      const $doc = await sub($[COLLECTION].gc1)
      const $query = await sub($[COLLECTION], { name: 'gc' })
      assert.equal($doc.name.get(), 'gc')
      assert.equal($query.get().length, 1)
      // diagnostics read everything while the signals are alive
      diagnostics.snapshot({ details: true })
      diagnostics.checkLeaks()
    })()
    await runGc()
    // finalizer releases complete asynchronously
    await diagnostics.waitForIdle()
    assert.equal(signalsCache.size, cacheSize, 'signal cache back to its size')
    assert.equal(docSubscriptions.docs.has(hash), false, 'doc finalized and destroyed')
    assert.equal(snapshot0QueryCount(), 0, 'query finalized and destroyed')
    assert.ok((diagnostics.getCounters()['fr.finalized'] || 0) > finalizedBefore)
    const snapshot = diagnostics.snapshot()
    assert.equal(snapshot.docs.trackedOwnerTokens, 0)
    assert.equal(snapshot.queries.trackedOwnerTokens, 0)
    for (const finding of diagnostics.checkLeaks().findings) {
      assert.deepEqual(mine(finding.examples), [], finding.code)
    }
  })

  it('flags subscriptions created by calling the managers directly instead of sub()', async () => {
    diagnostics.enable()
    setSubscriptionGcDelay(0)
    await createDoc(COLLECTION, 'agg1', { name: 'agg', active: true, price: 1 })
    // aggregation-row setters hold the source doc only for the write (sub() records)
    const _rows = aggregation(({ active }) => [{ $match: { active, name: 'agg' } }])
    const $rows = await sub(_rows, { $collection: COLLECTION, active: true })
    for (let i = 0; i < 3; i++) await $rows[0].price.set(10 + i)
    await unsub($rows)
    await diagnostics.waitForIdle()
    assert.deepEqual(mine(diagnostics.snapshot({ details: true }).details['docs.owned']), [])
    assert.equal(diagnostics.checkLeaks().findings.some(item => item.code === 'doc.subscribe.bypassedSub'), false)

    const $doc = $[COLLECTION].agg1
    for (let i = 0; i < 3; i++) await docSubscriptions.subscribe($doc)
    const owned = mine(diagnostics.snapshot({ details: true }).details['docs.owned'])
    assert.equal(owned.length, 1)
    assert.deepEqual(owned[0].ownerRoots, ['__global__:3'])
    const finding = diagnostics.checkLeaks().findings.find(item => item.code === 'doc.subscribe.bypassedSub')
    assert.equal(finding?.count, 3)
    // cleanup
    for (let i = 0; i < 3; i++) await docSubscriptions.unsubscribe($doc)
  })

  it('diff() lists metrics that grew between snapshots', async () => {
    diagnostics.enable()
    setSubscriptionGcDelay(0)
    const before = diagnostics.snapshot()
    await createDoc(COLLECTION, 'diff1', { name: 'diff' })
    const $doc = await sub($[COLLECTION].diff1)
    const after = diagnostics.snapshot()
    const result = diagnostics.diff(before, after)
    const entries = result.grew.find(change => change.metric === 'docs.byCollection.' + COLLECTION)
    assert.deepEqual(entries && { before: entries.before, after: entries.after }, { before: 0, after: 1 })
    assert.equal(result.grew.find(change => change.metric === 'docs.entries')?.delta, 1)
    assert.ok(result.changes.every(change => !/AgeMs$|oldest/.test(change.metric)))
    await unsub($doc)
  })

  it('waitForIdle() resolves once teardown settles', async () => {
    await runGc() // flush timers left by other test files
    diagnostics.enable()
    setSubscriptionGcDelay(30)
    await createDoc(COLLECTION, 'idle1', { name: 'idle' })
    const $doc = await sub($[COLLECTION].idle1)
    const pending = unsub($doc)
    const state = await diagnostics.waitForIdle({ timeoutMs: 2000 })
    assert.equal(state.idle, true)
    assert.equal(state.pendingDestroys, 0)
    await pending
  })

  it('forceGc() runs the exposed gc', async () => {
    assert.equal(await diagnostics.forceGc({ rounds: 1, delayMs: 0 }), true)
  })
})
