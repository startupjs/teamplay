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

`useBatchSub()` uses the same default `defer` behavior as `useSub()`. If you are
porting legacy synchronous batch code and need immediate resubscription timing,
pass `{ defer: false }` explicitly.

## Features

1. **Automatic Subscription Management**: Hooks handle subscribing when the component mounts and unsubscribing when it unmounts.

2. **Suspense Integration**: `useSub()` and `useBatchSub()` work with the Suspense boundary created by `observer()`.

3. **Reactivity**: Changes to the subscribed data will cause the component to re-render.

## Notes

- Subscription hooks should be used within components wrapped with `observer()` to ensure proper reactivity.
- They follow React's rules of hooks, so they should not be used in conditional statements.
- Legacy compat hooks such as `useDoc`, `useQuery`, `useBatchDoc`, and `useBatchQuery` are not part of the public object-tree API. Use `useSub`, `useAsyncSub`, or `useBatchSub` instead.
