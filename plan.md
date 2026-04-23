# TypeScript Signal Migration Plan

## Current State

- The main Signal runtime lives in `packages/teamplay/orm/SignalBase.js`. `packages/teamplay/orm/Signal.js` only switches between `Signal` and `SignalCompat` depending on `TEAMPLAY_COMPAT`.
- The proxy wrapper lives in `packages/teamplay/orm/getSignal.js`. It always uses `extremelyLateBindings` by default, so property access always returns a child signal and method calls are resolved in the proxy `apply` trap.
- Custom model classes are registered with `addModel(pattern, Model)` from `packages/teamplay/orm/addModel.js`. Runtime model selection uses exact segment-length pattern matching with `*`.
- Runtime schema validation is currently backend-only. `@teamplay/backend/features/validateSchema.js` reads `models[collection].schema`, transforms the simplified schema with `@teamplay/schema/transformSchema`, and passes JSON Schema into `@teamplay/sharedb-schema`.
- Public TypeScript coverage is currently very loose. `packages/teamplay/index.d.ts` exports `$`, `model`, `Signal`, `sub`, and hooks mostly as `any`, so VS Code cannot infer collection fields, document fields, or custom model methods.
- The repo has no source build step. Tests import `.js` files directly, so renaming `SignalBase.js` to `.ts` immediately would break runtime unless we also add a build pipeline or commit generated `.js`.

## Schema Typing Research

- Plain JSON Schema does not automatically provide TypeScript types unless we either add a type-level JSON Schema mapper or use a library such as `json-schema-to-ts`.
- `json-schema-to-ts` is current at `3.1.1` and is purpose-built for inferring TypeScript from JSON Schema, but adding it to public declarations would make it a public type dependency.
- Zod is current at `4.3.6`. Zod 4 has first-party `z.toJSONSchema()` support, so Zod can be a good developer-facing schema source while still emitting JSON Schema for ShareDB validation.
- For this repository, the lowest-risk first step is to implement a small built-in JSON Schema type mapper that handles Teamplay’s common schemas: object, array, string, number/integer, boolean, null, enum, const, required, and the existing simplified `{ field: schema }` form.
- Zod support should be typed structurally via `_output`/`_zod.output` so users can use Zod schemas for static typing without forcing a hard runtime dependency yet. A later runtime helper can call `z.toJSONSchema()` when Zod is installed.

## Target Developer UX

```ts
import { $, Signal, type CollectionSpec, type JsonSchemaSpec, sub } from 'teamplay'

class GamesModel extends Signal<Game> {
  findOpenGames () {
    return this
  }
}

class GameModel extends Signal<Game> {
  start () {
    return this.status.set('started')
  }
}

const gameSchema = {
  info: {
    type: 'object',
    required: true,
    properties: {
      title: { type: 'string', required: true },
      maxPlayers: { type: 'integer', required: true }
    }
  },
  status: { type: 'string', enum: ['draft', 'started'] as const }
} as const

declare module 'teamplay' {
  interface TeamplayCollections {
    games: JsonSchemaSpec<typeof gameSchema, typeof GamesModel, typeof GameModel>
  }
}

$.games.findOpenGames()
$.games.gameId.info.title.get()

const $game = await sub($.games.gameId)
$game.start()
$game.info.maxPlayers.get()
```

Expected VS Code behavior:

- `$.games.` suggests collection model methods, standard Signal methods, and document id access through bracket/dot navigation.
- `$.games[gameId].` suggests document model methods, standard Signal methods, and fields inferred from the schema.
- `$.games[gameId].info.` suggests `title`, `maxPlayers`, and standard Signal methods.
- `sub($.games[gameId])` preserves the same typed document signal.

## Implementation Strategy

1. Add strong public declarations around `Signal`, `sub`, `addModel`, and root `$` without changing runtime behavior.
2. Add a `TeamplayCollections` module-augmentation registry. This is necessary because TypeScript cannot infer global `$` types from runtime `addModel()` calls in unrelated files.
3. Add `CollectionSpec`, `JsonSchemaSpec`, and `ZodSchemaSpec` helper types to bind collection/document data and custom collection/document model classes.
4. Add isolated type tests using `tsc --noEmit` against a test-only config under `packages/teamplay`, because the root TypeScript config is currently broken by docs/tooling dependencies.
5. Keep existing JS runtime tests passing, including compatibility tests.
6. In a follow-up source migration, convert `SignalBase.js` to `SignalBase.ts`, set package-local TypeScript compiler options to `module: NodeNext`, emit runtime `.js`, and treat compat files as JS until they are intentionally migrated.

## Runtime Migration Notes

- Do not change `extremelyLateBindings` semantics during the typing phase. The runtime method-call behavior depends on the proxy returning child signals for all string properties.
- Keep `SignalCompat` importing the default `Signal` wrapper exactly as it does now so compatibility mode behavior remains unchanged.
- If/when Zod runtime schemas are added, expose a helper that accepts a Zod namespace or converter so `z.toJSONSchema(schema)` can be used without making every runtime consumer load Zod.
- Backend validation should continue to receive plain JSON Schema after `transformSchema()`, regardless of whether the source schema is JSON Schema or Zod.

## Direct TypeScript Source Update

- The migrated files are now distributed as `.ts` source directly, without `.js` re-export shims and without parallel `.d.ts` files.
- Package exports point `types` and `default` at the same `.ts` entrypoints for the converted modules. Runtime imports inside the monorepo use explicit `.ts` extensions when they target converted files.
- Jest cannot use Node's built-in TypeScript stripper from its VM module loader, so client tests use a test-only TypeScript strip transformer. This does not produce build artifacts or change published source.
- `SignalBase.ts` now carries the public method annotations directly on the class implementation so local/computed signal inference does not collapse to `any`.
