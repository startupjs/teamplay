# @teamplay/server-aggregate

Racer server aggregate plugin. It allows only server-defined aggregate queries.

## Install

```
yarn add @teamplay/server-aggregate
```

## Setup

In the client code:

```js
require('@teamplay/server-aggregate/client')
```

On the server:

```js
import serverAggregate from '@teamplay/server-aggregate'

serverAggregate(backend, {
  customCheck,
  allowDirectClientAggregations: false
})
```

where:
* `backend`: your ShareDB backend instance
* `customCheck (optional)`: your personal check function. It should return an error message if there is an error. **IMPORTANT** The message must be of type `string`.
* `allowDirectClientAggregations (optional)`: migration-only opt-in for existing direct client `$aggregate` queries. It is `false` by default. Prefer named server aggregations.

## How to add aggregation

On the server side to add aggregation use `backend.addAggregate(collection, queryName, cb, options)`, where:

* `collection`: collection name
* `queryName`: query name (alias)
* `cb(params, shareRequest)`: async function that returns a query object or throw an error
* `options.shouldRequery(input)`: optional synchronous mutation filter. Return `true` when the aggregation can change. Errors and non-boolean results fail open and requery.
* `options.pollDebounce`: optional non-negative ShareDB poll debounce override
* `options.pollInterval`: optional non-negative safety polling interval. Use `0` only when `shouldRequery` covers every relevant mutation.

```js
backend.addAggregate('items', 'main', async (params, shareRequest) => {
  // ...
  // access control or whatever
  // ...

  return [
    {$match: {type: 'wooden'}}
  ]
}, {
  pollDebounce: 0,
  pollInterval: 3000,
  shouldRequery ({ collection, mutation, params, context }) {
    if (collection !== 'items') return false
    return mutation.id === params.itemId
  }
})
```

`shouldRequery` receives the concrete subscription `params`, trusted server
`context` (`session`, root `collection`, and `isServer`), and normalized mutation
metadata (`id`, operation type, document before, and document after). This feature
requires a ShareDB integration which supplies that mutation metadata to `skipPoll`.

## Usage

```js
model.query('items', {
  $aggregationName: 'main',
  $params: {
    type: 'global'
  }
})
```

When you setup the client side as described in the `Setup` section you can use the `aggregateQuery(collection, queryName, params)` function which is syntactic sugar over the `model.query`, where:

```js
model.aggregateQuery('items', 'main', { type: 'global' })
```

## MIT License

Copyright (c) 2018 by Artur Zayats
