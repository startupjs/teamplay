# React Integration

TeamPlay integrates seamlessly with React, allowing you to build reactive user interfaces with ease. This guide will show you how to use TeamPlay in your React components.

TeamPlay requires React 19 or newer. Observer components work under `<StrictMode>`, with concurrent rendering, and inside `<Activity>`: a hidden subtree releases its subscriptions and subscribes again when it is shown.

With the React Compiler, set `babel-plugin-teamplay`'s `reactCompiler` option. See [React Compiler](#react-compiler).

## The `observer()` Higher-Order Component

To use TeamPlay signals in a React component, you need to wrap your component with the `observer()` function:

```javascript
import { observer } from 'teamplay'

const MyComponent = observer(() => {
  // Your component code here
})
```

### Why do we need `observer()`?

The `observer()` function does two important things for your component:

1. It allows the component to "see" changes in TeamPlay signals and automatically re-render when those signals change.
2. It automatically wraps your component in a Suspense boundary, handling loading states for you.

## Using `useSub()` for Data Subscriptions

When you want to subscribe to data from the server in a React component, use the `useSub()` hook with an object-tree signal:

```javascript
import { $, observer, useSub } from 'teamplay'

const UserProfile = observer(({ userId }) => {
  const $user = useSub($.users[userId])
  return <div>{$user.name.get()}</div>
})
```

### How `useSub()` Works with Suspense

`useSub()` works with the Suspense functionality that `observer()` provides:

1. It starts fetching the data from the server.
2. While fetching, it "suspends" the component.
3. The `observer()` wrapper shows a loading state.
4. Once the data is ready, the component renders with the data.

If the server refuses the subscription (for example the access rules deny the
read), the component throws the error once the subscription fails, so the
nearest error boundary shows it. See
[Errors](../api/use-sub-hook.md#errors).

### Switching subscriptions

When a hook's signal or params change, the component keeps showing the
previous data (no Suspense fallback) until the new subscriptions are loaded,
including subscriptions that depend on each other
(`useSub($.courses[$user.courseId.get()])`): they switch together, never one
link at a time. `defer: false` shows the fallback instead, and the
`forceDefer` runtime option ignores `defer: false` everywhere. See
[Re-subscribing: consistency and `defer`](../api/use-sub-hook.md#re-subscribing-consistency-and-defer).

### Async subscriptions

If the component should render its own loading state instead of suspending, use
`useAsyncSub()`:

```javascript
import { $, observer, useAsyncSub } from 'teamplay'

const UserProfile = observer(({ userId }) => {
  const $user = useAsyncSub($.users[userId])
  if (!$user) return <div>Loading...</div>
  return <div>{$user.name.get()}</div>
})
```

### Batch subscriptions

Use `useBatchSub()` when several subscriptions should become ready together.
Each batch subscription is declared first, then a final no-argument
`useBatchSub()` closes the Suspense barrier:

```javascript
import { $, observer, useBatchSub } from 'teamplay'

const CoursePage = observer(({ courseId }) => {
  const $course = useBatchSub($.courses[courseId], { defer: false })
  const $lessons = useBatchSub($.lessons, { courseId }, { defer: false })

  useBatchSub()

  return (
    <section>
      <h1>{$course.title.get()}</h1>
      {$lessons.map($lesson => (
        <div key={$lesson.getId()}>{$lesson.title.get()}</div>
      ))}
    </section>
  )
})
```

`useBatchSub()` keeps TeamPlay's normal `defer` default: when `courseId`
changes, the previous course and lessons stay on screen until the new ones are
loaded. With `{ defer: false }`, as in this example, a re-subscribe suspends to
the fallback instead.

`useBatchSub(signal, params, options)` is syntax sugar for
`useSub(signal, params, { ...options, batch: true, async: false })`. The barrier
can also be closed with the lower-level form
`useSub(undefined, undefined, { batch: true })`, but `useBatchSub()` is the
recommended spelling in application code.

Avoid legacy hook names like `useDoc`, `useQuery`, `useBatchDoc`, and
`useBatchQuery` in new code. The public API is the object-tree subscription API:
`useSub`, `useAsyncSub`, and `useBatchSub`.

### Grouping Suspense retries

Use `SuspenseGroup` around an application subtree that should share one loading
boundary. This is useful for route shells where nested `observer()` components
discover several subscription waves in sequence:

```javascript
import { SuspenseGroup } from 'teamplay'

function PlayerRoute ({ children }) {
  return (
    <SuspenseGroup fallback={<PlayerSkeleton />}>
      {children}
    </SuspenseGroup>
  )
}
```

Until the group reveals its content for the first time, default Suspense
boundaries added by `observer()` are consolidated into the group boundary.
TeamPlay automatically schedules retries for initial `useSub()`,
`useBatchSub()`, and `useSuspendMemo()` promises, as well as any other thenable
thrown directly while rendering an `observer()` component. After the initial
content commits, observer boundaries become local again so a later suspended
interaction does not hide the whole revealed group. An observer with an
explicit `suspenseProps.fallback` always keeps its own boundary. Outside
`SuspenseGroup`, observer behavior is unchanged.

TeamPlay cannot intercept a promise thrown later by an arbitrary non-observer
descendant because React evaluates that descendant in a separate fiber. For a
stable promise owned by such a descendant, such as a memoized `React.lazy()`
loader, register it explicitly:

```javascript
import React from 'react'
import { useSuspenseGroupScheduleUpdate } from 'teamplay'

let viewPromise
const loadView = () => {
  if (!viewPromise) viewPromise = import('./LoadedView.js')
  return viewPromise
}
const LoadedView = React.lazy(loadView)

function LazyView (props) {
  const scheduleUpdate = useSuspenseGroupScheduleUpdate()
  const promise = loadView()
  scheduleUpdate?.(promise)
  return <LoadedView {...props} />
}
```

The loader must return the same in-flight promise on repeated renders. The hook
returns `undefined` outside a group, so the component can retain its normal
local Suspense fallback there.

## React Compiler

The [React Compiler](https://react.dev/learn/react-compiler) needs
`babel-plugin-teamplay`'s `reactCompiler` option. Expo turns the compiler on
with `"experiments": { "reactCompiler": true }` in `app.json`, and the default
Expo template sets it.

### Why

The compiler caches a value until one of its inputs changes identity. A signal
keeps its identity when its data changes (`$user.score` is the same object
before and after `$user.score.set(12)`), so without the option the compiled
code keeps returning the old value:

```javascript
// your hook
function useScore ($user) {
  const score = $user.score.get() ?? 0
  useEffect(() => { /* ... */ }, [])
  return score
}

// what the compiler turns it into
function useScore ($user) {
  const $ = _c(3)
  let t0
  if ($[0] !== $user.score) {
    t0 = $user.score.get() ?? 0
    $[0] = $user.score
    $[1] = t0
  } else {
    t0 = $[1] // the same signal: the cached, old value
  }
  // ...
}
```

The cached branch also skips `.get()`, so `observer()` stops tracking that
field: after one cached render, later changes don't re-render the component.
The same happens to values derived from signals, to reads from the imported `$`
(cached for the life of the component), and to local and computed signals
(`$(0)`, `$(() => ...)`), whose hooks the compiler then calls only on the
first render.

### The `reactCompiler` option

- `'full'`: the compiler compiles everything, and TeamPlay keeps the compiled
  code reactive. Components keep the compiler's optimizations: a re-render
  from the parent reuses what didn't change, and memoized callbacks keep their
  identity. This also compiles components written inline in `observer()`
  (`observer(function Profile () {})`), which the compiler alone skips.
- `'optOut'`: the compiler skips the components and hooks that use signals
  (`babel-plugin-teamplay` adds `'use no memo'` to them) and compiles the rest.
  The skipped ones work exactly as without the compiler.
- `false`: nothing. Without the option, `babel-plugin-teamplay` warns when the
  compiler compiles a file that uses signals.

`babel-plugin-teamplay` has to run before the compiler (it fails the build
otherwise). Plugins run before presets, so with Expo:

```javascript
// babel.config.js
module.exports = {
  presets: ['babel-preset-expo'],
  plugins: [['teamplay/babel', { reactCompiler: 'full' }]]
}
```

How `'full'` works: before the compiler, `$()` called in a component or a hook
becomes `useSignal()`, which the compiler never caches, and a function passed
inline to `observer()` gets `'use memo'`, so the compiler compiles it (add
`'use no memo'` to one to keep it uncompiled). A function whose code calls a
function declared further down in it gets its function declarations moved to
its top, where JavaScript hoists them anyway: the compiler leaves some of them
in place, and a call that runs before them would fail ("Cannot access ...
before initialization"). After the compiler,
each block of code the compiler caches runs in a reaction that tracks the
signals it reads, inside `observer()` components. When one of them changes,
that block and the blocks that use its result run again, and so do the blocks
that create elements. A block also runs again when a value it uses changes
that the compiler took for a constant: a value computed from the imported `$`
outside the blocks. The other blocks keep their cache, so values from
`useMemo()` and `useCallback()` keep their identity. In a component that isn't
an `observer()`, a block recomputes when one of its inputs is a plain object or
array, which may be a doc's data changed in place.

Things to know:

- `'optOut'` skips what `observer()` wraps, and finds other components and
  hooks that use signals by TeamPlay's naming: a `$`-named value or anything
  imported from `teamplay` or `startupjs`. Name signals `$something`. A
  component that isn't an `observer()` and is given a doc's data (an object
  read with `.get()`) is still compiled, and shows it stale after a change in
  place: use `'full'`, or make it an `observer()`.
- Rendering must not read the clock in a way the compiler can't see. With
  `'full'`, a block of code that calls `Date.now()`, `new Date()`,
  `performance.now()`, or `moment()` / `dayjs()` without an argument itself
  recomputes on every render; a helper function that reads the clock inside is
  cached like any other call. Keep the time in a signal or in state, and pass
  it in.
- The same goes for other values from outside React and signals that change:
  the compiler caches a read of `window.location` (or of a helper that reads
  it) like any other value. Keep such a value in a signal, or add
  `'use no memo'` to a component that has to read it again on every render.
- The compiler caches values that only change in place or with time. Code
  that worked only because a value went stale under the compiler alone (for
  example a hook reading signals, which the compiler cached) changes behaviour
  with either mode, back to what it does without the compiler.
- `$()` is a hook when it runs while a component renders, also in a helper
  function a component calls. The compiler doesn't know that and may skip the
  call. Rename such a helper to `use...()` and call `useSignal()` in it (the
  `dollarCalls` option points out these calls).
- The compiler knows a hook by the name it's called by (`use` and an uppercase
  letter or a digit) and caches calls of anything else, so a hook called under
  another name runs only on some renders, and React fails with "Rendered fewer
  hooks than expected". In both modes, `babel-plugin-teamplay` renames a
  function imported under a hook name, and a constant that is just another
  name for it (CSSX's style hook is called this way), so it keeps a hook name.
  Hooks you write yourself need a hook name.
- With `'full'`, if `babel-plugin-teamplay` doesn't recognize the compiler's
  output for a function, it warns, and inside `observer()` that function then
  runs as if it wasn't compiled.
- The compiler takes a function given to an element (an `onPress`), to a hook,
  or returned, for one that runs while the component renders, and reads ahead
  what it reads: for `onPress={() => remove(course.id)}` it reads `course.id`
  on every render, which throws while `course` is `undefined` (a doc not
  loaded yet, or deleted). `'full'` compiles `observer()` components that the
  compiler skipped before, and their code may read such values only on press,
  so it sets the compiler's `environment.enableTreatFunctionDepsAsConditional`
  (the callback then depends on `course` itself), unless your compiler options
  set it.

Or turn the compiler off: `"experiments": { "reactCompiler": false }` in Expo's
`app.json`, or remove `babel-plugin-react-compiler` from your Babel config.

## Creating and Waiting for Documents

Sometimes, you might need to create a document if it doesn't exist yet. Here's how to do it:

1. Check if the document exists using `.get()`.
2. If it doesn't exist, create it with `.set()`, providing an initial state object.
3. Wait for the creation to finish by "throwing" the promise returned by `.set()`.

Here's a simple example:

```javascript
const UserProfile = observer(({ userId }) => {
  const $user = useSub($.users[userId])

  if (!$user.get()) {
    throw $user.set({ name: 'New User', createdAt: Date.now() })
  }

  // Rest of your component code
})
```

### Why do we 'throw' the promise?

In React, 'throwing' a promise is a special way to tell React that we're waiting for some data. When we throw a promise:

1. React catches it and shows a loading state (thanks to Suspense).
2. When the promise resolves, React re-renders our component with the fresh data.

This ensures our component only renders when it has all the data it needs.

## Putting It All Together

Here's an example of a complete React component using TeamPlay:

```jsx
import { observer, useSub, useSignal, $ } from 'teamplay'

const UserProfile = observer(({ userId }) => {
  const $user = useSub($.users[userId])
  const $editMode = useSignal(false)

  if (!$user.get()) {
    throw $user.set({ name: 'New User', bio: 'Tell us about yourself', createdAt: Date.now() })
  }

  const handleToggleEditMode = () => {
    $editMode.set(!$editMode.get())
  }

  return (
    <div>
      <h1>{$user.name.get()}</h1>
      {$editMode.get() ? (
        <>
          <input
            value={$user.name.get()}
            onChange={e => $user.name.set(e.target.value)}
          />
          <textarea
            value={$user.bio.get()}
            onChange={e => $user.bio.set(e.target.value)}
          />
        </>
      ) : (
        <p>{$user.bio.get()}</p>
      )}
      <button onClick={handleToggleEditMode}>
        {$editMode.get() ? 'Save' : 'Edit'}
      </button>
    </div>
  )
})

function App() {
  return (
    <div>
      <h1>Welcome to our app!</h1>
      <UserProfile userId="_1" />
    </div>
  )
}

export default App
```

In this example:

1. We wrap our `UserProfile` component with `observer()`.
2. We use `useSub()` to subscribe to user data.
3. We check if the user document exists and create it if it doesn't.
4. We create a local `$editMode` signal with `useSignal()` to manage the component's state.
5. We use `.get()` to read values and `.set()` to update them.

By following these patterns, you can create React components that automatically stay in sync with your data, handle loading states, and manage document creation seamlessly.
