# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [0.6.0](https://github.com/startupjs/teamplay/compare/v0.5.12...v0.6.0) (2026-10-09)


* teamplay 0.6: racer-style linger, leak fixes, atomic re-subscribe, React 19 only, diagnostics (#55) ([63d4124](https://github.com/startupjs/teamplay/commit/63d4124409e79b031a1f7fea93a51d5a938973a0)), closes [#55](https://github.com/startupjs/teamplay/issues/55)


### BREAKING CHANGES

* `__setUseDeferredValue()` is no longer exported.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>

* refactor(teamplay): SuspenseGroup uses useLayoutEffect directly

utils/useIsomorphicLayoutEffect.js picked useEffect on the server only
to avoid React 18's "useLayoutEffect does nothing on the server"
warning. React 19 removed that warning (its server renderer treats
useLayoutEffect as a no-op), so GroupCommitMarker calls useLayoutEffect
and the helper is deleted.

A side effect: isServer() is true under jest (Node), so the client
tests used to run the marker with useEffect while browsers ran it with
useLayoutEffect; they now run the browser code path. The SSR test now
asserts that server rendering logs no error at all.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>

* test(teamplay): an observer recovers after <Activity> hides and shows it (failing)

React 19.2's <Activity mode="hidden"> keeps a subtree mounted but runs
its effect cleanups, and runs the effects again when it shows the
subtree. The observer wrapper treats the useSyncExternalStore
unsubscribe as an unmount and destroys its state on the next task
(cache, destroy callbacks, scheduleUpdate), and nothing recreates it
when the wrapper subscribes again. After a hide/show cycle:
- every render acquires a new useSub() lease (the cache no longer
  stores it), and
- scheduled updates are dropped, so a re-subscribe that keeps the
  previous result never re-renders when the new one is ready.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>

* fix(teamplay): an observer recovers after <Activity> hides and shows it

<Activity mode="hidden"> (React 19.2) runs the effect cleanups of a
subtree it keeps mounted. The observer wrapper's useSyncExternalStore
unsubscribe then destroys the wrapper's state on the next task, exactly
as for an unmount: its useSub() leases are released and the subtree
holds no subscription while hidden, which is what we want. But the
destroy also dropped the cache, the destroy-callback set and
scheduleUpdate for good, so once Activity showed the subtree again every
render acquired a new lease and scheduled updates (a re-subscribe that
keeps the previous result until the new one is ready) never re-rendered
it (fixes the previous test).

destroyAdm() now empties the wrapper's cache and destroy callbacks
instead of discarding them, and a wrapper that subscribes again after
it was destroyed is usable as before (diagnostics count it as created
again). An unmounted wrapper is still released the same way; it just
keeps two empty collections until it is collected.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>

* feat(teamplay)!: require React 19

The `react` peer dependency of teamplay is now `>=19.0.0` (it was `*`);
react-native and async-storage peers are unchanged. The React layer is
written and tested for React 19 only: the client suite runs on React
19, and the React 18 code paths are gone (previous commits).

Docs:
- CHANGELOG.md and packages/teamplay/CHANGELOG.md: an Unreleased (next
  minor) section, "BREAKING: requires React 19", listing the removed
  APIs (`__setUseDeferredValue()`, `useSubClassic()`,
  `useIsomorphicLayoutEffect`) and the observer fixes found on React 19;
- architecture.md: React 19 requirement, how the observer wrapper
  notifies React (snapshot even without a listener, no notification
  after unsubscribe, reuse after <Activity> shows it again), client
  tests on React 19 and their helpers;
- installation and React integration guides, both READMEs: React 19+;
- tasks.md: the React 19-only state, and two parking-lot notes
  (observer's forwardRef option on React 19, unused universalSub.js);
- 46_uncommitted-lease-churn.js: its comment no longer suggests running
  React 19 by hand.
* teamplay requires React 19 (`react >= 19.0.0`).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>

* chore(scripts): bundle-size check for the teamplay main entry

scripts/bundle-size.mjs bundles a typical app entry
(import { $, useSub, sub, observer } from 'teamplay', react external) with
esbuild, minified, and reports raw and gzip bytes for any mix of the working
tree, other checkouts and git refs:

- tree-shaken: esbuild with tree shaking, dependencies bundled
- metro-like: no tree shaking, so every module reachable from the entry
  ships whole, as with Metro (React Native, Expo)
- own-code: no tree shaking, teamplay's own packages only

It also lists the src/diagnostics/* modules in the metro-like bundle, and
--check fails when a diagnostics module other than the always-loaded switch
(hooks.ts) is reachable from the working tree's main entry.

  node scripts/bundle-size.mjs master teamplay-leakfix .

Measured before the lazy split (gzip, metro-like): master 92,405,
teamplay-leakfix 109,047 (+16,642): diagnostics/state, instrument,
collect, leaks and index ship in every bundle.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>

* feat(diagnostics): load the implementation only where apps import it

Diagnostics shipped whole in every bundle: the main entry imported
diagnostics/index.ts, and Metro (React Native, Expo) does not tree-shake.
LMS web bundles grew by 6-12 KB gzip and broke their budget with
diagnostics off.

Now the runtime imports only diagnostics/hooks.ts. It holds the `diag`
object with the `diag.on` switch and the shared `diagnostics` API object.
Everything else loads with 'teamplay/diagnostics': the collectors, leak
checks, manager instrumentation, trace buffer, counting FinalizationRegistry
wrapper and the flag parsing.

- Hook sites call diag.record(), diag.noteLeaseCreated(), ... behind
  `if (diag.on)`. install.ts adds those functions when the subpath loads,
  and the switch turns on only after that. src/react changes are limited to
  the diag lines.
- install.ts is the first import of diagnostics/index.ts and imports no
  runtime module. Loaded before 'teamplay', it installs the hooks and applies
  globalThis.__TEAMPLAY_DIAGNOSTICS__ / TEAMPLAY_DIAGNOSTICS before any
  runtime module evaluates.
- utils/MockFinalizationRegistry.ts creates plain registries again. Once
  diagnostics are loaded it asks diag.createFinalizationRegistry() for a
  counting wrapper (diagnostics/finalization.ts). Registries created earlier
  are not counted and show up as finalization.untracked; finalization.exact
  is true only when diagnostics loaded first with a startup flag.
- Node: a new "node" export condition resolves 'teamplay' to
  src/index.node.ts, which loads 'teamplay/diagnostics' before the runtime.
  TEAMPLAY_DIAGNOSTICS and `import { diagnostics } from 'teamplay'` keep
  working unchanged on servers.
- 'teamplay/diagnostics/enable' loads diagnostics and switches them on.
- API: `diagnostics` from 'teamplay' is the same object as before, but until
  the subpath loads only isEnabled() and disable() exist and enable() throws
  an error that names the import. enableDiagnostics, disableDiagnostics and
  isDiagnosticsEnabled are exported from 'teamplay/diagnostics' only.

Bundle (gzip, app entry with $, useSub, sub, observer): master 107,542,
teamplay-leakfix 127,933 (+20,391), this change 110,262 (+2,720) with real
Metro 0.83 production builds. The same branch with every diagnostics hook
stripped is +2,069, so diagnostics-off costs about 650 B. The rest is the
leak fixes. esbuild metro-like: 92,406 / 109,049 / 94,436.

Tests: test/diagnosticsLazy.js checks the import graph (the main entry
reaches only hooks.ts; the installer reaches no runtime module), an esbuild
bundle when esbuild is installed, and each way to load and enable in a child
process (bundler entry without the subpath, Node entry with and without
TEAMPLAY_DIAGNOSTICS, global flag + subpath first, the enable subpath, late
load). Mocha preloads the subpath (.mocharc.cjs) like the Node entry. Jest
loads it per file only with TEAMPLAY_DIAGNOSTICS (setupFiles); the
diagnostics test files import it first. The other files run against the
bare main entry.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>

* docs(diagnostics): loading and enabling per environment

The Diagnostics guide now separates loading the implementation from
switching it on, and covers each environment:

- Node: automatic (the "node" export condition), TEAMPLAY_DIAGNOSTICS.
- Browser bundles: import 'teamplay/diagnostics' first, behind a build-time
  constant to keep it out of production.
- Metro and Expo: no tree shaking. Use
  `if (process.env.EXPO_PUBLIC_TEAMPLAY_DIAGNOSTICS) require(...)` in a
  module the entry imports first (or `__DEV__`). Metro folds the constant
  before it collects dependencies, so production builds drop the module.
  Checked with Metro 0.83: a production bundle with `if (__DEV__)` around the
  require has no diagnostics; a dev bundle has them.
- Playwright: the build under test must include the subpath; the fixture
  only sets the global flag.

It also covers why the subpath should load first (finalization.exact,
finalization.untracked), what `diagnostics` from 'teamplay' can do before
the subpath loads, and the bundle cost (0.3-0.7 KB gzip without the subpath,
16-20 KB with it). architecture.md describes the hooks.ts / install.ts split.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>

* test(teamplay): skip the <Activity> tests on React 19.0 and 19.1

The peer range is react >= 19.0.0, but <Activity> only exists from
React 19.2: import React as a namespace so 53_activity.js loads on
every supported version and skips its tests where Activity is missing.
The committed dev dependency (19.2.4) runs them.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>

* chore(teamplay): keep .mocharc.cjs out of the npm package

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>

* chore: local prerelease version 0.6.0-next.0

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>

* test(teamplay): observers mounting in a concurrent render re-render alone on an update (failing)

An update can reach an observer wrapper that rendered in a concurrent
render (a transition, a Suspense retry, useSub()'s deferred render) but
has not subscribed yet: React yields to the event loop while it renders.
Since 7d516c5 the wrapper changes its useSyncExternalStore snapshot even
without a listener, so React's store consistency check fails at the end
of that render and React renders the whole root again synchronously,
discarding every component mounting in it: 30 items mount 60 times and
render 60 times instead of mounting 30 times and re-rendering the one
item the update was for (31 renders).

Three cases: a signal the observer read changes during a transition, a
promise passed to useScheduleUpdate() settles during a transition, and a
signal changes while React retries a Suspense boundary (the path of a
suspending useSub(), e.g. with defer: false). The tests run without
act(), which renders a transition without yielding. They pass at
eaa14ba, right before 7d516c5.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>

* fix(teamplay): an update before an observer subscribes no longer re-renders the whole root

7d516c5 made the observer wrapper change its useSyncExternalStore
snapshot on every update, also while React has no listener, and relied on
useSyncExternalStore's check after it subscribes to re-render. But a
wrapper without a listener is often one that rendered in a concurrent
render still in progress: React subscribes after the commit and yields to
the event loop while it renders a transition, a Suspense retry (every
suspending useSub(), e.g. with defer: false) or useSub()'s deferred
render. Before committing such a render React checks that no snapshot it
rendered changed; one did, so React rendered the whole root again
synchronously, discarding every component mounting in it, which then
rendered from scratch with a new wrapper, reaction and useSub() leases
(the LMS's E2E harness counted ~29% more observer wrappers, +16% lease
creates and more uncommitted-lease releases with the same commits).

notify() now changes the snapshot only while React listens, as before
7d516c5. Without a listener it marks the update pending, and the next
subscribe() delivers it right away (changes the snapshot and calls
React's new listener, which re-renders in the same flush): children's
effects that write before their wrapper subscribes, a StrictMode replay,
<Activity> showing a hidden subtree. The unsubscribe still drops the
listener at once, so React is never notified after it unsubscribed (the
leak 7d516c5 fixed), and an unmounted wrapper just keeps the flag.

Fixes the previous test (30 items: 30 mounts and 31 renders instead of
60 and 60).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>

* test(teamplay): dependent useSub() calls switch without a fallback or an unloaded document

useSub() defers by default (useDeferredValue) so that switching the first
of several subscriptions that depend on each other (a user, the user's
course, the course's lesson) keeps the previous documents on screen until
the new ones are loaded. Nothing tested it. The test switches the user
with every subscription slowed down and checks every committed state: no
Suspense fallback, all three documents loaded, and the chain only moves
forward (a document switches after the one it depends on did), ending
consistent.

It does not assert that the chain is held back as a whole: between the
first new document and the last, the component commits mixed states
(U2/C1/L1, U2/C2/L1), in 0.5.12 as well as now, since the hooks below the
one that changed defer their own new value during the urgent re-render
the ready subscription triggers.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>

* feat(teamplay): the subscription GC delay can come from the runtime config

An app can set how long an unsubscribed doc or query stays subscribed in
the runtime config object it already uses for idFields:
globalThis[Symbol.for('teamplay.runtimeConfig')].subscriptionGcDelay, or
configureTeamplay({ subscriptionGcDelay }) (null removes it). It is read
on every getSubscriptionGcDelay() call, so it applies whenever the app
sets it, before or after teamplay loads; setSubscriptionGcDelay() still
takes precedence, and setSubscriptionGcDelay(null) goes back to the
config (3000 ms without one). An invalid value throws, like an invalid
idFields. getTeamplayConfig() reports the delay in effect.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>

* test(teamplay): dependent subscriptions commit only consistent states (failing)

A component whose subscriptions depend on each other (A, then the B that
A points to, then the C that B points to) commits mixed states when A
switches to a document that is not subscribed yet: a2/b1/c1, a2/b2/c1,
then a2/b2/c2, deferred (the default) and with defer: false alike. A
deferred re-subscribe returns the previous signal from its background
render instead of suspending, so every link commits as soon as it loads,
and the urgent re-render that follows shows the next link's previous
target.

The tests record every commit (useLayoutEffect) and every DOM state
(MutationObserver) and require that no state mixes a link with a target
the link above does not point to, and that:
- deferred (default): the previous chain stays on screen without the
  fallback until the new chain is loaded, then commits at once;
- defer: false (hook or observer()): the re-subscribe suspends to the
  fallback until the new chain is loaded;
- a1 -> a2 -> a3 in quick succession ends at a3 (deferred: without
  committing a2);
- a switch back to a warm chain needs no loading.
They cover document chains, document -> query -> documents, document ->
aggregation -> documents, useBatchSub() chains (with a sibling in the
same barrier), a child observer subscribing to an id from its parent, a
subscription GC delay of 0 (uncommitted leases released at once), a link
slower than the 1000 ms an uncommitted lease is held, and that a switch
neither loops (react.lease.reacquireLoop) nor churns leases. Every
scenario runs under act() and with React's own scheduler (createRoot()
without act()). The documents are created through a separate connection
and the server answers the client's requests after a delay, so every
first subscription is slow (setTestThrottling() only delays the promise a
render throws, not the subscription).

34 of the 38 tests fail; the 4 warm-chain tests pass.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>

* fix(teamplay): dependent subscriptions switch atomically, never one link at a time

useSub() never returns a signal whose subscription is not ready any more
(useAsyncSub() still returns undefined): a pending lease throws its
readiness promise on a re-subscribe as on the first render, and a batch
adds it to the barrier, which then suspends on a re-subscribe too. Before,
a re-subscribe returned the previous signal and scheduled an update
(useSubDeferred(), "keep previous snapshot during update re-subscribe",
d657f53), so the background render of a deferred hook never suspended and
every link of a chain of dependent subscriptions committed as soon as it
loaded (a2/b1/c1, a2/b2/c1, ...), with defer: false too.

- Deferred (the default): the signal and the serialized params still go
  through useDeferredValue(). An urgent render gets the committed ones
  (their lease is ready) and renders the previous consistent state; the
  new ones appear only in React's deferred (transition-lane) render, where
  a suspension keeps the committed UI on screen without the fallback.
  React retries it when the promise settles, the next dependent hook gets
  its new input in that non-urgent render (useDeferredValue() returns it
  at once there) and suspends in turn, until the component, and any child
  observer rendered in the same deferred render, commits the new chain at
  once. Switching again meanwhile ends at the last target.
- defer: false: a re-subscribe in an urgent render suspends to the
  fallback until the new chain is loaded.
- A target that is already subscribed returns synchronously, as before.

Supporting changes:
- Each hook remembers the lease of its last commit. An urgent render of
  the committed target while the deferred render waits for a new one is
  served by it; the pending lease stays in the cache for the deferred
  render (before, the two renders replaced each other's lease, and the
  commit of the urgent one released the pending one).
- A component that has committed arms renderAttemptDestroyer's gate when
  it suspends, so trapRender keeps its observer reaction: a change of what
  the suspended render read (the id switched again) still re-renders it
  (the reaction was destroyed, so a click during a switch went unnoticed
  until the pending promise settled).
- Both useDeferredValue() calls run in every mode, fed a constant when the
  hook does not defer, so the hook order no longer depends on the defer
  option; the urgent render that turns deferring on renders the committed
  target, as useDeferredValue() would have. Params are serialized once per
  render and parsed only to acquire a new lease (they were serialized
  twice and parsed once per deferred render).
- A batched target that is already subscribed but still materializing is
  waited for whenever the hook has not committed it (it was only on the
  first render).

Tests that pinned the old behaviour:
- 30_react-extended: "keeps previous signal during update resubscribe",
  "keeps previous query signal during update resubscribe" and "keeps
  previous docs for no-guard local reads during query switches" are
  useBatchSub(..., { defer: false }) switches that expected no fallback.
  Returning the previous signal there was the bug, and they passed only
  because the hidden content and the fallback share an element id. They
  now expect the fallback on screen (visibleText() finds the visible
  element) and that the new lesson is never read unloaded; renamed
  accordingly. The default/explicit-defer siblings check the visible
  element too (the previous content stays).
- 55_deferred-dependent-subscriptions documented the mixed commits
  (U2/C1/L1, U2/C2/L1) as expected; it now requires only U1/C1/L1 and
  U2/C2/L2.
- 53_activity: a comment said a defer: false re-subscribe keeps the
  previous query result; it suspends now (the test is unchanged).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>

* feat(teamplay): forceDefer makes every subscription hook ignore defer: false

An app can make useSub(), useBatchSub() and useAsyncSub() always defer a
re-subscribe, ignoring defer: false of a hook and of observer(), in the
runtime config object it already uses for idFields:
globalThis[Symbol.for('teamplay.runtimeConfig')].forceDefer = true, or
configureTeamplay({ forceDefer: true }) (null removes it). It is read on
every render, so it applies whenever the app sets it, before or after
teamplay loads. setForceDefer(true | false) (exported from 'teamplay',
next to setSubscriptionGcDelay()) takes precedence over the config, and
setForceDefer(null) goes back to it; getForceDefer() and
getTeamplayConfig().forceDefer return the value in effect. A value that
is not a boolean throws, like an invalid idFields.

A mounted component picks a change up on its next render without breaking
its hooks (both useDeferredValue() calls run in every mode); the urgent
render that turns deferring on keeps the committed target, so the switch
that follows shows no fallback. The async mode is unchanged: deferred, it
returns undefined in the background render while the new target loads.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>

* docs(teamplay): re-subscribe consistency, defer semantics and forceDefer

- docs/api/use-sub-hook.md: "Re-subscribing: consistency and defer" (what
  a component shows while a chain of dependent subscriptions switches, in
  each mode; warm targets; the first render; useAsyncSub(); live data of a
  subscribed document; across components) and "Ignoring defer: false
  everywhere (forceDefer)"; useBatchSub()'s barrier on a re-subscribe.
- docs/guide/react-integration.md: "Switching subscriptions"; what
  defer: false does for useBatchSub().
- docs/api/sub-function.md: forceDefer in the runtime config.
- architecture.md: how the atomic switch works (useDeferredValue(), the
  suspended deferred render, the committed lease serving urgent renders,
  the reaction kept through a suspension, the sentinel that keeps the hook
  order, uncommitted leases of a waiting chain).
- CHANGELOG (Unreleased): the fix, the behaviour changes of defer: false
  and useBatchSub() re-subscribes, and forceDefer.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>

* chore: local prerelease version 0.6.0-next.2

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>

* chore: restore the package version for the release

The local prerelease versions (0.5.13-next.*, 0.6.0-next.*) were only for
installing test builds into LMS; lerna sets the real version on publish.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>

* test(teamplay): findModel() does not split registered patterns on every lookup (failing)

Ported from the LMS app's guard test for its local findModel() patch.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>

* perf(teamplay): findModel() splits the registered patterns once

findModel() runs on every signal lookup (getSignalClass, idFields) and split
every registered pattern on each call: with the LMS app's ~250 models that was
most of the cost of creating a signal and a fifth of its E2E server's JS time.
The patterns are now split once and grouped by segment count, in registration
order (the first match still wins). Every change to MODELS, through addModel()
or written to it directly (tests swap models in and out), drops the index; the
next lookup rebuilds it. Upstreams the LMS app's local findModel() patch.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>

* docs: complete the unreleased 0.6.0 changelog

Adds the subscription linger, leak fixes, unsub() and aggregation-row write
changes, diagnostics, the GC delay runtime config and the performance fixes,
and makes the package changelog match the root one.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>





## [0.5.12](/compare/v0.5.11...v0.5.12) (2026-09-24)

**Note:** Version bump only for package example





## [0.5.11](/compare/v0.5.10...v0.5.11) (2026-09-08)

**Note:** Version bump only for package example





## [0.5.10](/compare/v0.5.9...v0.5.10) (2026-08-20)

**Note:** Version bump only for package example





## [0.5.9](/compare/v0.5.8...v0.5.9) (2026-08-13)

**Note:** Version bump only for package example





## [0.5.8](https://github.com/startupjs/teamplay/compare/v0.5.7...v0.5.8) (2026-08-10)

**Note:** Version bump only for package example





## [0.5.7](https://github.com/startupjs/teamplay/compare/v0.5.6...v0.5.7) (2026-08-07)

**Note:** Version bump only for package example





## [0.5.6](https://github.com/startupjs/teamplay/compare/v0.5.5...v0.5.6) (2026-08-06)

**Note:** Version bump only for package example





## [0.5.5](https://github.com/startupjs/teamplay/compare/v0.5.4...v0.5.5) (2026-08-06)

**Note:** Version bump only for package example





## [0.5.4](https://github.com/startupjs/teamplay/compare/v0.5.3...v0.5.4) (2026-08-06)

**Note:** Version bump only for package example





## [0.5.3](https://github.com/startupjs/teamplay/compare/v0.5.2...v0.5.3) (2026-08-05)

**Note:** Version bump only for package example





## [0.5.2](https://github.com/startupjs/teamplay/compare/v0.5.1...v0.5.2) (2026-08-01)

**Note:** Version bump only for package example





## [0.5.1](https://github.com/startupjs/teamplay/compare/v0.5.0...v0.5.1) (2026-07-30)

**Note:** Version bump only for package example





# [0.5.0](https://github.com/startupjs/teamplay/compare/v0.5.0-alpha.38...v0.5.0) (2026-06-24)

**Note:** Version bump only for package example





# [0.4.0](https://github.com/startupjs/teamplay/compare/v0.3.35...v0.4.0) (2026-05-03)


### Features






## [0.3.35](https://github.com/startupjs/teamplay/compare/v0.3.34...v0.3.35) (2026-02-12)

**Note:** Version bump only for package example





## [0.3.34](https://github.com/startupjs/teamplay/compare/v0.3.33...v0.3.34) (2026-01-14)

**Note:** Version bump only for package example





## [0.3.33](https://github.com/startupjs/teamplay/compare/v0.3.32...v0.3.33) (2026-01-14)

**Note:** Version bump only for package example





## [0.3.32](https://github.com/startupjs/teamplay/compare/v0.3.31...v0.3.32) (2026-01-14)

**Note:** Version bump only for package example





## [0.3.31](https://github.com/startupjs/teamplay/compare/v0.3.30...v0.3.31) (2026-01-14)

**Note:** Version bump only for package example





## [0.3.30](https://github.com/startupjs/teamplay/compare/v0.3.29...v0.3.30) (2026-01-01)


### Features

* add offline support ([#21](https://github.com/startupjs/teamplay/issues/21)) ([77ed88c](https://github.com/startupjs/teamplay/commit/77ed88c8b39fab6b35c91c925cd7f42ba3477f98))
