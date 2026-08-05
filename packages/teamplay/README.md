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
> __***__ similar to Firebase but with your own MongoDB database

## Installation

For installation and documentation see [teamplay.dev](https://teamplay.dev)

## ORM Helpers

For legacy Racer-style model mixins (for example versioning libraries which call
`getAssociations()`), use ORM helpers from the `teamplay/orm` subpath:

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
Think of it as a render gate, not as an asynchronous version of `useMemo()`:

1. The factory runs synchronously during render.
2. A normal return value is cached until the dependencies change.
3. If the factory throws a thenable, the same pending thenable is rethrown on
   every retry for that hook slot.
4. After the thenable settles, the factory runs again. It must observe that the
   external signal or state is now ready, or surface a stored error.

Do not pass an `async` factory or return a Promise. A returned Promise is treated
as an ordinary completed value and does not suspend; the factory must throw it.

```js
import { observer, useSuspendMemo } from 'teamplay'

const Component = observer(({ $stage, userId, stageUserStore }) => {
  useSuspendMemo(() => {
    if (!stageUserStore?.startedAt) {
      throw $stage.join(userId)
    }
  }, [$stage.getId(), userId, !!stageUserStore?.startedAt])

  return <span>Ready</span>
})
```

This keeps the same pending thenable for the same hook slot while the component
instance is alive. Dependencies identify the gate inputs; changing them can
start a new operation and does not cancel the previous one.

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

`useSuspendMemoByKey()` deduplicates only the in-flight operation. It does not
cache a completed result; the external signal or state remains the source of
truth after the Promise settles.

## License

MIT
