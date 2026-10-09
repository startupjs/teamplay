# Diagnostics and Leak Checks

TeamPlay keeps a lot of runtime state on your behalf: cached signal proxies, subscription managers with owners and delayed teardown, root contexts, query materializations, React subscription leases, and the ShareDB connection. Diagnostics let you see all of it and check whether it returns to a clean state. Use them in E2E or integration tests to confirm that navigating away or closing a request model really releases everything.

Diagnostics are off by default and cost (almost) nothing unless you load them. The `teamplay` main entry ships only the switch: hot paths pay one property read, and a bundle without diagnostics grows by 0.3–0.7 KB gzip. The implementation (collectors, leak checks, instrumentation, trace buffers, FinalizationRegistry counting) lives in `teamplay/diagnostics` (16–20 KB gzip) and is loaded only where you import it. On Node, `teamplay` loads it for you.

## Enabling

Two steps: **load** the implementation, then **switch it on**.

| Where | Load | Switch on |
| --- | --- | --- |
| Node | automatic (the `node` export condition of `teamplay` loads it first) | `TEAMPLAY_DIAGNOSTICS=1` (or `=trace`, `=trace,stacks`, `=trace,tracesize=20000`) |
| Browser bundle (webpack, Vite, esbuild) | `import 'teamplay/diagnostics'` as the first import of the app entry | `globalThis.__TEAMPLAY_DIAGNOSTICS__ = true` before the bundle runs, or `diagnostics.enable()` |
| Metro (React Native, Expo) | the same import, guarded by a build-time constant (below) | the same |
| Any | `import 'teamplay/diagnostics/enable'` loads and switches on at once | |

```js
// 1. Before TeamPlay loads (browser): FinalizationRegistry counts are exact.
globalThis.__TEAMPLAY_DIAGNOSTICS__ = true            // or { trace: true, stacks: true, traceSize: 5000 }
```

```sh
# 2. Before TeamPlay loads (Node): same effect.
TEAMPLAY_DIAGNOSTICS=1 node --expose-gc server.js        # or TEAMPLAY_DIAGNOSTICS=trace,stacks
```

```js
// 3. At runtime, once the implementation is loaded.
import { diagnostics } from 'teamplay/diagnostics'   // on Node also from 'teamplay'
diagnostics.enable({ trace: true })
```

The flags are read when `teamplay/diagnostics` loads. A bundle that does not include it ignores them, and `globalThis.__teamplay__.diagnostics` stays undefined.

`diagnostics` is also exported from `teamplay`, as the same object. Until the implementation is loaded only `isEnabled()` (always `false`) and `disable()` (a no-op) exist there, and `enable()` throws an error that names the import. The other methods appear once `teamplay/diagnostics` is loaded. The function aliases `enableDiagnostics()`, `disableDiagnostics()` and `isDiagnosticsEnabled()` are exported from `teamplay/diagnostics` only.

While enabled, the same API is available as `globalThis.__teamplay__.diagnostics` (next to the older `__teamplay__.DEBUG` counters), so test runners can call it with `page.evaluate()`.

### Load it first

Load `teamplay/diagnostics` before anything imports `teamplay`. TeamPlay creates its FinalizationRegistries when its modules load, and only registries created after diagnostics loaded are counted. Loaded later, everything else still works (counters, trace, leases, snapshots, leak checks), but `snapshot().finalization` has no counts for the earlier registries: `finalization.exact` is `false` and `finalization.untracked` names them.

ES `import` statements run before the code of the module that contains them. So put the (conditional) load in its own module and import that module first:

```js
// index.js (app entry)
import './teamplayDiagnostics.js'   // first
import App from './App'
```

### Browser bundles

```js
// teamplayDiagnostics.js
import 'teamplay/diagnostics'
```

Bundlers include the module only when it is imported. To keep it out of production builds, import it only in a debug or E2E build. One way is an entry file used only for that build. Another, for bundlers that understand `require()` (webpack, Metro), is a build-time constant (webpack `DefinePlugin`) that turns the `require()` into dead code:

```js
// teamplayDiagnostics.js
if (process.env.TEAMPLAY_DIAGNOSTICS_BUILD) require('teamplay/diagnostics')
```

### Metro (React Native, Expo)

Metro does not tree-shake. Every module that is reachable from the entry, including `import()` targets, ships in the bundle. For production builds Metro folds constants before it collects dependencies, so a `require()` inside an `if` whose condition is a build-time constant is dropped when the constant is false. Expo inlines `EXPO_PUBLIC_*` variables in production builds:

```js
// teamplayDiagnostics.js (imported first by the app entry)
if (process.env.EXPO_PUBLIC_TEAMPLAY_DIAGNOSTICS) require('teamplay/diagnostics')
```

```sh
EXPO_PUBLIC_TEAMPLAY_DIAGNOSTICS=1 npx expo export -p web   # E2E build with diagnostics
npx expo export -p web                                       # production build without them
```

In development builds the variable is read at runtime, so the module is always bundled (and loaded only when the variable is set). Without Expo, use `if (__DEV__) require('teamplay/diagnostics')`, or a Babel plugin that inlines an environment variable. Avoid `import()` for this: Metro still adds its target to the bundle. To check a build, search it for `untrackedSubscribedDocs`, a finding code that only the full implementation contains.

### Node

`import ... from 'teamplay'` resolves to the Node entry (`exports` condition `node`). It loads `teamplay/diagnostics` before the runtime, so `TEAMPLAY_DIAGNOSTICS` covers the whole process and `import { diagnostics } from 'teamplay'` (or `from 'startupjs'`) has the full API. Nothing is enabled without the variable. Code that imports TeamPlay's source files directly, as TeamPlay's own tests do, must load `teamplay/diagnostics` first itself (see `packages/teamplay/.mocharc.cjs`).

### Options

`enable(options)`, the global flag object and the env var (`trace`, `stacks`, `tracesize=N`) take the same options:

| Option | Default | Effect |
| --- | --- | --- |
| `trace` | `false` | Record lifecycle events into a bounded ring buffer. |
| `stacks` | `false` | Capture a stack trace for each traced event (implies `trace`, slow). |
| `traceSize` | `5000` | Ring buffer capacity. |

Event counters and timings are always collected while diagnostics are on. Anything that hooks record (counters, React leases, observer wrappers, pending `unsub()` promises) only covers what happened after diagnostics were enabled. Once `teamplay/diagnostics` is loaded, `snapshot()` also works while diagnostics are disabled: it reads the subscription managers, root contexts and connection on demand.

### Overhead

Bundle size (an app entry importing `$`, `useSub`, `sub` and `observer`, minified, gzip, compared with the same code with every hook removed): without `teamplay/diagnostics`, the switch and the guarded hook calls add about 0.3 KB with esbuild and about 0.65 KB with Metro. With it, add about 16 KB (esbuild) or 20 KB (Metro). `node scripts/bundle-size.mjs` measures the main entry.

Runtime, measured on Node with an in-memory ShareDB backend:

| Mode | Signal creation | Subscribe/unsubscribe |
| --- | --- | --- |
| Not loaded, or loaded and off | same as without diagnostics | same as without diagnostics |
| On (counters) | +0% | about +8% |
| On + `trace` | +0% | about +8% |
| On + `trace` + `stacks` | +0% | about +90% |

A detailed `snapshot()` plus `checkLeaks()` takes about 2 µs per cached signal (≈0.7 s with 350k cached signals). Diagnostics never keep signals, docs or components alive: registries hold ids, strings and `WeakRef`s only. The test suite checks that finalizers still run with tracing and stacks on.

## API

```js
diagnostics.snapshot({ details: true, limit: 50 })   // JSON report
diagnostics.checkLeaks({ ignoreCollections: ['_session'] })
diagnostics.diff(snapshotA, snapshotB)              // metrics that changed
diagnostics.getTrace({ type: 'doc.', key: 'users', limit: 100 })
diagnostics.getCounters()   // { 'doc.subscribe': 12, 'react.lease.create': 4, ... }
diagnostics.getTimings()    // { 'doc.subscribe': { count, totalMs, maxMs, avgMs }, ... }
diagnostics.getIncidents()  // recorded anomalies (see findings below)
diagnostics.resetCounters() // counters, timings, incidents, churn maps
diagnostics.clearTrace()
await diagnostics.forceGc()      // runs globalThis.gc() when exposed, lets finalizers run
await diagnostics.waitForIdle()  // no transitions, pending destroys or downgrade graces, pending owner releases or pollers
diagnostics.disable()            // removes instrumentation and clears collected state
```

`snapshot()` options:

| Option | Default | Effect |
| --- | --- | --- |
| `details` | `false` | Add `details`: example lists (owned entries, pending destroys, untracked connection docs, leases, ...). |
| `limit` | `50` | Max examples per list. |
| `top` | `25` | Max keys in "by collection" / "by root" breakdowns. |
| `sizes` | `false` | Approximate private data size per root (`JSON.stringify`). |
| `thresholds` | see below | When something counts as stale. |

Default thresholds: pending destroys and pending `unsub()` promises older than `gcDelay + 2000 ms`, uncommitted leases and never-mounted observer wrappers older than 5000 ms, readiness pollers older than 10000 ms.

`checkLeaks()` accepts the same options plus `ignore` (finding codes, `'prefix.*'` allowed), `ignoreCollections`, `staleSignalHashesThreshold` (default 1000) and `afterGc`. It returns `{ ok, errors, warnings, findings }`; `ok` means there are no `error` findings.

## Reading a snapshot

Every snapshot has a flat `metrics` map (`'docs.entries': 3`, `'connection.docs.total': 40`, ...). `diff()` uses it, so you can store snapshots as JSON and compare them later.

| Section | What it shows |
| --- | --- |
| `signals.cache` | Cached signal proxies: `total`, `live`, `dead` (collected but not yet evicted by the registry), `byKind` (`root`, `collection`, `doc`, `field`, `query`, `queryData`, `aggregation`, `aggregationRow`, `local`, `private`), `byCollection`, `byRoot`. |
| `docs` | Doc subscription manager. `categories`: `owned` (has owners), `retainedOnly` (held only by query results, including a query lingering in its grace), `graceLive` (no owners, transport still subscribed during `gcDelay`; the next owner adopts it synchronously), `graceStale` (no owners, released fetch: data kept, transport closed), `ownerless` (no owners and nothing will clean it up), `transition`. Also `pendingDestroys`, `stalePendingDestroys`, `oldestPendingDestroyMs`, `downgradeGraces` (owned entries whose last subscriber left: the live transport stays subscribed for `gcDelay` before it is downgraded to a fetch), `divergent`, `graceTransportNotLive`, `byMode`, `byPhase`, `ownerRecords` (by root, closed or missing roots). |
| `queries`, `aggregations` | Same for queries and aggregations. In the grace (`graceLive`, `graceStale`) the last owner left, but its root stays attached (its `$queries` / `$aggregations` data stays) and the owner record waits for its per-owner timer; a live transport stays subscribed, a released fetch is closed. `materializedDocSignals` is the number of result docs retained by query runtimes. |
| `roots` | Root contexts: `count`, `closedRemembered` (closed roots whose root signal is still referenced; their ids stay closed until it is collected), `pendingDisposes`, `signalHashes` / `staleSignalHashes` (hashes of collected signals a root has not forgotten yet; the signal cache finalizer removes them), `privateQueries`, `privateAggregations`, `localValues`, and the `largest` roots. |
| `finalization` | Every TeamPlay FinalizationRegistry created after `teamplay/diagnostics` loaded, with `registered`, `unregistered`, `finalized`, `liveEstimate`. `exact` is true only when diagnostics were switched on as they loaded, before TeamPlay. `untracked` names the registries created before diagnostics loaded (not counted). |
| `react` | `leases` (useSub: committed, uncommitted, pending, collected without release, churn by target and hook), `adms` (observer wrappers: subscribed, never subscribed, cache contents), `observers` (reactions: orphaned, extra, unmounted), `pollers`, `promiseBatcher`, `suspendMemoInFlight`, event listeners, batch scheduler, `debugCounters` (the old `DEBUG` map). |
| `dataTree` | Public docs per collection and `orphanDocs`: docs in the tree that no doc manager entry tracks. |
| `connection` | ShareDB connection: docs per collection, subscribed, pending/inflight ops, never loaded, `untracked` (`subscribed`, `pending`, `phantom`, `loaded`), queries by action and collection, untracked queries. On the server, `server` adds backend `agentsCount`, pubsub streams and the agent's subscribed docs/queries. |
| `sub` | Pending owner releases and the incident count: `unsub()` promises (they resolve once the release is applied, not when the grace timer fires) and releases started by a FinalizationRegistry callback (intent `finalized`). |
| `counters`, `timings` | Event counters and duration stats (`doc.subscribe`, `doc.transport.subscribe`, `query.unsubscribe`, `react.readinessPoll`, ...). |

## Findings

| Code | Severity | Meaning |
| --- | --- | --- |
| `docs.transportWithoutOwners`, `queries.…`, `aggregations.…` | error | A transport is subscribed or fetched with zero owners and no pending destroy. Nothing will close it. |
| `*.runtimeWithoutOwners` | error | Materialized runtime with zero owners, no retain and no pending destroy. |
| `*.divergent` | error | Transport mode differs from its target while the entry is stable and no reconcile is in flight (lost wakeup). The target keeps a live transport during the grace, so a lingering subscription is not divergent; a fetch transport left open in the grace is (`grace: true` in the example). |
| `*.stalePendingDestroy` | error | A destroy (grace timer) is pending longer than the threshold. |
| `*.graceTransportNotLive` | error | An entry lingers in its grace as a live subscription, but its ShareDB doc or query is no longer subscribed. The next owner would adopt it synchronously and get data that no longer updates. A disconnected client is not reported (ShareDB resubscribes on reconnect). |
| `*.ownersOfClosedRoots`, `*.ownersOfMissingRoots` | error | Owner records belong to a closed or unknown root. |
| `roots.orphanQueryData`, `roots.orphanAggregationData` | error | `$queries` / `$aggregations` data in a root without an owner or attached runtime. |
| `connection.untrackedSubscribedDocs` | error | A ShareDB doc is subscribed but no doc manager entry tracks it. The server keeps streaming its ops. |
| `connection.untrackedQueries` | error | A ShareDB query is not owned by any query or aggregation runtime. |
| `react.staleUncommittedLeases` | error | A useSub lease never committed and was not released. |
| `react.lease.reacquireLoop` | warn | A useSub hook kept re-acquiring the same target from uncommitted render attempts (release/re-subscribe loop); its uncommitted lease is kept until commit or unmount. |
| `react.leasesCollectedWithoutRelease` | error | A lease was garbage collected without being released, so its subscription count leaked. |
| `react.stalePollers` | error | A readiness polling loop runs longer than the threshold. |
| `doc.fr.liveOwnerWiped` (and `query.`, `aggregation.`) | error | A FinalizationRegistry callback took counts that a live signal still held. Finalizers release only the counts their collected signal acquired (`releaseFinalizedToken`), so this means a regression: a finalizer released the wrong counts or force-destroyed a shared owner key. |
| `connection.untrackedLoadedDocs`, `connection.phantomDocs`, `dataTree.orphanDocs` | warn | Docs written without a subscription, or created by `connection.get()` probes. They stay in memory until the page reloads. |
| `react.orphanObservers`, `react.extraObservers`, `react.staleUnmountedObservers` | warn | Observer reactions from renders React discarded (StrictMode, abandoned mounts) that are not disposed yet. Their finalizer unobserves them once React drops the render and GC runs; a count that persists after GC is a leak. |
| `react.staleNeverSubscribedAdms` | warn | Observer wrappers that rendered but never mounted. |
| `doc.subscribe.bypassedSub` (and `query.`, `aggregation.`) | warn | Subscriptions created by calling the subscription managers directly instead of `sub()`. Unless the caller releases them, they are released only by GC. |
| `*.unsubscribe.intentMismatch` | warn | `unsubscribe()` with an intent the owner does not hold while it holds the other one. |
| `roots.staleSignalHashes` | warn | A root remembers many hashes of collected signals. |
| `sub.stalePendingUnsubs` | warn | Owner releases (`unsub()` or finalizer) pending longer than the threshold. |
| `sub.unsub.mixedIntents`, `roots.closedRemembered`, `signals.dead`, `connection.untrackedPendingDocs` | info | Context for the above. |

Every finding carries `count` and up to `limit` `examples` with hashes, ids, roots and ages.

## Tracing

With `trace: true` every lifecycle event is stored as `{ seq, t, type, key, data, stack? }`. Event types:

- `doc.subscribe`, `doc.unsubscribe`, `doc.retain`, `doc.release`, `doc.destroy.scheduled`, `doc.destroy.cancelled`, `doc.destroy`, `doc.destroyed`, `doc.destroyByOwner`, `doc.reconcile.changed`, `doc.releaseRoot`
- `doc.transport.subscribe|fetch|unsubscribe|unfetch`, `doc.runtime.destroy|dispose`
- the same `query.*` and `aggregation.*` events, plus `query.transport.destroy`, `query.runtime.detach`
- `doc.subscribe.slowPathWhileLive`: `sub()` returned a promise although the transport was already live
- `root.get`, `root.close`, `root.dispose.start`, `root.dispose.end`, `fr.finalized`, `*.fr.ownerFinalized` (a finalizer released a collected signal's counts: `released`, the owner's remaining `ownerCount`, and the counts its live signals hold; the `*.fr.release` timing measures the release)
- `react.lease.create|commit|release|releaseUncommitted`, `react.adm.create|subscribe|destroy`, `react.observer.create|destroy`, `react.readinessPoll.start|end`, `react.batchReadinessPoll.start|end`, `reaction.create|dispose`

Counters that are not trace events: `doc.reconcile.noop` (a reconcile that changed nothing on the wire; the entry stays stable), `doc.reconcile.joined`, `doc.subscribe.sync`, `sub.doc.subscribe` / `sub.doc.fetch` (sub records), `sub.unsub.*`.

```js
diagnostics.getTrace({ type: ['doc.destroy', 'doc.subscribe'], key: '"users","42"' })
```

## Recipes

### Playwright: leak check per test

The app under test must be a build that includes `teamplay/diagnostics` (see [Metro](#metro-react-native-expo) and [Browser bundles](#browser-bundles)). The fixture only switches it on:

```js
// fixture
await page.addInitScript(() => { globalThis.__TEAMPLAY_DIAGNOSTICS__ = { trace: true } })
// Chromium: launch with args: ['--js-flags=--expose-gc'] so forceGc() works.
const hasDiagnostics = await page.evaluate(() => !!globalThis.__teamplay__?.diagnostics)
// false: this build does not include 'teamplay/diagnostics'

// after the scenario
await page.goto('/blank-page')   // navigate away from everything the test opened
const report = await page.evaluate(async () => {
  const d = globalThis.__teamplay__.diagnostics
  await d.waitForIdle()
  await d.forceGc()
  return { snapshot: d.snapshot({ details: true }), leaks: d.checkLeaks() }
})
expect(report.leaks.errors).toBe(0)
```

### Growth between two points

```js
const before = diagnostics.snapshot()
// ... open and close the same page 10 times ...
await diagnostics.waitForIdle()
await diagnostics.forceGc()
const { grew } = diagnostics.diff(before, diagnostics.snapshot())
// e.g. [{ metric: 'connection.docs.total', before: 120, after: 410, delta: 290 }, ...]
```

### Node server

```sh
TEAMPLAY_DIAGNOSTICS=1 node --expose-gc server.js
```

No import is needed: the Node entry of `teamplay` loads diagnostics, and `import { diagnostics } from 'teamplay'` is the full API. Request roots and models created with `getRootSignal()` appear in `roots`. Owner records that outlive a closed root show up as `ownersOfClosedRoots`. Expose `snapshot()` and `checkLeaks()` through a test-only endpoint to read them from your test runner.
