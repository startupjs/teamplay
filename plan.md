# TypeScript Signal Migration Plan

## Current State

- The default Signal implementation has been moved to TypeScript source and is distributed as `.ts` directly. Converted runtime imports use explicit `.ts` extensions so Node and Metro can load the source without a build step.
- `packages/teamplay/src/orm/SignalBase.ts` contains the runtime class implementation and its directly maintained method typings. We removed the duplicate ambient `interface Signal` shape so method signatures are no longer maintained in two places.
- `packages/teamplay/src/orm/Signal.ts` is now a small runtime facade that selects `Signal` or `SignalCompat` and re-exports the public type surface.
- Compatibility mode remains JS-backed and intentionally unchanged except for import paths needed to coexist with the converted TS files.
- Type-only logic has been split out of implementation files:
  - `packages/teamplay/src/orm/types/signal.ts` defines the high-level signal graph: `TypedSignal`, `DocumentSignal`, `CollectionSignal`, `QuerySignal`, `AggregationSignal`, model binding, and collection specs.
  - `packages/teamplay/src/orm/types/jsonSchema.ts` maps the supported JSON Schema subset into TypeScript values.
  - `packages/teamplay/src/orm/types/query.ts` maps document schemas into typed Mongo-style query params.
  - `packages/teamplay/src/orm/types/path.ts` contains reusable path tuple/string helpers.
- Public root typing is registry-based. End projects augment `TeamplayCollections` and `TeamplayModels`, and `$`, `sub()`, `useSub()`, query signals, aggregation signals, local signals, and computed local signals derive from those registries.
- Runtime model binding still uses `addModel(pattern, Model)`. Type binding is separate because TypeScript cannot infer global root signal types from runtime calls in unrelated modules.
- Runtime collection schema validation still comes from backend `models[collection].schema`. `createBackend({ models, validateSchema: true })` wires this into ShareDB schema validation outside production.

## Supported Developer UX

The intended developer experience now works through module augmentation:

```ts
import { $, Signal, addModel, sub, type JsonSchemaSpec } from 'teamplay'

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

class GamesModel extends Signal<Array<Game>> {
  collectionLabel () {
    return this.path()
  }
}

class GameModel extends Signal<Game> {
  start () {
    return this.status.set('started')
  }
}

type Game = import('teamplay').FromJsonSchema<typeof gameSchema>

addModel('games', GamesModel)
addModel('games.*', GameModel)

declare module 'teamplay' {
  interface TeamplayCollections {
    games: JsonSchemaSpec<typeof gameSchema, typeof GamesModel, typeof GameModel>
  }
}

$.games.collectionLabel()
$.games[gameId].info.title.get()

const $game = await sub($.games[gameId])
await $game.start()
```

Expected VS Code behavior:

- `$.games.` suggests collection model methods, standard Signal methods, and document id access.
- `$.games[gameId].` suggests document model methods, standard Signal methods, and fields inferred from the collection schema.
- `$.games[gameId].info.` suggests `title`, `maxPlayers`, and standard Signal methods.
- `sub($.games[gameId])`, `useSub($.games[gameId])`, `sub($.games, query)`, and `useSub($.games, query)` preserve the same document schema and document model methods.
- Query and aggregation results behave like typed arrays of document signals. Iteration, numeric indexes, `map`, `reduce`, and `find` expose document signals with schema fields and custom document model methods.
- Local `$({ ... })` and computed `$(() => ...)` infer their value shape from the initial value or return value and expose nested child signals.

## Schema Typing

- JSON Schema typing is built in for the subset Teamplay uses most: object, array, tuple arrays, string, number/integer, boolean, null, enum, const, required arrays, field-level `required: true`, and the existing simplified `{ field: schema }` form.
- Query params are schema-aware. Known document paths are suggested, nested paths such as `'info.maxPlayers'` are supported, and common operators such as `$in`, `$gte`, and `$regex` are value-type checked.
- Zod typing is supported structurally through `ZodSchemaSpec` by reading `_output` or `_zod.output`, but runtime Zod-to-JSON-Schema conversion is not yet exposed as a first-class Teamplay helper.
- If a project uses Zod today, it can use `ZodSchemaSpec` for editor typing and still provide JSON Schema to backend `models` for runtime validation.

## Completed Work

- Converted the default Signal path to TypeScript source without adding a compile step.
- Replaced loose declaration files with implementation-backed types and focused type helper modules.
- Added type tests for schema inference, custom collection/document/nested models, query params, query signals, aggregation signals, `sub()`, `useSub()`, local signals, computed signals, and array-like signal forwarding.
- Fixed runtime regressions found during the TS migration in `sub()` and array-like forwarding, then added behavioral tests so those paths stay covered.
- Added the type test command to the main test command and precommit flow.

## Remaining Work

- Generate a project-level `teamplay-env.d.ts` automatically in the future, similar to Expo Router, so end projects do not have to hand-write module augmentation.
- Add a runtime schema helper if we want Zod to be a first-class schema source:
  - accept a Zod schema for developer typing,
  - convert it to JSON Schema for backend validation,
  - register the generated JSON Schema in the backend `models` object.
- Continue migrating non-Signal source files from JS to TS in small slices, keeping compatibility mode green.
- Expand docs/API references as more of the type surface stabilizes.
