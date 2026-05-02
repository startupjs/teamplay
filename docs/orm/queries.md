# Queries

Queries subscribe to filtered lists from a collection. Query signals are array-like and contain document signals for the collection.

## Basic Query

```ts
import { $, sub } from 'teamplay'

const $activeUsers = await sub($.users, {
  active: true,
  $sort: { createdAt: -1 }
})

for (const $user of $activeUsers) {
  $user.displayName()
}
```

In React:

```tsx
import { $, observer, useSub } from 'teamplay'

export default observer(function ActiveUsers () {
  const $users = useSub($.users, {
    active: true,
    $sort: { createdAt: -1 }
  })

  return $users.map($user => $user.displayName()).join(', ')
})
```

## Query Params

Query params use Mongo-style syntax:

```ts
await sub($.users, {
  name: 'Ada',
  age: { $gte: 18 },
  role: { $in: ['admin', 'member'] },
  $sort: { createdAt: -1 }
})
```

When schemas are generated, TypeScript checks query fields and values against the collection schema.

## Result Signals

Query results behave like collection arrays for reading:

```ts
const names = $activeUsers.map($user => $user.displayName())

for (const $user of $activeUsers) {
  await $user.rename('Ada Lovelace')
}
```

Collection model methods are also available on query result signals when the result points to the same collection:

```ts
const userId = await $activeUsers.addNew({
  name: 'Grace',
  createdAt: Date.now()
})
```

Top-level query results are array-readable. Array mutators such as `push` and `pop` are only typed on actual array fields, because mutating a query result as an array is not a valid database operation.

## Query Metadata

Query signals expose metadata as named child signals:

```ts
const ids = $activeUsers.ids.get()
const extra = $activeUsers.extra.get()
```

`ids` contains the ordered document ids for the current query result. `extra` contains server-provided metadata such as count results when the query returns it.

These names are reserved on query signals. If a real document id is `ids` or `extra`, access that document through the collection object tree:

```ts
const $idsDocument = $.users['ids']
const $extraDocument = $.users['extra']
```

## Queries vs Aggregations

Use queries for simple filtering and sorting. Use [Aggregations](/orm/aggregations) for `$group`, `$project`, `$lookup`, `$unwind`, and other pipeline stages.
