# signal() and useSignal()

`signal()` and `useSignal()` create local, reactive values, as `$()` does:
`useSignal()` in components and hooks, `signal()` everywhere else.

`$()` is both: a hook while a component renders, a plain function elsewhere.
These two names say which one you mean, and React tooling (the rules of hooks
lint, the [React Compiler](../guide/react-integration.md#react-compiler))
recognizes `useSignal()` as a hook.

## signal()

```javascript
import { signal } from 'teamplay'

const $count = signal(0)
$count.set(5)
$count.get() // 5

// a computed signal
const $double = signal(() => $count.get() * 2)
$double.get() // 10
```

Each call creates a new signal. In a component, that means a new signal on
every render: use `useSignal()` there.

## useSignal()

```javascript
import { observer, useSignal } from 'teamplay'

const Counter = observer(({ $user }) => {
  const $clicks = useSignal(0)
  const $label = useSignal(() => $user.name.get() + ': ' + $clicks.get())
  return <button onClick={() => $clicks.set($clicks.get() + 1)}>{$label.get()}</button>
})
```

The component keeps its signals across renders. The initial value is used on
the first render only, and a computed signal keeps the function of the first
render.

`useSignal()` is a hook: call it at the top level of a component or a hook,
never conditionally. It works in any component; outside `observer()`, the
component doesn't re-render when the signal changes, as with any signal read.

## Moving from $()

`$(value)` and `$(() => ...)` keep working. To move to the new names, set
`babel-plugin-teamplay`'s `dollarCalls` option:

```javascript
plugins: [['teamplay/babel', { dollarCalls: 'warn' }]] // or 'error' to fail the build
```

It reports every `$()` call (with which of the two to use instead) and
`signal()` called directly in a component or a hook. `$` itself stays: only
calling it is reported, not `$.users[id]`.

Note: `signal($root, segments)` used to be the low-level `getSignal()`. It
still works, with a deprecation warning: use `getSignal($root, segments)`.
