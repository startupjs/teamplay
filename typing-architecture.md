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

The best path forward is still to make runtime modules typed and export reusable type facts, then make the generated augmentation reference those facts instead of rebuilding them. After the second refactor, the emphasis changes:

1. Continue removing unchecked implementation islands, especially around `SignalBase.ts` and lower-level runtime plumbing.
2. Replace temporary `.d.ts` shims and broad `any` declarations with narrow contracts that match the JavaScript modules they describe.
3. Make runtime descriptors, path rules, model-pattern rules, and schema-introspection rules more load-bearing instead of merely descriptive.
4. Preserve the object-tree authoring model while adding tests around the ambiguous TypeScript edges that the proxy API necessarily creates.
5. Keep `teamplay-env.d.ts` as the static bridge, but keep shrinking the amount of policy generated into that file.

## Current State After Round 2

The second architecture pass finished the highest-risk public surface work from the previous task list:

- `packages/teamplay/index.ts`, `packages/teamplay/orm/sub.ts`, and `packages/teamplay/react/useSub.ts` are now checked rather than protected by `@ts-nocheck`.
- Runtime signal descriptors now name root, collection, document, query, aggregation, local array, and nested-value cases.
- Base signal method contracts live in checked type modules and are reused by `types/signal.ts`.
- Collection/query/aggregation signals expose array readers without exposing runtime-invalid top-level array mutators.
- Aggregation typing now defaults to document-row-like output for registered collection aggregations, while allowing explicit arbitrary output with output-first generics.
- `defineSchema()` is available as the conventional schema helper, and generated env declarations can augment schema modules with default interfaces so `Signal<Game>` remains the target UX.
- The test suite now covers descriptor behavior, aggregation typing, query/special-property collisions, generated schema augmentations, and more schema runtime/type fixtures.

The important strategic choice still looks right: TeamPlay should not abandon module augmentation or the proxy object-tree API. TypeScript cannot infer a global root object from arbitrary runtime calls, and users should still be able to treat `$` as one large reactive object.

The remaining work is lower-level and more about maintainability than about new public features. The public facade is much better guarded, but the runtime/type boundary still has temporary shims, broad declarations, and a few places where runtime facts are described twice.

Current pressure points:

- `packages/teamplay/orm/SignalBase.ts` is now the only remaining non-Compat `@ts-nocheck` island. It still needs careful checked slices, not a whole-file rewrite.
- Some implementation bodies still use `any` where runtime inputs are intentionally dynamic, especially `sub.ts`, `useSub.ts`, and aggregation helper internals. These should be tightened only where readability and overload quality stay acceptable.
- `SignalRuntimeDescriptor` makes runtime signal kind decisions visible, but type helpers do not derive much from it yet.
- `Signal<T>` remains both the model base-class constructor name and the public value facade. That is good UX, but it should be made more explicit internally before pushing deeper into `SignalBase.ts`.
- Query metadata is now first-class for `ids` and `extra`, while broad document-id indexing remains an unavoidable ambiguous edge.
- Schema runtime/type parity now uses a shared matrix for TeamPlay tests, but Babel/JSDoc extraction and generated env tests still need to consume the same cases.

## Current State After Round 3 Consolidation

This iteration reduced the package-surface drift without changing the public object-tree UX:

- Converted small non-Compat runtime modules from `.js` to checked `.ts`, including React helpers, observer support utilities, ORM associations, subscription GC delay, server detection, schema internals, root scope/context cleanup, cache/finalization shims, and `getSignal.ts`.
- Removed broad declaration shims where conversion was practical, and narrowed the remaining JavaScript boundary declarations for `Doc`, `Query`, `Aggregation`, observer wrapping, local `$`, Compat entry points, and `pluralize`.
- Added `RuntimeSignalInstance`, `SignalBaseInstance`, `SignalModelConstructor`, and related exports so internal constraints no longer have to lean on the public `Signal<T>` facade.
- Added a strict external-consumer fixture with `allowJs: false` and modern module resolution to catch package export regressions.
- Modeled query metadata signals for both `ids` and `extra`, with type and runtime coverage for special-property collisions.
- Moved root alias and numeric property-key normalization into checked helpers, and moved array/value mutation target guards out of `SignalBase.ts`.
- Added a shared schema fixture matrix used by runtime schema tests and TeamPlay type fixtures.

The most important remaining boundary is `SignalBase.ts`. That file owns proxy behavior, extremely-late method binding, mutation dispatch, metadata helpers, query/aggregation special properties, and Compat fallbacks. It should be converted in slices with tests around each touched method group.

The main TypeScript limitation that remains intentional is broad collection indexing. `$.users[id]` depends on a broad string index, so TypeScript cannot perfectly distinguish every possible document id from special properties like `ids`, `extra`, or model method names. The current direction is to keep named special properties precise, cover collisions at runtime, and preserve the object-tree access model instead of adding a less natural document accessor solely for TypeScript.

## Current State After Follow-Up Consolidation

The follow-up slice kept the same public UX and focused on reducing duplicated runtime facts:

- `sub.ts` and `useSub.ts` implementation bodies now use `unknown`, `AggregationParams`, and small runtime guards instead of broad implementation-body `any`.
- Signal symbols now live in a checked module, and `SignalBase.ts` delegates symbol-keyed segment access, query-state mutation guards, private path detection, storage-segment access, and owning-root id lookup to checked helpers.
- File-model pattern rules for `[id] -> *`, `index`, ignored `-` files, invalid wildcard filenames, aggregation/schema/access grouping, and collection-pattern checks now live in a shared Babel plugin utility used by Node loading, generated env discovery, static import generation, and tests.
- Runtime path tuple to pattern-string joining is covered in `signalPathRules.ts`.
- The schema fixture matrix now also drives Babel/JSDoc and generated-env tests, including the expected fallback for dynamic schemas.
- User-facing docs now call out query `ids` / `extra`, generated schema module setup, and the intentional broad-indexing limitation.

The most important remaining technical debt is still `SignalBase.ts` itself. The checked helper boundary is better, but the proxy class, extremely-late method binding, and method implementations should continue to move in narrow tested groups rather than through a whole-file conversion.

One practical limitation remains in the Babel plugin: the injected `require.context` helper is still self-contained generated client code, so it cannot directly import the shared Node-side utility. Its behavior is still covered by snapshots and should either stay tested against the shared rule fixtures or be generated from the same source in a later pass.

## Current State After Metadata Slice

This slice continued the same consolidation direction:

- `SignalBase.ts` now delegates read-only metadata behavior (`path`, `leaf`, `parent`, `getId`, `getCollection`, and `getAssociations`) to checked helpers in `signalMetadata.ts`.
- Focused metadata tests cover structural helper behavior, real signal methods, static collection overrides, associations, and aggregation-row ids routed back to source documents.
- The generated `require.context` helper now comes from the shared model-pattern rule module, with a parity test that executes the generated helper source and compares it to the Node-side rules.
- `JoinPath` is exported from the public package surface and covered by both internal and external type fixtures, aligning type-level path joining with the runtime path-pattern helper.

This still looks like the right direction for end-user UX: the object-tree API stays unchanged, but the internal rules behind that API are easier to test and harder to drift. The next `SignalBase.ts` slices should continue to avoid proxy-heavy rewrites until the read dispatch and array reader behavior are isolated with focused tests.

## Next Direction After Round 2

The next iteration should be a consolidation pass. The goal is not to invent a new typing model; it is to make the current model harder to break and easier to extend.

### 1. Tighten Temporary JavaScript Declarations

The new declarations for JavaScript modules were the right bridge for checking public TypeScript entry files. Now they should be narrowed.

Highest-value targets:

- `packages/teamplay/orm/Doc.d.ts`
- `packages/teamplay/orm/Query.d.ts`
- `packages/teamplay/orm/Aggregation.d.ts`
- `packages/teamplay/react/*.d.ts`
- `packages/teamplay/orm/Compat/*.d.ts`

Each pass should replace broad `any` exports with explicit contracts only as far as the runtime module actually promises them. The right test is an external consumer fixture that imports `teamplay` without `allowJs` and still gets useful public types.

### 2. Untangle Runtime Class Contracts From The Public `Signal<T>` Facade

The public `Signal<T>` alias is intentionally smarter than the runtime constructor instance type. That is the right end-user experience:

```ts
class User extends Signal<UserDoc> {}
function UserCard ({ $user }: { $user: Signal<UserDoc> }) {}
```

Internally, though, this overloading makes it harder to type the runtime base class. The next pass should introduce clearer internal names such as `RuntimeSignalInstance`, `SignalBaseInstance`, or `SignalModelConstructor`, then use the public facade only at API boundaries.

This should happen before a large attempt to remove `@ts-nocheck` from all of `SignalBase.ts`.

### 3. Make Runtime Descriptors And Path Rules More Load-Bearing

Descriptors are currently useful for tests and alignment, but the runtime still has multiple places that independently answer questions like "is this a collection path?", "what model pattern does this path imply?", and "what is the document item path for this query row?".

The next useful move is a shared path/model-pattern module for:

- `[id] -> *`
- `index` mapping to the containing path
- ignored `-` files
- invalid wildcard filenames
- root aliases such as `$session -> _session`
- path tuple to pattern string
- descriptor-to-type-kind naming alignment

Type-level helpers will still need conditional types, but the runtime names and test fixtures can be shared.

### 4. Preserve Object-Tree UX While Narrowing Query Metadata

The object-tree API is still the right user model. We should not add `$.users.doc(id)` just to make TypeScript easier.

The next query typing work should focus on the edges users actually hit:

- model `$query.extra` explicitly,
- keep `$query.ids` precise,
- keep query signals assignable to `Signal<T[]>` where that is already a documented UX goal,
- add collision tests for document ids named `ids`, `extra`, and model method names.

If TypeScript cannot express every collision perfectly, the preferred outcome is clear special-property typing plus runtime regression tests, not a less natural public API.

### 5. Turn Schema Parity Into A Fixture Matrix

Schema support now spans runtime normalization, `FromJsonSchema`, Babel/JSDoc extraction, and generated module augmentation. The next improvement is a single matrix of supported and intentionally degraded schema cases.

The matrix should include:

- full object schema,
- TeamPlay shorthand schema,
- keyword-named fields,
- nested objects,
- arrays and tuples,
- nullable values,
- `enum` and `const`,
- unsupported dynamic schema expressions.

Each fixture should state the runtime shape, inferred TypeScript shape, generated field metadata, and expected fallback when static analysis cannot safely infer the schema.

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
    _active
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
| Base signal methods | `SignalBase.ts` | Checked contracts plus wrappers in `types/signal.ts` | Medium | Method contracts are extracted, but the runtime base implementation is still mostly unchecked. |
| Proxy child access | `extremelyLateBindings.get/apply` | `SignalChildren`, `SignalFieldsForPath` | High | Proxy behavior cannot be inferred automatically. Keep a mapped type, but centralize alias rules. |
| Root `$` collections | Runtime `addModel/initModels` | `TeamplayCollections` augmentation | Unavoidable | TypeScript needs static global declarations. |
| Model pattern matching | `findModel()` | `JoinPath` plus `TeamplayModels` keys | Medium | Both use `*`, but matching implementation and type joining are separate. |
| Collection signal shape | `SignalBase.add`, proxy, model class | `CollectionSignal` | Medium | More precise after method-group extraction; still manual. |
| Query top-level model methods | `getQuerySignal()` path `[collection]` | `CollectionQuerySignal` | Medium | Now aligned, but manual. |
| Query item methods | `SignalBase[ARRAY_METHOD]` maps ids to `[collection, id]` | `SignalArrayLike<DocumentSignal<...>>` | Medium | Manual but clear. |
| Collection/query mutators | `ensureArrayTarget()` rejects root, collection, and query array mutators | split array reader/mutator contracts | Low/Medium | Top-level collection/query/aggregation mutators are blocked at the type level; keep regression tests around runtime guards. |
| Query special fields | query proxy handles `ids` and `extra` specially | `ids` is explicit; broad string index can still imply document signals | High | `extra` is still not modeled well, and broad string document access makes special names inherently delicate. |
| Aggregation top-level behavior | `getAggregationSignal()` path `['$aggregations', hash]` plus descriptor | `AggregationSignal` and explicit output generics | Medium | Output-first generics cover arbitrary metadata, but runtime/type alignment remains manual. |
| Aggregation row method fallback | `extremelyLateBindings.apply()` | collection aggregation item model | Medium | Default registered output is document-row-like; arbitrary output must be explicit. |
| `sub()` behavior | Runtime branch checks | checked overload list plus shared result helpers | Medium | Checked now, but direct overloads remain for editor display quality. |
| `useSub()` behavior | wraps `sub()` | checked overload list plus shared result helpers | Medium | Checked now, but overload drift is still possible when new subscription kinds are added. |
| Local `$()` signals | `universal$`, local storage | `LocalSignalFactory` | Medium | Explicit generic and inferred initial values are independent of runtime state. |
| JSON Schema normalization | `transformSchema.js` | `FromJsonSchema` | High | Separate implementations. Simplified/full detection must stay aligned. |
| Schema field JSDoc | none at runtime | Babel AST parser | Medium | Best effort only; should reuse schema introspection rules. |
| Query params | ShareDB/mingo/backend query runtime | `QueryParams<TDocument>` | Medium | Intentionally partial, permits unknown dotted/operator keys. |
| Aggregation headers | `aggregation()` and Babel eliminator | `AggregationFunction`, `RegisteredAggregationInput` | Medium | Client/server transform shapes must stay aligned. |
| Manual model registration | `addModel(pattern, Model)` | checks `TeamplayModels` path keys only | Medium | Nested model paths are checked, but collection pattern registration is not strongly tied to `TeamplayCollections`. |
| Association helpers | `@teamplay/schema` runtime returns JSON Schema objects | `.d.ts` declarations | Low/Medium | Small and currently direct, but declarations are separate from JS implementation. |
| JavaScript module declarations | JS modules under `orm`, `react`, and `schema` | adjacent `.d.ts` shims | Medium/High | Necessary for external TypeScript consumers, but broad `any` exports should be narrowed over time. |

## Current Pain Points

### 1. `@ts-nocheck` Hides Runtime/Type Drift

The highest-risk public entry files are now checked, but several central runtime modules still have `@ts-nocheck` or rely on unchecked JavaScript boundaries:

- `packages/teamplay/orm/SignalBase.ts`
- `packages/teamplay/orm/getSignal.ts`
- `packages/teamplay/orm/Root.ts`
- `packages/teamplay/orm/connection.ts`
- `packages/teamplay/orm/index.ts`
- `packages/teamplay/react/helpers.ts`
- `packages/schema/index.ts`

The next pass should continue in small slices. A full `SignalBase.ts` conversion is still risky until the runtime constructor contracts are clearer.

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

### 3. Runtime Descriptors Are Not Yet Load-Bearing Enough

`SignalRuntimeDescriptor` makes root, collection, document, query, aggregation, local-array, and nested-value cases explicit. That is useful for tests, but the descriptor does not yet drive much implementation or type derivation.

The next goal is to make descriptors and shared path/model-pattern utilities answer more runtime questions, so future changes are not encoded once in runtime branches and again in type helpers.

### 4. Subscription Overloads Are Checked But Still Manual

`sub()`, `useSub()`, and `useAsyncSub()` now share result helper types and their implementation files are checked. Direct overloads remain because they improve VS Code display quality and inference in some cases.

Any new subscription kind still requires care in multiple overload lists. The practical answer is not to remove all overloads, but to keep the branch-result helpers authoritative and add type tests whenever a subscription shape changes.

### 5. Schema Runtime And Schema Types Are Separate

Runtime schema normalization lives in `packages/schema/lib/transformSchema.js`.

Type schema inference lives in `packages/teamplay/orm/types/jsonSchema.ts`.

Generated field JSDoc parsing lives in `packages/babel-plugin-teamplay/loader.js`.

These paths now share some runtime schema helpers, but they still cannot literally share one implementation because `FromJsonSchema` is type-level and the Babel parser is AST-based. They need a shared support matrix so improvements and intentional limitations stay visible.

### 6. The Model Loader Generates Concrete Type Lines

The generator writes lines like:

```ts
users: JsonSchemaSpec<typeof schema, typeof Users, typeof User>
'users.*.profile': typeof UserProfile
```

This is readable, but it means the generator needs to understand collection patterns, document patterns, schemas, nested models, and field JSDoc. Some of that knowledge also exists in runtime discovery and runtime registration.

### 7. Method Groups Are Better, But The Base Runtime Is Still Unchecked

Array readers and mutators are now split in the type model, and collection/query/aggregation top-level signals no longer expose runtime-invalid mutators. That matches the UX we want.

The remaining problem is implementation confidence. `SignalBase.ts` still owns the actual method dispatch and proxy behavior, so future work should move more method guards and descriptor/path helpers into checked modules before attempting a broad conversion.

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

This is acceptable for the file-based path because generated root types are the primary source of truth. `defineModels()` gives manual users a better local contract, but it still cannot create global `$` root typings without module augmentation.

## What Should Move Next

Not every type rule can move into runtime code, but the next good candidates are now narrower than they were in the first pass.

### Good Candidates

#### Runtime Class And Constructor Contracts

The public `Signal<T>` facade should remain optimized for users. Internal runtime modules need more literal names for what they actually consume and construct:

- runtime signal instance,
- runtime signal constructor,
- model constructor,
- base method-bearing instance,
- proxy child/facade shape.

These contracts should live near the runtime modules that use them. That makes later `SignalBase.ts` checking less likely to fight the public facade.

#### Descriptor And Path Helpers

`SignalRuntimeDescriptor` exists, and path/model-pattern behavior is now the best remaining policy to centralize:

- `[id]` maps to `*`,
- `index` maps to the containing path,
- segments starting with `-` are ignored,
- `*` in filenames throws,
- model pattern syntax validation,
- path tuple to model pattern string,
- root `$` aliases like `$session -> _session`.

Runtime, Babel, Node loader, generated types, and tests should use the same helper names and fixture cases where possible. Type-level path joining still needs conditional types, but it should mirror checked runtime utilities.

#### JavaScript Boundary Declarations

The public TypeScript files now depend on adjacent declarations for JavaScript modules. Those declarations should move from "enough to compile" toward "small, truthful contracts".

Prefer:

- exported structural interfaces for the pieces callers use,
- `unknown` for intentionally dynamic values,
- branded internal symbols only when runtime code really exposes them,
- external consumer tests that catch package-surface regressions.

#### Schema Fixture Matrix

Runtime schema transformation, `FromJsonSchema`, Babel JSDoc extraction, and generated schema-module augmentation cannot literally share one implementation. They can share one fixture matrix.

The next step is to make every supported schema case state:

- runtime transform output,
- inferred document type,
- generated field metadata,
- expected fallback when static analysis is impossible.

### Already Moved Far Enough For Now

- Subscription result helpers now exist and public subscription files are checked. Keep direct overloads where editor display quality is better.
- Array reader/mutator groups now match the collection/query/aggregation runtime guard behavior. Keep testing the guard behavior, but do not churn this surface without a real UX reason.
- Aggregation output-first generics now cover arbitrary metadata output. Further aggregation type work should follow runtime semantics, not lead them.
- `defineSchema()` now exists and preserves literal schema values. Future schema work should focus on parity fixtures and docs, not changing the helper's runtime semantics.

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

## Target Architecture Status

### Runtime Core

`addModel.ts`, `initModels.ts`, `utils/aggregation.ts`, `index.ts`, `sub.ts`, `useSub.ts`, `Root.ts`, `rootContext.ts`, `rootScope.ts`, `getSignal.ts`, React helpers, and schema internals are now checked. `SignalBase.ts` still needs incremental conversion.

Target state:

- the base class implementation owns base method signatures,
- checked helper modules own path, descriptor, and guard decisions,
- subscription functions keep runtime and type-level input/result logic close together,
- temporary `.d.ts` shims are narrowed or removed as JS modules become checked, with Compat shims kept only as a temporary bridge until compatibility mode is removed.

### Model Manifest And Generated Env Types

`ModelEntry`, `ModelManifest`, `defineModels()`, `CollectionsFromManifest<T>`, and `PathModelsFromManifest<T>` now exist. The generated env file delegates more interpretation to TeamPlay-owned helper types.

The remaining target is to shrink generated declarations further where helper types can own policy, while keeping concrete imports for facts that only the generator can discover.

### Signal Kind And Descriptor Semantics

`SignalKind`, `SignalForKind`, and `SignalRuntimeDescriptor` now provide shared vocabulary for signal shapes. The remaining target is to make descriptor/path helpers more load-bearing and to keep type-level kind names aligned with runtime descriptor names.

### Aggregation Semantics

The current product direction is stable:

- registered collection aggregations are document-row-like by default,
- arbitrary grouped or metadata output should be explicit with `aggregation<TOutput>(...)`,
- top-level aggregation signals remain array-like unless runtime behavior intentionally changes later.

If aggregation runtime headers later distinguish document-row output from arbitrary rows, TypeScript metadata should follow that runtime fact.

### Schema Semantics

Schema shape detection has a shared runtime home, `defineSchema()` is the recommended authoring helper, and generated schema-module default interfaces preserve the desired `Signal<Game>` UX.

The remaining target is not a larger helper API; it is fixture-driven parity across runtime transform, type inference, Babel extraction, and generated env declarations. Runtime and TeamPlay type tests now share a matrix; Babel/JSDoc and generated-env tests should be moved onto that matrix next.

## Completed Refactoring Plan

The first thirteen task phases are complete and are tracked in [tasks.md](./tasks.md). Round 3 is partially complete and should continue from the remaining unchecked tasks plus the suggested next task set. In summary, the completed phases:

- locked the current `Signal<T>` facade semantics with type tests,
- checked the public entry and subscription runtime files,
- introduced shared subscription result helpers,
- added model manifest helpers,
- centralized signal-kind type shapes,
- split array readers from array mutators,
- added runtime signal descriptors,
- extracted base signal method contracts,
- redesigned aggregation generics around explicit output,
- preserved object-tree document access,
- added `defineSchema()`,
- generated schema-module default interfaces, and
- expanded schema/runtime/type fixtures.

The next plan should start from the remaining Round 3 items and "Suggested Next Task Set" in [tasks.md](./tasks.md), not from the historical phases above.

## Testing Strategy

The current `packages/teamplay/test_types/signal-inference.ts` is valuable and should stay as the executable type spec.

Keep expanding coverage in these areas:

- External consumer imports of `teamplay` without `allowJs`, especially across the temporary `.d.ts` shims.
- Ambiguous document shape fallback for `Signal<T>` and `Signal<T[]>`.
- Query collection model methods, `ids`, `extra`, and collision cases on `sub()` and `useSub()`.
- Aggregation rows with document-like output and arbitrary output.
- Generated `teamplay-env.d.ts` helper use, schema module augmentation, and nonstandard `root` / `typesFile` layouts.
- Schema runtime/type fixture pairs that share a single support matrix.

For every runtime behavior change in signal shape, add one type assertion next to an existing runtime test or in the type spec.

## Open Decisions

### Should `Signal<T[]>` Always Mean Collection-Like?

Current answer: yes, when `T` maps to one known collection document type.

Reason: most user code that accepts `Signal<UserDoc[]>` expects the same practical behavior as `$.users`, query results, or future collection-like aggregation results.

Tradeoff: local arrays of the same document shape may receive collection methods in the public alias. This is a UX tradeoff we accepted. Inferred local `$({ users: [...] })` values still use local typed signal shapes because `LocalSignalFactory` returns `TypedSignal<T>`, not the public `Signal<T>` facade.

### Should Aggregation Top-Level Signals Expose Collection Methods?

Current answer: not yet at runtime.

The type system should not move further until runtime semantics are decided. If top-level aggregation signals become collection-like, update `AggregationSignal` through the existing `SignalForKind` core.

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

The earlier refactors moved model manifest interpretation into TeamPlay-owned helper types:

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

The current type system is a strong proxy-friendly facade, and the second refactor moved the most visible public surfaces into checked code. The next quality jump is deeper: reduce temporary JavaScript shims, make descriptors/path/schema rules shared and testable, and keep the object-tree UX stable while narrowing the ambiguous edges.

The most important architectural move is still not to eliminate `teamplay-env.d.ts`; it is to keep making `teamplay-env.d.ts` a thin manifest bridge while moving interpretation into TeamPlay-owned, checked TypeScript modules.

The second most important move is to type-check the remaining runtime modules that carry public method signatures or shape decisions. Once `SignalBase.ts` and the lower-level signal/path/runtime helpers are checked in narrow slices, future runtime edits are much more likely to fail at compile time when they break the public typing model.
