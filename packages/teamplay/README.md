# TeamPlay

> Full-stack signals ORM with multiplayer

Features:

- signals __*__
- multiplayer __**__
- ORM
- auto-sync data from client to DB and vice-versa __***__
- query DB directly from client __***__
- works in pure JS, on server (Node.js) and integrates with React

> __*__ deep signals -- with support for objects and arrays\
> __**__ concurrent changes to the same data are auto-merged using [OT](https://en.wikipedia.org/wiki/Operational_transformation)\
> __***__ similar to Firebase but with your own MongoDB-compatible database

## Installation

### Client-only mode

If you just want a client-only mode without any data being synced to the server, then you don't need to setup anything and can jump directly to [Usage](#usage).

### Synchronization of data with server

Enable the connection on client somewhere early in your client app:

```js
import connect from 'teamplay/connect'
connect()
```

On the server you need to create the teamplay's backend and then create a connection handler for WebSockets:

```js
import { createBackend, initConnection } from 'teamplay/server'
const backend = createBackend()
const { upgrade } = initConnection(backend)
server.on('upgrade', upgrade) // Node's 'http' server instance
```

- for production use it's recommended to use MongoDB. It's gonna be automatically used if you set the env var `MONGO_URL`
- when deploying to a cluster with multiple instances you also have to set the env var `REDIS_URL` (Redis)

Without setting `MONGO_URL` the alternative `mingo` mock is used instead which persists data into an SQLite file `local.db` in the root of your project.

> [!NOTE]
> teamplay's `createBackend()` is a wrapper around creating a [ShareDB's backend](https://share.github.io/sharedb/api/backend).
> You can instead manually create a ShareDB backend yourself and pass it to `initConnection()`.
> `ShareDB` is re-exported from `teamplay/server`, you can get it as `import { ShareDB } from 'teamplay/server'`

## `initConnection(backend, options)`

**`backend`** - ShareDB backend instance

**`options`**:

### `fetchOnly` (default: `true`)

By default all subscriptions on the server are not reactive. This is strongly recommended.

If you need the subscriptions to reactively update data whenever it changes (the same way as they work on client-side), pass `{ fetchOnly: false }`.

## Usage

### Introduction to teamplay ORM

teamplay is a powerful and easy-to-use ORM (Object-Relational Mapping) that allows you to work with your data in a natural, dot-notation style. It's designed to make data management in your app seamless and intuitive.

#### The Big Idea: Deep Signals

At the heart of teamplay is the concept of "deep signals." Think of your entire data structure as a big tree. With teamplay, you can navigate this tree using simple dot notation, just like you would access properties in a JavaScript object.

For example, to access a user's name, you might write:

```javascript
$.users[userId].name
```

This creates a "signal" pointing to that specific piece of data. Signals are smart pointers that know how to get and set data, and they automatically update your app when the data changes.

#### Public and Private Collections

In teamplay, data is organized into collections. There are two types:

1. **Public Collections**: These are shared across all users of your app. They typically start with a lowercase letter (e.g., `users`, `posts`).

2. **Private Collections**: These are specific to each user or session. They start with an underscore (e.g., `_session`).

### Basic Operations on Signals

Every signal in teamplay comes with a set of useful methods:

- `.get()`: Retrieves the current value of the signal.
- `.set(value)`: Updates the value of the signal.
- `.del()`: Deletes the value (or removes an item from an array).

Example:

```javascript
// Get a user's name
const name = $.users[userId].name.get()

// Update a user's name
$.users[userId].name.set('Alice')

// Delete a user's profile picture
$.users[userId].profilePicture.del()
```

### The `$()` Function: Creating Local Signals

The `$()` function is a powerful tool for creating local, reactive values:

1. Creating a simple value:

```javascript
const $count = $(0)
console.log($count.get()) // Outputs: 0
$count.set(5)
console.log($count.get()) // Outputs: 5
```

2. Creating a computed value (similar to a calculated spreadsheet cell):

```javascript
const $firstName = $('John')
const $lastName = $('Doe')
const $fullName = $(() => $firstName.get() + ' ' + $lastName.get())

console.log($fullName.get()) // Outputs: "John Doe"
$firstName.set('Jane')
console.log($fullName.get()) // Outputs: "Jane Doe"
```

### The `sub()` Function: Subscribing to Data

The `sub()` function is used to subscribe to data from the server:

1. Subscribing to a single document:

```javascript
const $user = await sub($.users[userId])
console.log($user.name.get())
```

2. Subscribing to a query (multiple documents):

```javascript
const $activeUsers = await sub($.users, { status: 'active' })
```

#### Working with Query Signals

Query signals are special. They behave like a collection signal, but they're also iterable:

```javascript
// Iterate over active users
for (const $user of $activeUsers) {
  console.log($user.name.get())
}

// Or use array methods
const names = $activeUsers.map($user => $user.name.get())
```

Each `$user` in the loop is a scoped signal for that specific user document.

### Reactivity: Keeping Your App in Sync

teamplay's reactivity system ensures that whenever data changes, any part of your app using that data updates automatically. This happens behind the scenes, so you don't have to manually track and update data dependencies.

For example, if you're displaying a user's name in your app and that name changes in the database, teamplay will automatically update your app's UI to reflect the new name.

This reactivity works for both public and private collections, local signals created with `$()`, and subscribed data from `sub()`.

By using these tools and concepts, you can build powerful, real-time applications with ease using teamplay!

## React Integration

teamplay integrates seamlessly with React, allowing you to build reactive user interfaces with ease. Here's how to use teamplay in your React components:

### The `observer()` Higher-Order Component

To use teamplay signals in a React component, you need to wrap your component with the `observer()` function:

```javascript
import { observer } from 'teamplay'

const MyComponent = observer(() => {
  // Your component code here
})
```

#### Why do we need `observer()`?

The `observer()` function does two important things for your component:

1. It allows the component to "see" changes in teamplay signals and automatically re-render when those signals change.
2. It automatically wraps your component in a Suspense boundary, handling loading states for you.

### Using `useSub()` for Data Subscriptions

When you want to subscribe to data from the server in a React component, use the `useSub()` hook:

```javascript
import { observer, useSub } from 'teamplay'

const UserProfile = observer(({ userId }) => {
  const $user = useSub($.users[userId])
  return <div>{$user.name.get()}</div>
})
```

#### How `useSub()` Works with Suspense

`useSub()` works with the Suspense functionality that `observer()` provides:

1. It starts fetching the data from the server.
2. While fetching, it "suspends" the component.
3. The `observer()` wrapper shows a loading state.
4. Once the data is ready, the component renders with the data.

### Creating and Waiting for Documents

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

#### Why do we 'throw' the promise?

In React, 'throwing' a promise is a special way to tell React that we're waiting for some data. When we throw a promise:

1. React catches it and shows a loading state (thanks to Suspense).
2. When the promise resolves, React re-renders our component with the fresh data.

This ensures our component only renders when it has all the data it needs.

### Putting It All Together

Here's an example of a complete React component using teamplay:

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

## Asynchronous Setters and Data Synchronization

In teamplay, operations that modify data (like `.set()` and `.del()`) are asynchronous. This means they return promises that resolve when the data has been successfully synced with the server. This design ensures that your client-side data stays consistent with the server-side data.

### Why Setters are Asynchronous

Asynchronous setters allow teamplay to:

1. Confirm that data changes have been successfully saved on the server.
2. Handle any potential network issues or conflicts.
3. Ensure that all clients have the most up-to-date data.

### Awaiting Setters

While teamplay automatically handles data synchronization in most cases, there might be situations where you need to ensure a specific operation has completed before proceeding. In these cases, you can await the setter operations:

```javascript
const updateUser = async () => {
  await $user.name.set('New Name')
  console.log('Name updated and synced with server!')
  // Proceed with operations that depend on the updated name
}
```

### Best Practices

1. In most cases, you don't need to await setters in React components. teamplay and React will handle updates and re-renders automatically.

2. Await setters when you have logic that depends on the updated data being saved to the server.

3. In React event handlers or effects where you're performing multiple operations, consider awaiting setters to ensure operations happen in the correct order:

```javascript
const handleFormSubmit = async (event) => {
  event.preventDefault()
  await $user.name.set(newName)
  await $user.email.set(newEmail)
  navigate('/profile')  // Only navigate after both updates are complete
}
```

By understanding and properly using asynchronous setters, you can ensure your application maintains data consistency and responds correctly to user actions.

## Examples

For a simple working react app see [/example](/example)

### Simplest example with server synchronization

On the client we `connect()` to the server, and we have to wrap each React component into `observer()`:

```js
// client.js
import { createRoot } from 'react-dom/client'
import connect from 'teamplay/connect'
import { observer, $, sub } from 'teamplay'

connect()

const App = observer(({ userId }) => {
  const $user = sub($.users[userId])
  if (!$user.get()) throw $user.set({ points: 0 })
  const { $points } = $user
  const increment = () => $points.set($points.get() + 1)
  return <button onClick={increment}>Points: {$points.get()}</button>
})

const container = document.body.appendChild(document.createElement('div'))
createRoot(container).render(<App userId='_1' />)
```

On the server we create the ShareDB backend and initialize the WebSocket connections handler:

```js
// server.js
import http from 'http'
import { createBackend, initConnection } from 'teamplay/server'

const server = http.createServer() // you can pass expressApp here if needed
const backend = createBackend()
const { upgrade } = initConnection(backend)

server.on('upgrade', upgrade)

server.listen(3000, () => {
  console.log('Server started. Open http://localhost:3000 in your browser')
})
```

## License

MIT
