# Compat Events (change/all) — Architecture Draft

This document describes a **fuller event system** for compatibility with StartupJS/Racer, extending the current custom-only `emit/useOn/useEmit` to support:

- `useOn('change', pathPattern, handler)`
- `useOn('all', pathPattern, handler)`
- pattern matching (`*` and `**`)
- integration with **REF** (aliasing) so events re-emit on ref paths

It is a **design/architecture plan**, not implemented yet.

---

## 1) Goals and Non-Goals

### Goals
- Preserve the simple `emit()` custom events behavior.
- Add **model change events** similar to Racer:
  - `change` — for a concrete path mutation
  - `all` — for any mutation with event name included
- Support patterns:
  - `*` = one segment
  - `**` = any number of segments
- React hooks API matches StartupJS patterns.
- Integrate with ref aliasing (see `REF.md`) so change events propagate via refs.

### Non-Goals
- Full Racer event system (insert/move etc. events mapped 1:1).
- Cross-process/event-bus (this is in-process only).
- Performance parity with Racer for very large event graphs.

---

## 2) Proposed Public API

### Custom events (current)
```js
emit('Voting.agree', payload)
useOn('Voting.agree', handler)
```

### Model events
```js
useOn('change', 'tenants.${id}.features.*', (path, value, prevValue, meta) => {
  // path = 'tenants.123.features.someFeature'
})

useOn('all', 'stores.*.value', (path, eventName, value, prevValue, meta) => {
  // eventName = 'change'
})
```

`useEmit()` still returns `emit`.

---

## 3) Event Types & Payload

### `change`
Triggered on any mutation (set/del/assign/array/string ops).
Payload:

```
(path, value, prevValue, meta)
```

Where:
- `path`: dot string of the mutated path
- `value`: new value at path
- `prevValue`: previous value (or undefined if not available)
- `meta`: optional info (op type, index for array ops, etc.)

### `all`
Triggered for **every** mutation, with event name included:

```
(path, eventName, value, prevValue, meta)
```

---

## 4) Pattern Matching Rules

### Syntax
- `a.b.c` — exact path match
- `a.*.c` — one segment wildcard
- `a.**` — any depth (including `a` itself)
- `**` — match everything

### Matching algorithm (simple)
Split both pattern and path by `.`.
Use recursive matching:

- If segment is `**`, it can match zero or more segments
- If segment is `*`, it matches one segment
- Otherwise must equal exact segment

Pseudo:

```js
function match(patternSegs, pathSegs) {
  if (patternSegs empty) return pathSegs empty
  if (patternSegs[0] === '**') {
    return match(patternSegs.slice(1), pathSegs) ||
           (pathSegs.length && match(patternSegs, pathSegs.slice(1)))
  }
  if (patternSegs[0] === '*') return pathSegs.length && match(patternSegs.slice(1), pathSegs.slice(1))
  return patternSegs[0] === pathSegs[0] && match(patternSegs.slice(1), pathSegs.slice(1))
}
```

---

## 5) Where to Emit Model Events

We need to emit for all write operations in the data tree. Candidate centralized points:

- `dataTree.set`
- `dataTree.del`
- `dataTree.setReplace`
- array mutators: `arrayPush/Unshift/Insert/Remove/Move/Pop/Shift`
- string mutators: `stringInsert/stringRemove`

Each should call:

```js
emitModelChange(path, value, prevValue, meta)
```

Where `path` is the segments joined by `.`.

### `meta` suggestion

```
{
  op: 'set' | 'del' | 'push' | 'insert' | 'remove' | 'move' | 'stringInsert' | ...,
  index?,
  howMany?,
  from?,
  to?
}
```

---

## 6) Event Router Architecture

We need a dedicated router for model events, separate from custom events:

- `emitCustom(eventName, ...args)` — existing simple bus
- `emitModelChange(path, value, prevValue, meta)` — new

### Suggested structure

```js
const modelListeners = {
  change: new Map(), // pattern -> Set(handlers)
  all: new Map()
}
```

### Subscribe
When `useOn('change', pattern, handler)`:

- register handler under `modelListeners.change`
- `useLayoutEffect` cleanup

### Emit
When data tree changes:

- compute `pathString`
- for each registered pattern, run match
- call handlers for those that match

### `all`
Same but `handler(path, 'change', value, prevValue, meta)`

---

## 7) REF Integration

When ref aliasing is enabled (see `REF.md`), change events should propagate:

### Requirement
If a path `A` is a ref to `B`, any changes to `B` should also emit as if they happened on `A`.

### Approach
Maintain a ref graph:

```
fromPath -> toPath
```

When emitting events for `toPath`:

1. Emit for `toPath` itself
2. Find all ref sources pointing to `toPath` or its descendants
3. Re-emit with translated path:
   - If `A` refs to `B`, and event occurs at `B.x.y`, then emit as `A.x.y`

### Implementation sketch

```js
function emitModelChange(path, value, prevValue, meta) {
  emitToListeners(path, value, prevValue, meta)

  for each ref { from, to }:
    if path starts with to:
      const suffix = path.slice(to.length)
      const aliasedPath = from + suffix
      emitToListeners(aliasedPath, value, prevValue, meta)
}
```

This is a simplified version. A full graph would need to handle:
- nested refs
- multiple refs to the same target
- cycles

---

## 8) Hook Behavior and Dev UX

### `useOn('change', path, handler)`
- Should accept both string paths and signal `.path()` values
- Should throw if path invalid (non-string)

### `useOn('all', ...)`
- Same behavior, includes event name

### `useEmit()`
- Returns custom `emit()` only (same as now)
- Not involved in model events

---

## 9) Testing Strategy

### Unit tests
- match algorithm (`*`, `**`, exact)
- change listeners fire on set/del
- all listeners include eventName
- refs re-emit changes on alias path

### Integration tests
- Use `useOn('change', 'path.*')` inside observer component
- Modify underlying signal, expect handler called

---

## 10) Migration Plan

1. Implement router and pattern matcher
2. Wire emitModelChange into dataTree mutators
3. Add `useOn` overloading: `(eventName, path, handler)` for `change/all`
4. Add REF integration hooks (optional in first pass)

---

## 11) Open Questions

- Should `change` include subpath for any deep updates (e.g. setDiffDeep)?
- Should we emit on both root path and leaf path for array operations?
- Should we mirror Racer’s `insert/remove/move` events or just treat as `change`?
- Performance: do we need prefix indexes for pattern match?

---

## 12) Minimal Implementation Outline (Pseudo)

```js
// eventsCompat.js
const customListeners = new Map()
const modelListeners = { change: new Map(), all: new Map() }

export function emit (eventName, ...args) {
  // custom events only
}

export function emitModelChange (path, value, prevValue, meta) {
  runModelListeners('change', path, value, prevValue, meta)
  runModelListeners('all', path, 'change', value, prevValue, meta)
  // plus refs propagation
}

function runModelListeners (type, path, ...args) {
  for (const [pattern, handlers] of modelListeners[type]) {
    if (match(pattern, path)) handlers.forEach(h => h(...args))
  }
}

export function useOn (eventName, ...args) {
  if (eventName === 'change' || eventName === 'all') {
    const [pattern, handler, deps] = args
    // subscribe to modelListeners
  } else {
    // custom events
  }
}
```

---

## 13) Relationship to REF.md

This design assumes the **REF layer is available** (as described in `REF.md`).
If we keep REF disabled, the event system still works, but **ref path re-emission will not happen**.

For full StartupJS parity in LMS, both event routing **and** refs are required.

---

## 14) Coverage of Server-Side Ops (Where to Emit)

To make `useOn('change'/'all')` observe **server-originated mutations**, we must emit model events for all mutation entry points, including those that bypass `dataTree.*`.

### A) Local dataTree mutators (already listed)
These cover local writes and any code paths that directly call dataTree:
- `set`, `setReplace`, `del`
- array mutators: `arrayPush/Unshift/Insert/Remove/Move/Pop/Shift`
- string mutators: `stringInsertLocal/stringRemoveLocal`
- numeric: `increment` (json0 `na`)

### B) ShareDB `doc.on('op')` in `orm/Doc.js` (critical)
Public docs and remote ops mutate `doc.data` directly, bypassing `dataTree.*`.
Therefore, we must listen to ShareDB ops and emit:

```
doc.on('op', (op, source) => {
  // op is json0; convert to paths and emit change/all
})
```

Emit at:
- path: `[collection, docId, ...op.p]` => `collection.docId.subpath`
- `value` and `prevValue` can be pulled from `doc.data` snapshot before/after, or reconstructed from op where possible
- `meta` should include at least `{ op: 'json0', source, p: op.p, kind: 'oi/od/li/ld/na/si/sd/lm' }`

This is required for:
- server updates
- local writes via `submitOp` on public docs

### C) Query updates in `orm/Query.js`
Query subscriptions mutate observable arrays via direct `splice`, not `dataTree.*`.
We must emit model changes for:
- `['$queries', hash, 'docs']` on insert/move/remove
- `['$queries', hash, 'ids']` on insert/move/remove
- `['$queries', hash, 'extra']` on extra

Options:
1. Call `emitModelChange` directly in these handlers.
2. Refactor to use dataTree array mutators so emission is centralized.

### D) Aggregations in `orm/Aggregation.js`
Aggregation uses direct `_set` for `['$aggregations', hash]` and `extra` updates.
Must emit for these paths as well (same approach as Query).

### E) Misc derived structures
Anything else that modifies `dataTreeRaw` via direct `splice`/assignment should emit or be refactored to go through `dataTree.*`.

---

## 15) json0 Op Mapping Guidance (Doc `op` handling)

We need a minimal conversion from json0 ops to `(path, value, prevValue, meta)`:

### Common json0 shapes
- `{ p, oi, od }` object replace/insert/delete
- `{ p, li, ld }` array insert/delete/replace
- `{ p, na }` number add
- `{ p, si, sd }` string insert/delete
- `{ p, lm }` array move

### Suggested handling
- For each op in the op array, emit a `change`:
  - `path = [collection, docId, ...op.p]`
  - `prevValue` = snapshot before applying op if available
  - `value` = snapshot after applying op if available
  - `meta.op` = one of `set`, `del`, `insert`, `remove`, `move`, `increment`, `stringInsert`, `stringRemove`
  - `meta.kind` = `oi/od/li/ld/na/si/sd/lm`

If full before/after snapshot is too costly, emit `value = get(path)` and `prevValue = undefined`.

---

## 16) Notes on REF Integration

When ref aliasing (see `REF.md`) is enabled, **server ops** must also propagate:
- `emitModelChange` should apply ref translation for *all* sources, including ShareDB `op` handlers.
- If doc ops are emitting directly, they should call the centralized `emitModelChange` so ref propagation is consistent.
