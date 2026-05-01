# TeamPlay Typing Architecture

This document audits the current TeamPlay typing system and records a direction for reducing drift between runtime behavior and TypeScript behavior.

The goal is not to remove all type-level code. TeamPlay uses proxies, file-system conventions, and runtime model registration, so some static bridge is unavoidable. The goal is to make that bridge smaller, more mechanical, and easier to verify when runtime behavior changes.

## Executive Summary

The current system gives a good developer experience:

- `Signal<UserDoc>` exposes schema fields and document model methods.
- `Signal<UserDoc[]>` exposes collection model methods and document item methods when `UserDoc` maps to one known collection.
- `$` exposes generated collection paths from `TeamplayCollections`.
- `sub()` and `useSub()` preserve document, collection, query, and aggregation signal shapes.
- `teamplay-env.d.ts` can be generated from file-based models.

The main architectural issue is that a lot of this behavior is expressed in high-level type helpers that live outside the runtime code that actually decides signal behavior. The biggest examples are:

- `Signal<T>` in `packages/teamplay/index.ts` reinterprets a value type as a document, collection, or plain local signal.
- `CollectionSignal`, `QuerySignal`, and `AggregationSignal` in `packages/teamplay/orm/types/signal.ts` manually model proxy behavior from `SignalBase.ts`, `Query.js`, and `Aggregation.js`.
- `sub.ts` and `useSub.ts` duplicate runtime subscription branches as overloads.
- `FromJsonSchema` in `orm/types/jsonSchema.ts` duplicates part of runtime schema normalization from `@teamplay/schema`.
- `teamplay-env.d.ts` generation duplicates loader traversal and schema introspection rules.

Some duplication is unavoidable because TypeScript cannot infer global root paths from runtime calls like `addModel('users.*', User)`. Runtime calls can happen conditionally or in any module, while TypeScript needs a static module shape. The file-based loader and module augmentation are therefore the right class of solution.

The best path forward is to make runtime modules typed and export reusable type facts, then make the generated augmentation reference those facts instead of rebuilding them. In practice this means:

1. Remove `@ts-nocheck` from type-bearing runtime files in small slices.
2. Collapse duplicated overload logic for `sub()` and `useSub()` into shared result helper types.
3. Introduce a typed model manifest/helper so runtime file-based models and generated types use the same structural contract.
4. Move path, alias, model-pattern, and schema-normalization rules into shared modules used by runtime, Babel generation, and type helpers.
5. Keep `teamplay-env.d.ts` as the static bridge, but generate less bespoke type code.

## Current State After The First Refactor

We are moving in the right direction. The first architecture pass made several important improvements:

- Type facts for file-based models now live in TeamPlay helper types instead of being fully hardcoded in generated declarations.
- `sub()` and `useSub()` now share common result helper types for the cases where TypeScript inference stays good.
- Signal kinds now have a central `SignalKind` / `SignalForKind` core.
- Array readers and array mutators are separated in the type model, and top-level collection/query/aggregation signals no longer expose runtime-invalid array mutators.
- Runtime schema shape detection has a shared home in `@teamplay/schema`, and the Babel plugin reuses the shared JSON Schema keyword list.
- `addModel.ts`, `initModels.ts`, and `utils/aggregation.ts` are now checked TypeScript rather than unchecked public contracts.

This is the correct kind of progress: we did not try to eliminate the static bridge, because TeamPlay's proxy and file-system conventions make that impossible. Instead, we made the bridge more mechanical and pushed interpretation into checked TeamPlay modules.

The remaining problem is that several central public files still carry `@ts-nocheck` and several type rules still model desired UX rather than mechanically reflecting runtime behavior. That is normal at this stage, but it should guide the next iteration.

## Next Direction

The next iteration should prioritize three things.

### 1. Make The Public Runtime Surface Checked

The highest-leverage next step is removing `@ts-nocheck` from files that already contain public type declarations:

- `packages/teamplay/index.ts`
- `packages/teamplay/orm/sub.ts`
- `packages/teamplay/react/useSub.ts`
- eventually `packages/teamplay/orm/SignalBase.ts`

This matters more than adding new type features. If these files are checked, future runtime edits are much more likely to fail during development when they drift from the public type model.

The practical way to do this is to split type-only facade logic out of runtime entry files. For example, the public `Signal<T>` facade and root collection derivation can move into checked type modules imported by `index.ts`. Then `index.ts` can mostly be runtime exports plus type re-exports.

### 2. Add Runtime Signal Descriptors

`SignalKind` exists in the type system, but runtime still expresses kind decisions implicitly:

- collection signals are paths with one public segment,
- document signals are public paths with collection + id,
- query signals are collection-path signals branded with query symbols,
- aggregation signals are `$aggregations.<hash>` paths branded with aggregation symbols,
- nested array fields are regular document/value signals whose current value is an array.

Adding an internal runtime descriptor would make those decisions explicit:

```ts
type SignalRuntimeKind =
  | 'root'
  | 'collection'
  | 'document'
  | 'nestedValue'
  | 'localArray'
  | 'query'
  | 'aggregation'

interface SignalRuntimeDescriptor {
  kind: SignalRuntimeKind
  segments: Array<string | number>
  collectionName?: string
  documentId?: string | number
  itemPattern?: Array<string | number>
}
```

The type system cannot directly infer from runtime descriptors, but aligning names and tests around the same concepts will make drift much easier to spot.

### 3. Improve Ambiguous Internals Without Weakening The Object-Tree API

Some type complexity exists because the public runtime API is very dynamic. The biggest examples are:

- `$.users[id]` requires a broad string index type, which collides with special properties like `ids`, `extra`, and method names.
- aggregation rows are usually document-row-like and should feel similar to query output, but some aggregations return arbitrary metadata objects.
- `Signal<T>` is both the model base class constructor type and the public prop facade type.

The object-tree API is central to TeamPlay's UX. Users should be able to think of `$` as one large reactive object, where collections, documents, and nested fields are accessed with normal property/index syntax. We should not add a separate `$.users.doc(id)` style API just to make types easier.

Instead, the next public API candidates should solve real authoring problems without changing that mental model:

- a first-class typed aggregation output path for arbitrary grouped/metadata results, while keeping document-row-like output as the default,
- a `defineSchema()` helper as the conventional schema authoring entry point, if it can reduce or hide explicit `FromJsonSchema` usage.

For schema typing, there is an important TypeScript limitation: a default-imported schema value cannot normally be used directly as a type name. A plain `export default defineSchema(...)` only exports a value, so `import Game from './schema'` followed by `Signal<Game>` would normally fail.

There is, however, a promising convention: TypeScript allows a default value export and a default interface export in the same module because the interface is type-only.

```ts
const schema = defineSchema({
  title: { type: 'string', required: true }
})

export default schema
export default interface Game extends FromJsonSchema<typeof schema> {}
```

Then consumers can write:

```ts
import Game from '@/models/games/schema'

class GameModel extends Signal<Game> {}
function printGames ($games: Signal<Game[]>) {}
```

This preserves the desired `Signal<Game>` UX without making users write `typeof` at call sites. TeamPlay generates this default interface in `teamplay-env.d.ts`; schema source files are not modified.

The generator can do this without modifying schema source files by emitting a module augmentation in `teamplay-env.d.ts`:

```ts
export {}

type GamesSchema = typeof import('./models/games/schema').default

declare module './models/games/schema' {
  export default interface Game extends FromJsonSchema<GamesSchema> {}
}
```

This makes a normal import work as both a runtime value and a type:

```ts
import Game from '@/models/games/schema'

Game.title // runtime schema value
const $game: Signal<Game> = $(...)
```

The generator should prefer relative module specifiers by default, computed from `teamplay-env.d.ts` to the schema source file. This avoids depending on app-specific aliases such as `@`.

The important constraint is that TypeScript must be able to resolve the augmentation specifier to the schema source file. The import string does not have to be textually identical. In a normal project, augmenting `./models/games/schema` from the root env file also applies when user code imports `@/models/games/schema`, `./models/games/schema`, `../../models/games/schema`, or `../../models/games/schema.ts`, as long as all specifiers resolve to the same file in the same TypeScript program.

Configuration is still useful for generated env files outside the project root, monorepos, symlinked packages, or any setup where the computed relative specifier would not resolve to the same module identity.

## Current Runtime Architecture

### Signal Construction

Runtime signal creation flows through:

- `packages/teamplay/orm/getSignal.ts`
- `packages/teamplay/orm/SignalBase.ts`
- `packages/teamplay/orm/addModel.ts`

`getSignal($root, segments, options)` chooses the runtime class with `getSignalClass(segments)`. `getSignalClass()` calls `findModel(segments)`, which matches runtime model patterns registered through `addModel(pattern, Model)`.

Model pattern rules at runtime:

- `users` matches a collection signal.
- `users.*` matches a document signal.
- `users.*.profile` matches a nested document field signal.
- `[id]` in file names is normalized to `*`.
- Matching is length-sensitive and wildcard segments match one segment.

After the class is chosen, the instance is wrapped in a `Proxy`. That proxy is what gives TeamPlay dot access:

```ts
$.users[userId].profile.name.get()
```

There is no real `name` property on the base class. The proxy creates child signals on demand.

### Method Lookup

`SignalBase.ts` defines base methods such as:

- `get()`
- `peek()`
- `set()`
- `assign()`
- `add()`
- array methods such as `map()`, `reduce()`, `find()`
- array/string mutators
- metadata methods such as `path()`, `getId()`, `getCollection()`, `getAssociations()`

With extremely late bindings enabled, dot access always creates a child signal first. A call like `$user.displayName()` is represented internally as:

1. `get` trap returns a child signal for path `users.<id>.displayName`.
2. `apply` trap sees the last segment is `displayName`.
3. It looks up `displayName` on the raw parent signal for path `users.<id>`.
4. It calls that method with `this` bound to the parent signal.

This is why runtime method lookup is more dynamic than normal TypeScript class lookup.

### Query Signals

`getQuerySignal(collectionName, params, options)` creates a signal at path:

```ts
[collectionName]
```

and marks it with query symbols such as `IS_QUERY`, `COLLECTION_NAME`, and `HASH`.

That means a query result uses the collection model class at runtime. Query-specific data is stored separately under `$queries.<hash>`, and array iteration maps query ids back to document signals:

```ts
for (const id of ids) yield getSignal(root, [collectionName, id])
```

Runtime consequence:

- The top-level query signal behaves like the collection model.
- Query items behave like document model signals.
- Query array methods also pass document model signals.
- Query array mutators are rejected by runtime guards.

### Aggregation Signals

`getAggregationSignal(collectionName, params, options)` creates a signal at path:

```ts
['$aggregations', hash]
```

and marks it with aggregation symbols.

Runtime consequence:

- The top-level aggregation signal does not currently resolve to the collection model class.
- Aggregation rows can redirect method calls to the original document when the row has `_id` or `id`.
- This row redirection is implemented in `extremelyLateBindings.apply()`.

The type system currently treats collection aggregations as array-like document signals, but does not expose collection model methods at the top level.

### File-Based Models

The Babel plugin and Node loader discover file-based models from `models/` or fallback folders. Runtime output has this shape:

```ts
{
  users: {
    default: Users,
    schema,
    access,
    $$active
  },
  'users.*': {
    default: User
  }
}
```

`initModels(models)` registers every `default` class via `addModel(pattern, model.default)` and stores the full object for backend features.

## Current Type Architecture

### Public Module Augmentation

`packages/teamplay/index.ts` exposes three augmentation interfaces:

```ts
export interface TeamplayCollections {}
export interface TeamplayModels {}
export interface TeamplaySignalFields {}
```

Generated or manual augmentation fills these interfaces:

```ts
declare module 'teamplay' {
  interface TeamplayCollections {
    users: JsonSchemaSpec<typeof schema, typeof Users, typeof User>
  }

  interface TeamplayModels {
    'users.*.profile': typeof UserProfile
  }

  interface TeamplaySignalFields {
    'users.*': UsersFields
  }
}
```

This is the static source TypeScript uses for root paths, schemas, model classes, and field JSDoc.

### Public `Signal<T>`

The exported `Signal<T>` type in `packages/teamplay/index.ts` is not just the base class instance type. It is a UX facade.

It does three things:

1. If `T` is `any`, return a loose typed signal.
2. If `T` is a known collection document type, return a document signal with the registered document model and path.
3. If `T` is an array of a known collection document type, return a collection-shaped signal with the registered collection model and document model.

The collection matching uses exact type equality against `CollectionDocument<TeamplayCollections[K]>`. If more than one collection matches the same document shape, it falls back to the plain signal shape because the collection model would be ambiguous.

This is intentionally user-centric:

```ts
function UserCard ({ $user }: { $user: Signal<UserDoc> }) {
  $user.displayName()
}

function UsersList ({ $users }: { $users: Signal<UserDoc[]> }) {
  $users.addNew()
}
```

Runtime cannot know `UserDoc`; this is entirely a TypeScript convenience built from module augmentation.

### `TypedSignal`, `DocumentSignal`, And Child Fields

`packages/teamplay/orm/types/signal.ts` defines the core signal graph.

`TypedSignal<TValue, TModel, TPath>` is an intersection of:

- a base `Signal<TValue>` instance,
- the model instance selected for the path,
- array-like methods when `TValue` is an array,
- child signal properties for object fields,
- generated field mixins from `TeamplaySignalFields`.

The proxy behavior is modeled with mapped types:

```ts
type SignalChildren<TValue, TPath> =
  TValue extends object
    ? { [K in keyof TValue]: SignalChild<TValue[K], AppendPath<TPath, K>> }
      & { [K in keyof TValue as `$${K}`]: SignalChild<TValue[K], AppendPath<TPath, K>> }
    : {}
```

This is why `$user.name` and `$user.$name` work in TypeScript.

### Path-Based Model Selection

`PathModel<TValue, TDefaultModel, TPath>` looks up `JoinPath<TPath>` in `TeamplayModels`.

For example:

```ts
DocumentSignal<GameInfo, typeof Signal, readonly ['games', '*', 'info']>
```

joins to:

```ts
'games.*.info'
```

and receives the nested model class from `TeamplayModels`.

This mirrors runtime `findModel(segments)` for simple exact pattern cases.

### Collection And Query Signals

`CollectionSignal<TDocument, TCollectionModel, TDocumentModel, TPath>` models:

- collection model methods,
- document indexing by id or number,
- `add(value: TDocument): Promise<string>`,
- array-like methods returning document model signals.

`CollectionQuerySignal<TDocument, TCollectionModel, TDocumentModel, TCollectionPath>` currently reuses `CollectionSignal` and adds `ids`.

This matches current query runtime better than the earlier `ArraySignal`-only version because query signals are created at `[collectionName]` and therefore use collection model methods.

`QuerySignal<TDocument, TDocumentModel, TDocumentPath>` is still the generic array-like query shape. It is used for unregistered aggregations and lower-level cases where collection model information is unavailable.

### Aggregation Signals

`CollectionAggregationSignal<TCollection>` is:

```ts
AggregationSignal<
  CollectionDocument<TeamplayCollections[TCollection]>,
  CollectionDocumentModel<TeamplayCollections[TCollection]>,
  readonly [TCollection, '*']
>
```

That means the top-level aggregation is typed as array-like and aggregation items have document model methods.

This matches the row-level runtime fallback for document-like aggregation rows, but it is more optimistic than runtime in one important way: TypeScript does not know whether a particular pipeline returns full documents with `_id` or arbitrary grouped rows. `TypedAggregationInput<TDocument, TDocumentModel>` exists as an escape hatch, but the default collection aggregation assumes collection documents.

### JSON Schema Typing

`FromJsonSchema<TSchema>` maps a TeamPlay-supported JSON Schema subset to a TypeScript document type.

Supported areas include:

- simplified object schemas,
- full `{ type: 'object', properties: ... }` schemas,
- field-level `required: true`,
- `required: [...]`,
- arrays and tuple arrays,
- primitive JSON Schema types,
- `enum`,
- `const`,
- nullable type arrays.

This intentionally mirrors common TeamPlay schema usage, not the full JSON Schema spec.

### Query Param Typing

`QueryParams<TDocument>` builds dot-path keys from the document shape and types common Mongo-style operators.

Known fields are typed:

```ts
sub($.users, { 'profile.age': { $gte: 18 } })
```

Unknown dotted keys and `$...` operators are allowed as `unknown` to avoid blocking valid Mongo/mingo query features that the type system does not model yet.

### Generated `teamplay-env.d.ts`

`packages/babel-plugin-teamplay/loader.js` generates:

- `TeamplayCollections`
- `TeamplayModels`
- `TeamplaySignalFields`

It also parses simple schema files to generate JSDoc mixin types for fields. This is necessary because JSDoc on plain document interfaces does not survive through mapped signal child types well enough for editor completions.

## Audit Matrix

| Area | Runtime source | Type source | Drift risk | Notes |
| --- | --- | --- | --- | --- |
| Base signal methods | `SignalBase.ts` | Same file plus wrappers in `types/signal.ts` | Medium | Method signatures are close to runtime, but file has `@ts-nocheck` and wrappers override array methods. |
| Proxy child access | `extremelyLateBindings.get/apply` | `SignalChildren`, `SignalFieldsForPath` | High | Proxy behavior cannot be inferred automatically. Keep a mapped type, but centralize alias rules. |
| Root `$` collections | Runtime `addModel/initModels` | `TeamplayCollections` augmentation | Unavoidable | TypeScript needs static global declarations. |
| Model pattern matching | `findModel()` | `JoinPath` plus `TeamplayModels` keys | Medium | Both use `*`, but matching implementation and type joining are separate. |
| Collection signal shape | `SignalBase.add`, proxy, model class | `CollectionSignal` | Medium | Mostly stable, but query semantics recently required type changes. |
| Query top-level model methods | `getQuerySignal()` path `[collection]` | `CollectionQuerySignal` | Medium | Now aligned, but manual. |
| Query item methods | `SignalBase[ARRAY_METHOD]` maps ids to `[collection, id]` | `SignalArrayLike<DocumentSignal<...>>` | Medium | Manual but clear. |
| Collection/query mutators | `ensureArrayTarget()` rejects root, collection, and query array mutators | inherited base `Signal<T[]>` methods | High | Collection-shaped types can currently expose mutators that runtime rejects. |
| Query special fields | query proxy handles `ids` and `extra` specially | `ids` is explicit; broad string index can still imply document signals | High | `extra` is not modeled well, and `ids` intersects with string document indexing. |
| Aggregation top-level behavior | `getAggregationSignal()` path `['$aggregations', hash]` | `AggregationSignal` | High | Type is array-like; runtime top-level is not collection model. |
| Aggregation row method fallback | `extremelyLateBindings.apply()` | `CollectionAggregationSignal` item model | High | Type assumes rows are document-like; runtime requires `_id` or `id`. |
| `sub()` behavior | Runtime branch checks | overload list in `sub.ts` | Medium | Same function contains both, but unchecked due `@ts-nocheck`. |
| `useSub()` behavior | wraps `sub()` | duplicated overload list | High | Overloads duplicate `sub()` and can drift. |
| Local `$()` signals | `universal$`, local storage | `LocalSignalFactory` | Medium | Explicit generic and inferred initial values are independent of runtime state. |
| JSON Schema normalization | `transformSchema.js` | `FromJsonSchema` | High | Separate implementations. Simplified/full detection must stay aligned. |
| Schema field JSDoc | none at runtime | Babel AST parser | Medium | Best effort only; should reuse schema introspection rules. |
| Query params | ShareDB/mingo/backend query runtime | `QueryParams<TDocument>` | Medium | Intentionally partial, permits unknown dotted/operator keys. |
| Aggregation headers | `aggregation()` and Babel eliminator | `AggregationFunction`, `RegisteredAggregationInput` | Medium | Client/server transform shapes must stay aligned. |
| Manual model registration | `addModel(pattern, Model)` | checks `TeamplayModels` path keys only | Medium | Nested model paths are checked, but collection pattern registration is not strongly tied to `TeamplayCollections`. |
| Association helpers | `@teamplay/schema` runtime returns JSON Schema objects | `.d.ts` declarations | Low/Medium | Small and currently direct, but declarations are separate from JS implementation. |

## Current Pain Points

### 1. `@ts-nocheck` Hides Runtime/Type Drift

Many files with exported type-bearing runtime APIs still have `@ts-nocheck`:

- `packages/teamplay/index.ts`
- `packages/teamplay/orm/SignalBase.ts`
- `packages/teamplay/orm/sub.ts`
- `packages/teamplay/react/useSub.ts`
- `packages/teamplay/orm/addModel.ts`
- `packages/teamplay/orm/initModels.ts`
- `packages/utils/aggregation.ts`
- `packages/utils/accessControl.ts`

This lets us write TypeScript syntax in implementation files, but TypeScript is not checking whether overload bodies, generic return types, or runtime values actually agree.

### 2. `Signal<T>` Is A Facade, Not The Runtime Class

Users import `Signal` as both:

```ts
class User extends Signal<UserDoc> {}
```

and:

```ts
function UserCard ({ $user }: { $user: Signal<UserDoc> }) {}
```

Runtime `Signal` is a constructor. Type `Signal<T>` is a higher-level facade that may become a document signal, collection signal, or plain typed signal.

This is good UX, but it means the public type named `Signal` is no longer a direct instance type for the runtime base class. That is manageable, but it should be intentional and documented internally.

### 3. Query And Aggregation Types Are Manually Aligned

The runtime decision that query signals use `[collectionName]` is encoded manually in `CollectionQuerySignal`.

If runtime query representation changes, TypeScript will not fail automatically. Type tests should catch common examples, but the architecture has no single source of truth.

Aggregation is even more fragile because the current type surface intentionally models desired UX more than strict runtime guarantees.

### 4. `sub()` And `useSub()` Have Duplicated Overloads

`useSub()` returns the same signal shape as `sub()` for the same inputs, but its overloads are manually copied. `useAsyncSub()` copies them again.

Any new subscription kind currently requires edits in multiple places.

### 5. Schema Runtime And Schema Types Are Separate

Runtime schema normalization lives in `packages/schema/lib/transformSchema.js`.

Type schema inference lives in `packages/teamplay/orm/types/jsonSchema.ts`.

Generated field JSDoc parsing lives in `packages/babel-plugin-teamplay/loader.js`.

All three understand similar concepts: simplified schemas, full object schemas, properties, required fields, and UI metadata. They are not sharing a single schema-introspection module.

### 6. The Model Loader Generates Concrete Type Lines

The generator writes lines like:

```ts
users: JsonSchemaSpec<typeof schema, typeof Users, typeof User>
'users.*.profile': typeof UserProfile
```

This is readable, but it means the generator needs to understand collection patterns, document patterns, schemas, nested models, and field JSDoc. Some of that knowledge also exists in runtime discovery and runtime registration.

### 7. Collection-Shaped Types Still Expose Some Runtime-Invalid Methods

`CollectionSignal` is built from `Signal<TDocument[]>`, so it inherits base array mutators such as `push()`, `pop()`, `insert()`, `remove()`, and `move()`.

Runtime rejects those methods for collection and query signals:

```ts
function ensureArrayTarget ($signal) {
  if ($signal[SEGMENTS].length < 2) throw Error('Can\'t mutate array on a collection or root signal')
  if ($signal[IS_QUERY]) throw Error('Array mutators can\'t be used on a query signal')
}
```

The intended collection mutation API is `add()` for creating documents and document-level methods for editing documents. The types should eventually omit array mutators from collection and query top-level signals while keeping array iteration methods.

### 8. Broad String Indexing Collides With Special Signal Properties

`CollectionSignal` uses broad string indexing to support document access:

```ts
Readonly<Record<string, CollectionDocumentSignal<...>>>
```

This is ergonomic for `$.users[userId]`, but it also means any string property can look like a document signal at the type level.

Runtime has special query properties:

- `$query.ids`
- `$query.extra`

The type system explicitly adds `ids`, but `extra` is not modeled as a query-extra signal today. The broad record also means special names can intersect with document-id access. We should move toward named special properties plus a narrower document accessor if TypeScript can keep the developer experience acceptable.

### 9. Manual Registration Is Less Typed Than File-Based Registration

`addModel()` validates `TeamplayModels` entries for nested patterns, but collection patterns such as `users` are not strongly checked against `TeamplayCollections`.

This is acceptable for the file-based path because generated root types are the primary source of truth. For manual registration, `defineModels()` would give us a better place to type-check collection model, document model, schema, access, and aggregation parts together.

## What Can Be Moved Into Runtime Code

Not every type rule can move into runtime code, but several can.

### Good Candidates

#### Base Method Signatures

Base methods should live only on `SignalBase.ts`, and TypeScript should check the file.

Current status:

- Good: method signatures are close to the implementation.
- Problem: `@ts-nocheck` disables validation.
- Plan: remove `@ts-nocheck` from `SignalBase.ts` in stages.

Expected result:

- JSDoc, argument types, and return types live with the actual method implementation.
- Wrapper types only adapt proxy behavior, not base method behavior.

#### Shared Array Method Types

`SignalBase.ts` and `SignalArrayLike` both define `map`, `reduce`, and `find` behavior.

We can extract a shared interface:

```ts
export interface SignalArrayMethods<TItem> {
  readonly [Symbol.iterator]: () => IterableIterator<TItem>
  map<TResult>(callback: (value: TItem, index: number, array: TItem[]) => TResult, thisArg?: any): TResult[]
  reduce: ...
  find(...)
}
```

Then runtime `Signal` can implement the untyped/base version and proxy wrappers can specialize it with item type.

#### Collection-Safe Method Sets

Base `Signal<T[]>` has both array iteration methods and array mutators. Collection/query signals should expose iteration methods but not array mutators.

Extract explicit method groups:

```ts
type SignalArrayReaders<TItem> = Pick<..., 'map' | 'reduce' | 'find' | typeof Symbol.iterator>
type SignalArrayMutators<TItem> = Pick<..., 'push' | 'pop' | 'insert' | 'remove' | 'move' | ...>
```

Then:

- local array signals use readers and mutators,
- nested array field signals use readers and mutators,
- collection signals use readers plus `add()`,
- query signals use readers plus query metadata,
- aggregation signals use readers plus aggregation metadata.

This matches runtime guards more precisely.

#### Path And Pattern Rules

The following should be centralized:

- `[id]` maps to `*`
- `index` maps to the containing path
- segments starting with `-` are ignored
- `*` in filenames throws
- model pattern syntax validation
- path tuple to model pattern string
- root `$` aliases like `$session -> _session`

Runtime, Babel, Node loader, generated types, and tests should all import from the same path/model-pattern module where possible.

For type-level path joining, we still need conditional types. But the runtime constants and helper names can live next to their type equivalents.

#### Subscription Result Types

`sub()`, `useSub()`, and `useAsyncSub()` should share one exported type helper:

```ts
type SubResult<TSignal, TParams> = ...
type MaybePromise<T> = T | Promise<T>
```

Then:

```ts
function sub<TSignal, TParams = undefined>(
  signal: TSignal,
  params?: TParams
): MaybePromise<SubResult<TSignal, TParams>>

function useSub<TSignal, TParams = undefined>(
  signal: TSignal,
  params?: TParams,
  options?: UseSubOptions
): SubResult<TSignal, TParams>
```

This does not eliminate type-level branching, but it removes duplicated overload lists.

#### Aggregation Metadata

The aggregation runtime already brands functions and headers. The type metadata can be made stronger:

```ts
interface AggregationFunction<TOutput = unknown, TCollection extends string = string, TModel = typeof Signal> { ... }
interface AggregationMeta<TCollection extends string, TOutput = Array<CollectionDocument<TCollection>>> { ... }
```

Then an aggregation can carry output type explicitly without relying on `TypedAggregationInput` as a separate shape. The generic should represent the full signal value, not just a row type, because aggregations can return either an array of rows or a single metadata object. The common collection-registered case should still default to document-row-like array output, because most aggregations are consumed like query results. Arbitrary metadata/grouped output should be explicit:

```ts
const stats = aggregation<{ total: number, currentDay: number, unread: number }>(() => [
  // pipeline
])

const rows = aggregation<Array<{ _id: string, total: number }>>(() => [
  // pipeline
])
```

The first public generic on `aggregation<...>()` should represent output shape. Today the first generic effectively represents collection name, so this is a type-level migration for anyone who explicitly wrote `aggregation<'games'>`. The new convention is more consistent with the rest of TeamPlay's typing model:

```ts
aggregation<Game[]>()
aggregation<{ total: number, unread: number }>()
```

#### Schema Definition Helper

A runtime helper can preserve literal schema types and feed runtime normalization:

```ts
const schema = defineSchema({
  name: { type: 'string', required: true }
})

type UserDoc = InferSchema<typeof schema>
```

`defineSchema()` should stay optional for backward compatibility. Existing plain exported schema objects must continue to work.

The first runtime implementation should be intentionally small:

- return the schema object unchanged,
- preserve literal schema types with a `const` generic,
- mark the object in a `WeakSet` or equivalent internal registry,
- let `initModels()` warn in development when it sees a schema that was not passed through `defineSchema()`.

That marker is runtime logic, but it does not change schema behavior. It only lets TeamPlay guide users toward the conventional path. More aggressive runtime validation, normalization, freezing, or metadata attachment can come later if it clearly improves safety.

The desired `Signal<Game>` syntax should come from generated default interface augmentation in `teamplay-env.d.ts`, not from `defineSchema()` itself.

### Poor Candidates

#### Global Root Inference From `addModel()`

This is not realistically possible for the default global `$`.

TypeScript cannot update the exported shape of `teamplay` after arbitrary runtime calls:

```ts
addModel('users.*', User)
```

Module augmentation or generated declarations are still needed.

#### Full Proxy Behavior From Implementation

TypeScript cannot infer dynamic proxy child properties from the `get` trap. We will always need mapped types for object fields and array items.

#### Fully Dynamic Schemas

If a schema file builds an object dynamically, TypeScript and the Babel generator cannot reliably extract field JSDoc. Users should provide explicit types or accept reduced editor metadata.

## Proposed Target Architecture

### 1. Runtime Core Becomes Type-Checked

Move type-bearing runtime modules toward checked TypeScript.

Start with:

- `SignalBase.ts`
- `Signal.ts`
- `addModel.ts`
- `initModels.ts`
- `sub.ts`
- `useSub.ts`
- `utils/aggregation.ts`

Keep compatibility JS untouched until the non-compat core is stable.

Target state:

- The base class implementation owns base method signatures.
- Subscription functions own runtime and type-level input/result logic in one module.
- `addModel()` and `initModels()` have checked runtime contracts.

### 2. Introduce A Model Manifest Contract

Define a single structural contract for model objects:

```ts
interface ModelEntry {
  default?: SignalClass<any>
  schema?: unknown
  access?: unknown
  [aggregationName: `$$${string}`]: unknown
}

type ModelManifest = Record<string, ModelEntry>
```

Then add helper types:

```ts
type CollectionsFromManifest<TManifest> = ...
type PathModelsFromManifest<TManifest> = ...
type SignalFieldsFromManifest<TManifest> = ...
```

The generated `teamplay-env.d.ts` can become more mechanical:

```ts
import type { CollectionsFromManifest, PathModelsFromManifest } from 'teamplay'
import type models from './path/to/generated-models-type'

declare module 'teamplay' {
  interface TeamplayCollections extends CollectionsFromManifest<typeof models> {}
  interface TeamplayModels extends PathModelsFromManifest<typeof models> {}
}
```

The exact generated file may still need concrete imports for schemas and model classes, but the logic for turning a manifest into type registries should live in TeamPlay, not inside the generator string builder.

### 3. Use `defineModels()` For Manual And Generated Models

Add an optional helper:

```ts
const models = defineModels({
  users: {
    default: Users,
    schema
  },
  'users.*': {
    default: User
  }
})

initModels(models)
```

Benefits:

- Manual users get type checking on the runtime model object.
- Generated file-based models can use the same shape.
- `initModels()` can accept `ModelManifest` and preserve the same type parameter for downstream helpers.

This does not replace module augmentation for the global `$`, but it gives the generator a typed source to derive from.

### 4. Centralize Signal Kind Semantics

Introduce explicit signal-kind type helpers:

```ts
type SignalKind = 'value' | 'document' | 'collection' | 'query' | 'aggregation'

type SignalForKind<TKind, TValue, TCollectionModel, TDocumentModel, TPath> = ...
```

Then define public aliases from this:

```ts
type DocumentSignal<...> = SignalForKind<'document', ...>
type CollectionSignal<...> = SignalForKind<'collection', ...>
type CollectionQuerySignal<...> = SignalForKind<'query', ...>
type AggregationSignal<...> = SignalForKind<'aggregation', ...>
```

This makes query and aggregation differences explicit instead of hidden in separate intersections.

Runtime can also use a parallel descriptor:

```ts
interface SignalRuntimeDescriptor {
  kind: SignalKind
  segments: Array<string | number>
  collectionName?: string
  itemSegments?: Array<string | number>
}
```

`getQuerySignal()` and `getAggregationSignal()` would become the canonical places defining those descriptors.

### 5. Align Aggregation Runtime And Type Semantics

The product direction is that aggregation output is usually row-like and should feel similar to query output by default. Some aggregations return arbitrary objects, and those need an explicit output type.

Current behavior:

- Top-level aggregation signals are not collection model signals.
- Aggregation rows can call document methods only when `_id` or `id` is present.
- Types assume collection-document rows for registered collection aggregations.

Decisions:

- Keep optimistic document-row-like output for registered collection aggregations by default.
- Add explicit output typing for grouped/projection/metadata aggregations with `aggregation<TOutput>(...)`.
- Preserve array-like top-level aggregation signals unless runtime behavior intentionally changes later.
- Consider a runtime header flag that distinguishes document-row output from arbitrary rows, so server/client transforms and TypeScript metadata stay aligned.

### 6. Centralize Schema Introspection

Create a shared schema-introspection module used by:

- runtime `transformSchema()`,
- `FromJsonSchema` documentation and tests,
- Babel field JSDoc extraction,
- `defineSchema()` as the conventional schema authoring helper.

The runtime and Babel code can literally share JavaScript functions for:

- detecting full object schema vs simplified schema,
- listing fields,
- finding required fields,
- extracting `label` and `description`,
- stripping UI-only metadata.

Type-level `FromJsonSchema` cannot call runtime functions, but its tests should be generated from or paired with the same runtime fixtures.

### 7. Make Generated Types Smaller

Generated declarations should avoid embedding too much policy. Prefer generated facts plus TeamPlay-owned derivation helpers.

Current generated facts:

- collection name,
- schema import,
- collection model import,
- document model import,
- nested model import,
- field JSDoc interfaces.

Keep those facts, but move transformation logic into exported helper types:

```ts
type CollectionSpecFromParts<TSchema, TCollectionModel, TDocumentModel> = ...
type GeneratedSignalFields<TDoc, TDocs> = ...
```

The generator should discover and import; TeamPlay should interpret.

## Suggested Refactoring Plan

### Phase 1: Stabilize And Document Current Semantics

This document is the first step.

Follow-up tasks:

- Add a short internal note in type tests explaining that `Signal<T>` is a facade over generated registries.
- Add explicit type tests for ambiguous duplicate document shapes.
- Add explicit type tests for aggregation output assumptions.

### Phase 2: Remove `@ts-nocheck` From Small Runtime Files

Start with files that are already close to valid TypeScript:

1. `packages/utils/aggregation.ts`
2. `packages/teamplay/orm/addModel.ts`
3. `packages/teamplay/orm/initModels.ts`
4. `packages/teamplay/orm/Signal.ts`

Then move to:

5. `packages/teamplay/orm/sub.ts`
6. `packages/teamplay/react/useSub.ts`
7. `packages/teamplay/orm/SignalBase.ts`

Do this incrementally. Do not try to type the whole proxy runtime in one change.

### Phase 3: Share Subscription Result Types

Introduce:

```ts
type SubResult<TSignal, TParams = undefined> = ...
type AsyncSubResult<TSignal, TParams = undefined> = SubResult<TSignal, TParams> | undefined
```

Use those from:

- `sub.ts`
- `useSub.ts`
- `useAsyncSub()`

Keep overloads only if editor display quality suffers without them.

### Phase 4: Add Model Manifest Helpers

Add:

- `ModelEntry`
- `ModelManifest`
- `defineModels()`
- `CollectionsFromManifest<T>`
- `PathModelsFromManifest<T>`

Then update the Babel generator to use these helpers in generated declarations.

This is the highest-leverage refactor for reducing generated type complexity.

### Phase 5: Split Signal Kind Types

Refactor `types/signal.ts` so collection, query, aggregation, document, and local-array behavior are built from one `SignalForKind` core.

This should make future runtime changes, like collection-like aggregation signals, a one-place type update.

### Phase 6: Schema Helper And Shared Introspection

Add `defineSchema()` and shared introspection utilities.

Move Babel JSDoc extraction to the shared schema introspection rules where possible.

Keep `FromJsonSchema` focused on TeamPlay's supported subset and test it against fixtures that also pass runtime `transformSchema()`.

## Testing Strategy

The current `packages/teamplay/test_types/signal-inference.ts` is valuable and should stay as the executable type spec.

Add coverage in these areas:

- Ambiguous document shape fallback for `Signal<T>` and `Signal<T[]>`.
- Query collection model methods on `sub()` and `useSub()`.
- Aggregation rows with document-like output and arbitrary output.
- Manual model manifest helper once it exists.
- Generated `teamplay-env.d.ts` using helper types rather than concrete policy.
- Schema runtime/type fixture pairs.

For every runtime behavior change in signal shape, add one type assertion next to an existing runtime test or in the type spec.

## Open Decisions

### Should `Signal<T[]>` Always Mean Collection-Like?

Current answer: yes, when `T` maps to one known collection document type.

Reason: most user code that accepts `Signal<UserDoc[]>` expects the same practical behavior as `$.users`, query results, or future collection-like aggregation results.

Tradeoff: local arrays of the same document shape may receive collection methods in the public alias. This is a UX tradeoff we accepted. Inferred local `$({ users: [...] })` values still use local typed signal shapes because `LocalSignalFactory` returns `TypedSignal<T>`, not the public `Signal<T>` facade.

### Should Aggregation Top-Level Signals Expose Collection Methods?

Current answer: not yet at runtime.

The type system should not move further until runtime semantics are decided. If top-level aggregation signals become collection-like, update `AggregationSignal` through the future `SignalForKind` core.

### Should Manual `addModel()` Produce Types?

No, not globally.

It can be typed so the model class matches a known augmented pattern, but it cannot create global root typings. Manual users still need module augmentation or a typed local root builder.

### Should We Keep Module Augmentation?

Yes.

For the global singleton `$`, module augmentation is the correct static bridge. The improvement is to generate smaller augmentation that delegates more interpretation to TeamPlay helper types.

## Practical Rules For Future Changes

When changing runtime signal behavior:

1. Identify the affected signal kind: document, collection, query, aggregation, local array, or compat ref.
2. Update the runtime implementation.
3. Update the central signal-kind type helper, not scattered aliases.
4. Add a type assertion in `test_types/signal-inference.ts`.
5. If the change affects file-based models or schemas, update the Babel generator fixture snapshots.
6. If the change affects user-facing setup, update TypeScript Support and ORM docs.

When adding a new model-loading convention:

1. Add it to shared model-pattern utilities.
2. Use the same utility in Node loading, Babel static import generation, require.context generation, and type generation.
3. Add fixture coverage for generated runtime output and generated `teamplay-env.d.ts`.

When adding schema features:

1. Add runtime transform support.
2. Add `FromJsonSchema` support if the type can be represented.
3. Add JSDoc extraction support only if it can be done statically and safely.
4. Add paired runtime and type fixtures.

## Implementation Notes

### Manifest Helpers

The first refactor moved model manifest interpretation into TeamPlay-owned helper types:

- `ModelEntry` and `ModelManifest` describe the runtime object consumed by `initModels()`.
- `defineModels()` is a typed no-op for manual model manifests.
- `CollectionsFromManifest<T>` derives `TeamplayCollections` from collection entries, schema entries, and matching `collection.*` document model entries.
- `PathModelsFromManifest<T>` derives `TeamplayModels` from wildcard model entries such as `games.*` and `games.*.comments.*`.

The generated `teamplay-env.d.ts` now emits an internal manifest interface and augments TeamPlay by extending those helper types. This keeps generator output simpler and moves policy like "collection document model comes from `${collection}.*`" into checked TypeScript code.

### Subscription Result Helpers

`SubResult<TSignal, TParams>` and `MaybePromiseSubResult<TSignal, TParams>` now centralize the common document, collection query, typed aggregation, registered aggregation, client aggregation, and unregistered aggregation result shapes.

Generic aggregation overloads still use direct result types where conditional inference would reduce editor quality. In particular, client aggregation typing goes through `ClientAggregationFunction<TCollection>` because plain `AggregationFunction` can represent server-only model-file aggregations where the collection is not known on the function value.

### Signal Kind Core

`SignalKind` and `SignalForKind` now provide one central place for the major signal shapes. The public aliases still resolve through non-conditional helper shapes where TypeScript needs to infer generic overloads, because conditional facades degrade inference for `sub()` and `useSub()`.

Array readers and mutators are now represented separately:

- Array readers are `map`, `reduce`, `find`, and `[Symbol.iterator]`.
- Array mutators are `push`, `pop`, `unshift`, `shift`, `insert`, `remove`, and `move`.

Top-level collection, query, and aggregation signals expose array readers where runtime supports them, but they block array mutators at the type level. Nested array fields still expose mutators because those paths are valid runtime array targets.

### Schema Introspection Helpers

Schema shape detection now has a shared runtime home in `@teamplay/schema`:

- `isFullObjectSchema()` decides whether a schema is full JSON Schema form (`type: 'object'`) or TeamPlay shorthand.
- `getSchemaPropertiesObject()` returns the properties object for both full and shorthand schema forms.
- `getSimplifiedSchemaRequiredFields()` centralizes shorthand `required: true` extraction.
- `JSON_SCHEMA_KEYWORDS` is shared with the Babel plugin so the AST-based JSDoc extractor does not maintain its own keyword list.

The Babel plugin still needs AST-specific traversal for static schema files, but it no longer owns generic JSON-schema keyword policy.

## Bottom Line

The current type system is a strong first version, but it is still a facade assembled from several independent type modules. That is normal for a proxy-based ORM, but we should reduce policy duplication.

The most important architectural move is not to eliminate `teamplay-env.d.ts`; it is to make `teamplay-env.d.ts` a thin manifest bridge and move interpretation into TeamPlay-owned, checked TypeScript modules.

The second most important move is to type-check the runtime modules that already carry public method signatures. Once `SignalBase.ts`, `sub.ts`, and `useSub.ts` are checked, future runtime edits are much more likely to fail at compile time when they break the public typing model.
