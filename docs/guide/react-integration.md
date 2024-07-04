# React Integration

TeamPlay integrates seamlessly with React, allowing you to build reactive user interfaces with ease. This guide will show you how to use TeamPlay in your React components.

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

When you want to subscribe to data from the server in a React component, use the `useSub()` hook:

```javascript
import { observer, useSub } from 'teamplay'

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
    throw $user.set({ name: 'New User', createdAt: new Date() })
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
import { observer, useSub, $ } from 'teamplay'

const UserProfile = observer(({ userId }) => {
  const $user = useSub($.users[userId])
  const $editMode = $(false)

  if (!$user.get()) {
    throw $user.set({ name: 'New User', bio: 'Tell us about yourself', createdAt: new Date() })
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
4. We create a local `$editMode` signal to manage the component's state.
5. We use `.get()` to read values and `.set()` to update them.

By following these patterns, you can create React components that automatically stay in sync with your data, handle loading states, and manage document creation seamlessly.
