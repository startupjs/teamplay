# ORM

TeamPlay signals can be extended with custom model classes and collection schemas. The runtime parts and the TypeScript parts are intentionally explicit:

- `addModel(pattern, Model)` connects a Signal subclass to a runtime path pattern.
- The backend `models` object connects collection schemas to ShareDB runtime validation.
- `declare module 'teamplay'` connects those same paths to TypeScript so `$`, `sub()`, and `useSub()` can suggest custom methods and schema fields.

## Complete Example

This example defines a shared `model/index.ts` file with `users` and `games` collections, collection-level models, document-level models, nested models, runtime JSON Schemas, and TypeScript module augmentation.

```ts
// model/index.ts
import {
  $,
  Signal,
  addModel,
  aggregation,
  sub,
  type FromJsonSchema,
  type JsonSchemaSpec
} from 'teamplay'

export const userSchema = {
  name: { type: 'string', required: true },
  avatarUrl: { type: 'string' },
  createdAt: { type: 'integer', required: true }
} as const

export const gameSchema = {
  userId: { type: 'string', required: true },
  createdAt: { type: 'integer', required: true },
  info: {
    type: 'object',
    required: true,
    properties: {
      title: { type: 'string', required: true },
      maxPlayers: { type: 'integer', required: true }
    }
  },
  players: {
    type: 'array',
    required: true,
    items: {
      type: 'object',
      required: ['name', 'robot'],
      properties: {
        name: { type: 'string' },
        robot: { type: 'boolean' }
      }
    }
  },
  status: {
    type: 'string',
    enum: ['draft', 'started', 'finished'] as const
  }
} as const

export type Game = FromJsonSchema<typeof gameSchema>
export type GamePlayer = Game['players'][number]
export type User = FromJsonSchema<typeof userSchema>

export class UsersModel extends Signal<User[]> {
  addNew (name: string) {
    return this.add({
      name,
      createdAt: Date.now()
    })
  }
}

export class UserModel extends Signal<User> {
  displayName () {
    return this.name.get()
  }
}

export class GamesModel extends Signal<Game[]> {
  addNew (data: Omit<Game, 'createdAt' | 'status'> & { status?: Game['status'] }) {
    return this.add({
      ...data,
      status: data.status ?? 'draft',
      createdAt: Date.now()
    })
  }
}

export class GameModel extends Signal<Game> {
  async start () {
    await this.status.set('started')
  }

  title () {
    return this.info.title.get()
  }
}

export class GameInfoModel extends Signal<Game['info']> {
  capacityLabel () {
    return `${this.maxPlayers.get()} players`
  }
}

export class GamePlayerModel extends Signal<GamePlayer> {
  displayName () {
    return this.robot.get() ? `${this.name.get()} (bot)` : this.name.get()
  }
}

// Runtime model registration. These classes are used by the Proxy-backed
// signals returned for matching paths.
addModel('users', UsersModel)
addModel('users.*', UserModel)
addModel('games', GamesModel)
addModel('games.*', GameModel)
addModel('games.*.info', GameInfoModel)
addModel('games.*.players.*', GamePlayerModel)

// Runtime schema registration for the backend. Pass this object to
// createBackend({ models }) so ShareDB validates writes for the collection.
export const models = {
  users: {
    schema: userSchema
  },
  games: {
    schema: gameSchema
  }
}

// Type registration. This can live in the same imported file or in a generated
// teamplay-env.d.ts file. The file only has to be included by the app tsconfig.
declare module 'teamplay' {
  interface TeamplayCollections {
    users: JsonSchemaSpec<typeof userSchema, typeof UsersModel, typeof UserModel>
    games: JsonSchemaSpec<typeof gameSchema, typeof GamesModel, typeof GameModel>
  }

  interface TeamplayModels {
    'games.*.info': typeof GameInfoModel
    'games.*.players.*': typeof GamePlayerModel
  }
}

async function example (gameId: string) {
  const userId = await $.users.addNew('Ada')
  $.users[userId].displayName()

  await $.games.addNew({
    userId,
    info: {
      title: 'Chess',
      maxPlayers: 2
    },
    players: [
      { name: 'Ada', robot: false },
      { name: 'Robot 1', robot: true }
    ]
  })

  const $game = await sub($.games[gameId])
  await $game.start()

  $game.info.title.set('Chess')
  $game.info.maxPlayers.increment()
  $game.info.capacityLabel()
  $game.players[0].displayName()

  const $startedGames = await sub($.games, {
    status: 'started',
    'info.maxPlayers': { $gte: 2 }
  })

  for (const $startedGame of $startedGames) {
    await $startedGame.start()
    $startedGame.info.title.get()
  }

  const $$startedGames = aggregation('games', ({ status }: { status: Game['status'] }) => [
    { $match: { status } },
    { $project: { info: 1, players: 1, status: 1 } }
  ])

  const $projectedGames = await sub($$startedGames, { status: 'started' })
  $projectedGames[0].title()
}
```

In server code, pass the exported `models` object to `createBackend()`:

```ts
import { createBackend } from 'teamplay/server'
import { models } from './model/index.ts'

export const backend = createBackend({
  validateSchema: true,
  models
})
```

Keep server-only code such as `createBackend()` in server files. The schema, model classes, `addModel()` calls, and module augmentation can live in a shared model setup file that is imported during app startup.

## What TypeScript Understands

After the module augmentation is loaded, TypeScript can infer the signal shape from the schema and model registry:

- `$.games.` suggests `GamesModel` methods, standard `Signal` methods, and document id navigation.
- `$.games[gameId].` suggests `GameModel` methods, standard `Signal` methods, and fields from `gameSchema`.
- `$.games[gameId].info.` suggests `title`, `maxPlayers`, `capacityLabel()`, and standard `Signal` methods.
- `$.games[gameId].players[0].` suggests `name`, `robot`, `displayName()`, and standard `Signal` methods.
- `$.users[userId].` suggests `UserModel` methods and fields from `userSchema`.
- `sub($.games[gameId])` and `useSub($.games[gameId])` preserve the document model and schema fields.
- `sub($.games, query)` and `useSub($.games, query)` return typed query signals that are iterable and array-like.
- Aggregation subscriptions for a collection use that collection's document model and schema for the projected document signals.
- Local signals created with `$({ ... })` infer fields from the initial value, and computed signals created with `$(() => value)` infer fields from the return value.

## Schema Formats

JSON Schema is the runtime format used by backend validation. TeamPlay also supports the simplified schema style shown above, where top-level keys are treated as object properties.

Collection documents are stored in the database and synchronized as JSON data. Keep persisted values JSON-compatible: strings, numbers, booleans, nulls, arrays, and plain objects. For dates, prefer storing Unix time numbers such as `Date.now()` instead of `Date` instances.

The current type mapper covers the schema features used most often in TeamPlay apps: objects, arrays, tuple arrays, strings, numbers, integers, booleans, nulls, enums, const values, `required: [...]`, and field-level `required: true`.

Zod can be used for type inference through `ZodSchemaSpec`, but TeamPlay does not yet provide a first-class runtime helper that converts Zod schemas into backend JSON Schema. If you use Zod today, still pass JSON Schema to the backend `models` object for runtime validation.

## Module Augmentation

TypeScript cannot infer global `$` paths from runtime `addModel()` calls alone. The module augmentation is the type registry:

- `TeamplayCollections` registers top-level collections, their schemas, collection model classes, and document model classes.
- `TeamplayModels` registers extra path-specific model overrides below documents, such as `games.*.info` or `games.*.players.*`.

In the future this registry can be generated into a `teamplay-env.d.ts` file. For now, add it manually in a file included by the app TypeScript config.
