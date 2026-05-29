# Teamplay Compatibility Mode

This folder contains the compatibility layer that emulates the old StartupJS (Racer/ShareDB) model API on top of Teamplay signals.

It includes:
1. `SignalCompat` — a signal class with Racer-compatible value semantics on the current signal path.
2. Compat subscription hooks — `useDoc`, `useQuery`, and related async/batch aliases.

All hooks are re-exported from `packages/teamplay/src/index.ts`.

## Compatibility Mode Signal

Teamplay normally uses `Signal` as the default signal class. In compatibility mode, it switches to `SignalCompat`:

```js
// packages/teamplay/src/orm/Signal.js
export default globalThis?.teamplayCompatibilityMode ? SignalCompat : Signal
```

`SignalCompat` extends `Signal` with convenience methods that match supported StartupJS behavior:
- `getCopy()`, `getDeepCopy()` — shallow/deep copies of current signal data.
- Mutators on the current signal path: `set`, `setReplace`, `del`, `increment`, `push`, `remove`, etc.
- `leaf()`, `parent()` — path helpers.
- `root()` — owning root signal method for explicit root traversal.

Legacy cursor helpers `.at()` / `.scope()` and path-first overloads like `get(path)` / `set(path, value)`
are intentionally not part of the current compat API. Use child-signal traversal instead.

Example:

```js
const $user = $.users.user1
const $profile = $user.profile
const $rootProfile = $user.root().users.user1.profile
const name = $profile.name.get()
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
const $query = $.query('courses', { active: true })
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

### query(collection, query, options?)

Creates a query signal **without** subscribing. Supports shorthand params:
- array of ids → `{ _id: { $in: ids } }`
- single id → `{ _id: id }`

If `query` is `undefined`, a safe non-existent query is used.
If `query` contains `$aggregate` or `$aggregationName`, an aggregation signal is returned.

```js
const $$active = $.query('users', { active: true })
const $$byIds = $.query('users', ['u1', 'u2'])
const $$single = $.query('users', 'u1')
const $$agg = $.query('stores', { $aggregate: [{ $match: { active: true } }] })
```

### subscribe(...signals) / unsubscribe(...signals)

Subscribes or unsubscribes doc/query/aggregation signals.
- If called on a signal with **no args**, it subscribes/unsubscribes **that** signal.
- If passed arguments, it treats them as a list (arrays are flattened, falsy values ignored).

```js
const $$active = $.query('users', { active: true })
await $$active.subscribe()

const $user = $.users.user1
await $.subscribe($user, $$active)
$.unsubscribe($user, $$active)
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

Fetch-only variants of `subscribe` / `unsubscribe`. They load data once without a live subscription.

```js
const $$active = $.query('users', { active: true })
await $$active.fetch()
$$active.unfetch()
```

### getExtra()

Returns the query/aggregation `extra` payload:
- Query signals → `extra` (e.g. `$count`, server `extra`)
- Aggregation signals → the aggregated array (same as `.get()`)

```js
const $$count = $.query('users', { active: true, $count: true })
await $$count.subscribe()
const count = $$count.getExtra()

const $$agg = $.query('stores', { $aggregate: [{ $match: { active: true } }] })
await $$agg.subscribe()
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
| `setEach` | Not a special API in core mutators. | Per-key compat `set` on the current signal (not `assign` merge/delete behavior). |
| `setDiffDeep` | Deep-diff engine (`utils/setDiffDeep.js`). | Recursive Racer-like diff implemented via compat mutators (`set` / `del`) below the current signal. |
| `setDiff` | N/A as compat shim. | Racer-like full replace with exact-equality no-op (`===` / `NaN`). Equivalent objects / arrays still replace. |

Migration note: compat behavior is intentionally Racer-aligned and may differ from core mutators.
Composite compat mutators (`setEach`, `setDiffDeep`) apply updates atomically for Teamplay-scheduled observers via the runtime batch scheduler.

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
This means a doc that arrived through `useQuery` / `useBatchQuery` will stay available
for immediate direct object-tree reads while that query remains subscribed, even if
some unrelated `useDoc` subscriber for the same `collection.id` unmounts.

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

Applies a recursive Racer-like diff using compat mutators (`set` / `del`) below the current path.
This is intentionally a compat implementation detail and differs from core deep-diff internals.

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

Racer-like per-key set. `setEach` iterates keys and applies compat `set` for each key.
- `setEach({ k: null })` stores `null`.
- `setEach({ k: undefined })` applies current delete semantics.

```js
await $.users.user1.setEach({ name: 'Bob', age: null })
```

### Null / Undefined Matrix (Compat)

| Call | Result |
| --- | --- |
| `set(null)` | stores `null` at the current path |
| `set(undefined)` | applies delete semantics at the current path |
| `setEach({ k: null })` | stores `null` for `k` |
| `setEach({ k: undefined })` | applies delete semantics for `k` |

```js
await $.users.user1.status.set(null) // status === null
await $.users.user1.setEach({ status: undefined }) // status deleted
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
- In `publicOnly` mode, private mutations throw.

### Public Collections and `publicOnly`

Public collections are those **not** starting with `_` or `$`.  
Private collections start with `_` or `$` (e.g. `_session`, `_page`, `$render`).

Behavior:
- Public collections use **JSON0 ops** for mutators (`increment`, array/string ops).
- When `publicOnly` is enabled, **private** mutations throw.
- ID fields are normalized and protected for public documents (`_id`/`id`).

Example:

```js
// public document
const $user = $.users.user1
await $user.score.increment(1) // uses json0 op

// private doc (allowed only when publicOnly = false)
const $session = $.session
await $session.token.set('abc')
```

### Queries and Aggregations

Teamplay stores query results in `$queries.<hash>`.  
Query signals:
- Are iterable.
- Support `.map`, `.reduce`, `.find`.
- Provide `getIds()` for convenience.

```js
const [users, $users] = useQuery('users', { active: true })
for (const $u of $users) {
  console.log($u.getId())
}
```

Aggregations:
- Expose docs as signals similar to queries.
- `getId()` works on aggregation result items (when `_id` or `id` exists).
- **Setting a whole doc via `.set()` on aggregation is prohibited**.
  You can only update subpaths.

```js
const [items] = useQuery('orders', { $aggregate: [...] })

// OK: update field inside aggregation result doc
items[0].amount.set(10)

// NOT OK: setting entire doc from aggregation signal
items[0].set({ amount: 10 }) // throws
```

---

## Compat Hooks Overview

All hooks are built on top of Teamplay’s signal system and `useSub` / `useAsyncSub`.
They are designed to behave close to StartupJS hooks, but adapted to Teamplay’s API.

General notes:
- Hooks should be used inside `observer()` components to get reactive updates.
- Sync hooks (`useDoc`, `useQuery`) use Suspense by default (via `useSub`).
- In compatibility mode, sync hooks are strict (`defer: false`) to match racer-like
  semantics and avoid transient `undefined` / empty snapshots during fast navigation.
  This is enforced by compat hooks (user `defer` option is ignored for sync hooks).
- Async hooks (`useAsyncDoc`, `useAsyncQuery`) never throw; they return `undefined` until ready.
- Batch hooks use a Suspense batch barrier (`useBatch`) and wait for both
  subscribe promises and DataTree materialization readiness.

### Events

Compatibility mode supports **two layers** of events:

- **Custom events** (manual `emit`)
- **Model events** (`change` / `all` with path patterns)

Model events are **only active in compatibility mode**.

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

### Doc Hooks

#### `useDoc$` / `useDoc`

```js
const [user, $user] = useDoc('users', userId)
```

Behavior:
- Subscribes to a single doc.
- If `id == null`, a warning is logged and `__NULL__` is used.

#### `useAsyncDoc$` / `useAsyncDoc`

```js
const [user, $user] = useAsyncDoc('users', userId)
if (!user) return 'Loading...'
```

Returns `undefined` until subscription resolves.

#### Batch variants

`useBatchDoc` / `useBatchDoc$` participate in batch Suspense flow:
- they register subscribe promises for `useBatch()`;
- they also register a **materialization readiness check**:
  doc is considered ready only when it is visible in DataTree (or explicitly missing).

### Query Hooks

#### `useQuery$` / `useQuery`

```js
const [users, $users] = useQuery('users', { active: true })
```

Important: the **second return value is the collection**, not the query signal.
This matches StartupJS and makes updates easy:

```js
$users[userId].name.set('New Name')
```

`useQuery$` returns the **query signal**:

```js
const $query = useQuery$('users', { active: true })
const ids = $query.getIds()
const docs = $query.get()
```

If `query == null`, a warning is logged and `{ _id: '__NON_EXISTENT__' }` is used.
If `query` is not an object, an error is thrown.

#### `useAsyncQuery$` / `useAsyncQuery`

```js
const [users, $users] = useAsyncQuery('users', { active: true })
if (!users) return 'Loading...'
```

Async variant: no Suspense, returns `undefined` until ready.

#### Batch variants

`useBatchQuery` / `useBatchQuery$` participate in batch Suspense flow:
- they register subscribe promises for `useBatch()`;
- they register a **query readiness check**:
  query ids must be materialized in DataTree, and each `collection.id` from ids must
  be visible in DataTree (or explicitly missing).
- for `$aggregate` queries, readiness is query-level:
  DataTree must have `$queries.<hash>.docs` (array, including empty), or `extra`.
  Aggregate rows are not required to exist as `collection.<id>` docs.
  Presence of `$queries.<hash>.ids` alone does not mark aggregate readiness.
  For Teamplay aggregation subscriptions, `$aggregations.<hash>` also marks readiness.

### Query Helpers

#### `useQueryIds`

```js
const [users] = useQueryIds('users', ['b', 'a'])
// preserves order: users[0] is 'b', users[1] is 'a'
```

Options:
- `reverse: true` — reverse order of IDs before mapping.

`useBatchQueryIds` and `useAsyncQueryIds` are batch/async variants.

#### `useQueryDoc`

Returns a **single doc** matched by query:

```js
const [doc, $doc] = useQueryDoc('events', { slugId })
```

Implementation details:
- Adds `$limit: 1`
- Adds default `$sort: { createdAt: -1 }` if `$sort` is missing

`useQueryDoc$` returns only the doc signal (or `undefined`).
`useBatchQueryDoc` / `useAsyncQueryDoc` are batch/async variants.

### Batch Barrier

`useBatch()` is a Suspense barrier for batch hooks.

It throws while:
- batch subscribe promises are pending;
- or subscribe promises are resolved but requested docs/queries are not yet
  materialized in DataTree.

After `useBatch()` stops throwing in compat mode, immediate direct object-tree reads
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

### useDoc with Suspense

```js
const Component = observer(() => {
  const [user, $user] = useDoc('users', userId)
  return <button onClick={() => $user.name.set('New')}>{user.name}</button>
})
```

### useAsyncDoc

```js
const Component = observer(() => {
  const [user] = useAsyncDoc('users', userId)
  if (!user) return 'Loading...'
  return user.name
})
```

### useQuery / useQuery$

```js
const Component = observer(() => {
  const [users, $users] = useQuery('users', { active: true })
  const $query = useQuery$('users', { active: true })
  const ids = $query.getIds()
  return (
    <>
      {users.map(u => <div key={u._id}>{u.name}</div>)}
      <button onClick={() => $users[userId].name.set('New')}>Rename</button>
    </>
  )
})
```

### useQueryIds

```js
const [users] = useQueryIds('users', ['b', 'a'])
// users are ordered by ids array
```

### useQueryDoc

```js
const [latest, $latest] = useQueryDoc('events', { type: 'webinar' })
if (!latest) return null
return <span>{latest.title}</span>
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
