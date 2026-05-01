# Aggregations

Aggregations define server-side query builders for cases that need Mongo aggregation stages such as `$group`, `$project`, `$lookup`, and `$unwind`.

Use regular [Queries](/orm/queries) for simple `$match` and `$sort` cases.

## Define An Aggregation

Aggregation files start with `$$` and live under the collection folder:

```ts
// models/users/$$byRole.ts
import { aggregation } from 'teamplay'

interface ByRoleParams {
  orgId: string
}

interface RoleCount {
  _id: string
  count: number
}

export default aggregation<RoleCount[]>(({ orgId }: ByRoleParams, { session }) => {
  if (!session.userId) return []

  return [
    { $match: { orgId } },
    { $group: { _id: '$role', count: { $sum: 1 } } }
  ]
})
```

The file name becomes the aggregation name. `models/users/$$byRole.ts` is registered as `byRole` on the `users` collection.

## Subscribe

Import the aggregation and subscribe to it:

```ts
import { sub } from 'teamplay'
import $$byRole from '../models/users/$$byRole.ts'

const $roles = await sub($$byRole, { orgId })
```

In React:

```tsx
import { useSub } from 'teamplay'
import $$byRole from '../models/users/$$byRole.ts'

const $roles = useSub($$byRole, { orgId })
```

## Callback Arguments

The aggregation callback receives two arguments:

```ts
aggregation<Output>((params, context) => {
  context.collection
  context.session
  context.isServer
})
```

`params` is the object passed to `sub($$aggregation, params)` or `useSub($$aggregation, params)`.

`context` contains:

- `collection`: collection name this aggregation runs against.
- `session`: request session. By default it is typed as `{ userId?: string }`.
- `isServer`: whether the aggregation is being evaluated from server-side code.

Return either a Mongo aggregation pipeline array:

```ts
return [
  { $match: { orgId } },
  { $group: { _id: '$role', count: { $sum: 1 } } }
]
```

Or an aggregation query object:

```ts
return {
  $aggregate: [
    { $match: { orgId } }
  ]
}
```

## Output Types

The first generic is the full subscription result shape.

For row-like results:

```ts
interface RoleCount {
  _id: string
  count: number
}

export default aggregation<RoleCount[]>(() => [
  { $group: { _id: '$role', count: { $sum: 1 } } }
])
```

For document rows, use the schema type:

```ts
import type User from './schema.ts'

export default aggregation<User[]>(({ orgId }: { orgId: string }) => [
  { $match: { orgId, active: true } }
])
```

For metadata output, pass the object shape:

```ts
export default aggregation<{ total: number, unread: number }>(() => [])
```

Then the subscribed signal follows that shape:

```ts
const $stats = await sub($$notificationStats)

$stats.total.get()
$stats.unread.get()
```

## Session Types

By default, `context.session` is typed as:

```ts
{ userId?: string }
```

You can provide a custom session shape as the second generic:

```ts
interface Session {
  userId?: string
  role?: 'admin' | 'member'
}

export default aggregation<User[], Session>((params, { session }) => {
  if (session.role !== 'admin') return []
  return [{ $match: params }]
})
```

If you also want to specify the collection type, pass session as the third generic:

```ts
export default aggregation<User[], 'users', Session>((params, { collection, session }) => {
  return [{ $match: { collection, userId: session.userId } }]
})
```

For one-off code, inline callback annotations also work:

```ts
export default aggregation<User[]>((params, { session }: { session: Session }) => {
  return [{ $match: { userId: session.userId } }]
})
```

## Client Security

Aggregation files contain server code. The TeamPlay Babel plugin replaces `aggregation()` calls in client builds with aggregation headers:

```ts
__aggregationHeader<User[], Session>({
  collection: 'users',
  name: '$$byRole'
})
```

The server pipeline implementation is removed from the client bundle. This is why aggregation functions should be defined in `models/<collection>/$$name.ts` files and imported from there.
