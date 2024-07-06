# observer() HOC

The `observer()` Higher-Order Component (HOC) is used to make React components reactive to changes in TeamPlay signals.

## Syntax

```javascript
observer(Component)
```

## Parameters

- `Component`: The React component to be made reactive.

## Return Value

Returns a new component that is reactive to TeamPlay signals.

## Example

```javascript
import { observer, $ } from 'teamplay'

const UserProfile = observer(({ userId }) => {
  const $user = $.users[userId]
  return <div>{$user.name.get()}</div>
})
```

## Features

1. **Reactivity**: Components wrapped with `observer()` will automatically re-render when any TeamPlay signal they use changes.

2. **Suspense Integration**: `observer()` automatically wraps the component in a Suspense boundary, handling loading states for asynchronous operations.

## Notes

- Always wrap components that use TeamPlay signals with `observer()` to ensure they update when data changes.
- `observer()` optimizes re-renders by only updating when the specific data used in the component changes.
