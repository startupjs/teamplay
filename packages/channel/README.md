# teamplay channel

WebSocket/SockJS 2-way communication socket.

SockJS can be used to emulate WebSocket in environments where you don't have access to websocket.

## Usage

For internal use only. Teamplay creates the server side with `initConnection(backend, options)` (`teamplay/server`) and the client side with `connect(options)` (`teamplay/connect`); the options below go through them.

## The xhr-polling fallback is off in production by default

The server serves the SockJS xhr-polling fallback (for clients that cannot open a websocket) **only outside production by default**. When `NODE_ENV` is `production`, its HTTP paths (`/channel/...`) answer a plain `404` and nothing of SockJS runs, unless the project turns it on:

```js
// server option
initConnection(backend, { allowXhrFallback: true })
```

```sh
# or, for frameworks that do not pass channel options through
TEAMPLAY_ALLOW_XHR_FALLBACK=1
```

An explicit `allowXhrFallback` option wins; otherwise `TEAMPLAY_ALLOW_XHR_FALLBACK` decides when set (`1`/`true` on, `0`/`false` off); otherwise it is on unless `NODE_ENV` is `production`. Websockets are not affected.

A client set to use the fallback (`connect({ allowXhrFallback: true })` or `forceXhrFallback: true`) against a server that does not serve it logs one error (`... does not serve the xhr-polling fallback ...`) and connects with a websocket at once, using it from then on (a websocket that fails later reconnects with the usual backoff). The client's check of the fallback's info path times out after 10 seconds (`xhrProbeTimeout`), aborting the request, and a timeout is treated like the server being down.

## Message size

`maxMessageSize` (bytes, default `16777216`, 16 MiB — MongoDB's document limit, so a write that fits in the database is never refused for its size) is the largest message a client may send. On the server, an explicit option wins, otherwise the `TEAMPLAY_MAX_MESSAGE_SIZE` environment variable (bytes, in plain decimal digits; anything else throws at startup) is used if set, otherwise the default (for frameworks that do not pass channel options through). Set the same value on both sides:

```js
// server
const { upgrade, middleware } = initConnection(backend, { maxMessageSize: 4 * 1024 * 1024 })
// client
connect({ maxMessageSize: 4 * 1024 * 1024 })
```

On the server:

- a websocket message larger than `maxMessageSize` closes that connection with code 1009 ("message too big"), at its frame header, before it is read;
- with the xhr-polling fallback (SockJS), one POST carries the messages the client queued since its previous POST, each escaped as a JSON string (SockJS also writes some characters as `\uXXXX`, up to 3 times their UTF-8 size). The client cuts its batches to fixed limits that do not depend on `maxMessageSize`, and the server enforces the same ones while the body arrives, before SockJS keeps or parses it: at most 1000 messages per POST, and more than one message only within 1 MiB; a POST carrying a single message may be as large as that message escaped (3 × `maxMessageSize`). A POST that breaks them gets 413 and its session is closed (1009). Each message in a POST is also capped at `maxMessageSize`, as a websocket frame is (1009). The messages of a POST are handed to ShareDB a chunk at a time, so one POST never holds the event loop for long;
- a websocket that sends a malformed frame is closed; the server keeps serving the other connections.

On the client, a message larger than `maxMessageSize` is not sent: the request that message would have carried fails with the error code `ERR_MESSAGE_TOO_BIG` (a write is rolled back, a subscription fails) and the connection stays up — on both the websocket and the xhr-polling transports, since the client measures the UTF-8 size of each message before it sends it. A fire-and-forget message (an unsubscribe, presence, a ping) is dropped without a synthetic reply. If the server's limit is lower than the client's and it closes the connection as too big (1009, or a 413 on the xhr-polling fallback), the client logs it, reconnects, and from then on does not send a message as long as the longest one it had sent on that connection, so the request that caused it fails instead of closing the connection again — on both transports.

Messages from the server to the client are not limited.

## Server

The websocket server is [`ws`](https://github.com/websockets/ws) 8. A malformed frame (reserved bits or opcode, an unmasked frame, invalid UTF-8 in a text message) closes that connection with the code ws gives it (1002, 1007); the server logs a short line with the error code and keeps serving everyone else.

`perMessageDeflate` (default `true`): compress websocket messages (permessage-deflate), as the earlier `ws` 1.x did by default. `false` turns it off (ws 8's own default): no zlib memory per connection, at the cost of larger messages on the wire. A compressed message counts against `maxMessageSize` inflated.

## License

MIT
