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

For batch screens that need several subscriptions to become ready together, use
`useBatchSub()` and close the barrier with a final no-argument call:

```tsx
import { $, observer, useBatchSub } from 'teamplay'

export default observer(function CourseLessons ({ courseId }) {
  const $course = useBatchSub($.courses[courseId], { defer: false })
  const $lessons = useBatchSub($.lessons, { courseId }, { defer: false })

  useBatchSub()

  return (
    <>
      <h1>{$course.title.get()}</h1>
      {$lessons.map($lesson => (
        <div key={$lesson.getId()}>{$lesson.title.get()}</div>
      ))}
    </>
  )
})
```

`useBatchSub()` is the public batch subscription API. Legacy query hooks
such as `useQuery`, `useQuery$`, `useBatchQuery`, and `useBatchQuery$` are not
part of the object-tree API.

`useBatchSub(signal, params, options)` is syntax sugar for
`useSub(signal, params, { ...options, batch: true, async: false })`; the
no-argument `useBatchSub()` call is syntax sugar for the lower-level
`useSub(undefined, undefined, { batch: true })` barrier.

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

Nested dotted fields are checked when the path is a literal:

```ts
await sub($.users, {
  'profile.city': 'London'
})
```

Computed keys are allowed for Mongo patterns that are only known at runtime. In that case TypeScript can preserve the query object shape, but it cannot validate the computed field's value against a specific schema field:

```ts
const likedByPath = `likes.${viewerId}`

await sub($.users, {
  [likedByPath]: true,
  active: true
})
```

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

You can also use method aliases when that reads better in imperative code:

```ts
const ids = $activeUsers.getIds()
const extra = $activeUsers.getExtra()
```

These names are reserved on query signals. If a real document id is `ids` or `extra`, access that document through the collection object tree:

```ts
const $idsDocument = $.users['ids']
const $extraDocument = $.users['extra']
```

## Queries vs Aggregations

Use queries for simple filtering and sorting. Use [Aggregations](/orm/aggregations) for `$group`, `$project`, `$lookup`, `$unwind`, and other pipeline stages.
