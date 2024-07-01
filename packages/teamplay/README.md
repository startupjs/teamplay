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

2. **Private Collections**: These are specific to each user or session. They start with an underscore or dollar sign (e.g., `_session`, `$page`).

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
