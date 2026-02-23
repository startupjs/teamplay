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

### get()

Returns the current value and tracks reactivity.

```js
const name = $.users.user1.name.get()
```

### peek()

Returns the current value **without** tracking reactivity.

```js
const name = $.users.user1.name.peek()
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

### Events (Custom Only)

#### `emit`

```js
emit('Voting.agree', payload)
```

Emits a custom event. This simplified compat version only supports custom events
(no `change`/`all` model events yet).

#### `useOn`

```js
useOn('Voting.agree', () => {
  // handle event
})
```

Subscribes to a custom event and cleans up on unmount.

#### `useEmit`

```js
const emit = useEmit()
emit('url', '/home')
```

Returns a stable `emit` function.

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
