# TypeScript Support

TeamPlay's TypeScript support connects three things:

- schemas define the document shape
- model classes define custom methods
- generated module augmentation tells TypeScript which schema and model belong to each path

If you use file-based models, TeamPlay generates the augmentation for you in `teamplay-env.d.ts`.

## The Usual Setup

Add the Babel plugin and put models in `models/`:

```js
// babel.config.cjs
module.exports = {
  plugins: ['teamplay/babel']
}
```

```txt
models/users/schema.ts
models/users/index.ts
models/users/[id].ts
```

The plugin writes `teamplay-env.d.ts` in the project root. Make sure your TypeScript config includes it:

```json
{
  "include": ["**/*.ts", "**/*.tsx", "teamplay-env.d.ts"]
}
```

Many app configs already include root `.d.ts` files through `**/*.ts` or `**/*.tsx`; add the file only if your editor or checker does not see it.

## Infer Document Types From Schemas

With file-based models, TeamPlay generates a default document type for every collection schema module. Define the schema with `defineSchema()` and export it as default:

```ts
// models/users/schema.ts
import { defineSchema } from 'teamplay'

const schema = defineSchema({
  name: {
    type: 'string',
    required: true,
    label: 'Name',
    description: 'Displayed in the profile'
  },
  email: { type: 'string' },
  createdAt: { type: 'number', required: true }
})

export default schema
```

After `teamplay-env.d.ts` is generated, the schema module's default export is also usable as the document type:

```ts
import type User from './models/users/schema.ts'
```

`User` becomes:

```ts
type User = {
  name: string
  email?: string
  createdAt: number
}
```

Plain exported schema objects still work for backward compatibility, but `defineSchema()` is the conventional form and preserves literal inference without `as const`.

## Type Model Classes

Collection models extend `Signal<Document[]>`:

```ts
// models/users/index.ts
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

Document models extend `Signal<Document>`:

```ts
// models/users/[id].ts
import { Signal } from 'teamplay'
import type User from './schema.ts'

export default class UserModel extends Signal<User> {
  displayName () {
    return this.name.get()
  }
}
```

Inside model methods, schema fields are typed signals:

```ts
this.name.get()      // string
this.email.get()     // string | undefined
this.createdAt.get() // number
```

## Use Typed Root Paths

After `teamplay-env.d.ts` is generated, `$` knows your collections:

```ts
import { $, sub } from 'teamplay'

const userId = await $.users.addNew({ name: 'Ada' })

const $user = await sub($.users[userId])
$user.displayName()
$user.name.get()
$user.email.set('ada@example.com')
```

`sub()` and `useSub()` preserve the same schema and model type:

```ts
const $users = await sub($.users, { name: 'Ada' })

for (const $user of $users) {
  $user.displayName()
  $user.name.get()
}
```

Query params are checked against the schema:

```ts
await sub($.users, {
  name: 'Ada',
  $sort: { createdAt: -1 }
})
```

Aggregation output types are output-first:

```ts
import { aggregation, sub } from 'teamplay'
import type User from '../models/users/schema.ts'

const $$activeUsers = aggregation<User[]>(({ orgId }: { orgId: string }) => [
  { $match: { orgId, active: true } }
])

const $activeUsers = await sub($$activeUsers, { orgId })
```

For grouped or metadata output, pass that full result shape:

```ts
const $$notificationStats = aggregation<{ total: number, unread: number }>(() => [])
const $stats = await sub($$notificationStats)

$stats.total.get()  // number
$stats.unread.get() // number
```

## Type Component Props

Use `Signal<T>` for signal props:

```tsx
import { observer, type Signal } from 'teamplay'
import type User from '../models/users/schema.ts'

const UserCard = observer(function UserCard ({ $user }: { $user: Signal<User> }) {
  $user.displayName()
  return $user.name.get()
})
```

`Signal<User>` also includes the generated document model methods when `User` matches one known collection document type.

For query, collection, or list props, use the array document type. The signal keeps the collection model methods, and item signals keep the document model methods:

```ts
function UsersList ({ $users }: { $users: Signal<User[]> }) {
  $users.addNew()

  for (const $user of $users) {
    $user.displayName()
  }
}
```

This also works for query results from `sub()` and `useSub()`:

```ts
const $activeUsers = await sub($.users, { active: true })
$activeUsers.addNew()
```

Top-level collection, query, and aggregation signals are array-readable with `map`, `reduce`, `find`, and iteration. Array mutators such as `push` and `pop` are only typed on actual array fields like `$user.tags`, because mutating a collection or query result as an array is not a valid runtime operation.

If two collections have exactly the same document type, TeamPlay cannot safely infer which collection model belongs to `Signal<T>`, so it falls back to the plain typed signal shape.

## Local Signals

Local signals infer types from their initial value:

```ts
const $visible = $(false)
$visible.get() // boolean

const $draft = $({ name: '', email: '' })
$draft.name.get() // string
```

You can also provide the type explicitly:

```ts
const $newUser = $<User>()
const $showModal = $<boolean>()
```

This gives TypeScript the signal shape, but the runtime value is still uninitialized until you set or assign it.

## Nested Models

Nested files are generated into `TeamplayModels`:

```txt
models/games/[id]/players/[playerId].ts -> games.*.players.*
```

```ts
// models/games/[id]/players/[playerId].ts
import { Signal } from 'teamplay'
import type Game from '../../schema.ts'

type GamePlayer = Game['players'][number]

export default class GamePlayerModel extends Signal<GamePlayer> {
  displayName () {
    return this.robot.get() ? `${this.name.get()} (bot)` : this.name.get()
  }
}
```

Then:

```ts
$.games[gameId].players[0].displayName()
```

## Field Descriptions In Editor Suggestions

For simple schema files, TeamPlay generates field JSDoc from literal `label` and `description` values:

```ts
const schema = {
  name: {
    type: 'string',
    label: 'Name',
    description: 'Displayed in the profile'
  }
} as const
```

Editors can show that text when completing:

```ts
$.users[userId].name
$.users[userId].$name
```

The generator supports common static forms:

```ts
export default {
  name: { type: 'string', label: 'Name' }
}
```

```ts
const schema = {
  name: { type: 'string', label: 'Name' }
}

export default schema
```

If the schema is dynamic or cannot be parsed safely, field JSDoc is skipped but the normal schema type can still work through TypeScript.

## How The Generated File Works

`teamplay-env.d.ts` augments the `teamplay` module and each schema module:

```ts
type UserSchema = typeof import('./models/users/schema').default

declare module './models/users/schema' {
  export default interface User extends FromJsonSchema<UserSchema> {}
}

declare module 'teamplay' {
  interface TeamplayCollections {
    users: JsonSchemaSpec<typeof schema, typeof UsersModel, typeof UserModel>
  }

  interface TeamplayModels {
    'games.*.players.*': typeof GamePlayerModel
  }

  interface TeamplaySignalFields {
    'users.*': UsersFields
  }
}
```

- Schema module augmentation makes `import type User from './models/users/schema.ts'` work.
- `TeamplayCollections` registers collection schemas, collection model classes, and document model classes.
- `TeamplayModels` registers extra model classes below documents.
- `TeamplaySignalFields` preserves schema field JSDoc in signal completions.

You normally do not edit this file.

## Manual Augmentation

If you do not use file-based models, or if a framework/plugin provides models that the local filesystem cannot see, add an augmentation file included by your `tsconfig.json`.

```ts
// types/teamplay.ts
import type { CollectionSpec, SignalClass } from 'teamplay'

interface FileDoc {
  url: string
  mimeType?: string
}

type FilesModel = SignalClass<FileDoc[]>
type FileModel = SignalClass<FileDoc>

declare module 'teamplay' {
  interface TeamplayCollections {
    files: CollectionSpec<FileDoc, FilesModel, FileModel>
  }
}
```

For schemas, prefer `JsonSchemaSpec`:

```ts
import type { JsonSchemaSpec } from 'teamplay'
import schema from '../models/users/schema.ts'
import UsersModel from '../models/users/index.ts'
import UserModel from '../models/users/[id].ts'

declare module 'teamplay' {
  interface TeamplayCollections {
    users: JsonSchemaSpec<typeof schema, typeof UsersModel, typeof UserModel>
  }
}
```

Manual augmentation should match the runtime registration. If the runtime and type registry disagree, TypeScript may suggest methods that are not present at runtime.

## Schema Type Coverage

The type mapper covers the schema features used most often in TeamPlay apps:

- objects and nested properties
- arrays and tuple arrays
- strings, numbers, integers, booleans, and nulls
- enums and const values
- `required: [...]`
- field-level `required: true` in simplified schemas
- `additionalProperties` and `patternProperties`

Zod-like schemas can be used for type inference with `ZodSchemaSpec`, but TeamPlay does not currently convert Zod schemas to backend JSON Schema automatically. Use JSON Schema for runtime validation.
