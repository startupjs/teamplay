# TeamPlay

> Full-stack signals ORM with multiplayer

Features:

- signals __*__
- multiplayer __**__
- ORM
- auto-sync data from client to DB and vice-versa __***__
- query DB directly from client __***__
- works in pure JS, on server (Node.js) and integrates with React

> __*__ deep signals -- with support for objects and arrays\
> __**__ concurrent changes to the same data are auto-merged using [OT](https://en.wikipedia.org/wiki/Operational_transformation)\
> __***__ similar to Firebase but with your own MongoDB-compatible database

## Installation

For installation and documentation see [teamplay.dev](https://teamplay.dev)

## ORM Compat Helpers

For legacy Racer-style model mixins (for example versioning libraries which call
`getAssociations()`), use ORM compat helpers from the `teamplay/orm` subpath:

```js
import BaseModel, { hasMany, hasOne, belongsTo } from 'teamplay/orm'
```

These helpers attach class-level associations and expose them through
`$doc.getAssociations()` on model signals.

## React Suspense Gates

If you need to throw a thenable from render, prefer `useSuspendMemo()` or
`useSuspendMemoByKey()` over `useMemo()`.

Why:

- React may restart a suspended initial render.
- `useMemo()` is not a semantic "run this suspend gate once" primitive.
- Side-effectful async work like `join()` may accidentally start again on retry.

### `useSuspendMemo(factory, deps)`

Use it when the suspend gate is local to one observer component instance.

```js
import { observer, useSuspendMemo } from 'teamplay'

const Component = observer(({ $stage, userId, stageUserStore }) => {
  useSuspendMemo(() => {
    if (!stageUserStore?.startedAt) {
      throw $stage.join(userId)
    }
  }, [$stage.getId()])

  return <span>Ready</span>
})
```

This keeps the same pending thenable for the same hook slot while the component
instance is alive.

### `useSuspendMemoByKey(key, factory, deps)`

Use it when the async operation must be deduped by business meaning, not just
by component instance.

```js
import { observer, useSuspendMemoByKey } from 'teamplay'

const Component = observer(({ $stage, stageId, userId, stageUserStore }) => {
  useSuspendMemoByKey(
    `stage.join:${stageId}:${userId}`,
    () => {
      if (!stageUserStore?.startedAt) {
        throw $stage.join(userId)
      }
    },
    [stageId, userId, !!stageUserStore?.startedAt]
  )

  return <span>Ready</span>
})
```

This is the right choice when:

- the component may remount while the promise is still pending;
- two different components may trigger the same async operation;
- the operation should behave like a single in-flight business task.

## License

MIT
