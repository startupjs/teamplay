# TeamPlay Architecture

This document explains how the TeamPlay monorepo works at runtime and how the main packages fit together. Read it before changing runtime behavior, public APIs, package exports, backend integration, subscriptions, or React integration.

For TypeScript-specific details, read [typing-architecture.md](./typing-architecture.md) after this document. Together, these two files should give a fresh human or agent enough context to navigate the repo without prior project knowledge.

## High-Level Model

TeamPlay is a full-stack signal ORM built on top of ShareDB.

The user-facing mental model is:

```ts
import $, { sub } from 'teamplay'

const $user = await sub($.users[userId])
$user.name.set('Ada')
```

At runtime:

- `$` is a root signal.
- `$.users[userId]` is not a predeclared property. It is a proxy-created signal path.
- Public collection/document paths are backed by ShareDB documents and queries.
- Local/private paths are stored in root-scoped private state.
- `sub()` and `useSub()` attach ShareDB documents, queries, or aggregations and return signals with the same object-tree UX.
- Model classes attach methods to signal paths, so document and collection behavior lives beside the schema concepts users already work with.

The most important design constraint is that the object-tree API stays stable:

```ts
$              // root signal
$.users        // collection signal
$.users[id]    // document signal
$.users[id].x  // nested field signal
```

Avoid changes that make users think in terms of low-level ShareDB objects, raw paths, manual query stores, or separate document accessor APIs unless there is an explicit product decision.

## Runtime Shape

The runtime is easiest to understand as six cooperating layers:

```txt
Application code
  |
  | imports teamplay, teamplay/connect, teamplay/server, generated models
  v
Public TeamPlay API
  |
  | $, Signal, sub(), useSub(), observer(), initModels(), createBackend()
  v
Signal ORM runtime
  |
  | proxy signals, model lookup, data tree, private root state, subscriptions
  v
ShareDB connection
  |
  | docs, fetch/subscribe queries, JSON0 ops
  v
Transport and backend
  |
  | websocket channel, ShareDB backend, db, pubsub, hooks
  v
Database and server features
     schema validation, access control, server aggregations
```

The package boundaries mostly follow this layering, but `packages/teamplay` is intentionally the facade that end users import.

## Package Map

| Package | Role | Main files |
| --- | --- | --- |
| `teamplay` | Public runtime package: signals, ORM, React hooks, server/connect facades, model registration, schema/cache re-exports. | [packages/teamplay/src/index.ts](./packages/teamplay/src/index.ts), [packages/teamplay/src/orm](./packages/teamplay/src/orm), [packages/teamplay/src/react](./packages/teamplay/src/react), [packages/teamplay/src/server.js](./packages/teamplay/src/server.js), [packages/teamplay/src/connect/index.js](./packages/teamplay/src/connect/index.js) |
| `babel-plugin-teamplay` | File-based model discovery and code generation for app model folders. Produces model manifests and generated type env files. | [packages/babel-plugin-teamplay](./packages/babel-plugin-teamplay) |
| `@teamplay/backend` | ShareDB backend factory with database, pubsub, hooks, access control, schema validation, and server aggregation integration. | [packages/backend/index.js](./packages/backend/index.js) |
| `@teamplay/channel` | WebSocket/SockJS-compatible client/server channel used by the ShareDB connection. | [packages/channel](./packages/channel) |
| `@teamplay/schema` | JSON Schema helpers and TeamPlay schema wrapping. | [packages/schema](./packages/schema) |
| `@teamplay/server-aggregate` | ShareDB middleware for server-defined aggregation queries. | [packages/server-aggregate](./packages/server-aggregate) |
| `@teamplay/sharedb-access` | ShareDB access-control middleware. | [packages/sharedb-access](./packages/sharedb-access) |
| `@teamplay/sharedb-schema` | ShareDB schema validation middleware. | [packages/sharedb-schema](./packages/sharedb-schema) |
| `@teamplay/utils` | Shared internal utilities, including aggregation and access-control helpers/types. | [packages/utils](./packages/utils) |
| `@teamplay/cache` | Cache helpers used by runtime code. | [packages/cache](./packages/cache) |
| `@teamplay/debug` | Debug helper package. | [packages/debug](./packages/debug) |
| `example` | Example application workspace. | [example](./example) |

Root [package.json](./package.json) defines the workspace layout and the standard test flow. The root `npm test` runs Babel plugin tests first, then the `teamplay` package test suite.

## Public Entry Points

The public `teamplay` package exports multiple surfaces from [packages/teamplay/package.json](./packages/teamplay/package.json):

- `teamplay`: main public API, including `$`, `Signal`, `sub`, React hooks, model helpers, schema helpers, aggregation/access-control helpers, and compatibility exports.
- `teamplay/orm`: lower-level ORM exports for runtime internals and advanced usage.
- `teamplay/connect`: browser/client connection setup.
- `teamplay/server`: server-side backend and channel setup.
- `teamplay/file-based-models`: generated model loading support.
- `teamplay/babel` and `teamplay/babel/loader`: build-time model transforms.
- `teamplay/connect-test` and `teamplay/connect-offline`: test/offline connection variants.
- `teamplay/cache` and `teamplay/schema`: convenience re-exports.

The main public entry is [packages/teamplay/src/index.ts](./packages/teamplay/src/index.ts). It creates the global root signal:

```ts
export const $ = getRootSignal({
  rootId: GLOBAL_ROOT_ID,
  rootFunction: universal$
})
```

It also deliberately separates the public `Signal<T>` type facade from the runtime `Signal` constructor:

```ts
export type Signal<TValue = unknown> = PublicSignal<TValue>
export const Signal = RuntimeSignal
```

That separation is covered in [typing-architecture.md](./typing-architecture.md). Runtime readers should still know it exists because changing runtime exports can affect public type UX.

Plugin declaration sidecars use the same separation: they may declare public `Signal<T>`-based model classes for typing while runtime model registration still goes through real constructors and `addModel()`.

## Application Startup

### Server Startup

Typical server setup flows through `teamplay/server`:

```ts
import models from 'teamplay/file-based-models'
import { createBackend, initConnection } from 'teamplay/server'
import { initModels } from 'teamplay'

initModels(models)
const backend = createBackend({ secure: true })
const channel = initConnection(backend)
```

Important files:

- [packages/teamplay/src/server.js](./packages/teamplay/src/server.js)
- [packages/backend/index.js](./packages/backend/index.js)
- [packages/teamplay/src/orm/initModels.ts](./packages/teamplay/src/orm/initModels.ts)

`teamplay/server` wraps `@teamplay/backend`. If `initModels()` has already registered models and `createBackend()` is called without an explicit `models` option, the wrapper passes the initialized model manifest into the backend.

`initConnection(backend, options)` creates a server-side ShareDB connection through `backend.connect()`, stores it in the ORM singleton connection, sets default transport flags, applies runtime-wide ORM options such as `idFields`, and returns the server channel.

The backend factory creates a ShareDB backend with:

- database adapter from `packages/backend/db`,
- pubsub from `packages/backend/redis`,
- `sharedb-hooks`,
- optional custom hooks,
- access control,
- server aggregation,
- schema validation outside production,
- connection logging and client lifecycle tracking.

### Client Startup

Typical browser/client setup flows through `teamplay/connect`:

```ts
import connect from 'teamplay/connect'

connect({ base: '/channel' })
```

Important files:

- [packages/teamplay/src/connect/index.js](./packages/teamplay/src/connect/index.js)
- [packages/teamplay/src/connect/sharedbConnection.cjs](./packages/teamplay/src/connect/sharedbConnection.cjs)
- [packages/channel](./packages/channel)
- [packages/teamplay/src/orm/connection.ts](./packages/teamplay/src/orm/connection.ts)

`connect()` creates a channel socket, wraps it in a ShareDB-compatible connection adapter, and stores it in the ORM singleton connection. If a connection already exists, it returns without replacing it.

Document identity fields are runtime-wide, matching the singleton connection constraint. Effective id fields resolve as `Model.ID_FIELDS`, then configured runtime `idFields`, then the default `['_id']`.

The singleton connection is a current architectural constraint. [packages/teamplay/src/orm/Root.ts](./packages/teamplay/src/orm/Root.ts) has TODOs for spawnable/per-root connections, but the current implementation assumes one active connection per runtime environment.

## Models And Manifests

TeamPlay supports file-based models. A model folder is transformed into a manifest where path patterns map to classes and metadata:

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

The Babel plugin and loader own discovery/generation. Runtime registration flows through [packages/teamplay/src/orm/initModels.ts](./packages/teamplay/src/orm/initModels.ts):

- `initModels(models)` stores the manifest and registers every `default` class.
- `defineModels(models)` is a typed identity helper for explicit manifests.
- `getModels()` returns the current manifest for server features.
- `resetModelsForTests()` clears global model registration.

Signal class lookup is handled by [packages/teamplay/src/orm/addModel.ts](./packages/teamplay/src/orm/addModel.ts) and [packages/teamplay/src/orm/getSignal.ts](./packages/teamplay/src/orm/getSignal.ts). Patterns are path-based:

- `users` matches the collection signal.
- `users.*` matches document signals.
- `users.*.profile` matches nested field signals.
- `[id]` file segments are normalized to `*` by the model tooling.

The model manifest is also important for backend features:

- schemas feed validation,
- access rules feed access-control middleware,
- aggregation definitions feed server aggregation middleware,
- generated declarations feed editor and TypeScript UX.

Private root collections such as `_session` are a special manifest case. A schema at `models/_session/schema.ts` describes the whole private value, not documents inside a public collection. The generator uses that schema for `TeamplayPrivateCollections` and field metadata, while backend schema validation skips it because private roots are client-local and do not flow through ShareDB as shared collections.

## Signal Runtime

Signals are proxy-wrapped instances. Most user code never sees raw signal instances.

Main files:

- [packages/teamplay/src/orm/getSignal.ts](./packages/teamplay/src/orm/getSignal.ts)
- [packages/teamplay/src/orm/SignalBase.ts](./packages/teamplay/src/orm/SignalBase.ts)
- [packages/teamplay/src/orm/Signal.ts](./packages/teamplay/src/orm/Signal.ts)
- [packages/teamplay/src/orm/Root.ts](./packages/teamplay/src/orm/Root.ts)
- [packages/teamplay/src/orm/rootContext.ts](./packages/teamplay/src/orm/rootContext.ts)

`getSignal(root, segments, options)` is the signal factory. It:

- requires a root id for root signals,
- chooses a signal class with `getSignalClass(segments)`,
- creates a raw signal instance,
- wraps it in a `Proxy`,
- stores root ownership metadata,
- caches proxies by signal identity hash,
- keeps parent dependencies alive for child signals that need them.

The proxy is what makes this possible:

```ts
$.users[userId].profile.name
```

Every path segment creates another signal. No concrete `users`, `profile`, or `name` property has to exist on the base object.

### Method Binding

TeamPlay currently uses "extremely late bindings" in [packages/teamplay/src/orm/SignalBase.ts](./packages/teamplay/src/orm/SignalBase.ts). A property access always prefers creating a child signal. If that child signal is called like a function, the proxy `apply` trap can route the call back to a method on the parent signal model.

This allows field names and method names to collide without losing object-tree access:

```ts
$user.displayName       // child signal
$user.displayName()     // parent model method call
```

Aggregation rows have additional fallback behavior: when an aggregation row contains `_id` or `id`, model method calls can be routed back to the source document signal.

This boundary is intentionally treated as high risk. Add focused behavior tests before changing proxy `apply` logic.

## Storage Model

TeamPlay has two runtime storage domains.

### Public Data Tree

The public data tree lives in [packages/teamplay/src/orm/dataTree.js](./packages/teamplay/src/orm/dataTree.js):

- `dataTreeRaw` is the raw shared object tree.
- `dataTree` is the observable wrapper.
- public ShareDB docs are mirrored into this tree.

Document signals read from this tree once docs are fetched/subscribed. Writes to public document paths flow back to ShareDB through `setPublicDoc()` / related helpers. Those helpers:

- validate public document paths,
- normalize id fields,
- prevent accidental partial creation of missing docs,
- clone and strip full-document identity fields where needed,
- submit JSON0 diffs through ShareDB,
- preserve local observable state in sync with ShareDB events.

Public document ids are strings. Numeric segments are array indices, not document ids.

### Root-Scoped Private Data

Private/local data is root-owned and lives in [packages/teamplay/src/orm/rootContext.ts](./packages/teamplay/src/orm/rootContext.ts) plus [packages/teamplay/src/orm/privateData.js](./packages/teamplay/src/orm/privateData.js).

Private storage is used for:

- local/session/page state,
- root aliases such as `$.session` for `$._session`,
- query materialization under `$queries`,
- aggregation materialization under `$aggregations`,
- root-owned runtime bookkeeping.

Each root context tracks:

- root id and fetch-only default,
- private observable data and raw private data,
- model listeners,
- refs,
- query and aggregation runtime hashes,
- signal hashes,
- direct document subscription counts.

This is why root identity matters. A query result under one root should not leak into another root's private state, even when the public collection data is shared.

`getLogicalRootSnapshot(rootId)` merges public data with root-private data for tools that need a root-shaped snapshot.

## Subscriptions

`sub()` is the plain JS subscription entry point. React's `useSub()` builds on the same runtime concepts.

Main files:

- [packages/teamplay/src/orm/sub.ts](./packages/teamplay/src/orm/sub.ts)
- [packages/teamplay/src/orm/Doc.js](./packages/teamplay/src/orm/Doc.js)
- [packages/teamplay/src/orm/Query.js](./packages/teamplay/src/orm/Query.js)
- [packages/teamplay/src/orm/Aggregation.js](./packages/teamplay/src/orm/Aggregation.js)
- [packages/teamplay/src/react/useSub.ts](./packages/teamplay/src/react/useSub.ts)

### Document Subscription Flow

```txt
sub($.users[id])
  -> detect public document signal
  -> docSubscriptions.subscribe($doc)
  -> ShareDB doc.fetch() or doc.subscribe()
  -> Doc mirrors doc.data into dataTree
  -> resolve with the same $doc signal
```

[packages/teamplay/src/orm/Doc.js](./packages/teamplay/src/orm/Doc.js) manages the ShareDB doc lifecycle. It tracks subscription/fetch mode, mirrors load/create/delete/op events into observable state, injects id fields into plain objects, and delays cleanup so short-lived UI ownership changes do not churn transport state.

### Query Subscription Flow

```txt
sub($.users, params)
  -> detect public collection signal
  -> getQuerySignal(collectionName, params)
  -> querySubscriptions.subscribe($query)
  -> ShareDB createFetchQuery/createSubscribeQuery
  -> query docs materialize into public dataTree
  -> query ids/docs/extra materialize under root private $queries.<hash>
  -> resolve with query signal
```

[packages/teamplay/src/orm/Query.js](./packages/teamplay/src/orm/Query.js) owns query lifecycle. The query signal itself is path-shaped like the collection, but its data is read through private query materialization:

```txt
$queries.<hash>.docs
$queries.<hash>.ids
$queries.<hash>.extra
```

Array readers on query signals map query ids back to document signals. This keeps query items behaving like document model signals instead of anonymous plain objects.

#### Subscribe vs fetch transport, and read-after-write

A query's transport mode is chosen per owning root by `getRootTransportMode`: a fetchOnly root uses `createFetchQuery`, otherwise `createSubscribeQuery`. The two behave fundamentally differently:

- A **subscribe** query is a live transport: it stays open and its membership is maintained incrementally by server-pushed `insert`/`remove`/`move` diffs. Because membership is server-authoritative and arrives over a separate pubsub round-trip, a live subscribe query momentarily *lags* an awaited write (the write resolves on its op-ack; the query diff lands later). So `await write` followed by an immediate read of a subscribe query can miss the write.
- A **fetch** query is a one-shot point-in-time read: ShareDB self-destroys it (`_handleFetch` → `_destroyQuery`) once results arrive. Accordingly `sub()` in fetch mode never dedups to a cached snapshot — every `sub()` re-pulls (`Query._refetch`, replacing `$queries.<hash>` in place so reactive readers never see an empty window). This is what gives a fetchOnly root **read-after-write**: an awaited write is reflected by the next `sub()`. `initConnection({ fetchOnly })` is the server default, and it propagates the choice to the auto-created global root (which froze the pre-init default at import time).

The reconcile loop (`QuerySubscriptions.reconcileTransport`/`reconcileTransportNow`) serializes these transitions per transport hash and re-runs if a sub/unsub/refetch lands mid-transition. Aggregations reuse this machinery but override `_swapRefetchedDocs` (their rows are projected `extra`, not subscribed docs).

### Aggregation Subscription Flow

Aggregations reuse the query transport layer but materialize data under `$aggregations`:

```txt
sub(aggregationHeader, params)
  -> normalize aggregation params
  -> getAggregationSignal(collectionName, params)
  -> aggregationSubscriptions.subscribe($aggregation)
  -> ShareDB aggregation query
  -> aggregation extra materializes under root private $aggregations.<hash>
  -> resolve with aggregation signal
```

[packages/teamplay/src/orm/Aggregation.js](./packages/teamplay/src/orm/Aggregation.js) extends query behavior. Aggregation output comes from query `extra`, not from normal query `results`. If aggregation rows include `_id` or `id`, the runtime can inject configured id fields and route model method calls back to source documents.

## Writes And Mutations

Signal write methods are defined on the runtime signal base and delegated into smaller helper modules.

Important files:

- [packages/teamplay/src/orm/SignalBase.ts](./packages/teamplay/src/orm/SignalBase.ts)
- [packages/teamplay/src/orm/signalReads.ts](./packages/teamplay/src/orm/signalReads.ts)
- [packages/teamplay/src/orm/signalValueMutations.ts](./packages/teamplay/src/orm/signalValueMutations.ts)
- [packages/teamplay/src/orm/signalStorageMutations.ts](./packages/teamplay/src/orm/signalStorageMutations.ts)
- [packages/teamplay/src/orm/signalMutationGuards.ts](./packages/teamplay/src/orm/signalMutationGuards.ts)
- [packages/teamplay/src/orm/dataTree.js](./packages/teamplay/src/orm/dataTree.js)
- [packages/teamplay/src/orm/privateData.js](./packages/teamplay/src/orm/privateData.js)

The mutation layer decides whether a signal path is:

- a public document path,
- a private/local path,
- a generated query or aggregation path,
- an id-field path,
- a path that should be rejected.

The UX goal is that users call normal signal methods:

```ts
$user.name.set('Ada')
$draft.tags.push('typescript')
$counter.increment(1)
```

The runtime should route the operation correctly and produce clear errors when a path cannot be mutated, such as top-level query arrays or aggregation rows.

## React Integration

React integration lives in [packages/teamplay/src/react](./packages/teamplay/src/react). The main public exports are:

- `observer()`
- `useSub()`
- `useAsyncSub()`
- `useSuspendMemo()`
- local/session/page/document/query hooks, including compatibility hooks.

`$` and `sub()` are intentionally universal: the root export in [packages/teamplay/src/index.ts](./packages/teamplay/src/index.ts) uses `universal$` so the same public API works in plain JS and React environments.

React subscriptions must preserve the same runtime signal shapes as `sub()`:

- document subscriptions return document signals,
- collection queries return query signals that are assignable to collection array signals,
- aggregations return aggregation signals,
- query `ids` and `extra` remain explicit metadata signals.

When changing React behavior, check both runtime correctness and end-user ergonomics: suspense timing, stable signal identity, cleanup, and editor-visible result types.

## Backend Features

The backend layer starts in [packages/backend/index.js](./packages/backend/index.js). It composes ShareDB with TeamPlay-specific server features.

### Access Control

Access control is initialized by `@teamplay/backend` through `features/accessControl`. It uses model manifests and the `@teamplay/sharedb-access` package to control create, read, update, and delete operations.

Access rules should be treated as server authority. Client typing and generated declarations can make access functions pleasant to write, but runtime security must live on the backend.

There are two backend modes:

- Global access control (`createBackend({ accessControl: true })`) checks every collection and denies collections without rules by default.
- Selective access control initializes the same middleware with `openByDefault` when global access control is off but at least one collection is explicitly protected. This is used for `serverOnlyCollections` and access rules declared with `accessControl(rules, { force: true })`.

`serverOnlyCollections` are protected by calling `backend.protectAccessCollection(collectionName)`. They deny client read/create/update/delete even when the rest of the app is open. Forced access rules are registered in the same selective mode so framework/plugin-owned sensitive collections can be protected without requiring app-wide access control.

### Schema Validation

Schema validation is initialized by `@teamplay/backend` through `features/validateSchema` when enabled and outside production. It uses model schemas plus the `@teamplay/sharedb-schema` package.

Schema definitions also feed type generation. Keep runtime schema behavior and generated type behavior aligned when changing schema helpers.

Schema validation only applies to public top-level collections. Private root schemas are intentionally skipped at the backend validation layer because they describe client-local root state for typing/editor UX, not ShareDB documents.

### Server Aggregations

Server aggregation is initialized by `@teamplay/backend` through `features/serverAggregate`. It uses model aggregation definitions and the `@teamplay/server-aggregate` package to allow only server-defined aggregate queries.

Client-side aggregation helpers ultimately produce query params that the server aggregation middleware understands.

## File-Based Model Tooling

The model tooling package is [packages/babel-plugin-teamplay](./packages/babel-plugin-teamplay). It owns build-time behavior such as:

- discovering model files,
- converting file paths into model patterns,
- ignoring private `-` files,
- grouping schema/access/aggregation files,
- recognizing private root schemas separately from public collection schemas,
- generating model manifests,
- generating `teamplay-env.d.ts`,
- importing plugin declaration sidecars,
- emitting static framework feature and plugin-option types,
- supporting loader/plugin variants.

Changes here often affect both runtime and typing:

- Runtime: model manifests passed to `initModels()` and `createBackend()`.
- Typing: generated module augmentation for public collections, private root collections, models, fields, schemas, plugin declaration imports, static feature flags, plugin options, access rules, and aggregations.

Run Babel plugin tests and TeamPlay type tests for changes in this area.

## Compatibility Layer

Compatibility code lives under [packages/teamplay/src/orm/Compat](./packages/teamplay/src/orm/Compat) and related compat entry points.

Compat exists to preserve old Racer/StartupJS-style behavior while TeamPlay moves toward the current object-tree signal API. It is temporary and should not be a target for broad TypeScript conversion or large new abstractions.

The practical rule:

- preserve compat behavior when shared runtime changes touch it,
- add compat tests when shared behavior can regress,
- avoid investing in compat-only rewrites unless required to unblock current behavior.

## Testing Architecture

Standard verification starts from root [package.json](./package.json):

```sh
npm test
```

That runs:

```txt
yarn workspace babel-plugin-teamplay test
cd packages/teamplay && npm run test
```

The `teamplay` package test script runs:

- `npm run test-types`
- `npm run test-types:external`
- `npm run test-server`
- `npm run test-client`
- `npm run test-compat`

Compat tests are part of the standard `teamplay` package test flow and therefore part of the root `npm test` flow.

Focused commands:

```sh
cd packages/teamplay && npm run test-types
cd packages/teamplay && npm run test-types:external
cd packages/teamplay && npm run test-server
cd packages/teamplay && npm run test-client
cd packages/teamplay && npm run test-compat
yarn workspace babel-plugin-teamplay test
```

Client tests live in [packages/teamplay/test_client](./packages/teamplay/test_client). Numeric filenames define coarse execution order and [packages/teamplay/test_client/testSequencer.cjs](./packages/teamplay/test_client/testSequencer.cjs) preserves path order without maintaining an explicit file list.

Server/runtime tests live in [packages/teamplay/test](./packages/teamplay/test). Type tests live in [packages/teamplay/test_types](./packages/teamplay/test_types) and the strict external consumer setup.

The pre-commit hook runs lint-staged and root `npm test`, so changes should pass the same broad suite before commit.

## Common Change Paths

Use these entry points when deciding where a change belongs.

| Change | Start here | Also check |
| --- | --- | --- |
| Public API export | [packages/teamplay/src/index.ts](./packages/teamplay/src/index.ts), [packages/teamplay/package.json](./packages/teamplay/package.json) | Type tests, external consumer tests |
| Signal property access or method binding | [packages/teamplay/src/orm/SignalBase.ts](./packages/teamplay/src/orm/SignalBase.ts), [packages/teamplay/src/orm/getSignal.ts](./packages/teamplay/src/orm/getSignal.ts) | Proxy/apply tests, compat tests if shared |
| Signal read behavior | [packages/teamplay/src/orm/signalReads.ts](./packages/teamplay/src/orm/signalReads.ts), [packages/teamplay/src/orm/signalArrayReaders.ts](./packages/teamplay/src/orm/signalArrayReaders.ts) | Query/aggregation/doc read tests |
| Signal write behavior | [packages/teamplay/src/orm/signalValueMutations.ts](./packages/teamplay/src/orm/signalValueMutations.ts), [packages/teamplay/src/orm/signalStorageMutations.ts](./packages/teamplay/src/orm/signalStorageMutations.ts), [packages/teamplay/src/orm/dataTree.js](./packages/teamplay/src/orm/dataTree.js) | Public/private mutation tests |
| Document subscription lifecycle | [packages/teamplay/src/orm/Doc.js](./packages/teamplay/src/orm/Doc.js) | Server tests, GC/cleanup tests |
| Query lifecycle or metadata | [packages/teamplay/src/orm/Query.js](./packages/teamplay/src/orm/Query.js), [packages/teamplay/src/orm/sub.ts](./packages/teamplay/src/orm/sub.ts) | Query metadata type/runtime tests |
| Aggregation behavior | [packages/teamplay/src/orm/Aggregation.js](./packages/teamplay/src/orm/Aggregation.js), backend server aggregation features | Aggregation row method tests |
| Root ownership or private data | [packages/teamplay/src/orm/Root.ts](./packages/teamplay/src/orm/Root.ts), [packages/teamplay/src/orm/rootContext.ts](./packages/teamplay/src/orm/rootContext.ts), [packages/teamplay/src/orm/privateData.js](./packages/teamplay/src/orm/privateData.js) | Root cleanup and isolation tests |
| Model discovery/generation | [packages/babel-plugin-teamplay](./packages/babel-plugin-teamplay) | Babel tests, generated-env snapshots, type tests |
| Backend access/schema/aggregation | [packages/backend](./packages/backend), [packages/sharedb-access](./packages/sharedb-access), [packages/sharedb-schema](./packages/sharedb-schema), [packages/server-aggregate](./packages/server-aggregate) | Server tests and model manifest tests |
| React subscription UX | [packages/teamplay/src/react](./packages/teamplay/src/react) | Client tests, suspense/cleanup tests, type tests |

## Design Principles

When changing this codebase:

- Preserve the `$` object-tree UX unless a product decision says otherwise.
- Keep public APIs stable and make runtime errors clear.
- Put runtime facts in checked runtime helpers when practical.
- Keep generated typing code mechanical and covered by snapshots/type tests.
- Avoid broad rewrites of high-risk proxy behavior without focused tests first.
- Treat root ownership as part of correctness; query/private state should not leak across roots.
- Treat backend access control and schema validation as server-authoritative, not client hints.
- Avoid large investments in Compat implementation files; keep them working until the compatibility layer is removed.
- Update [architecture.md](./architecture.md), [typing-architecture.md](./typing-architecture.md), and [tasks.md](./tasks.md) when architectural direction changes.
