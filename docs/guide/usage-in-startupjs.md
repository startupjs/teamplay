# Usage In StartupJS

StartupJS uses TeamPlay as its signal and ORM layer. In StartupJS apps, use the same model conventions as TeamPlay, but import app-facing APIs from `startupjs`.

For the full model convention, read [ORM](/orm/index). For generated types and `Signal<T>` examples, read [TypeScript Support](/guide/typescript-support).

## Imports

Import TeamPlay APIs through StartupJS:

```ts
import { $, Signal, observer, pug, sub, useSub } from 'startupjs'
```

Use direct `teamplay` imports only for low-level integration code.

## Models Folder

StartupJS loads file-based models automatically. Use `models/`:

```txt
models/users/schema.ts
models/users/index.ts
models/users/[id].ts
models/users/access.ts
models/users/$$active.ts
```

StartupJS still supports the legacy `model/` folder as a fallback. If that fallback is used, TeamPlay prints a warning asking you to migrate to `models/`.

The same loader also generates `teamplay-env.d.ts`. `npx startupjs check` runs that generator before typechecking.

Pure TeamPlay apps use a manual `models.setup.ts` file. StartupJS apps should not create one for the same models because the StartupJS registry already imports file-based models, merges plugin models, and initializes TeamPlay.

## Schema

```ts
// models/tasks/schema.ts
import { defineSchema } from 'startupjs'

const schema = defineSchema({
  title: { type: 'string', required: true },
  done: { type: 'boolean' },
  createdAt: { type: 'number', required: true }
})

export default schema
```

StartupJS commonly uses TeamPlay's simplified schema format, where the top-level object is the document fields. If you write full JSON Schema, use `type: 'object'` at the root and put fields under `properties`.

## Collection Model

```ts
// models/tasks/index.ts
import { Signal } from 'startupjs'
import type Task from './schema.ts'

export default class TasksModel extends Signal<Task[]> {
  async addNew (title: string) {
    return await this.add({
      title,
      done: false,
      createdAt: Date.now()
    })
  }
}
```

## Document Model

```ts
// models/tasks/[id].ts
import { Signal } from 'startupjs'
import type Task from './schema.ts'

export default class TaskModel extends Signal<Task> {
  async toggle () {
    await this.done.set(!this.done.get())
  }
}
```

## React Components

Wrap components in `observer()` and subscribe to database data with `useSub()`:

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

Pass signals to child components instead of raw values:

```tsx
TaskRow($task=$task)
```

```tsx
import { observer, pug, type Signal } from 'startupjs'
import type Task from '../models/tasks/schema.ts'

const TaskRow = observer(function TaskRow ({ $task }: { $task: Signal<Task> }) {
  return pug`
    Span= $task.title.get()
  `
})
```

`Signal<Task>` includes schema fields and document model methods when `Task` maps to one known collection.

## Subscriptions Outside React

Use `sub()` outside React:

```ts
const $task = await sub($.tasks[taskId])
await $task.toggle()

const $openTasks = await sub($.tasks, { done: false })
```

Private client state such as `$._session` is local and does not need subscriptions.

## Access Rules And Aggregations

Enable server features in `startupjs.config.js` when you need them:

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

Access rules live in `models/<collection>/access.ts`; aggregation files are named `$$name.ts`. See [Access Control](/orm/access-control) and [Aggregations](/orm/aggregations) for examples.

## Typechecking

Use StartupJS' checker:

```bash
npx startupjs check
```

It runs a pug-aware TypeScript language service and generates `teamplay-env.d.ts` before checking. Plain `tsc --noEmit` does not understand StartupJS pug templates.

For normal validation, run:

```bash
npx startupjs check
npx eslint .
```
