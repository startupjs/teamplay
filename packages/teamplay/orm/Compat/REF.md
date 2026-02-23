# SignalCompat `ref` / `removeRef` — Compatibility Draft

This document captures a **draft** implementation of StartupJS/Racer-style `ref` behavior for Teamplay’s `SignalCompat`.

It is **not active in code** right now. The goal is to discuss and decide whether we want to bring it back, and in what form.

---

## 1) Why we need this

In LMS there are a few **real usages** of model refs (not React DOM refs):

- `components/Media/index.js`
  ```js
  if ($fullscreen) $localFullscreen.ref($fullscreen)
  ```
- `main/components/FilterV2/index.js`
  ```js
  if (!isMultiSelect) $localValue.ref($value)
  ```
- `main/Layout/Tutoring/index.js` and `v5/apps/main/Layout/Tutoring/index.js`
  ```js
  $session.ref('tutoringSession', $tutoringSession)
  $session.removeRef('tutoringSession')
  ```

These use the **Racer model ref**, which effectively makes one path behave like another path (alias). Teamplay doesn’t have this concept, so we explored a minimal compat layer.

---

## 2) Target API (minimal subset)

We only target what LMS actually uses:

### `ref(target)`

```js
$local.ref($.users.user1)
```

This means `$local` mirrors `$users.user1` and mutating `$local` mutates `$users.user1`.

### `ref(subpath, target)`

```js
$session.ref('tutoringSession', $tutoringSession)
```

This means `$session.tutoringSession` acts as an alias to `$tutoringSession`.

### `removeRef(path?)`

```js
$local.removeRef()
$session.removeRef('tutoringSession')
```

Stops syncing.

---

## 3) Semantics vs Racer

Racer refs are deep and complicated (they respond to all model events, including array insert/remove/move, etc).

This draft **only covers**:
- Signal-level aliasing (one signal proxies another).
- No `refList`, `refExtra`, `refMap`.
- No automatic path-patching for list inserts/moves.

It should be enough for current LMS usages.

---

## 4) Draft Implementation Strategy

### 4.1 Keep a ref store on root

We store refs on root signal:

```js
const REFS = Symbol('compat refs')
$root[REFS] = new Map()
```

Each entry is keyed by `fromPath` and stores `{ stop }` cleanup.

### 4.2 One-way reactive sync (target → alias)

We use `@nx-js/observer-util` `observe()` to track target changes and push them into alias:

```js
const toReaction = observe(() => {
  const value = $to.get()
  trackDeep(value)
  setDiffDeepBypassRef($from, deepCopy(value))
}, { lazy: true })

toReaction()
```

Why deep copy?
- Without it, `setDiffDeep` can re-use same object references and skip updates.
- Deep copy ensures the diffing path detects change.

### 4.3 Forward all mutations from alias → target

To avoid two reactions and feedback loops, we forward all mutator calls:

- `set`, `setNull`, `setDiffDeep`, `setEach`
- `del`
- `increment`
- `push`, `unshift`, `insert`, `pop`, `shift`, `remove`, `move`
- `stringInsert`, `stringRemove`
- `assign`

Forwarding uses a hidden `REF_TARGET` symbol on the alias signal.

### 4.4 Mutator forward mechanism

On each mutator:

```js
const forwarded = forwardRef(this, 'set', arguments)
if (forwarded) return forwarded
```

`forwardRef()` resolves to a target signal if present and applies the same method there.

---

## 5) Draft Code (for later restoration)

Below is the exact code we removed from `SignalCompat.js`. It can be re-applied as-is.

### 5.1 Imports (add back)

```js
import { raw, observe, unobserve } from '@nx-js/observer-util'
```

### 5.2 Symbols and helpers (add near other helpers)

```js
const REFS = Symbol('compat refs')
const REF_TARGET = Symbol('compat ref target')

function getRefStore ($signal) {
  const $root = getRoot($signal) || $signal
  $root[REFS] ??= new Map()
  return $root[REFS]
}

function createRefLink ($from, $to) {
  const toReaction = observe(() => {
    const value = $to.get()
    trackDeep(value)
    setDiffDeepBypassRef($from, deepCopy(value))
  }, { lazy: true })

  // Prime sync and start tracking.
  toReaction()
  return () => {
    unobserve(toReaction)
  }
}

function trackDeep (value, seen = new Set()) {
  if (!value || typeof value !== 'object') return
  if (seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) trackDeep(item, seen)
  } else {
    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        trackDeep(value[key], seen)
      }
    }
  }
}

function resolveRefSignal ($signal) {
  let current = $signal
  const seen = new Set()
  while (current && current[REF_TARGET]) {
    if (seen.has(current)) break
    seen.add(current)
    current = current[REF_TARGET]
  }
  return current
}

function forwardRef ($signal, methodName, args) {
  const $target = resolveRefSignal($signal)
  if ($target === $signal) return null
  return SignalCompat.prototype[methodName].apply($target, args)
}

function setDiffDeepBypassRef ($signal, value) {
  return Signal.prototype.set.call($signal, value)
}
```

### 5.3 `ref()` / `removeRef()` methods (add to `SignalCompat`)

```js
ref (path, target, options) {
  if (arguments.length > 3) throw Error('Signal.ref() expects one to three arguments')
  let $from = this
  let $to
  if (arguments.length === 1) {
    $to = resolveRefTarget(this, path, 'Signal.ref()')
  } else if (arguments.length === 2) {
    if (isSignalLike(target) || typeof target === 'string') {
      const segments = parseAtSubpath(path, 1, 'Signal.ref()')
      $from = resolveSignal(this, segments)
      $to = resolveRefTarget(this, target, 'Signal.ref()')
    } else {
      $to = resolveRefTarget(this, path, 'Signal.ref()')
      options = target
    }
  } else {
    const segments = parseAtSubpath(path, 1, 'Signal.ref()')
    $from = resolveSignal(this, segments)
    $to = resolveRefTarget(this, target, 'Signal.ref()')
  }
  if (!$to) throw Error('Signal.ref() expects a target path or signal')
  if ($from === $to) return $from
  const store = getRefStore($from)
  const fromPath = $from.path()
  const existing = store.get(fromPath)
  if (existing) existing.stop()
  const stop = createRefLink($from, $to, options)
  store.set(fromPath, { stop })
  $from[REF_TARGET] = $to
  return $from
}

removeRef (path) {
  if (arguments.length > 1) throw Error('Signal.removeRef() expects a single argument')
  let $from = this
  if (arguments.length === 1) {
    const segments = parseAtSubpath(path, 1, 'Signal.removeRef()')
    $from = resolveSignal(this, segments)
  }
  const store = getRefStore($from)
  const fromPath = $from.path()
  const existing = store.get(fromPath)
  if (existing) {
    existing.stop()
    store.delete(fromPath)
  }
  if ($from[REF_TARGET]) delete $from[REF_TARGET]
}
```

### 5.4 Forwarding mutations (add to each mutator)

Example for `set()`:

```js
async set (path, value) {
  const forwarded = forwardRef(this, 'set', arguments)
  if (forwarded) return forwarded
  // ...existing body
}
```

Same pattern for:
- `setNull`, `setDiffDeep`, `setEach`
- `del`
- `increment`
- `push`, `unshift`, `insert`, `pop`, `shift`, `remove`, `move`
- `stringInsert`, `stringRemove`
- `assign`

### 5.5 Supporting helpers (only needed with ref)

```js
function isSignalLike (value) {
  return value && typeof value.path === 'function' && typeof value.get === 'function'
}

function resolveRefTarget ($signal, target, methodName) {
  if (isSignalLike(target)) return target
  if (typeof target === 'string') {
    const segments = parseAtSubpath(target, 1, methodName)
    const $root = getRoot($signal) || $signal
    return resolveSignal($root, segments)
  }
  return undefined
}
```

---

## 6) Draft tests (removed)

We also had tests in `packages/teamplay/test/signalCompat.js`. They can be restored if needed:

- `syncs values both ways for direct signals`
- `supports subpath refs from root`
- `removeRef stops syncing`

---

## 7) Risks and limitations

- This is **not a full racer ref** implementation.
- No support for `refList`, `refExtra`, `refMap`.
- No array index patching when list changes.
- Might not handle exotic cases with cyclic refs.

That said, it’s deliberately scoped to known LMS usage patterns and should be “good enough” for those.
