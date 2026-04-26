# Usage in StartupJS

StartupJS uses TeamPlay as its ORM and signal layer. Most TeamPlay concepts are the same, but a StartupJS app has its own conventions:

- Import app-facing APIs from `startupjs`, not directly from `teamplay`.
- Put models, schemas, access rules, and aggregations in the app's `model/` folder.
- Let StartupJS auto-load the runtime model files from the filesystem.
- Add TypeScript module augmentation manually so `$`, `sub()`, and `useSub()` know the same model and schema shape at type time.
- Use `npx startupjs check` for project typechecking. It runs StartupJS' pug-aware TypeScript language service.

## Imports

In application code, import TeamPlay APIs through StartupJS:

```ts
import { $, Signal, observer, pug, sub, useSub } from 'startupjs'
```

Use direct `teamplay` imports only in type augmentation declarations, because the exported type registry lives in the `teamplay` module:

```ts
declare module 'teamplay' {
  // TeamplayCollections and TeamplayModels go here
}
```

## Filesystem Model Loading

StartupJS scans the `model/` folder and converts filenames into TeamPlay model patterns. The runtime registration is automatic, so you normally do not call `addModel()` yourself in a StartupJS app.

Common files:

```txt
model/users/index.ts       -> users
model/users/[id].ts        -> users.*
model/users/schema.ts      -> schema for users
model/users/access.ts      -> access rules for users
model/users/$$active.ts    -> aggregation for users
model/users/-helpers.ts    -> ignored by the model loader
```

Rules:

- Use `[id]` in filenames for wildcard path segments. Do not use `*` in filenames.
- `index.ts` is special: `model/users/index.ts` maps to `users`.
- Files or folders whose path section starts with `-` are ignored.
- `schema.ts`, `access.ts`, and `$$...` aggregation files are merged into the top-level collection runtime model object.
- Schemas, access rules, and server aggregations are collection-level concepts. Put them under the collection folder, not under `[id]`.

The loader handles runtime setup only. TypeScript cannot infer global `$` paths from the loader, so you still need module augmentation.

## Collection Schema

Define one schema per real collection in `model/<collection>/schema.ts`. StartupJS commonly uses TeamPlay's simplified JSON Schema style: export the field map directly and mark required fields with `required: true`.

```ts
// model/users/schema.ts
import { pickFormFields, type FromJsonSchema } from 'startupjs'

const schema = {
  name: { type: 'string', required: true },
  email: { type: 'string' },
  createdAt: { type: 'number', required: true }
} as const

export default schema
export type UserDoc = FromJsonSchema<typeof schema>

export const USER_FORM = pickFormFields(schema, {
  exclude: ['createdAt']
})
```

Keep schemas aligned with the stored document shape, including generated fields such as `createdAt`, tokens, relation ids, flags, and nested objects. When `validateSchema: true` is enabled in `startupjs.config.js`, backend writes are validated and invalid client writes are rolled back.

## Model Classes

Collection model files should default-export a `Signal<Document[]>` subclass. Document model files should default-export a `Signal<Document>` subclass.

```ts
// model/users/index.ts
import { Signal } from 'startupjs'
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

```ts
// model/users/[id].ts
import { Signal } from 'startupjs'
import type { UserDoc } from './schema.ts'

export default class User extends Signal<UserDoc> {
  displayName () {
    return this.name.get()
  }
}
```

Add model methods when the operation has business meaning: creating a document with generated fields, updating several fields together, or exposing reusable document logic. For simple field mutations, use signal methods directly:

```ts
await $user.name.set('Ada')
await $user.assign({ email: 'ada@example.com' })
await $user.tags.push('speaker')
```

## Type Augmentation

Create a file included by the app `tsconfig.json`, for example `types/teamplay.ts`. Register each collection with `JsonSchemaSpec`.

```ts
// types/teamplay.ts
import type { JsonSchemaSpec } from 'startupjs'
import type Users from '../model/users/index.ts'
import type User from '../model/users/[id].ts'
import type userSchema from '../model/users/schema.ts'

declare module 'teamplay' {
  interface TeamplayCollections {
    users: JsonSchemaSpec<typeof userSchema, typeof Users, typeof User>
  }
}
```

After this, TypeScript understands:

```ts
$.users.addNew({ name: 'Ada' })
$.users[userId].displayName()
$.users[userId].name.get()

const $user = useSub($.users[userId])
$user.displayName()
$user.email.set('ada@example.com')

const $users = useSub($.users, { name: 'Ada' })
for (const $user of $users) {
  $user.displayName()
}
```

If a collection is provided by a StartupJS plugin or another package and has no local model file, add a type-only entry for the subset your app uses.

```ts
import type { AnySignal, CollectionSpec, SignalClass } from 'startupjs'

type FileDocModel = SignalClass<any> & (new (segments: (string | number)[]) => AnySignal & {
  getUrl (): string
})

declare module 'teamplay' {
  interface TeamplayCollections {
    files: CollectionSpec<Record<string, unknown>, SignalClass<Record<string, unknown>[]>, FileDocModel>
  }
}
```

Use `TeamplayModels` for extra model classes below a document when the filesystem loader registers a deeper path, such as `games.*.players.*`.

```ts
// model/games/[id]/players/[playerId].ts
import { Signal } from 'startupjs'
import type { GameDoc } from '../../schema.ts'

type GamePlayerDoc = GameDoc['players'][number]

export default class GamePlayer extends Signal<GamePlayerDoc> {
  displayName () {
    return this.robot.get() ? `${this.name.get()} (bot)` : this.name.get()
  }
}
```

Then register the nested model type in the augmentation file:

```ts
// types/teamplay.ts
import type GamePlayer from '../model/games/[id]/players/[playerId].ts'

declare module 'teamplay' {
  interface TeamplayModels {
    'games.*.players.*': typeof GamePlayer
  }
}
```

## Subscriptions

Always subscribe to database data before reading it. In React components, use `useSub()`. Outside React, use `sub()`.

```ts
const $user = useSub($.users[userId])
const name = $user.name.get()

const $activeUsers = useSub($.users, {
  active: true,
  $sort: { createdAt: -1 }
})
```

```ts
const $user = await sub($.users[userId])
const $users = await sub($.users, { active: true })
```

Private collections such as `$._session` are client-local and do not need subscriptions.

## React Components

Wrap components with `observer()`. StartupJS components usually render with the `pug` tagged template.

```tsx
import { $, observer, pug, useSub } from 'startupjs'
import { Button, Content, ScrollView, Span } from 'startupjs-ui'

export default observer(function UsersPage () {
  const $users = useSub($.users, { $sort: { createdAt: -1 } })

  async function createUser () {
    await $.users.addNew({ name: 'Ada' })
  }

  return pug`
    ScrollView(full)
      Content(padding)
        Button(onPress=createUser) Add user
        each $user in $users
          Span(key=$user.getId())= $user.displayName()
  `
})
```

Pass signals to child components instead of raw values. Call `.get()` as late as possible.

```tsx
UserCard($user=$user)
```

```tsx
import type { DocumentSignal } from 'startupjs'
import type User from '../model/users/[id].ts'
import type { UserDoc } from '../model/users/schema.ts'

const UserCard = observer(function UserCard ({ $user }: { $user: DocumentSignal<UserDoc, typeof User> }) {
  return pug`
    Span= $user.name.get()
  `
})
```

Use `.getId()` for document ids. Do not use `.id` as a field accessor; `id()` is a signal method that generates ids.

## Local Signals

Use `$()` for local reactive state:

```ts
const $name = $('')
const $draft = $({ name: '', email: '' })
```

Typed local signals infer fields from their initial value. A bare `$()` is allowed for legacy or dynamic local state, but typed initial values give better completion:

```ts
const $modalVisible = $(false)
const $draftUser = $<Partial<UserDoc>>({})
```

## Queries and Aggregations

Use normal queries for filtering and sorting whenever possible:

```ts
const $users = useSub($.users, {
  orgId,
  active: true,
  $sort: { createdAt: -1 }
})
```

Normal query signals are reactive and are automatically filtered by collection read rules when access control is enabled.

Use an aggregation file only when you need real aggregation stages such as `$group`, `$project`, `$lookup`, or `$unwind`.

```ts
// model/users/$$byRole.ts
import { aggregation } from 'startupjs'

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

Then subscribe to the aggregation:

```ts
import $$byRole from '@/model/users/$$byRole.ts'

const $roles = useSub($$byRole, { orgId })
```

Do not use an aggregation for a single `$match`; use a normal query instead. Aggregations are heavier and are not protected by normal document `read` rules, so validate params and session inside the aggregation when access control matters.

## Access Rules and Feature Flags

Enable server features in `startupjs.config.js`:

```js
export default {
  features: {
    enableServer: true,
    validateSchema: true,
    serverAggregate: true,
    accessControl: true
  }
}
```

Access rules live in `model/<collection>/access.ts`:

```ts
import { accessControl } from 'startupjs'

export default accessControl({
  create: ({ session, newDoc }) => session.userId === newDoc.userId,
  read: ({ session, doc }) => session.userId === doc.userId,
  update: ({ session, doc }) => session.userId === doc.userId,
  delete: ({ session }) => !!session.isAdmin
})
```

Access control belongs on top-level collections. Design model methods and aggregations with those rules in mind.

## Typechecking

Use StartupJS' checker for app typechecking:

```bash
npx startupjs check
```

This command runs a pug-aware TypeScript language service. Plain `tsc --noEmit` does not understand StartupJS pug templates and can report unrelated errors.

For normal validation, run:

```bash
npx startupjs check
npx eslint .
```

Run Playwright or other app-level tests when changing user-facing behavior or flows.

## Complete Example

```txt
model/tasks/index.ts
model/tasks/[id].ts
model/tasks/schema.ts
types/teamplay.ts
```

```ts
// model/tasks/schema.ts
import { type FromJsonSchema } from 'startupjs'

const schema = {
  title: { type: 'string', required: true },
  done: { type: 'boolean' },
  createdAt: { type: 'number', required: true }
} as const

export default schema
export type TaskDoc = FromJsonSchema<typeof schema>
```

```ts
// model/tasks/index.ts
import { Signal } from 'startupjs'
import type { TaskDoc } from './schema.ts'

export default class Tasks extends Signal<TaskDoc[]> {
  async addNew (title: string) {
    return await this.add({
      title,
      done: false,
      createdAt: Date.now()
    })
  }
}
```

```ts
// model/tasks/[id].ts
import { Signal } from 'startupjs'
import type { TaskDoc } from './schema.ts'

export default class Task extends Signal<TaskDoc> {
  async toggle () {
    await this.done.set(!this.done.get())
  }
}
```

```ts
// types/teamplay.ts
import type { JsonSchemaSpec } from 'startupjs'
import type Tasks from '../model/tasks/index.ts'
import type Task from '../model/tasks/[id].ts'
import type taskSchema from '../model/tasks/schema.ts'

declare module 'teamplay' {
  interface TeamplayCollections {
    tasks: JsonSchemaSpec<typeof taskSchema, typeof Tasks, typeof Task>
  }
}
```

```tsx
// app/tasks.tsx
import { $, observer, pug, useSub } from 'startupjs'
import { Button, Checkbox, Content, ScrollView, Span } from 'startupjs-ui'

export default observer(function TasksPage () {
  const $tasks = useSub($.tasks, { $sort: { createdAt: -1 } })

  return pug`
    ScrollView(full)
      Content(padding)
        Button(onPress=() => $.tasks.addNew('New task')) Add task
        each $task in $tasks
          Checkbox(
            key=$task.getId()
            value=$task.done.get()
            onChange=() => $task.toggle()
          )
          Span= $task.title.get()
  `
})
```
