# Direct Document Transport Grace: Technical Plan

Status: implementation complete; downstream production integration pending

Target package: `packages/teamplay`

Baseline: `teamplay@0.5.1`, commit `805b885`

## Implementation Log

### 2026-08-01: Characterization and focused GREEN

The focused RED command was:

```sh
cd packages/teamplay
npm run test-server -- --grep "Direct document transport grace"
```

On the unmodified `0.5.1` runtime, the three characterization tests produced
two expected failures and one pass:

- final-owner removal changed active mode from `subscribe` to `idle` during
  the grace;
- quick adoption emitted `subscribe -> unsubscribe -> subscribe` instead of
  preserving the live transport;
- final expiry already performed one complete teardown.

The minimal runtime change adds a private target-mode calculation to
`DocSubscriptions` and uses it only in direct-document reconciliation. The
owner-derived desired mode remains unchanged.

Focused implementation coverage is GREEN for:

- live retention, adoption, and expiry;
- zero-delay compatibility;
- eager fetch and mixed live/fetch transitions;
- subscribe/teardown races, pending operations, force/root cleanup, and an
  unsubscribe failure retry;
- same-hash churn and bounded cleanup of abandoned unique hashes;
- explicit eager query and aggregation transport contracts;
- the public `sub()` / `unsub()` path with a real test ShareDB document.

### 2026-08-01: Retain handoff audit

A post-GREEN review found a separate ownership edge: a query could call
`docSubscriptions.retain()` while an ownerless live document was in grace.
`retain()` canceled pending destruction but did not reconcile transport mode,
which would let a query-retained document keep the direct live wire
indefinitely.

A new RED test reproduced active mode `subscribe` after the retain handoff.
The fix keeps `cancelDestroy()`'s public `void` contract and has `retain()`
reconcile only when it canceled a pending destroy. The test is now GREEN:
query retain keeps runtime/data but closes direct live transport eagerly.

### 2026-08-01: Validation results

| Check | Result |
| --- | --- |
| Focused direct grace and non-goal tests | 18 passing |
| Related retain/GC/grace tests | 31 passing |
| Full TeamPlay server suite | 444 passing, 4 pending |
| TeamPlay client suite | 4 suites, 103 tests passing |
| Internal type tests | passing |
| External-consumer type tests | passing |
| Babel plugin suite | 30 passing |
| Root lint | passing |
| Root build | passing |

The combined `yarn test` command is not consistently green because of a
pre-existing order/GC-dependent query assertion in `root finalization`:
`rootCloseQueries` exposes `null` through the runtime view while the assertion
expects `undefined`. The same failure was reproduced on a clean detached
`origin/master` worktree (`419 passing`, `4 pending`, one identical failure),
and the affected isolated root suites pass (`19 passing`). One standalone full
server run on this branch passed all 444 tests; the combined run later hit the
same baseline query failure after all new direct-grace tests passed.

### 2026-08-01: Downstream LMS boundary

A local LMS smoke temporarily replaced only the installed
`teamplay/dist/orm/Doc.js` with this branch's built output and started the
player-bundle branch on port 8082. The current LMS branch serves preserved
production HTML whose hashed script files belong to an earlier static export;
the new dev server therefore returned HTML for those script URLs and Chromium
rejected them by MIME type before app JavaScript ran. This does not validate or
invalidate TeamPlay runtime behavior. The temporary dependency was restored by
SHA and the LMS worktree remains clean.

The downstream route trace must be repeated after the TeamPlay package is
integrated and a fresh LMS production player artifact is exported.

TeamPlay implementation and package-level validation are complete. Fresh LMS
production export, route trace, and product smoke remain pending.

## 1. Problem

TeamPlay already keeps a direct-document runtime and its materialized data for
`subscriptionGcDelay` after the last owner leaves. The default delay is 3,000
ms. The live ShareDB transport does not receive the same grace:

1. `DocSubscriptions.unsubscribe()` removes the final owner.
2. It schedules delayed runtime destruction.
3. It immediately calls `reconcileTransport()`.
4. With no owners, `getDesiredTransportMode()` returns `idle` and the ShareDB
   document is unsubscribed immediately.
5. A new owner arriving inside the GC window reuses the runtime and data, but
   must open a new wire subscription and pay another round trip.

The LearnActive direct-stage experiment showed this exact handoff pattern:

- eight repeated direct-document subscriptions were removed;
- a 160 ms WebSocket RTT scenario improved from 3,794 ms to 3,096 ms;
- the measured gain was 698 ms (18.4%);
- the result matched a manual retain upper bound within 2 ms.

The intended change is to keep an already-live direct document subscribed
during the existing GC window. A new owner can adopt that transport. If no
owner arrives, the existing destroy path closes and destroys it at the normal
deadline.

## 2. Scope

### Included

- Direct public document transports managed by `DocSubscriptions`.
- Only an already-active `subscribe` transport.
- The existing `subscriptionGcDelay` as the grace duration.
- Existing explicit cleanup paths: timer expiry, `flushPendingDestroys()`,
  `clear()`, root disposal, forced destruction, and finalization.
- Lifecycle, race, cleanup, and bounded-retention tests.

### Excluded

- Query transports.
- Aggregation transports.
- `fetch` and fetch-only-root transports.
- New public configuration or API.
- LMS route-specific retain/handoff code.
- A TeamPlay package release or LMS dependency bump in the implementation PR.

Queries can retain large result sets and a live backend query. Aggregations use
the same query transport machinery and may also retain server computation.
Their pending-destroy accounting is owner-scoped, unlike the single
transport-scoped document timer. They need a separate measured load experiment
before any grace is introduced.

Fetch transports are also excluded. Reusing a completed fetch without issuing
a new fetch can return stale data because it has no live update stream.

## 3. Required Invariants

1. A direct live document with no owners and a pending GC destroy remains in
   `subscribe` mode until adoption or cleanup.
2. A matching live owner arriving before cleanup reuses the same runtime and
   wire subscription without `unsubscribe -> subscribe` churn.
3. The grace applies only when the owner count is zero. Normal multi-owner
   mode reconciliation remains unchanged.
4. A fetch-only owner is unfetched eagerly and must fetch again when it returns.
5. A live-to-fetch or fetch-to-live owner transition reconciles immediately;
   grace must never preserve the wrong transport mode.
6. Timer expiry closes the transport exactly once, waits for pending document
   operations, destroys the ShareDB document, disposes data, and removes all
   manager bookkeeping.
7. `subscriptionGcDelay = 0` preserves current eager teardown behavior.
8. Force paths never wait for grace: `clear()`, root disposal, explicit
   `destroy()`, and forced finalizer cleanup close immediately.
9. A failed transport transition must not create an unhandled rejection,
   duplicate timer, detached runtime, or untracked live subscription.
10. Query and aggregation transport behavior remains unchanged.

## 4. Proposed Runtime Design

Keep owner-derived intent separate from temporary transport retention.

Add a private `DocSubscriptions` helper with semantics similar to:

```js
getTargetTransportMode (hash) {
  const desiredMode = this.getDesiredTransportMode(hash)
  if (desiredMode !== 'idle') return desiredMode

  const entry = this.entries.get(hash)
  const activeMode = entry?.runtime?.activeTransportMode ?? entry?.mode
  const canReuseLiveTransport =
    entry?.pendingDestroy &&
    this.getEntryTotalCount(entry) === 0 &&
    activeMode === 'subscribe'

  return canReuseLiveTransport ? 'subscribe' : 'idle'
}
```

`reconcileTransport()` and every loop iteration in
`reconcileTransportNow()` should use the target mode. Owner calculations in
`getDesiredTransportMode()` remain unchanged.

This design uses the existing lifecycle ordering:

- final owner removal schedules `pendingDestroy` before reconciliation;
- a new owner calls `cancelDestroy()` before reconciliation;
- timer expiry and `flushPendingDestroys()` remove `pendingDestroy` before
  calling `destroyByHash()`;
- without `pendingDestroy`, the target becomes `idle` and normal teardown runs;
- force paths either remove the timer or never create it, so they remain eager.

No new entry field or public type is expected. If implementation reveals that
the temporary mode cannot be derived safely, stop and introduce an explicit
internal entry field instead of encoding the state in unrelated counters.

## 5. TDD Execution Plan

All behavioral changes start as failing tests. Use a long test GC delay and
`flushPendingDestroys()` to advance the lifecycle deterministically instead of
waiting for real timers.

### Phase A: Characterize the missing live grace

File: `packages/teamplay/test/subscriptionManagers.js`

Add a focused `Direct document transport grace` describe block.

1. **RED: final live owner keeps transport active during grace**
   - Subscribe a `MockDoc` in live mode.
   - Start the final unsubscribe without awaiting its delayed cleanup promise.
   - Assert one pending destroy, zero owners, the same runtime, active mode
     `subscribe`, and no `unsubscribe:subscribe` event.
   - Current `0.5.1` must fail on the active mode/event assertions.

2. **RED: quick live resubscribe adopts the transport**
   - Subscribe owner A, start its final unsubscribe, then subscribe owner B to
     the same hash before flushing cleanup.
   - Assert the first unsubscribe promise settles after adoption.
   - Assert the runtime identity is unchanged.
   - Assert the complete event sequence is only `subscribe:subscribe`.
   - Assert the canceled timer cannot destroy owner B later.

3. **RED: grace expiry performs one complete teardown**
   - Start final unsubscribe and call `flushPendingDestroys()`.
   - Assert exactly one `unsubscribe:subscribe`, one destroy, one dispose, and
     empty runtime/owner/timer maps.
   - Await the original unsubscribe promise to prove timer settlement is wired
     correctly.

Run only this describe block and record the expected RED failures before
changing runtime code.

### Phase B: Minimal green implementation

File: `packages/teamplay/src/orm/Doc.js`

1. Add the private target-mode helper described above.
2. Use it only inside document transport reconciliation.
3. Do not touch `Query.js`, `Aggregation.js`, React hooks, or public exports.
4. Run the Phase A tests after each source change.
5. Refactor naming only after all three tests are green.

### Phase C: Mode and configuration boundaries

File: `packages/teamplay/test/subscriptionManagers.js`

Add tests one at a time, RED then GREEN:

1. **Zero-delay compatibility**
   - With `subscriptionGcDelay = 0`, final live unsubscribe immediately emits
     `unsubscribe:subscribe` and removes the runtime.

2. **Fetch remains eager**
   - A fetch-only direct document emits `unsubscribe:fetch` before runtime GC.
   - A quick new fetch emits a second `subscribe:fetch`; it must not reuse a
     potentially stale completed fetch.

3. **Live-to-fetch handoff**
   - While a live transport is in grace, a fetch-only owner arrives.
   - Assert immediate `unsubscribe:subscribe -> subscribe:fetch` transition and
     no retained live transport.

4. **Mixed live/fetch owners**
   - With both owners active, removing the live owner immediately downgrades to
     fetch because a real fetch owner remains.
   - Grace starts only after the final fetch owner leaves, and fetch remains
     eager.

These tests prevent the optimization from changing freshness or transport-mode
semantics.

### Phase D: Races and hard cleanup

Files:

- `packages/teamplay/test/subscriptionManagers.js`
- `packages/teamplay/test/rootClose.js`
- `packages/teamplay/test/gcCleanup.js` only if the manager tests do not cover a
  real FinalizationRegistry edge.

Add the following tests incrementally:

1. **Unsubscribe while subscribe is in flight**
   - Use a gated mock subscription.
   - Remove the owner before the subscribe callback resolves.
   - After resolution, keep the completed live transport through grace.
   - On adoption, assert no redundant wire cycle.
   - Without adoption, flush and assert exactly one teardown.

2. **Resubscribe while teardown is in flight**
   - Gate the mock unsubscribe.
   - Add a new owner while teardown is transitioning.
   - Assert the state machine ends live with one necessary resubscribe and no
     detached runtime or stale target mode.

3. **Pending document operations**
   - Keep the existing behavior: grace can expire, but runtime destruction
     waits for `whenNothingPending()`.
   - Assert the wire closes once and final destruction happens after pending
     operations settle.

4. **Clear during grace**
   - `clear()` cancels the timer, closes immediately, settles the outstanding
     unsubscribe promise, and leaves no late timer effects.

5. **Root close during grace**
   - `releaseRootOwnedSubscriptions()` / `closeSignal()` force immediate cleanup
     when the closing root was the last owner.
   - When another root owns the same document, closing one root must keep the
     shared live transport.

6. **Finalizer and explicit force destroy**
   - Forced cleanup must bypass grace and stay idempotent when another cleanup
     path races it.

7. **Unsubscribe failure**
   - A transport failure at grace expiry is observable by an explicitly
     awaited unsubscribe.
   - The runtime remains tracked and can be cleaned by a later retry/clear.
   - No unhandled rejection or duplicate pending timer remains.

After every test, run `assertDocSubscriptionsConsistent(manager)`.

### Phase E: Public-path and non-goal contracts

Files:

- `packages/teamplay/test/sub$.js`
- `packages/teamplay/test/subscriptionManagers.js`

1. Add one real ShareDB/public API test using `sub()` and `unsub()`:
   - subscribe a direct live document;
   - begin `unsub()`;
   - verify the ShareDB document remains subscribed during grace;
   - call `sub()` again for the same document;
   - verify the runtime and wire subscription are reused;
   - flush final cleanup and verify the ShareDB document is unsubscribed.

2. Strengthen existing query GC tests:
   - query runtime may remain until GC, but query transport closes immediately;
   - aggregation transport follows the same eager rule.

3. Add a bounded-retention stress test with mock docs:
   - churn one hash repeatedly inside grace and assert one runtime, one timer at
     most, and one initial wire subscribe;
   - abandon many unique hashes and assert `flushPendingDestroys()` returns all
     maps and active transports to zero.

## 6. Documentation Changes During Implementation

Update `architecture.md` to state the exact distinction:

- direct live document: runtime, data, and live transport share the GC grace;
- direct fetch: runtime/data grace only, transport is eager;
- query/aggregation: runtime materialization grace only, transport is eager.

Update `tasks.md` when implementation starts and move the item to the completed
summary only after all acceptance checks pass.

No public API documentation is required unless implementation introduces a new
configuration option. The preferred implementation does not.

## 7. Verification Ladder

Run in this order, stopping at the first unexplained regression:

1. Focused RED/GREEN Mocha tests:

   ```sh
   cd packages/teamplay
   npm run test-server -- --grep "Direct document transport grace"
   ```

2. Related lifecycle suites:

   ```sh
   cd packages/teamplay
   npm run test-server -- --grep "Subscription GC grace delay|DocSubscriptions|root-owned direct|GC during in-flight"
   ```

3. Full TeamPlay server tests:

   ```sh
   cd packages/teamplay
   npm run test-server
   ```

4. Client, type, build, and lint checks:

   ```sh
   cd packages/teamplay
   npm run test-client
   npm run test-types
   npm run test-types:external
   cd ../..
   yarn lint
   yarn build
   ```

5. Full monorepo gate:

   ```sh
   yarn test
   ```

6. Downstream LMS verification after a local package/link or published patch:
   - repeat the direct NegoBot route trace at 160 ms WebSocket RTT;
   - require the eight duplicate phases to remain absent;
   - smoke Survey + `StudentUploadFile`, direct course, auth, redirect, denied
     access, stage-to-stage navigation, and root/session teardown;
   - compare active server subscriptions after navigation and after the 3-second
     grace to detect retention leaks.

## 8. Acceptance Criteria

The implementation PR is ready for review only when all of the following hold:

- the characterization test is demonstrably RED on `0.5.1` and GREEN with the
  patch;
- quick direct-live handoff produces no wire unsubscribe/resubscribe pair;
- final cleanup occurs once and leaves no active transport, runtime, owner,
  timer, or data entry;
- fetch, query, and aggregation transports retain their eager behavior;
- force cleanup and root isolation remain correct;
- race and pending-operation tests pass without sleeps tied to production
  timing;
- full TeamPlay tests, types, lint, and build pass;
- downstream LMS reproduces the subscription-phase reduction without new page
  or console errors.

## 9. Stop Conditions

Stop and redesign instead of widening the patch if any of these occur:

- grace requires changing query or aggregation ownership bookkeeping;
- a completed fetch would be reused without a new fetch;
- forced root cleanup must wait for the GC deadline;
- target-mode derivation cannot distinguish a real owner from temporary grace;
- server subscription count does not return to baseline after deadline;
- the downstream trace does not remove the measured duplicate direct-document
  subscriptions.
