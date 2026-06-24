# ORM

TeamPlay models are `Signal` subclasses attached to paths in your data tree. The conventional setup is file-based: put schemas, model classes, access rules, and aggregations in `models/`, then initialize that model tree in both client and server entries.

For TypeScript details, see [TypeScript Support](/guide/typescript-support). This section focuses on ORM conventions and runtime behavior.

## Quick Start

:::note
StartupJS apps can skip this quick start. StartupJS configures the Babel model loader, loads file-based models, merges plugin models, and initializes TeamPlay models automatically through its registry.
:::

Add the Babel plugin when you want file-based models:

```js
// babel.config.cjs
module.exports = {
  plugins: ['teamplay/babel']
}
```

Create a model folder:

```txt
models/
  users/
    schema.ts
    index.ts
    [id].ts
    access.ts
    _active.ts
```

Create a shared setup file:

```ts
// models.setup.ts
import models from 'teamplay/file-based-models'
import { initModels } from 'teamplay'

initModels(models)
```

Import `models.setup.ts` before using TeamPlay model-backed APIs. On the client, put it near the top of your app entry:

```ts
// client entry
import './models.setup.ts'
```

If you need to modify, merge, or filter the model object, do it in `models.setup.ts` so client and server initialize the same model graph.

On the server, import `models.setup.ts` before creating the backend:

```ts
import './models.setup.ts'
import { createBackend, initConnection } from 'teamplay/server'

const backend = createBackend({
  validateSchema: true
})

const { upgrade } = initConnection(backend)
server.on('upgrade', upgrade)
```

`createBackend()` reuses models that were already initialized with `initModels()`.

## Folder Map

The loader maps files to TeamPlay paths:

```txt
models/users/index.ts       -> users
models/users/[id].ts        -> users.*
models/users/schema.ts      -> schema for users
models/users/access.ts      -> access rules for users
models/users/_active.ts     -> aggregation for users
models/users/-helpers.ts    -> ignored
models/_session/index.ts    -> _session
models/_session/schema.ts   -> schema for the _session private value
```

Use `[id]` for wildcard path segments. Do not use `*` in filenames.
Private collections such as `_session/` are regular model paths; `_name.ts` becomes an aggregation only directly inside a public top-level collection.

Read more in [File-Based Models](/orm/file-based-models).

## Schema

Create one `schema.ts` per collection:

```ts
// models/users/schema.ts
import { defineSchema } from 'teamplay'

export default defineSchema({
  name: {
    type: 'string',
    required: true,
    label: 'Name'
  },
  email: { type: 'string' },
  createdAt: { type: 'number', required: true }
})
```

When `validateSchema: true` is enabled on the backend, writes are validated with this schema. The generated `teamplay-env.d.ts` also makes the schema module's default export usable as the document type.

Schemas for private roots such as `models/_session/schema.ts` describe the private value itself. They are used for TypeScript and are skipped by backend collection validation.

Read more in [Schemas](/orm/schemas).

## Models

`models/users/index.ts` is the collection model:

```ts
import { Signal } from 'teamplay'
import type User from './schema.ts'

export default class UsersModel extends Signal<User[]> {
  async addNew (user: Omit<User, 'createdAt'>) {
    return await this.add({
      ...user,
      createdAt: Date.now()
    })
  }
}
```

`models/users/[id].ts` is the document model:

```ts
import { Signal } from 'teamplay'
import type User from './schema.ts'

export default class UserModel extends Signal<User> {
  displayName () {
    return this.name.get()
  }
}
```

Read more in [Models](/orm/models).

## Queries

Use collection subscriptions for filtered lists:

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

Read more in [Queries](/orm/queries).

## Aggregations

Aggregation files start with `_` and live under the collection folder:

```ts
// models/users/_byRole.ts
import { aggregation } from 'teamplay'

interface RoleCount {
  _id: string
  count: number
}

export default aggregation<RoleCount[]>(({ orgId }: { orgId: string }, { session }) => {
  if (!session.userId) return []

  return [
    { $match: { orgId } },
    { $group: { _id: '$role', count: { $sum: 1 } } }
  ]
})
```

Client builds replace server aggregation implementations with safe aggregation headers.

Read more in [Aggregations](/orm/aggregations).

## Access Control

Access rules live in `access.ts`:

```ts
// models/users/access.ts
import { accessControl } from 'teamplay'

export default accessControl({
  read: ({ session }) => Boolean(session.userId),
  create: ({ session }) => Boolean(session.userId),
  update: ({ session, doc }) => session.userId === doc.id,
  delete: false
})
```

Client builds remove access rules from the bundle automatically.

Read more in [Access Control](/orm/access-control).
