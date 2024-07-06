# useSub() Hook

The `useSub()` hook is a React hook that combines the functionality of the `sub()` function with React's component lifecycle. It's used to subscribe to TeamPlay data within React components.

## Syntax

```javascript
const $data = useSub(signal, [queryParams])
```

## Parameters

- `signal`: A signal representing the collection or document to subscribe to.
- `queryParams` (optional): An object containing query parameters when subscribing to multiple documents.

## Return Value

Returns a signal representing the subscribed data.

## Example

```javascript
import { observer, $, useSub } from 'teamplay'

const UserProfile = observer(({ userId }) => {
  const $user = useSub($.users[userId])
  return <div>{$user.name.get()}</div>
})
```

## Features

1. **Automatic Subscription Management**: `useSub()` handles subscribing when the component mounts and unsubscribing when it unmounts.

2. **Suspense Integration**: It works seamlessly with React Suspense, automatically handling loading states.

3. **Reactivity**: Changes to the subscribed data will cause the component to re-render.

## Notes

- `useSub()` should be used within components wrapped with `observer()` to ensure proper reactivity.
- It's designed to work with React's rules of hooks, so it should not be used in conditional statements.
