# Server-side API

TeamPlay provides a server-side API for setting up the backend and handling connections. This API is typically used in your server setup code.

## createBackend()

Creates a new TeamPlay backend instance.

```javascript
import { createBackend } from 'teamplay/server'

const backend = createBackend()
```

Common options:

```ts
const backend = createBackend({
  validateSchema: true,
  accessControl: true,
  serverAggregate: true,
  serverOnlyCollections: ['service']
})
```

- `validateSchema`: validate public collection writes with registered schemas.
- `accessControl`: enable access-control middleware for all collections. Collections without rules are denied by default.
- `serverAggregate`: enable server-side aggregations.
- `serverOnlyCollections`: collections that clients may not read or write through ShareDB.

`serverOnlyCollections` forces the access middleware to initialize even when global `accessControl` is off. In that mode, only server-only collections and collections marked with `accessControl(..., { force: true })` are protected; all other collections keep the normal open behavior.

## initConnection(backend, options)

Initializes the connection handler for WebSocket connections.

```javascript
import { initConnection } from 'teamplay/server'

const { upgrade } = initConnection(backend, options)
```

### Parameters

- `backend`: The TeamPlay backend instance created with `createBackend()`.
- `options` (optional): An object with the following properties:
  - `fetchOnly` (default: `true`): If true, server-side subscriptions are not reactive.
  - `idFields` (default: `['_id']`): Runtime-wide document identity field names to inject and protect on public documents.
  - `allowXhrFallback` (default: on outside production, off when `NODE_ENV` is `production`; the `TEAMPLAY_ALLOW_XHR_FALLBACK` environment variable, `1` or `0`, decides when set and no option is passed): Serve the SockJS xhr-polling fallback for clients that cannot open a WebSocket. Off, its HTTP paths answer a plain 404. See [`@teamplay/channel`](https://github.com/startupjs/teamplay/tree/master/packages/channel#the-xhr-polling-fallback-is-off-in-production-by-default).
  - `perMessageDeflate` (default: `true`): Compress WebSocket messages (permessage-deflate). `false` saves the zlib memory each connection takes.
  - `maxMessageSize` (default: the `TEAMPLAY_MAX_MESSAGE_SIZE` environment variable in bytes (decimal digits), if set, otherwise `16777216`, 16 MiB — MongoDB's document limit): The largest message a client may send, in bytes. A WebSocket that sends a larger one is closed (code 1009); with the xhr-polling fallback a larger message is refused and that write fails with `ERR_MESSAGE_TOO_BIG`. Pass the same value to `connect()` on the client. See [`@teamplay/channel`](https://github.com/startupjs/teamplay/tree/master/packages/channel#message-size).

### Return Value

Returns an object with an `upgrade` function to be used with a Node.js HTTP server.

## Usage Example

```javascript
import http from 'http'
import { createBackend, initConnection } from 'teamplay/server'

const server = http.createServer()
const backend = createBackend()
const { upgrade } = initConnection(backend, {
  idFields: ['_id', 'id']
})

server.on('upgrade', upgrade)

server.listen(3000, () => {
  console.log('Server started on port 3000')
})
```

## Additional Exports

TeamPlay's server module also re-exports some utilities:

- `ShareDB`: The underlying ShareDB library.
- `mongo`, `mongoClient`, `createMongoIndex`: MongoDB utilities.
- `redis`, `redlock`: Redis utilities.
- `sqlite`: SQLite utility.

These can be imported from `teamplay/server` if needed for advanced configurations.

## Notes

- The server-side API is designed to work with Node.js HTTP servers.
- For production use, it's recommended to use MongoDB by setting the `MONGO_URL` environment variable.
- When deploying to a cluster with multiple instances, set the `REDIS_URL` environment variable for proper scaling.
