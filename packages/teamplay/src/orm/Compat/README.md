# Teamplay Compatibility Mode

This folder contains the compatibility layer that emulates the old StartupJS (Racer/ShareDB) model API on top of Teamplay signals.

It includes:
1. `SignalCompat` — a signal class with Racer-compatible value semantics on the current signal path.
2. Compat event helpers for custom events and legacy model events.

React subscriptions are exposed through object-tree APIs from
`packages/teamplay/src/index.ts`: `useSub`, `useAsyncSub`, and `useBatchSub`.

## Compatibility Mode Signal

Teamplay normally uses `Signal` as the default signal class. In compatibility mode, it switches to `SignalCompat`:

```js
// packages/teamplay/src/orm/Signal.js
export default globalThis?.teamplayCompatibilityMode ? SignalCompat : Signal
```

The base `Signal` API now includes the current-path convenience methods used by
regular TeamPlay code:
- `getCopy()`, `getDeepCopy()` — shallow/deep copies of current signal data.
- `getExtra()` — query extra / aggregation rows getter.
- `setDiff()`, `setDiffDeep()`, `setEach()`, `setNull()` — current-path mutators.
- Mutators on the current signal path: `set`, `setReplace`, `del`, `increment`, `push`, `remove`, etc.

`SignalCompat` keeps legacy behavior that still needs compatibility handling:
- `ref()` / `removeRef()` forwarding and mirror semantics.
- imperative `query()` / `subscribe()` / `fetch()` lifecycle helpers.
- model events and `silent()` wrappers.
- `leaf()`, `parent()` — path helpers.
- `root()` — owning root signal method for explicit root traversal.

Legacy cursor helpers `.at()` / `.scope()`, path-first overloads like `get(path)` / `set(path, value)`,
and root-call collection helpers like `add(collection, object)` are intentionally not part of the current
compat API. Use child-signal traversal instead.

Example:

```js
const $user = $.users.user1
const $profile = $user.profile
const $rootProfile = $user.root().users.user1.profile
const name = $profile.name.get()
const id = await $.users.add({ name: 'Ada' })
```

Note on `$` usage:
- `$` is a root signal proxy and callable `$()`.
- Prefer direct child traversal (`$.users.user1`). Compat hooks may still accept path strings.

## SignalCompat API (Detailed)

Below is a detailed reference for methods available on compat signals. Most methods come from `Signal` (base), while `SignalCompat` keeps supported Racer-compatible semantics without path-first overloads.

### Root Call `$()`

The root signal is callable. Calling it creates a local `$local` signal:

```js
const $value = $(123)
const $reaction = $(() => someOtherSignal.get() + 1)
```

If a function is passed, a reactive local signal is created from that function (reaction).

### path()

Returns the current signal path as a dot-separated string.

```js
$.users.user1.name.path() // "users.user1.name"
```

### leaf()

Returns the last path segment as a string. For root returns `''`.

```js
$.users.user1.name.leaf() // "name"
```

### parent(levels = 1)

Returns the parent signal. `levels` can be greater than 1.

```js
$.users.user1.name.parent()    // $.users.user1
$.users.user1.name.parent(2)   // $.users
```

### ref(target)

Creates a lightweight alias between signals (minimal Racer-style ref).
Mutations on the alias are forwarded to the target. The alias mirrors target updates.
Reads expose the mirrored target value while the ref is active.
Ref mirroring is scheduled through Teamplay runtime scheduler, so updates remain batch-friendly
and do not leak intermediate ref states during a single batched cycle.

Source path restriction:
- The ref source path (`$from`) must be in a private collection (`_session`, `_page`, `$local`, etc.).
- Public source paths are not supported.

```js
const $local = $.local.value
const $user = $.users.user1
$local.ref($user)

const $session = $.session
$session.tutoringSession.ref($user)
```

### removeRef()

Stops syncing and forwarding for a ref.

```js
$local.removeRef()
$session.tutoringSession.removeRef()
```

### ref() example (what equals / what doesn’t)

```js
const $user = $.users.u1
const $alias = $.session.userAlias

await $user.set({ name: 'Ann', role: 'student' })

// Without ref
$alias.get()                       // undefined
$alias.get() === $user.get()       // false

// With ref
$alias.ref($user)
$alias.get()                       // { name: 'Ann', role: 'student' }
$alias.get() === $user.get()       // true (by value)
$alias === $user                   // false (different signals)
$alias.path() === $user.path()     // false

// Writes via alias update target
await $alias.set({ name: 'Bob' })
$user.get()                        // { name: 'Bob' }
$alias.get()                       // { name: 'Bob' }

// removeRef freezes alias with last value
$alias.removeRef()
await $user.set({ name: 'Kate' })
$user.get()                        // { name: 'Kate' }
$alias.get()                       // { name: 'Bob' }
$alias.get() === $user.get()       // false
```

### `ref` on query/aggregation targets (`mirror-only`)

Compat supports `refExtra` / `refIds` and query/aggregation-backed refs, but with a
different contract from plain document refs.

When target is a query or aggregation signal, compat creates a **mirror-only** link:
- Source path is updated from target changes (target -> source).
- Source path does **not** become an alias to target path (no `REF_TARGET` forwarding).
- Writes to source path do not forward to query/aggregation internals.

Why:
- Query/aggregation paths are hashed/synthetic and are not safe as generic alias targets.
- Racer behavior for these cases is effectively "mirror data into page/local path",
  not "make full bidirectional alias".

Reactivity:
- Initial sync runs immediately on `ref(...)`.
- Further target updates are mirrored through compat model-change events.

```js
const $query = await sub($.courses, { active: true })
const $table = $._page.tables._adminCourses

// mirror query.extra/docs into page model
$query.refExtra('_page.tables._adminCourses.dataSource')

// reactively mirrors target -> source
$table.dataSource.get()
```

**Limitations vs Racer**
- No `refList`, `refMap`.
- No event emissions specific to refs.
- No support for racer-style ref meta/options beyond the basic signature.

### start(targetPath, ...deps, getter)

Legacy computed binding API from Racer/StartupJS.
Creates a reactive computation and writes its result into `targetPath`.
Source of truth is root API (`$root.start(...)`), but non-root calls are supported as sugar:
- `$scope.start('a.b', ...deps, getter)` → `$root.start('<scopePath>.a.b', ...deps, getter)`

- `targetPath`: string path where computed value is written.
- `deps`: dependencies used by `getter`.
- `getter`: function called as `getter(...resolvedDeps)`.

Dependency resolution:
- Signal-like dep (`$doc`, `$session.user`) → `dep.get()`.
- String dep (`'settings.theme'`) → `$root.get(dep)`.
- Any other dep → passed as-is.

```js
$root.start('_virtual.lesson', $.lessons[lessonId], '_session.userId', (lesson, userId) => {
  if (!lesson) return undefined
  return { stageIds: lesson.stageIds, userId }
})
```

Behavior:
- Calling `start()` again for the same `targetPath` replaces previous reaction.
- `undefined` result applies compat delete semantics at target path.
- `null` result is stored as `null`.
- Returns target signal.
- If any dependency temporarily suspends (throws a Promise/thenable), compat skips the whole tick (getter is not called and target is not written).
- If `getter` throws a Promise, compat skips that tick and retries on next reactive update.

### stop(targetPath)

Stops a computation created with `start(targetPath, ...)`.
No-op if there is no active computation for the path.
Source of truth is root API (`$root.stop(...)`), but non-root calls are supported as sugar:
- `$scope.stop('a.b')` → `$root.stop('<scopePath>.a.b')`
- `$scope.stop()` → `$root.stop('<scopePath>')`

```js
$root.stop('_virtual.lesson')
```

### Removed: query() / subscribe() / unsubscribe()

Compat no longer exposes Racer-style imperative query lifecycle helpers:

- `model.query(collection, params)`
- `$query.subscribe()` / `$query.unsubscribe()`
- `model.subscribe(...signals)` / `model.unsubscribe(...signals)`

Use the explicit Teamplay subscription API instead:

```js
const $active = await sub($.users, { active: true })
const $user = await sub($.users.user1)

await unsub($active)
await unsub($user)
```

For aggregations:

```js
const $rows = await sub($.stores, { $aggregate: [{ $match: { active: true } }] })
await unsub($rows)
```

### close(callback?)

Compatibility shim for legacy `model.close()` calls.

- In Teamplay, `$`/`model` is a global root signal (not a per-request Racer model instance).
- Therefore `close()` is intentionally a no-op.
- Optional callback is supported and called immediately.

```js
model.close()
model.close(() => console.log('closed'))
```

### fetch(...signals) / unfetch(...signals)

Fetch-only helpers remain for direct doc/query signals, but new code should prefer explicit transport mode:

```js
const $active = await sub($.users, { active: true }, { mode: 'fetch' })
await unsub($active)
```

### getExtra()

Returns the query/aggregation `extra` payload:
- Query signals → `extra` (e.g. `$count`, server `extra`)
- Aggregation signals → the aggregated array (same as `.get()`)

```js
const $$count = await sub($.users, { active: true, $count: true })
const count = $$count.getExtra()

const $$agg = await sub($.stores, { $aggregate: [{ $match: { active: true } }] })
const rows = $$agg.getExtra()
```

### get()

Returns the current value and tracks reactivity.

```js
const name = $.users.user1.name.get()
$root.$render.url.get()
$user.profile.name.get()
```

### peek()

Returns the current value **without** tracking reactivity.

```js
const name = $.users.user1.name.peek()
$user.profile.name.peek()
```

### getCopy()

Shallow copy of the current signal value.

```js
const copy = $.users.user1.getCopy()
const copy2 = $.users.user1.profile.getCopy()
```

### getDeepCopy()

Deep copy of the current signal value.

```js
const deep = $.users.user1.getDeepCopy()
const profile = $.users.user1.profile.getDeepCopy()
```

### getId()

Returns the document id for document signals. For aggregations and queries, returns the id of the underlying doc when applicable.

```js
$.users.user1.getId() // "user1"
```

### getIds()

For query or aggregation signals returns array of ids. For other signals returns `[]` and logs a warning.

```js
const ids = $query.getIds()
```

### getCollection()

Returns the collection name.

```js
$.users.user1.getCollection() // "users"
```

### map / reduce / find

Works on arrays or query signals. For queries it maps over docs, returning doc signals.

```js
const names = $.users.map($u => $u.name.get())
```

### Iteration

Signals are iterable for arrays and queries:

```js
for (const $doc of $query) {
  console.log($doc.getId())
}
```

### Mutator Semantics (Core vs Compat)

Compatibility mode intentionally aligns mutators with Racer. This differs from core `Signal` behavior.

| API | Core (`Signal`) | Compat (`SignalCompat`) |
| --- | --- | --- |
| `set` | Uses deep-diff path (`dataTree.set` + internal `setDiffDeep`). | Current-path replace semantics, Racer-like. `undefined` keeps delete semantics. |
| `setReplace` | Explicit current-path replace. | Same current-path replace intent as compat `set` for non-`undefined` values. |
| `setEach` | Per-key replace semantics on the current signal. | Same core behavior plus ref forwarding. |
| `setDiffDeep` | Recursive current-path diff with empty target object preservation. | Same core behavior plus ref forwarding and silent/ref mirror handling. |
| `setDiff` | Racer-like full replace with exact-equality no-op (`===` / `NaN`). Equivalent objects / arrays still replace. | Same core behavior plus ref forwarding. |

Migration note: these convenience mutators are available in both modes. Compat mode
adds legacy ref/event behavior around them, but the current-path API shape is the same.
Composite mutators (`setEach`, `setDiffDeep`) apply updates atomically for Teamplay-scheduled observers via the runtime batch scheduler.

### Subscription GC Delay (Compat)

To reduce UI blink on rapid `unsub -> sub` cycles, compat uses an unload grace period for docs/queries.

- Default in compat: `300ms`
- Default in non-compat: `0ms` (immediate cleanup)

You can tune it globally:

```js
import { getSubscriptionGcDelay, setSubscriptionGcDelay } from 'teamplay'

setSubscriptionGcDelay(500)
console.log(getSubscriptionGcDelay()) // 500
```

When refCount drops to `0`, unsubscribe/destroy is scheduled after this delay.
If a new subscribe arrives before timeout, pending destroy is cancelled and the same doc/query instance is reused.

Compat queries also retain lifecycle ownership of docs they materialize into DataTree.
This means a doc that arrived through `useSub` / `useBatchSub` will stay available
for immediate direct object-tree reads while that query remains subscribed, even if
some unrelated doc subscriber for the same `collection.id` unmounts.

### set(value) and setReplace(value)

`SignalCompat` mutates the current signal path only:

```js
$.users.user1.name.set('Alice')
$.users.user1.profile.name.set('Alice')
$.users.user1.profile.setReplace({ name: 'Alice' })
```

In compat mode, `set` replaces the value at the current path.
- `set(null)` stores `null`.
- `set(undefined)` applies current delete/nullish semantics.
- `setReplace(value)` is the explicit replace API and exists in both compat and non-compat.

```js
await $.users.user1.profile.set({ name: 'Ann', role: 'student' })
await $.users.user1.profile.set({ name: 'Kate' }) // role is removed
```

### setNull(value)

Sets only if current value is `null` or `undefined`.

```js
$.config.theme.setNull('light')
```

### setDiffDeep(value)

Applies a recursive current-path diff below the current path.
Stale object keys are removed recursively and empty target objects are preserved.

```js
await $.users.user1.set({ profile: { name: 'Ann', role: 'student' } })
await $.users.user1.setDiffDeep({ profile: { name: 'Kate' } }) // deep-diff path
```

### setDiff(value)

Racer-like full replace at the current path.
- No-op only when previous and next values are exactly equal (`===`) or both `NaN`
- Equivalent objects / arrays still perform a replace
- Unlike `setDiffDeep`, this is not a recursive diff

```js
await $.users.user1.count.set(1)
await $.users.user1.count.setDiff(1) // no-op

await $.users.user1.setDiff({ profile: { name: 'Kate' } })
await $.users.user1.profile.setDiff({ name: 'Bob' }) // full replace
```

### setEach(object)

Per-key replace. `setEach` iterates keys and applies current-path replace semantics for each key.
- `setEach({ k: null })` stores `null`.
- `setEach({ k: undefined })` keeps `undefined` for private values and normalizes public document subpaths to `null`.

```js
await $.users.user1.setEach({ name: 'Bob', age: null })
```

### Null / Undefined Matrix (Compat)

| Call | Result |
| --- | --- |
| `set(null)` | stores `null` at the current path |
| `set(undefined)` | applies delete semantics at the current path |
| `setEach({ k: null })` | stores `null` for `k` |
| `setEach({ k: undefined })` | private: keeps key with `undefined`; public doc subpath: normalizes to `null` |

```js
await $.users.user1.status.set(null) // status === null
await $._session.userDraft.setEach({ status: undefined }) // key exists with undefined
```

### assign(object)

Assigns object fields. `null`/`undefined` deletes keys.

```js
$.users.user1.assign({ name: 'Bob', age: null })
```

### del()

Deletes the current signal value.
In compat mode, deleting a non-existing **public** document (or its subpath) is a no-op
to match legacy racer behavior.

```js
$.users.user1.profile.name.del()
```

### increment(byNumber = 1)

Increments numeric values.

```js
$.users.user1.score.increment(2)
```

### push / unshift / insert / pop / shift

Array mutators operate on the current array signal.

```js
$.users.user1.tags.push('new')
$.users.user1.tags.insert(1, ['x', 'y'])
```

### remove(index?, howMany?)

Removes array elements. If called with **no arguments** on an array element signal, it removes that element.

```js
$.users.user1.tags.remove(1)
$.users.user1.tags[0].remove()
```

### move(from, to, howMany?)

Moves array elements.

```js
$.users.user1.tags.move(0, 2)
```

### stringInsert / stringRemove

String mutators operate on the current string signal.

```js
$.doc.title.stringInsert(3, 'abc')
$.doc.title.stringRemove(1, 2)
```

### Error behavior and constraints

Some operations are not allowed:
- Mutating root or collection signals throws.
- Array/string mutators on query signals throw.

### Public and Private Collections

Public collections are those **not** starting with `_` or `$`.  
Private collections start with `_` or `$` (e.g. `_session`, `_page`, `$render`).

Behavior:
- Public collections use **JSON0 ops** for mutators (`increment`, array/string ops).
- Private collections are stored in root-scoped private storage.
- `setPublicOnly()` is a deprecated no-op kept for older bootstrap code.
- On the server, private writes through the global root log a warning because they create process-global private state.
- ID fields are normalized and protected for public documents (`_id`/`id`).

Example:

```js
// public document
const $user = $.users.user1
await $user.score.increment(1) // uses json0 op

// request/root-scoped private doc
const $session = req.model._session
await $session.token.set('abc')
```

### Queries and Aggregations

Teamplay stores query results in `$queries.<hash>`.  
Query signals:
- Are iterable.
- Support `.map`, `.reduce`, `.find`.
- Provide `getIds()` for convenience.

```js
const $usersQuery = useSub($.users, { active: true })
for (const $u of $usersQuery) {
  console.log($u.getId())
}
```

Aggregations:
- Expose docs as signals similar to queries.
- `getId()` works on aggregation result items (when `_id` or `id` exists).
- **Setting a whole doc via `.set()` on aggregation is prohibited**.
  You can only update subpaths.

```js
const $itemsQuery = useSub($.orders, { $aggregate: [...] })
const items = $itemsQuery.get()

// OK: update field inside aggregation result doc
items[0].amount.set(10)

// NOT OK: setting entire doc from aggregation signal
items[0].set({ amount: 10 }) // throws
```

---

## Compat Hooks Overview

React subscription hooks are built on top of Teamplay's object-tree signal API.
Compat path-based doc/query hooks are no longer exported.

General notes:
- Hooks should be used inside `observer()` components to get reactive updates.
- Direct compat doc/query hooks were removed. Use object-tree subscriptions instead:
  `useSub($.users[userId])`, `useSub($.users, query)`, `useAsyncSub(...)`.
- Batch subscriptions use a Suspense batch barrier (`useBatchSub()`) and wait for both
  subscribe promises and DataTree materialization readiness.

### Events

Teamplay supports custom events in core. Compatibility mode additionally
supports Racer-style model events:

- **Custom events** (manual `emit`)
- **Model events** (`change` / `all` with path patterns)

Custom events are available in both modes. Model events are **only active in
compatibility mode**.

#### Custom Events

##### `emit`

```js
emit('Voting.agree', payload)
```

Emits a custom event.

##### `useOn` (custom)

```js
useOn('Voting.agree', () => {
  // handle event
})
```

Subscribes to a custom event and cleans up on unmount.

##### `useEmit`

```js
const emit = useEmit()
emit('url', '/home')
```

Returns a stable `emit` function.

#### Model Events (compat only)

Model events mirror Racer-style subscriptions and are emitted on any data mutation.
Supported event names:

- `change` — basic change event
- `all` — same as `change`, but includes event name

```js
useOn('change', 'tenants.${id}.features.*', (featureKey, value, prevValue, meta) => {
  // featureKey = 'someFeature'
})

useOn('all', 'stages.*', (stageId, eventName, value, prevValue, meta) => {
  // eventName = 'change'
})
```

Pattern rules:
- `*` matches **one segment** and is passed to the handler.
- `**` matches **any suffix** and is passed as a dot-string.

```js
useOn('all', 'docs.**', (path, eventName, value) => {
  // path = '123.title' (suffix after "docs")
})
```

When there are no wildcards in the pattern, the handler signature is:

```
(value, prevValue, meta)
```

When wildcards exist, their captures are **prepended**:

```
(* captures..., value, prevValue, meta)
```

For `all`, `eventName` is inserted after captures:

```
(* captures..., eventName, value, prevValue, meta)
```

Model events can also be subscribed using `SignalCompat` directly:

```js
$root.on('change', 'docs.*.status', (docId, value) => {})
$root.removeListener('change', handler)
```

Limitations vs Racer:
- Only `change`/`all` events are supported (no `insert`/`remove`/`move` event names).
- `eventName` for `all` is always `'change'` in this compat layer.

### Doc Subscriptions

Direct compat doc hooks (`useDoc`, `useDoc$`, `useAsyncDoc`, `useAsyncDoc$`) are no
longer exported. Use object-tree subscriptions:

```js
const $user = useSub($.users[userId])
const user = $user.get()

const $asyncUser = useAsyncSub($.users[userId])
const asyncUser = $asyncUser?.get()
```

For batch behavior use `useBatchSub`:

```js
const $user = useBatchSub($.users[userId], { defer: false })
useBatchSub()
```

`useBatchSub` is syntax sugar over `useSub(..., { batch: true, async: false })`.
Both forms register subscribe promises for the batch barrier. The barrier can be
closed with no-arg `useBatchSub()` or with
`useSub(undefined, undefined, { batch: true })`.
For document subscriptions it also registers a **materialization readiness check**:
the doc is considered ready only when it is visible in DataTree (or explicitly
missing).

### Query Subscriptions

Direct compat query hooks (`useQuery`, `useQuery$`, `useAsyncQuery`,
`useAsyncQuery$`) are no longer exported. Use object-tree subscriptions:

```js
const $usersQuery = useSub($.users, { active: true })
const users = $usersQuery.get()
const ids = $usersQuery.getIds()
const $users = $.users
```

For batch behavior use `useBatchSub`:

```js
const $usersQuery = useBatchSub($.users, { active: true }, { defer: false })
useBatchSub()
const users = $usersQuery.get()
```

`useBatchSub` is syntax sugar over `useSub(..., { batch: true, async: false })`.
Both forms register subscribe promises for the batch barrier. The barrier can be
closed with no-arg `useBatchSub()` or with
`useSub(undefined, undefined, { batch: true })`.
For query subscriptions it also registers a **query readiness check**:
  query ids must be materialized in DataTree, and each `collection.id` from ids must
  be visible in DataTree (or explicitly missing).
- for `$aggregate` queries, readiness is query-level:
  DataTree must have `$queries.<hash>.docs` (array, including empty), or `extra`.
  Aggregate rows are not required to exist as `collection.<id>` docs.
  Presence of `$queries.<hash>.ids` alone does not mark aggregate readiness.
  For Teamplay aggregation subscriptions, `$aggregations.<hash>` also marks readiness.

### Query Helpers

Query helper hooks (`useQueryIds`, `useAsyncQueryIds`, `useQueryDoc`,
`useQueryDoc$`, `useAsyncQueryDoc`, `useAsyncQueryDoc$`, and their batch
variants) are no longer exported from TeamPlay compat. Keep product-specific
query helpers in application code and build them on top of `useSub`,
`useAsyncSub`, or `useBatchSub`.

### Batch Barrier

`useBatchSub()` with no arguments is a Suspense barrier for batch subscriptions.
The lower-level equivalent is `useSub(undefined, undefined, { batch: true })`.

It throws while:
- batch subscribe promises are pending;
- or subscribe promises are resolved but requested docs/queries are not yet
  materialized in DataTree.

After `useBatchSub()` stops throwing, immediate direct object-tree reads
for already requested batch entities should not produce
transient `undefined` caused by materialization races.

### Missing ShareDB Docs

Compat now mirrors Racer behavior for **missing public docs** (`type === null`,
`version === 0`) after subscribe/fetch:

- `connection.get(collection, id).data` becomes a truthy empty observable object;
- but the compat/model path still stays unresolved, so `$.collection[id].get()`
  continues to return `undefined` until the document is actually created.

This matters for legacy consumers which read `shareDoc.data` directly (for
example readonly rich-text paths) while still expecting normal public-doc
creation semantics from model mutators.

## Examples

### Doc subscription with Suspense

```js
const Component = observer(() => {
  const $user = useSub($.users[userId])
  const user = $user.get()
  return <button onClick={() => $user.name.set('New')}>{user.name}</button>
})
```

### Async doc subscription

```js
const Component = observer(() => {
  const $user = useAsyncSub($.users[userId])
  const user = $user?.get()
  if (!user) return 'Loading...'
  return user.name
})
```

### Query subscription

```js
const Component = observer(() => {
  const $query = useSub($.users, { active: true })
  const users = $query.get()
  const ids = $query.getIds()
  return (
    <>
      {users.map(u => <div key={u._id}>{u.name}</div>)}
      <button onClick={() => $.users[userId].name.set('New')}>Rename</button>
    </>
  )
})
```

### Suspense Gates for Thrown Thenables

If you use the legacy pattern "throw a promise from render and stop rendering
below this point", prefer `useSuspendMemo()` or `useSuspendMemoByKey()` over
plain `useMemo()`.

Why:

- React may restart a suspended initial render.
- `useMemo()` is not a reliable semantic gate for thenables.
- Side-effectful async work like `join()` may start again during retry.

#### When to use `useSuspendMemo()`

Use `useSuspendMemo()` when the gate is local to one observer component
instance.

```js
import { observer, useSuspendMemo } from 'teamplay'

const PStage = observer(({ $stage, $user, stageId, stageUserStore }) => {
  useSuspendMemo(() => {
    if (!stageUserStore?.startedAt) {
      throw $stage.join($user.id.get())
    }
  }, [stageId])

  return <span>Ready</span>
})
```

This gives you the old "suspend here until ready" shape, but keeps the same
pending thenable for the same hook slot while this component instance is alive.

#### When to use `useSuspendMemoByKey()`

Use `useSuspendMemoByKey()` when dedupe should follow the business operation
itself, not the current component instance.

```js
import { observer, useSuspendMemoByKey } from 'teamplay'

const PStage = observer(({ $stage, $user, stageId, stageUserStore }) => {
  useSuspendMemoByKey(
    `stage.join:${stageId}:${$user.id.get()}`,
    () => {
      if (!stageUserStore?.startedAt) {
        throw $stage.join($user.id.get())
      }
    },
    [stageId, !!stageUserStore?.startedAt]
  )

  return <span>Ready</span>
})
```

This is the right choice when:

- the component may remount while `join()` is still pending;
- two different components may try to start the same `join()`;
- you want one in-flight task per business key like
  `stage.join:${stageId}:${userId}`.

#### Practical difference

Suppose `stage.join(userId)` is pending:

- `useSuspendMemo()`
  Keeps one pending thenable for this exact hook slot in this exact component
  instance.
- `useSuspendMemoByKey()`
  Keeps one pending thenable for the whole business operation, even across
  remounts or different components that use the same key.

For mutation-like operations such as `join()`, `ensure*()`, `create*()` or
`validate*()`, `useSuspendMemoByKey()` is usually the safer choice.
