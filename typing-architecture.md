# TeamPlay Typing Architecture

This document describes the current TeamPlay typing architecture and the direction for keeping runtime behavior and TypeScript behavior aligned. Read [architecture.md](./architecture.md) first for the runtime and monorepo overview. This document intentionally avoids a chronological changelog; completed refactor history belongs in Git.

## Goals

TeamPlay uses proxies, file-system model conventions, runtime model registration, and generated module augmentation. Some static bridge code is unavoidable. The goal is to keep that bridge small, mechanical, and covered by tests.

The desired end-user experience is:

- `Signal<UserDoc>` exposes schema fields and document model methods.
- `Signal<UserDoc[]>` exposes collection model methods and item document methods when `UserDoc` maps to one known collection.
- `$` exposes generated collection paths from `TeamplayCollections`.
- `$.collection[id]` remains the conventional document access API.
- `sub()` and `useSub()` preserve document, collection, query, and aggregation signal shapes.
- `teamplay-env.d.ts` can be generated from file-based models, schemas, access rules, and aggregations.

The main implementation goal is to move runtime facts closer to checked runtime modules, then have generated declarations and public helper types reference those facts where TypeScript allows it.

## Current Status

The public typing surface is now mostly in the desired shape:

- `packages/teamplay/src/index.ts`, `packages/teamplay/src/orm/sub.ts`, and `packages/teamplay/src/react/useSub.ts` are checked.
- Public `Signal<T>` is a registry-based facade over runtime signals, model methods, schema fields, and generated path facts.
- Runtime/public contracts are separated through names such as `RuntimeSignalInstance`, `SignalBaseInstance`, and `SignalModelConstructor`.
- Collection, query, and aggregation signal types share central `SignalKind` / `SignalForKind` helpers.
- Query `ids` and `extra` are explicit metadata signals while query results remain assignable to `Signal<T[]>`.
- Aggregation typing is output-first and supports both document-row-like results and arbitrary explicit output shapes.
- Schema support has a shared fixture matrix across runtime schema tests, type tests, Babel/JSDoc tests, and generated-env tests.
- Strict external consumer tests validate the package surface without `allowJs`.

The main remaining implementation boundary is `SignalBase.ts`. It is still `@ts-nocheck`, but much of its behavior has been carved into checked helpers:

- `signalSymbols.ts`: shared signal symbols and default getter names.
- `signalPathRules.ts`: root alias and numeric property-key normalization, plus runtime path joining.
- `signalRuntimeAccess.ts`: segment access, owning root id lookup, private path detection, and mutation target checks.
- `signalMutationGuards.ts`: value/array mutation target validation.
- `signalMetadata.ts`: `path()`, `leaf()`, `parent()`, `getId()`, `getCollection()`, and `getAssociations()` behavior.
- `signalArrayReaders.ts`: query-id and array-index child-signal selection for iteration, `map`, `reduce`, and `find`.
- `signalReads.ts`: `get()`, `peek()`, `[GET]`, and `getIds()` storage-routing behavior.
- `signalValueMutations.ts`: `set()` and `del()` routing.
- `signalStorageMutations.ts`: shared public/private/id-field/publicOnly routing for array mutators, string mutators, and `increment()`.
- `idFields.ts`: checked id-field, public document path, add payload, and id normalization rules.

This is the right direction for maintainability: public UX remains stable, while high-risk runtime decisions become smaller, named, and independently testable.

## Runtime Architecture

### Signal Construction

Runtime signal creation flows through:

- `packages/teamplay/src/orm/getSignal.ts`
- `packages/teamplay/src/orm/SignalBase.ts`
- `packages/teamplay/src/orm/addModel.ts`

`getSignal($root, segments, options)` chooses the runtime class with `getSignalClass(segments)`. `getSignalClass()` calls `findModel(segments)`, which matches patterns registered by `addModel(pattern, Model)`.

Runtime model pattern rules:

- `users` matches a collection signal.
- `users.*` matches a document signal.
- `users.*.profile` matches a nested document field signal.
- `[id]` in file-based model names is normalized to `*`.
- Matching is length-sensitive and each wildcard matches one segment.

After the class is chosen, the instance is wrapped in a `Proxy`. The proxy is what enables object-tree access:

```ts
$.users[userId].profile.name.get()
```

There is no real `name` property on the base class. The proxy creates child signals on demand.

### Method Lookup

With extremely late bindings enabled, dot access creates a child signal even when the segment name collides with a method. A call like `$user.displayName()` works like this:

1. The proxy `get` trap returns a child signal at `users.<id>.displayName`.
2. The proxy `apply` trap sees the last segment is `displayName`.
3. It looks up `displayName` on the raw parent signal at `users.<id>`.
4. It calls that method with `this` bound to the parent signal.

Aggregation row method binding is more complex: if a row under `$aggregations.<hash>.<index>` has `_id` or `id`, method calls can be routed back to the original source document. This behavior still lives in `extremelyLateBindings.apply()` and needs focused tests before extraction.

### Query Signals

`getQuerySignal(collectionName, params, options)` creates a signal at:

```ts
[collectionName]
```

and marks it with query symbols such as `IS_QUERY`, `COLLECTION_NAME`, and `HASH`.

Query data is stored separately under `$queries.<hash>`. Array readers map query ids back to document signals:

```ts
for (const id of ids) yield getSignal(root, [collectionName, id])
```

Runtime consequences:

- The top-level query signal behaves like the collection model.
- Query items behave like document model signals.
- Query array readers pass document model signals.
- Query top-level array mutators are rejected.
- Query `ids` and `extra` are special metadata properties.

### Aggregation Signals

`getAggregationSignal(collectionName, params, options)` creates a signal at:

```ts
['$aggregations', hash]
```

Aggregation rows can redirect method calls to source documents when the row has `_id` or `id`. TypeScript treats registered collection aggregations as document-row-like by default, while `aggregation<TOutput>()` allows arbitrary explicit output.

### File-Based Models

The Babel plugin and Node loader discover model folders and produce a model manifest shaped like:

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

`initModels(models)` registers every `default` class with `addModel()` and stores the full manifest for backend features.

Shared model-pattern utilities now cover:

- `[id] -> *`
- `index` files mapping to the containing path
- ignored `-` files
- invalid wildcard filenames
- schema/access/aggregation grouping
- collection-pattern checks
- generated `require.context` helper parity

## Type Architecture

### Module Augmentation

`packages/teamplay/src/index.ts` exposes three augmentation interfaces:

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

This static bridge is necessary because TypeScript cannot infer global root paths from runtime calls like `addModel('users.*', User)`.

### Public `Signal<T>`

The exported `Signal<T>` type is intentionally a UX facade, not just the runtime base-class instance:

1. `Signal<any>` returns a loose typed signal.
2. `Signal<T>` returns a registered document signal when `T` maps to exactly one known collection document type.
3. `Signal<T[]>` returns a collection-shaped signal when `T` maps to exactly one known collection document type.
4. Ambiguous duplicate document shapes fall back to the plain typed signal shape.

This preserves the target usage:

```ts
class User extends Signal<UserDoc> {}

function UserCard ({ $user }: { $user: Signal<UserDoc> }) {
  $user.displayName()
}
```

### Core Signal Types

`packages/teamplay/src/orm/types/signal.ts` defines the core signal graph:

- `TypedSignal<TValue, TModel, TPath>`
- `DocumentSignal`
- `CollectionSignal`
- `CollectionQuerySignal`
- `AggregationSignal`
- `SignalForKind`
- `RootSignal`

`TypedSignal` intersects:

- the base signal instance,
- the selected model instance,
- array reader/mutator groups when valid,
- object child signals,
- generated field mixins from `TeamplaySignalFields`.

`PathModel<TValue, TDefaultModel, TPath>` joins runtime-like path tuples with `JoinPath<TPath>` and looks up `TeamplayModels`.

### Collections, Queries, And Aggregations

`CollectionSignal` models:

- collection model methods,
- document indexing by id or number,
- `add(value): Promise<string>`,
- array readers that pass document model signals,
- blocked top-level array mutators.

`CollectionQuerySignal` adds query metadata and preserves collection model methods. It matches runtime query construction at `[collectionName]`.

`AggregationSignal` is array-like. Registered collection aggregations default to document-row-like output; arbitrary output should use explicit output generics.

### Schema Types

`FromJsonSchema<TSchema>` covers the TeamPlay-supported JSON Schema subset:

- simplified object schemas,
- full object schemas with `properties`,
- field-level `required: true`,
- object-level `required: [...]`,
- arrays and tuple arrays,
- primitive JSON Schema types,
- nullable type arrays,
- `enum`,
- `const`.

Unsupported dynamic schema expressions intentionally degrade to safer fallback shapes. The shared schema fixture matrix is the source of truth for what is supported.

### Generated `teamplay-env.d.ts`

The Babel plugin generates:

- `TeamplayCollections`
- `TeamplayModels`
- `TeamplaySignalFields`
- schema-module default-interface augmentation for the `Signal<Game>` UX

The generated file still contains more concrete policy than ideal. Future work should continue moving interpretation into helper types as long as hover readability and field JSDoc quality do not regress.

## Intentional TypeScript Limitations

### Broad Collection Indexing

The object-tree API depends on broad document indexing:

```ts
$.users[userId]
```

That means TypeScript cannot perfectly distinguish every possible document id from every named collection property, query metadata property, or model method. The current decision is:

- keep `$.collection[id]`,
- keep named query metadata like `ids` and `extra` precise,
- cover collisions at runtime,
- document the limitation,
- do not add `$.users.doc(id)` solely for TypeScript convenience.

### Proxy Behavior Cannot Be Fully Inferred

Proxy child access and extremely late method binding must remain manually modeled with mapped types and runtime tests. The type system cannot derive this behavior from the JavaScript proxy implementation.

### Some Runtime/Type Duplication Is Unavoidable

Type-level schema inference, AST-based Babel parsing, runtime schema normalization, generated module augmentation, and proxy runtime behavior are different execution domains. The practical target is shared fixtures, shared naming, and small checked helpers, not one universal implementation.

## Risk Areas

| Area | Current risk | Direction |
| --- | --- | --- |
| `SignalBase.ts` proxy `apply` | High | Add tests for aggregation row method binding, model-method collisions, and Compat fallback before extraction. |
| Generated `teamplay-env.d.ts` policy | Medium | Move interpretation into helper types where editor display stays readable. |
| Query metadata vs document ids | Medium | Keep special properties precise and preserve object-tree access; investigate only type improvements that do not change UX. |
| Remaining `.d.ts` shims | Medium | Narrow declarations or convert non-Compat modules to `.ts` when useful. Avoid investing in Compat conversion because Compat is temporary. |
| Subscription overloads | Medium | Keep shared result helpers authoritative; retain direct overloads where editor display benefits. |
| Schema parity | Medium | Maintain the shared fixture matrix across runtime, type, Babel/JSDoc, and generated-env tests. |

## Verification Strategy

For every typing/runtime alignment change:

- add focused runtime tests for the touched behavior,
- add or update type tests when public TypeScript behavior changes,
- run `npm run test-types` and `npm run test-types:external`,
- run focused server/client tests for the touched path,
- run full `npm test` before commits that affect runtime behavior.

Standard `npm test` now runs:

1. Babel plugin tests,
2. TeamPlay internal type tests,
3. strict external consumer type tests,
4. normal server tests,
5. normal client tests,
6. compat server tests,
7. compat client tests.
