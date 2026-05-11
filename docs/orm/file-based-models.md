# File-Based Models

File-based models are the conventional way to connect TeamPlay paths to schemas, model classes, access rules, and aggregations.

## Prerequisites

This page assumes file-based model loading is already configured.

In a pure TeamPlay app, follow the [ORM Quick Start](/orm/index#quick-start) first. It shows how to enable the Babel plugin and initialize the discovered models from a shared setup file.

In a StartupJS app, no manual setup is needed. StartupJS configures the loader and initializes models through its registry.

## Folder Convention

Use `models/` at the project root:

```txt
models/
  users/
    schema.ts
    index.ts
    [id].ts
    access.ts
    _active.ts
    -helpers.ts
```

The loader maps files to paths:

```txt
models/users/index.ts       -> users
models/users/[id].ts        -> users.*
models/users/schema.ts      -> schema for users
models/users/access.ts      -> access rules for users
models/users/_active.ts     -> aggregation for users
models/users/-helpers.ts    -> ignored
models/_session/schema.ts   -> schema for the _session private value
```

Rules:

- `index.ts` maps to the containing path.
- `[id]` maps to `*`.
- `schema.ts`, `access.ts`, and `_name.ts` merge into the collection model object.
- `_name.ts` is treated as an aggregation only directly inside a public top-level collection. Private collections such as `_session/` are regular model paths.
- A schema directly under a private collection, such as `models/_session/schema.ts`, describes the whole private value. It is used for types, not backend collection validation.
- Files or folders starting with `-` are ignored.
- `*` is not allowed in filenames. Use `[id]` instead.

Legacy `$$name.ts` aggregation files are still loaded, but TeamPlay prints a warning. Rename them to `_name.ts`.

Nested paths work the same way:

```txt
models/games/[id]/players/[playerId].ts -> games.*.players.*
```

Dots in filenames are also path separators, so `models/_session.connection.ts` maps to `_session.connection` and `models/users._active.ts` maps to the `_active` aggregation on `users`.

## Generated Types

The Babel plugin also generates `teamplay-env.d.ts` in the project root. It describes your collections, model classes, nested models, and schema field JSDoc for TypeScript.

The file is not rewritten when content is unchanged, so it should not trigger hot reloads unnecessarily.

Include it in `tsconfig.json` if your project does not already include root-level `.d.ts` files:

```json
{
  "include": ["**/*.ts", "**/*.tsx", "teamplay-env.d.ts"]
}
```

See [TypeScript Support](/guide/typescript-support) for the generated type system.

## Advanced Type Inputs

Framework integrations can ask the generator to import plugin declaration files and expose static feature or plugin-option types:

```js
plugins: [[
  'teamplay/babel',
  {
    featuresType: '{ enableUploads: true }',
    pluginTypes: [{
      name: 'permissions',
      importPath: '@acme/permissions/plugin',
      optionsType: '{ isomorphic: { entities: readonly ["teams"] } }'
    }, {
      name: 'files',
      importPath: '@acme/files/plugin'
    }]
  }
]]
```

This is primarily for frameworks that already have a plugin registry. App authors usually should not configure these options directly; the framework should generate the plugin imports and option types.

## Custom Loading Pipelines

The quick start initializes the discovered model object directly. Frameworks or plugin systems can modify or merge that object first, then initialize the final model graph:

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

## Manual Registration

Without file-based loading, pass a model manifest to `initModels()` yourself:

```ts
import { Signal, initModels } from 'teamplay'
import userSchema from './models/users/schema.ts'
import type User from './models/users/schema.ts'

class UsersModel extends Signal<User[]> {}
class UserModel extends Signal<User> {}

initModels({
  users: {
    schema: userSchema,
    default: UsersModel
  },
  'users.*': {
    default: UserModel
  }
})
```

`initModels()` registers each `default` model class and stores the full manifest for backend features such as schemas, access rules, and aggregations. If you only need to attach custom signal classes and do not use a manifest, you can register classes directly with `addModel()`.

When you skip file-based loading, you also need manual TypeScript augmentation. See [TypeScript Support](/guide/typescript-support#manual-augmentation).
