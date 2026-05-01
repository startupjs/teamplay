# TeamPlay Typing Architecture Tasks

This checklist executes the plan from [typing-architecture.md](./typing-architecture.md). Keep public runtime APIs stable. Internal APIs and generated type shapes can change when it improves maintainability.

## Rules While Executing

- Keep changes small and verify frequently.
- Prefer moving type facts closer to runtime code over adding detached facade types.
- Preserve the current public runtime API unless there is an explicit product decision to change it.
- Generated `teamplay-env.d.ts` shape is internal and can be refactored.
- Update this file as tasks move from pending to done.

## Phase 1: Lock Current Semantics

- [x] Add an internal note to type tests that public `Signal<T>` is a registry-based facade.
- [x] Add type coverage for ambiguous duplicate document shapes falling back to plain signal shape.
- [x] Add type coverage for current aggregation assumptions and arbitrary aggregation output.
- [x] Add type coverage for query collection-model methods on `sub()` and `useSub()` if gaps remain.
- [x] Run `npm run test-types` from `packages/teamplay`.

## Phase 2: Type-Check Small Runtime-Facing Modules

- [x] Remove `@ts-nocheck` from `packages/utils/aggregation.ts`.
- [x] Remove `@ts-nocheck` from `packages/teamplay/orm/addModel.ts`.
- [x] Remove `@ts-nocheck` from `packages/teamplay/orm/initModels.ts`.
- [x] Check whether `packages/teamplay/orm/Signal.ts` can stay checked as-is.
- [x] Run `npm run test-types` from `packages/teamplay`.

## Phase 3: Shared Subscription Result Types

- [x] Introduce shared `SubResult` / `MaybePromiseSubResult` helper types.
- [x] Refactor `sub()` overloads to use shared helper types where editor UX stays acceptable.
- [x] Refactor `useSub()` and `useAsyncSub()` to reuse the same helper types.
- [x] Run `npm run test-types` from `packages/teamplay`.
- [x] Run focused server/client subscription tests if runtime code changes. Skipped because this phase only changed type declarations.

## Phase 4: Model Manifest Helpers

- [x] Add `ModelEntry` and `ModelManifest` types.
- [x] Add `defineModels()` as a typed no-op helper for manual and generated model objects.
- [x] Add `CollectionsFromManifest<T>` and `PathModelsFromManifest<T>` helper types.
- [x] Update generated `teamplay-env.d.ts` to delegate more interpretation to TeamPlay helper types.
- [x] Update Babel plugin snapshots.
- [x] Run `yarn workspace babel-plugin-teamplay test`.
- [x] Run `npm run test-types` from `packages/teamplay`.

## Phase 5: Central Signal Kind Types

- [x] Introduce a central `SignalKind` / `SignalForKind` type core.
- [x] Rebuild `DocumentSignal`, `CollectionSignal`, `CollectionQuerySignal`, and `AggregationSignal` from it.
- [x] Split array reader methods from array mutator methods.
- [x] Stop exposing runtime-invalid top-level collection/query array mutators.
- [x] Run `npm run test-types` from `packages/teamplay`.
- [x] Run focused runtime tests for collection/query mutator behavior.

## Phase 6: Schema Introspection

- [x] Extract shared runtime schema introspection helpers.
- [x] Use shared helpers in runtime schema transform where practical.
- [x] Use shared helpers in Babel field JSDoc extraction.
- [x] Add paired runtime/type schema fixtures.
- [x] Run `yarn workspace babel-plugin-teamplay test`.
- [x] Run `npm run test-types` from `packages/teamplay`.

## Phase 7: Documentation And Cleanup

- [x] Update [typing-architecture.md](./typing-architecture.md) after each architectural decision.
- [x] Update user-facing docs when public typing behavior changes.
- [x] Remove stale helper types once newer shared helpers replace them.
- [x] Run full TeamPlay test suite before committing major slices.

## Next Iteration Priorities

The first pass moved the largest type facts closer to TeamPlay-owned modules, but several public surfaces are still unchecked or still depend on detached facade logic. The next pass should focus on runtime files that already contain public type declarations and on public APIs that can reduce proxy/index-signature ambiguity.

## Phase 8: Type-Check Public Entry And Subscription Runtime

- [ ] Split public `Signal<T>` facade helpers out of `packages/teamplay/index.ts` into checked type modules.
- [ ] Remove `@ts-nocheck` from `packages/teamplay/index.ts`, or reduce it to the smallest unavoidable runtime section.
- [ ] Remove `@ts-nocheck` from `packages/teamplay/orm/sub.ts`.
- [ ] Remove `@ts-nocheck` from `packages/teamplay/react/useSub.ts`.
- [ ] Keep direct overloads only where they materially improve VS Code display quality.
- [ ] Run `npm run lint`.
- [ ] Run `npm run test-types` from `packages/teamplay`.
- [ ] Run focused subscription tests and the full suite before committing.

## Phase 9: Signal Runtime Descriptors

- [ ] Add an internal `SignalRuntimeKind` / descriptor helper for document, collection, query, aggregation, local array, and nested value signals.
- [ ] Use the descriptor in query and aggregation constructors/tests to make runtime signal kind decisions explicit.
- [ ] Align `SignalKind` / `SignalForKind` with the descriptor names.
- [ ] Add tests for descriptor output on root, collection, document, query, aggregation, and nested array paths.
- [ ] Run focused server tests around query, aggregation, and array mutators.

## Phase 10: Base Signal Method Contracts

- [ ] Extract checked base method interfaces for value methods, array readers, array mutators, string mutators, collection methods, and metadata methods.
- [ ] Use those interfaces in `types/signal.ts` instead of manually naming method groups with string unions where possible.
- [ ] Start removing `@ts-nocheck` from `packages/teamplay/orm/SignalBase.ts` in narrow slices.
- [ ] Add type assertions that nested array fields keep mutators while top-level collection/query/aggregation signals block them.
- [ ] Run `npm run test-types` and focused mutator runtime tests.

## Phase 11: Aggregation Typing Redesign

- [x] Keep collection aggregations document-row-like by default, matching the common case where aggregation output behaves like query output.
- [x] Add an explicit arbitrary-output type path for aggregations, preferably supporting `aggregation<TOutput>(...)` where `TOutput` is the full signal value.
- [x] Ensure aggregation subscription signals use the explicit output directly as `Signal<TOutput>`, so object metadata and custom row arrays are both expressible.
- [x] Change the public type-level generic order so the first generic on `aggregation<...>()` is output shape, not collection name.
- [x] Document the type-level migration from `aggregation<'games'>` to output-first forms such as `aggregation<Game[]>()`.
- [x] Add type tests for document-output aggregations, grouped row aggregations, and unregistered server aggregations.
- [x] Update ORM and TypeScript docs after implementation.

## Phase 12: Preserve Object-Tree Document Access UX

- [x] Do not add `$.users.doc(id)` / `$.users.$doc(id)` unless there is a separate product decision. It weakens the "one big object tree" mental model.
- [x] Keep `$.users[id]` as the conventional document access API.
- [ ] Improve type precision around broad string index access internally where possible without changing the public object-tree UX.
- [ ] Add regression tests for collisions between dynamic document ids and special collection properties like `ids`, `extra`, and model methods.

## Phase 13: Schema Definition And Type Fixtures

- [x] Add `defineSchema()` as the conventional schema authoring helper if it can materially reduce explicit `FromJsonSchema` usage.
- [x] Keep `defineSchema()` optional for backward compatibility; plain exported schema objects must continue to work.
- [x] Implement `defineSchema()` initially as an identity helper with a lightweight runtime marker, so `initModels()` can warn on unwrapped schemas without changing schema behavior.
- [x] Make the unwrapped-schema warning development-only and de-duplicated per collection/model pattern.
- [x] Validate the default value + default interface convention: `export default schema` plus `export default interface Game extends FromJsonSchema<typeof schema> {}`.
- [x] Generate schema-module default interfaces in `teamplay-env.d.ts` through module augmentation, without modifying schema source files.
- [x] Emit a relative schema module specifier by default, computed from `teamplay-env.d.ts` to the schema source file.
- [x] Verify the generated relative augmentation applies to alias imports, nested relative imports, and imports with explicit `.ts` extensions.
- [x] Use existing `root` / `typesFile` config for nonstandard source roots and monorepos where the computed relative specifier needs a different base.
- [x] Keep `Signal<Game>` / `extends Signal<Game>` as the target UX for document typing.
- [x] Ensure `defineSchema()` preserves literal types while leaving runtime schema normalization unchanged.
- [ ] Add paired runtime/type fixtures for full object schema, shorthand schema, keyword-named fields, nested objects, arrays, tuples, nullable values, `enum`, `const`, and unsupported dynamic schemas.
- [ ] Consider moving type tests into smaller fixture files once the single executable spec becomes too large to maintain.
