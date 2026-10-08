# sub() And unsub()

Use `sub()` outside React to load TeamPlay object-tree signals from the server.
It supports document signals, collection queries, and aggregations.

In React components, use `useSub()`, `useAsyncSub()`, or `useBatchSub()` instead.

## Syntax

```javascript
await sub($doc, options)
await sub($collection, queryParams, options)
await sub($aggregation, params, options)

await unsub($signal)
```

## Parameters

- `$doc`: A public document signal, for example `$.users[userId]`.
- `$collection`: A public collection signal, for example `$.users`.
- `$aggregation`: An aggregation input or transformed aggregation header.
- `queryParams`: Mongo-style query parameters for collection queries.
- `params`: Aggregation parameters.
- `options.mode`: Optional transport mode: `'auto'`, `'fetch'`, or `'subscribe'`.

`mode: 'auto'` is the default. It uses live subscription intent unless the root
context is configured as fetch-only.

## Documents

```javascript
import { $, sub, unsub } from 'teamplay'

const $user = await sub($.users[userId])
console.log($user.name.get())

await unsub($user)
```

Use fetch-only transport when you need a one-time load instead of a live
subscription:

```javascript
const $user = await sub($.users[userId], { mode: 'fetch' })
await unsub($user)
```

## Queries

```javascript
const $activeUsers = await sub($.users, { status: 'active' })

for (const $user of $activeUsers) {
  console.log($user.name.get())
}

await unsub($activeUsers)
```

Fetch-only query:

```javascript
const $activeUsers = await sub($.users, { status: 'active' }, { mode: 'fetch' })
```

## Parallel Subscriptions

Use `Promise.all()` for independent subscriptions:

```javascript
const [$user, $activeUsers] = await Promise.all([
  sub($.users[userId]),
  sub($.users, { status: 'active' })
])
```

Cleanup can be parallel too:

```javascript
await Promise.all([
  unsub($user),
  unsub($activeUsers)
])
```

## Cleanup

Call `unsub($signal)` for signals returned by `sub()`.

Each `unsub()` releases one `sub()` of that signal, with the transport mode it
was loaded with. Signals are shared per root and path, so two pieces of code
can hold the same signal with different modes. When a signal holds both a
fetch and a live subscription, `unsub($signal)` releases a fetch first, so it
never downgrades a live subscription another caller still holds. Name the one
to release with `unsub($signal, { mode: 'fetch' | 'subscribe' })`:

```js
const $user = await sub($.users[userId], { mode: 'fetch' }) // one-time load
await sub($.users[userId])                                  // live, elsewhere
await unsub($user, { mode: 'subscribe' })                   // stop live updates
await unsub($user)                                          // release the fetch
```

`unsub()` with a mode that the signal does not hold does nothing.

If subscription GC delay is enabled, cleanup may finish after the delay unless a
quick re-subscribe cancels it.
