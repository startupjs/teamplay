# React Subscription Hooks

TeamPlay exposes React hooks for subscribing to object-tree signals inside
`observer()` components:

- `useSub()` suspends while the initial subscription is loading.
- `useAsyncSub()` returns `undefined` while loading instead of suspending.
- `useBatchSub()` batches several subscriptions behind one Suspense barrier.

Use these hooks with object-tree signals such as `$.users[userId]` or
`$.users`, not string collection/path hook names.

## Syntax

```javascript
const $data = useSub(signal, [queryParams])
const $maybeData = useAsyncSub(signal, [queryParams])

const $batchedData = useBatchSub(signal, [queryParams], [options])
useBatchSub()

// Equivalent lower-level batch mode:
const $batchedDataViaUseSub = useSub(signal, [queryParams], { batch: true })
useSub(undefined, undefined, { batch: true })
```

## Parameters

- `signal`: A signal representing the collection or document to subscribe to.
- `queryParams` (optional): An object containing query parameters when subscribing to multiple documents.
- `options` (optional): `{ async?: boolean, defer?: boolean | number, batch?: boolean }`.
  `defer` (default `true`) decides what a re-subscribe shows while it loads:
  the previous content (`true`) or the Suspense fallback (`false`); see
  [Re-subscribing](#re-subscribing-consistency-and-defer).

For document subscriptions, options can be passed as the second argument:

```javascript
const $user = useSub($.users[userId], { defer: false })
const $batchedUser = useBatchSub($.users[userId], { defer: false })
```

## Return Value

Returns a signal representing the subscribed data. `useAsyncSub()` may return
`undefined` before the subscription is ready.

## Example

```javascript
import { observer, $, useSub, useAsyncSub } from 'teamplay'

const UserProfile = observer(({ userId }) => {
  const $user = useSub($.users[userId])
  return <div>{$user.name.get()}</div>
})

const OptionalUserProfile = observer(({ userId }) => {
  const $user = useAsyncSub($.users[userId])
  if (!$user) return null
  return <div>{$user.name.get()}</div>
})
```

## Batch Subscriptions

Use `useBatchSub()` when a component needs several subscriptions to become ready
as a group, or when it needs to read documents from the object tree immediately
after a query subscription is ready. `useBatchSub(signal, params, options)` is
syntax sugar for `useSub(signal, params, { ...options, batch: true, async: false })`.

```javascript
import { observer, $, useBatchSub } from 'teamplay'

const CourseLessons = observer(({ courseId }) => {
  const $lessonsQuery = useBatchSub($.lessons, { courseId }, { defer: false })
  const $course = useBatchSub($.courses[courseId], { defer: false })

  useBatchSub()

  return (
    <div>
      <h1>{$course.title.get()}</h1>
      {$lessonsQuery.map($lesson => (
        <div key={$lesson.getId()}>{$lesson.title.get()}</div>
      ))}
    </div>
  )
})
```

The final no-argument `useBatchSub()` call closes the batch barrier. If a render
uses batch subscriptions and does not call this barrier, TeamPlay throws a
development error.

The closing call is also available in the lower-level form:

```javascript
useSub(undefined, undefined, { batch: true })
```

`useBatchSub()` uses the same default `defer` behavior as `useSub()` (see
below): the barrier suspends on the first render and on a re-subscribe alike,
and in the default deferred mode a re-subscribe keeps the previous content on
screen while the barrier waits.

## Re-subscribing: consistency and `defer`

When a hook's signal or query params change (a route id, a filter, a field of
another document), the component never commits the new target before it is
loaded, and hooks that depend on each other switch together:

```javascript
const Lesson = observer(({ userId }) => {
  const $user = useSub($.users[userId])
  const $course = useSub($.courses[$user.courseId.get()])
  const $lesson = useSub($.lessons[$course.lessonId.get()])
  // ...
})
```

When `userId` changes, no render commits the new user with the previous
course, or the new course with the previous lesson. What the component shows
meanwhile depends on `defer`:

- **deferred (default)**: the previous user, course and lesson stay on screen,
  without the Suspense fallback, until the new user, course and lesson are all
  loaded; then the component commits them at once. The signal and params go
  through React's `useDeferredValue()`: urgent renders get the previous ones,
  and the background render that gets the new ones suspends on each new
  subscription in turn, which React does without hiding the committed UI.
  Changing the target again meanwhile (user 2, then user 3) ends at user 3
  without committing user 2.
- **`defer: false`** (per hook, or `observer(Component, { defer: false })` for
  every hook of the component): a re-subscribe in an urgent render suspends to
  the Suspense fallback until the new chain is loaded.
- A target that is already subscribed (for example the previous one, within
  the subscription GC delay) is returned synchronously, without waiting.

The first render of a component suspends to the fallback in every mode.
`useAsyncSub()` never suspends: it returns `undefined` while a subscription
loads, so it gives no such guarantee.

The guarantee covers switching what the hooks subscribe to. The data of a
subscribed document is live: when `$user.courseId` changes on the server, the
component renders the user's new data at once, and the course hook
re-subscribes like any other. Deferred, it keeps the previous course until
the new one is loaded (so meanwhile `$course.getId()` is not
`$user.courseId.get()`); with `defer: false`, it suspends.

Deferred, this also holds across components: a child observer that
subscribes to an id its parent passes it (from the parent's subscription) is
rendered in the parent's background render, and its suspension holds back the
parent's commit too. With `defer: false`, the parent commits its new data with
the child's fallback in place of the child.

### Ignoring `defer: false` everywhere (`forceDefer`)

`forceDefer` makes every `useSub()`, `useBatchSub()` and `useAsyncSub()` defer,
ignoring `defer: false` of a hook and of `observer()`. Set it in the runtime
config, next to `idFields`, before or after the app loads teamplay:

```javascript
globalThis[Symbol.for('teamplay.runtimeConfig')] = {
  ...globalThis[Symbol.for('teamplay.runtimeConfig')],
  forceDefer: true
}
// or: import { configureTeamplay } from 'teamplay/config'
//     configureTeamplay({ forceDefer: true })
```

or at runtime with `setForceDefer(true)` from `teamplay` (`setForceDefer(false)`
respects `defer: false` whatever the config says, `setForceDefer(null)` goes
back to the config; `getForceDefer()` returns the value in effect). The setter
takes precedence over the config. A mounted component picks the change up on
its next render.

## Features

1. **Automatic Subscription Management**: Hooks handle subscribing when the component mounts and unsubscribing when it unmounts.

2. **Suspense Integration**: `useSub()` and `useBatchSub()` work with the Suspense boundary created by `observer()`.

3. **Reactivity**: Changes to the subscribed data will cause the component to re-render.

## Notes

- Subscription hooks should be used within components wrapped with `observer()` to ensure proper reactivity.
- They follow React's rules of hooks, so they should not be used in conditional statements.
- Legacy hooks such as `useDoc`, `useQuery`, `useBatchDoc`, and `useBatchQuery` are not part of the public object-tree API. Use `useSub`, `useAsyncSub`, or `useBatchSub` instead.
