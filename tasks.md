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
