# Models

Model files attach methods to paths in the TeamPlay data tree. A model is a `Signal` subclass.

## Collection Models

`models/users/index.ts` is the collection model. It receives the collection signal, so it should extend `Signal<User[]>`.

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

Collection methods are a good place for create helpers, default fields, and collection-level workflows.

After initialization, collection methods are available from `$`:

```ts
const userId = await $.users.addNew({ name: 'Ada' })
```

## Document Models

`models/users/[id].ts` is the document model. It receives one document signal, so it should extend `Signal<User>`.

```ts
// models/users/[id].ts
import { Signal } from 'teamplay'
import type User from './schema.ts'

export default class UserModel extends Signal<User> {
  displayName () {
    return this.name.get()
  }

  async rename (name: string) {
    await this.name.set(name)
  }
}
```

Document methods are useful for business operations that belong to one document:

```ts
const $user = await sub($.users[userId])

$user.displayName()
await $user.rename('Ada Lovelace')
```

For simple updates, use signal methods directly:

```ts
await $.users[userId].name.set('Ada')
await $.users[userId].assign({ email: 'ada@example.com' })
```

## Nested Models

Nested model files attach methods below a document:

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

Now nested methods are available on matching paths:

```ts
$.games[gameId].players[0].displayName()
```

## Subscribe Before Reading

Always subscribe to database data before reading it:

```ts
const $user = await sub($.users[userId])
$user.displayName()
```

In React, use `useSub()`:

```tsx
import { $, observer, useSub } from 'teamplay'

export default observer(function UserName ({ userId }: { userId: string }) {
  const $user = useSub($.users[userId])
  return $user.displayName()
})
```

Local/private signals such as `$._session` do not need subscriptions.
