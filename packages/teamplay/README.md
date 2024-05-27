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

TBD
...

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
