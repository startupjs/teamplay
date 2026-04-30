# ORM

TeamPlay models are `Signal` subclasses attached to paths in your data tree. The conventional setup is file-based: put schemas and models in `models/`, add the Babel plugin, create a shared `models.setup.ts`, and import that setup from both client and server entries.

For TypeScript details, see [TypeScript Support](/guide/typescript-support). This page focuses on the runtime ORM conventions.

## Enable File-Based Models

Add the Babel plugin:

```js
// babel.config.cjs
module.exports = {
  plugins: ['teamplay/babel']
}
```

Then create a `models/` folder:

```txt
models/
  users/
    schema.ts
    index.ts
    [id].ts
    access.ts
    $$active.ts
    -helpers.ts
```

The loader maps files to TeamPlay paths:

```txt
models/users/index.ts       -> users
models/users/[id].ts        -> users.*
models/users/schema.ts      -> schema for users
models/users/access.ts      -> access rules for users
models/users/$$active.ts    -> aggregation for users
models/users/-helpers.ts    -> ignored
```

Use `[id]` for wildcard path segments. Do not use `*` in filenames.

## Define A Schema

Create one `schema.ts` per collection. Most TeamPlay apps use the simplified schema format, where the top-level object is the collection document fields:

```ts
// models/users/schema.ts
import { type FromJsonSchema } from 'teamplay'

const schema = {
  name: {
    type: 'string',
    required: true,
    label: 'Name'
  },
  email: { type: 'string' },
  createdAt: { type: 'number', required: true }
} as const

export default schema
export type UserDoc = FromJsonSchema<typeof schema>
```

When `validateSchema: true` is enabled on the backend, writes are validated with this schema.

## Add Collection Methods

`models/users/index.ts` is the collection model. It receives the collection signal, so it should extend `Signal<UserDoc[]>`.

```ts
// models/users/index.ts
import { Signal } from 'teamplay'
import type { UserDoc } from './schema.ts'

export default class Users extends Signal<UserDoc[]> {
  async addNew (user: Omit<UserDoc, 'createdAt'>) {
    return await this.add({
      ...user,
      createdAt: Date.now()
    })
  }
}
```

Collection methods are a good place for create helpers, default fields, and collection-level workflows.

## Add Document Methods

`models/users/[id].ts` is the document model. It receives one document signal, so it should extend `Signal<UserDoc>`.

```ts
// models/users/[id].ts
import { Signal } from 'teamplay'
import type { UserDoc } from './schema.ts'

export default class User extends Signal<UserDoc> {
  displayName () {
    return this.name.get()
  }

  async rename (name: string) {
    await this.name.set(name)
  }
}
```

Document methods are useful for business operations that belong to one document. For simple updates, use signal methods directly:

```ts
await $.users[userId].name.set('Ada')
await $.users[userId].assign({ email: 'ada@example.com' })
```

## Initialize The Models

Create a shared setup file:

```ts
// models.setup.ts
import models from 'teamplay/file-based-models'
import { initModels } from 'teamplay'

initModels(models)
```

`teamplay/file-based-models` is handled by the Babel plugin in client builds and by TeamPlay's Node loader on the server.

Import `models.setup.ts` before using `$`, `sub()`, `useSub()`, or `createBackend()` with model-backed behavior. In a client/server app, import it in both entries:

```ts
// client entry
import './models.setup.ts'
```

```ts
// server entry
import './models.setup.ts'
```

If your app is client-only, import it only from the client entry. StartupJS apps do not need this file because StartupJS initializes models through its registry.

## Use The Models

After initialization, import normal TeamPlay APIs:

```ts
import { $, sub } from 'teamplay'

const userId = await $.users.addNew({ name: 'Ada' })

const $user = await sub($.users[userId])
$user.displayName()
await $user.rename('Ada Lovelace')
```

In React, use `useSub()`:

```tsx
import { $, observer, useSub } from 'teamplay'

export default observer(function UserName ({ userId }: { userId: string }) {
  const $user = useSub($.users[userId])
  return $user.displayName()
})
```

Always subscribe to database data before reading it. Local/private signals such as `$._session` do not need subscriptions.

## Nested Models

Nested model files attach methods below a document:

```txt
models/games/[id]/players/[playerId].ts -> games.*.players.*
```

```ts
// models/games/[id]/players/[playerId].ts
import { Signal } from 'teamplay'
import type { GameDoc } from '../../schema.ts'

type GamePlayerDoc = GameDoc['players'][number]

export default class GamePlayer extends Signal<GamePlayerDoc> {
  displayName () {
    return this.robot.get() ? `${this.name.get()} (bot)` : this.name.get()
  }
}
```

Now `$.games[gameId].players[0].displayName()` is available.

## Queries

Use collection subscriptions for filtered lists:

```ts
const $activeUsers = await sub($.users, {
  active: true,
  $sort: { createdAt: -1 }
})

for (const $user of $activeUsers) {
  $user.displayName()
}
```

Query signals are array-like and contain document signals for the collection.

## Aggregations

Aggregation files start with `$$` and live under the collection folder:

```ts
// models/users/$$byRole.ts
import { aggregation } from 'teamplay'

interface ByRoleParams {
  orgId: string
}

export default aggregation<'users'>(({ orgId }: ByRoleParams, { session }) => {
  if (!session.userId) return

  return [
    { $match: { orgId } },
    { $group: { _id: '$role', count: { $sum: 1 } } }
  ]
})
```

Then subscribe to it:

```ts
import $$byRole from './models/users/$$byRole.ts'

const $roles = await sub($$byRole, { orgId })
```

Use normal queries for simple `$match`/`$sort` cases. Use aggregations for stages such as `$group`, `$project`, `$lookup`, and `$unwind`.

## Access Rules

Access rules live in `access.ts`:

```ts
// models/users/access.ts
import { accessControl } from 'teamplay'

export default accessControl({
  read: ({ session }) => Boolean(session.userId),
  create: ({ session }) => Boolean(session.userId),
  update: ({ session, doc }) => session.userId === doc.id
})
```

Client builds remove access rules from the bundle automatically.

## Server Setup

Import the shared model setup before creating the backend:

```ts
import './models.setup.ts'
import { createBackend, initConnection } from 'teamplay/server'

const backend = createBackend({
  validateSchema: true
})

const { upgrade } = initConnection(backend)
server.on('upgrade', upgrade)
```

`createBackend()` reuses models that were already initialized with `initModels()`. You can also pass `models` explicitly when you need to build or merge the model object yourself.

## Schema Formats

TeamPlay supports two schema shapes.

Simplified schema:

```ts
const schema = {
  title: { type: 'string', required: true },
  description: { type: 'string' },
  properties: {
    type: 'object',
    properties: {
      color: { type: 'string' }
    }
  }
} as const
```

If the root schema does not have `type: 'object'`, TeamPlay treats it as the collection document's properties. That means fields can be named `title`, `description`, `type`, `required`, `properties`, and other JSON Schema keywords.

Full JSON Schema:

```ts
const schema = {
  type: 'object',
  required: ['title'],
  properties: {
    title: { type: 'string' },
    description: { type: 'string' }
  }
} as const
```

Use full JSON Schema when you need normal JSON Schema root keywords. Use simplified schema for most app models.

Stored documents should be JSON-compatible: strings, numbers, booleans, nulls, arrays, and plain objects. Prefer `Date.now()` numbers over `Date` instances.

## Generated Files

The Babel plugin also generates `teamplay-env.d.ts` in the project root. It is not rewritten when the content is unchanged, so it should not trigger hot reloads unnecessarily.

Include the generated file in `tsconfig.json` if your project does not already include root-level `.d.ts` files:

```json
{
  "include": ["**/*.ts", "**/*.tsx", "teamplay-env.d.ts"]
}
```

See [TypeScript Support](/guide/typescript-support) for what the generated file provides.

## Advanced Usage

Most apps do not need these APIs. They are useful for frameworks, plugins, tests, or custom loading pipelines.

### Custom Loading Pipelines

If you need to merge framework/plugin models or change the model object before registration, put that logic in `models.setup.ts`:

```ts
// models.setup.ts
import { initModels } from 'teamplay'
import models from 'teamplay/file-based-models'

const finalModels = {
  ...models,
  ...pluginModels
}

initModels(finalModels)
```

### Manual Registration

Without file-based loading, register model classes yourself:

```ts
import { Signal, addModel, initModels } from 'teamplay'

class Users extends Signal<UserDoc[]> {}
class User extends Signal<UserDoc> {}

addModel('users', Users)
addModel('users.*', User)

initModels({
  users: {
    schema: userSchema,
    default: Users
  },
  'users.*': {
    default: User
  }
})
```

When you skip file-based loading, you also need manual TypeScript augmentation. See [TypeScript Support](/guide/typescript-support#manual-augmentation).
