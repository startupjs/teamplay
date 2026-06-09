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
