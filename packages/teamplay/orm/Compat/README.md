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

```js
$.users.user1.at('profile.name')
$.items.at(0)
```

### scope(path)

Resolve a path from root, ignoring the current signal path.

```js
$.users.user1.scope('users.user2')
```

### ref(target) / ref(subpath, target)

Creates a lightweight alias between signals (minimal Racer-style ref).
Mutations on the alias are forwarded to the target. The alias mirrors target updates.
Reads (`get`/`peek`) are forwarded to the target while the ref is active.

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

**Limitations vs Racer**
- No `refList`, `refExtra`, `refMap`.
- No automatic list index patching on insert/remove/move.
- No support for query/aggregation refs.
- No event emissions specific to refs.
- No support for racer-style ref meta/options beyond the basic signature.

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
```

### peek(subpath?)

Returns the current value **without** tracking reactivity.

```js
const name = $.users.user1.name.peek()
$user.peek('profile.name')
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

### set(value) and set(path, value)

`SignalCompat` accepts both:

```js
$.users.user1.name.set('Alice')
$.users.user1.set('profile.name', 'Alice')
```

In compat mode, `set` replaces values at the target path.

### setNull(path?, value)

Sets only if current value is `null` or `undefined`.

```js
$.config.setNull('theme', 'light')
```

### setDiffDeep(path?, value)

Applies a diff-deep update (uses base `Signal.set` internally).

```js
$.users.user1.setDiffDeep({ profile: { name: 'Alice' } })
```

### setDiff(path?, value)

Alias for `set()` in compat. Accepts the same arguments and semantics.

```js
$.users.user1.setDiff({ profile: { name: 'Alice' } })
```

### setEach(path?, object)

Shorthand for assign. Sets or deletes fields from an object.

```js
$.users.user1.setEach({ name: 'Bob', age: 30 })
```

### assign(object)

Assigns object fields. `null`/`undefined` deletes keys.

```js
$.users.user1.assign({ name: 'Bob', age: null })
```

### del(path?)

Deletes a value. Can be used with a subpath.

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
- Async hooks (`useAsyncDoc`, `useAsyncQuery`) never throw; they return `undefined` until ready.
- Batch hooks are **aliases**, no batching is implemented.

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

#### Batch aliases

`useBatchDoc` / `useBatchDoc$` are aliases to `useDoc` / `useDoc$`.
Batching is not implemented in Teamplay.

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

`useQuery$` returns the collection signal as well:

```js
const $users = useQuery$('users', { active: true })
```

If `query == null`, a warning is logged and `{ _id: '__NON_EXISTENT__' }` is used.
If `query` is not an object, an error is thrown.

#### `useAsyncQuery$` / `useAsyncQuery`

```js
const [users, $users] = useAsyncQuery('users', { active: true })
if (!users) return 'Loading...'
```

Async variant: no Suspense, returns `undefined` until ready.

#### Batch aliases

`useBatchQuery` / `useBatchQuery$` are aliases to `useQuery` / `useQuery$`.

### Query Helpers

#### `useQueryIds`

```js
const [users] = useQueryIds('users', ['b', 'a'])
// preserves order: users[0] is 'b', users[1] is 'a'
```

Options:
- `reverse: true` — reverse order of IDs before mapping.

`useBatchQueryIds` and `useAsyncQueryIds` are alias/async variants.

#### `useQueryDoc`

Returns a **single doc** matched by query:

```js
const [doc, $doc] = useQueryDoc('events', { slugId })
```

Implementation details:
- Adds `$limit: 1`
- Adds default `$sort: { createdAt: -1 }` if `$sort` is missing

`useQueryDoc$` returns only the doc signal (or `undefined`).
`useBatchQueryDoc` / `useAsyncQueryDoc` are alias/async variants.

### Batching Placeholder

`useBatch()` is a no-op placeholder.  
All batch hooks are **aliases** to their non-batch versions.

```js
useBatch() // does nothing in Teamplay
```

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
