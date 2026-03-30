# Teamplay Compatibility Mode

This folder contains the compatibility layer that emulates the old StartupJS (Racer/ShareDB) model API on top of Teamplay signals.

It includes:
1. `SignalCompat` — a signal class with legacy-style helpers like `.at()` and `.scope()`.
2. Compat hooks — `useValue`, `useLocal`, `useDoc`, `useQuery`, and related async/batch aliases.

All hooks are re-exported from `packages/teamplay/index.js`.

## Compatibility Mode Signal

Teamplay normally uses `Signal` as the default signal class. In compatibility mode, it switches to `SignalCompat`:

```js
// packages/teamplay/orm/Signal.js
export default globalThis?.teamplayCompatibilityMode ? SignalCompat : Signal
```

`SignalCompat` extends `Signal` with convenience methods that match StartupJS behavior:
- `at(path)` — access nested paths with dot notation.
- `scope(path)` — resolve a path from the root (ignores current signal path).
- `getCopy(path)`, `getDeepCopy(path)` — shallow/deep copies of data.
- Mutators with optional subpaths: `set`, `del`, `increment`, `push`, `remove`, etc.
- `leaf()`, `parent()` — path helpers.

Example:

```js
const $user = $.users.user1
const $profile = $user.at('profile')
const $rootProfile = $user.scope('users.user1.profile')
const name = $profile.name.get()
```

Note on `$` usage:
- `$` is a root signal proxy and callable `$()`.
- **For path strings** use `$.at('users.user1')` or `useModel('users.user1')`.
- `$root` and `model` are aliases to `$` for compat.

## SignalCompat API (Detailed)

Below is a detailed reference for methods available on compat signals. Most methods come from `Signal` (base), while `SignalCompat` adds path-aware variants and legacy helpers.

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

### path(subpath)

Returns a dot-separated path string for a nested subpath without creating a new signal. Accepts:
- string with dot path (`'a.b.c'`)
- integer index for arrays (`0`)

```js
$.users.user1.path('profile.age') // "users.user1.profile.age"
$.items.path(0) // "items.0"
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

### at(subpath)

Legacy path navigation. Accepts:
- string with dot path (`'a.b.c'`)
- integer index for arrays (`0`)
- multiple path segments (`'a', 'b', 0`)

```js
$.users.user1.at('profile.name')
$.users.user1.at('profile', 'name')
$.items.at(0)
```

### scope(path)

Resolve a path from root, ignoring the current signal path.

```js
$.users.user1.scope('users.user2')
$.users.user1.scope('users', 'user2')
```

### ref(target) / ref(subpath, target)

Creates a lightweight alias between signals (minimal Racer-style ref).
Mutations on the alias are forwarded to the target. The alias mirrors target updates.
Reads (`get`/`peek`) are forwarded to the target while the ref is active.
Ref mirroring is scheduled through Teamplay runtime scheduler, so updates remain batch-friendly
and do not leak intermediate ref states during a single batched cycle.

```js
const $local = $.local.value
const $user = $.users.user1
$local.ref($user)

const $session = $.session
$session.ref('tutoringSession', $user)
```

### removeRef(path?)

Stops syncing and forwarding for a ref.

```js
$local.removeRef()
$session.removeRef('tutoringSession')
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
- No automatic list index patching on insert/remove/move.
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

### get(subpath?)

Returns the current value and tracks reactivity.

```js
const name = $.users.user1.name.get()
$root.get('$render.url')
$user.get('profile.name')
$user.get('profile', 'name')
```

### peek(subpath?)

Returns the current value **without** tracking reactivity.

```js
const name = $.users.user1.name.peek()
$user.peek('profile.name')
$user.peek('profile', 'name')
```

### getCopy(subpath)

Shallow copy of the value. Optional `subpath` works like `at()`.

```js
const copy = $.users.user1.getCopy()
const copy2 = $.users.user1.getCopy('profile')
```

### getDeepCopy(subpath)

Deep copy of the value. Optional `subpath` works like `at()`.

```js
const deep = $.users.user1.getDeepCopy()
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
| `set` | Uses deep-diff path (`dataTree.set` + internal `setDiffDeep`). | Path-targeted replace semantics, Racer-like. `undefined` keeps delete semantics. |
| `setEach` | Not a special API in core mutators. | Per-key compat `set` (not `assign` merge/delete behavior). |
| `setDiffDeep` | Deep-diff engine (`utils/setDiffDeep.js`). | Recursive Racer-like diff implemented via compat mutators (`set` / `del`) on nested paths. |
| `setDiff` | N/A as compat shim. | Alias to compat `set` for both signatures: `setDiff(value)` and `setDiff(path, value)`. |

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
for immediate `useLocal` / `useModel` reads while that query remains subscribed, even if
some unrelated `useDoc` subscriber for the same `collection.id` unmounts.

### set(value) and set(path, value)

`SignalCompat` accepts both:

```js
$.users.user1.name.set('Alice')
$.users.user1.set('profile.name', 'Alice')
```

In compat mode, `set` replaces the value at the target path.
- `set(path, null)` stores `null`.
- `set(path, undefined)` applies current delete semantics.

```js
await $.users.user1.set('profile', { name: 'Ann', role: 'student' })
await $.users.user1.set('profile', { name: 'Kate' }) // role is removed
```

### setNull(path?, value)

Sets only if current value is `null` or `undefined`.

```js
$.config.setNull('theme', 'light')
```

### setDiffDeep(path?, value)

Applies a recursive Racer-like diff using compat mutators (`set` / `del`) on subpaths.
This is intentionally a compat implementation detail and differs from core deep-diff internals.

```js
await $.users.user1.set({ profile: { name: 'Ann', role: 'student' } })
await $.users.user1.setDiffDeep({ profile: { name: 'Kate' } }) // deep-diff path
```

### setDiff(path?, value)

Alias for compat `set` in both forms:
- `setDiff(value)` -> same as `set(value)`
- `setDiff(path, value)` -> same as `set(path, value)`

```js
await $.users.user1.setDiff({ profile: { name: 'Kate' } })
await $.users.user1.setDiff('profile', { name: 'Bob' })
```

### setEach(path?, object)

Racer-like per-key set. `setEach` iterates keys and applies compat `set` for each key.
- `setEach({ k: null })` stores `null`.
- `setEach({ k: undefined })` applies current delete semantics.

```js
await $.users.user1.setEach({ name: 'Bob', age: null })
```

### Null / Undefined Matrix (Compat)

| Call | Result |
| --- | --- |
| `set(path, null)` | stores `null` at `path` |
| `set(path, undefined)` | applies delete semantics at `path` |
| `setEach({ k: null })` | stores `null` for `k` |
| `setEach({ k: undefined })` | applies delete semantics for `k` |

```js
await $.users.user1.set('status', null) // status === null
await $.users.user1.setEach({ status: undefined }) // status deleted
```

### assign(object)

Assigns object fields. `null`/`undefined` deletes keys.

```js
$.users.user1.assign({ name: 'Bob', age: null })
```

### del(path?)

Deletes a value. Can be used with a subpath.
In compat mode, deleting a non-existing **public** document (or its subpath) is a no-op
to match legacy racer behavior.

```js
$.users.user1.del('profile.name')
```

### increment(path?, byNumber = 1)

Increments numeric values.

```js
$.users.user1.increment('score', 2)
```

### push / unshift / insert / pop / shift

Array mutators. All support optional `path`.

```js
$.users.user1.push('tags', 'new')
$.users.user1.insert('tags', 1, ['x', 'y'])
```

### remove(path?, index, howMany?)

Removes array elements. If called with **no arguments** on an array element signal, it removes that element.

```js
$.users.user1.remove('tags', 1)
$.users.user1.tags.at(0).remove()
```

### move(path?, from, to, howMany?)

Moves array elements.

```js
$.users.user1.move('tags', 0, 2)
```

### stringInsert / stringRemove

String mutators. Support optional `path`.

```js
$.doc.stringInsert('title', 3, 'abc')
$.doc.stringRemove('title', 1, 2)
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
await $user.increment('score', 1) // uses json0 op

// private doc (allowed only when publicOnly = false)
const $session = $.session
await $session.set('token', 'abc')
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

### Model Hook

#### `useModel`

```js
const $root = useModel()
const $user = useModel(`users.${userId}`)
const $settings = useModel($user.path('settings'))
```

Returns a signal for the given path. Accepts:
- no args → returns root signal
- string path (`'users.123'`)
- or a signal (returned as-is)

### Value / Local Hooks

#### `useValue$` / `useValue`

```js
const $count = useValue$(0)
const [count, $count] = useValue(0)
```

These create a local signal backed by `$local`. Useful as a reactive `useState` alternative.

#### `useLocal$` / `useLocal`

```js
const $lang = useLocal$('_page.lang')
const [lang, $lang] = useLocal('_page.lang')
```

`useLocal` accepts:
- a string path (`'_page.lang'`)
- or a signal with `path()` (e.g. `$signal`).

#### `useSession$` / `useSession`

Sugar on top of `useLocal` with `_session` prefix.

```js
const [userId, $userId] = useSession('userId')
const [session] = useSession() // root _session
```

#### `usePage$` / `usePage`

Sugar on top of `useLocal` with `_page` prefix.

```js
const [lang, $lang] = usePage('lang')
const [page] = usePage() // root _page
```

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

After `useBatch()` stops throwing in compat mode, immediate reads via
`useLocal(...).get(...)` for already requested batch entities should not produce
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
