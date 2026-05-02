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

## Round 2 Priorities (Complete)

The first pass moved the largest type facts closer to TeamPlay-owned modules. Round 2 checked the most visible public surfaces, added runtime descriptors, tightened collection/query/aggregation method shapes, and improved schema authoring UX.

## Phase 8: Type-Check Public Entry And Subscription Runtime

- [x] Split public `Signal<T>` facade helpers out of `packages/teamplay/index.ts` into checked type modules.
- [x] Remove `@ts-nocheck` from `packages/teamplay/index.ts`, or reduce it to the smallest unavoidable runtime section.
- [x] Remove `@ts-nocheck` from `packages/teamplay/orm/sub.ts`.
- [x] Remove `@ts-nocheck` from `packages/teamplay/react/useSub.ts`.
- [x] Keep direct overloads only where they materially improve VS Code display quality.
- [x] Run `npm run lint`.
- [x] Run `npm run test-types` from `packages/teamplay`.
- [x] Run focused subscription tests and the full suite before committing.

## Phase 9: Signal Runtime Descriptors

- [x] Add an internal `SignalRuntimeKind` / descriptor helper for document, collection, query, aggregation, local array, and nested value signals.
- [x] Use the descriptor in query and aggregation constructors/tests to make runtime signal kind decisions explicit.
- [x] Align `SignalKind` / `SignalForKind` with the descriptor names.
- [x] Add tests for descriptor output on root, collection, document, query, aggregation, and nested array paths.
- [x] Run focused server tests around query, aggregation, and array mutators.

## Phase 10: Base Signal Method Contracts

- [x] Extract checked base method interfaces for value methods, array readers, array mutators, string mutators, collection methods, and metadata methods.
- [x] Use those interfaces in `types/signal.ts` instead of manually naming method groups with string unions where possible.
- [x] Start removing `@ts-nocheck` from `packages/teamplay/orm/SignalBase.ts` in narrow slices.
- [x] Add type assertions that nested array fields keep mutators while top-level collection/query/aggregation signals block them.
- [x] Run `npm run test-types` and focused mutator runtime tests.

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
- [x] Improve type precision around broad string index access internally where possible without changing the public object-tree UX.
- [x] Add regression tests for collisions between dynamic document ids and special collection properties like `ids`, `extra`, and model methods.

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
- [x] Add paired runtime/type fixtures for full object schema, shorthand schema, keyword-named fields, nested objects, arrays, tuples, nullable values, `enum`, `const`, and unsupported dynamic schemas.
- [x] Consider moving type tests into smaller fixture files once the single executable spec becomes too large to maintain.

## Next Iteration Priorities

Round 3 should be a consolidation pass. The typing UX is now much closer to the desired public model, so the next work should make that model easier to maintain: narrow temporary declarations, clarify the runtime/public `Signal` boundary, make path and descriptor rules more shared, and strengthen edge-case tests around query metadata and schema generation.

## Phase 14: Tighten Internal JavaScript Declarations

- [x] Inventory adjacent `.d.ts` shims under `packages/teamplay/orm`, `packages/teamplay/react`, and `packages/schema`.
- [x] Replace broad `any` declarations in `Doc.d.ts`, `Query.d.ts`, and `Aggregation.d.ts` with the narrowest exported contracts that match the JavaScript modules.
- [x] Replace broad React helper declarations with contracts for the public helper behavior they actually expose.
- [x] Keep intentionally dynamic internals typed as `unknown` or small structural interfaces instead of pretending full precision.
- [x] Add an external TypeScript consumer fixture that imports `teamplay` without `allowJs` and validates the public package surface.
- [x] Run `npm run test-types` from `packages/teamplay`.
- [x] Run the external consumer fixture after each declaration slice.

## Phase 15: Separate Runtime Signal Contracts From The Public Facade

- [x] Introduce explicit internal names for the runtime instance and constructor contracts, such as `RuntimeSignalInstance`, `SignalBaseInstance`, and `SignalModelConstructor`.
- [x] Keep the public `Signal<T>` facade focused on end-user value typing, model props, and `extends Signal<T>` UX.
- [x] Update model class constraints to use constructor/runtime contracts where appropriate instead of relying on the public facade everywhere.
- [x] Add type tests for `class Model extends Signal<Doc>`, function props typed as `Signal<Doc>`, and local `$()` values that should not become collection-like.
- [ ] Confirm VS Code display quality for common `Signal<T>`, `Signal<T[]>`, `sub()`, and `useSub()` examples before continuing deeper.

## Phase 16: Continue Checked Slices Around `SignalBase.ts`

- [x] Move descriptor/path/method guard helpers out of `SignalBase.ts` into checked modules where that can be done without changing runtime behavior.
- [x] Type the array-target and value-target guard helpers that back mutator dispatch.
- [x] Type metadata helpers and symbol-keyed state access through small internal interfaces.
- [x] Convert one narrow `SignalBase.ts` method group at a time, starting with the least proxy-heavy methods.
- [x] Add focused runtime tests for any touched array, query, aggregation, and metadata behavior.
- [x] Run `npm run lint`, `npm run test-types` from `packages/teamplay`, and focused runtime tests after each slice.

## Phase 17: Query Metadata And Broad Index UX

- [x] Model `$query.extra` explicitly without weakening query-as-`Signal<T[]>` assignability.
- [x] Keep `$query.ids` precise and covered by both type and runtime tests.
- [x] Add collision tests for document ids named `ids`, `extra`, and collection/model method names.
- [ ] Investigate whether special-property typing can be improved while preserving `$.users[id]` as the conventional document-access API.
- [x] Document any TypeScript limitation that remains intentionally unsolved.

## Phase 18: Shared Path, Pattern, And Alias Rules

- [x] Create or extend a shared path/model-pattern utility for `[id] -> *`, `index`, ignored `-` files, invalid wildcard filenames, and path tuple to pattern string.
- [x] Centralize root alias behavior such as `$session -> _session`.
- [x] Use the shared utilities from runtime loading, Babel generation, and tests where practical.
- [x] Keep type-level path joining in conditional types, but align names and fixture cases with the runtime utilities.
- [x] Add fixtures for nested models, ignored files, aliases, invalid names, and nonstandard `root` / `typesFile` layouts.

## Phase 19: Schema Parity Matrix

- [x] Build a reusable schema fixture matrix that records runtime transform output, inferred TypeScript shape, generated JSDoc metadata, and expected fallback behavior.
- [x] Cover full object schema, shorthand schema, keyword-named fields, nested objects, arrays, tuples, nullable values, `enum`, `const`, and unsupported dynamic schemas.
- [x] Use the matrix from schema runtime tests, Babel plugin tests, and `packages/teamplay` type tests where practical.
- [x] Document the supported static schema subset and the recommended explicit type fallback for dynamic schemas.

## Phase 20: Generated Type And Package Surface Hygiene

- [ ] Shrink generated `teamplay-env.d.ts` further where helper types can own interpretation.
- [x] Validate generated schema-module augmentations with relative imports, alias imports, explicit extensions, and monorepo-style output locations.
- [x] Add a package-surface fixture for strict external projects using modern module resolution.
- [x] Review emitted declarations for accidental `any` leaks on exported APIs.
- [x] Update TypeScript support docs for the generated env file, schema default interfaces, and known module-resolution requirements.

## Phase 21: Documentation And Migration Guidance

- [x] Update internal docs to consistently distinguish public `Signal<T>` facade, runtime signal instance, and model constructor contracts.
- [x] Update user-facing docs for query metadata, aggregation output generics, `defineSchema()`, and generated schema default interfaces.
- [x] Add troubleshooting notes for missing generated env declarations, failed schema module augmentation, and external package import issues.
- [ ] Keep examples centered on the object-tree UX: `$`, `$.collection[id]`, `sub()`, `useSub()`, and `Signal<SchemaType>`.

## Suggested Next Task Set

The next pass should be smaller than this one and should avoid a whole-file `SignalBase.ts` rewrite.

- [x] Pick one `SignalBase.ts` method group, add the needed local interfaces, remove checks for that group, and run focused runtime tests immediately.
- [x] Replace implementation-body `any` in `sub.ts` and `useSub.ts` with `unknown`, `AggregationParams`, and runtime signal contracts where it does not hurt overload readability.
- [x] Extend the shared path utility to file-model pattern rules (`[id]`, `index`, ignored `-` files, invalid wildcard names) and migrate Babel loader tests to the shared fixtures.
- [x] Extend `schemaFixtureMatrix.ts` so Babel/JSDoc and generated env tests consume the same cases as runtime and type tests.
- [ ] Do a manual VS Code/editor display pass for `Signal<T>`, `Signal<T[]>`, `sub()`, `useSub()`, query `ids`/`extra`, and generated schema default interfaces.
- [x] Update user-facing TypeScript docs with external-consumer setup, schema augmentation troubleshooting, query metadata examples, and the known broad-indexing limitation.

## Suggested Next Task Set After This Slice

- [ ] Do the manual VS Code/editor display pass that cannot be verified reliably through automated tests.
- [x] Convert another narrow `SignalBase.ts` method group, preferably metadata/read-only methods before proxy-heavy mutation logic.
- [x] Add parity tests or source generation for the injected `require.context` model-pattern helper so it cannot drift from `modelPatternRules.js`.
- [ ] Shrink generated `teamplay-env.d.ts` further where helper types can own interpretation without hurting editor display.
- [ ] Keep examples centered on the object-tree UX while reviewing the remaining user-facing docs.

## Suggested Next Task Set After Metadata Slice

- [ ] Do the manual VS Code/editor display pass that cannot be verified reliably through automated tests.
- [x] Convert the next `SignalBase.ts` method group only after choosing a small behavioral boundary, likely read dispatch (`get`/`peek`/`getIds`) or array readers.
- [ ] Investigate whether special-property typing can be improved further without changing `$.collection[id]`.
- [ ] Shrink generated `teamplay-env.d.ts` where helper types can take over interpretation without losing field JSDoc or readable hover output.
- [ ] Continue reviewing user-facing docs for object-tree examples and remove any stale non-object-tree guidance.

## Suggested Next Task Set After Array Reader Slice

- [ ] Do the manual VS Code/editor display pass that cannot be verified reliably through automated tests.
- [x] Convert read dispatch next (`get`, `peek`, and `getIds`) only after adding focused tests for root logical snapshots, query docs, private storage, aggregation ids, and non-query fallback behavior.
- [ ] Investigate whether special-property typing can be improved further without changing `$.collection[id]`.
- [ ] Shrink generated `teamplay-env.d.ts` where helper types can take over interpretation without losing field JSDoc or readable hover output.
- [ ] Continue reviewing user-facing docs for object-tree examples and remove any stale non-object-tree guidance.

## Suggested Next Task Set After Read Dispatch Slice

- [ ] Do the manual VS Code/editor display pass that cannot be verified reliably through automated tests.
- [x] Convert the first `SignalBase.ts` value mutation boundary after adding focused tests for id-field no-ops, public/private storage selection, root/collection protection, and `publicOnly` rejection.
- [ ] Investigate whether special-property typing can be improved further without changing `$.collection[id]`.
- [ ] Shrink generated `teamplay-env.d.ts` where helper types can take over interpretation without losing field JSDoc or readable hover output.
- [ ] Continue reviewing user-facing docs for object-tree examples and remove any stale non-object-tree guidance.

## Suggested Next Task Set After Value Mutation Slice

- [ ] Do the manual VS Code/editor display pass that cannot be verified reliably through automated tests.
- [x] Extract a shared checked helper for the repeated array/string/increment mutator routing only after focused tests pin protected id-field no-ops, public/private routing, and `publicOnly` rejection for each operation family.
- [x] Convert `idFields` from JavaScript to TypeScript instead of adding a declaration shim for the new checked mutation helper.
- [ ] Investigate whether special-property typing can be improved further without changing `$.collection[id]`.
- [ ] Shrink generated `teamplay-env.d.ts` where helper types can take over interpretation without losing field JSDoc or readable hover output.
- [ ] Continue reviewing user-facing docs for object-tree examples and remove any stale non-object-tree guidance.

## Suggested Next Task Set After Storage Mutation Routing Slice

- [ ] Do the manual VS Code/editor display pass that cannot be verified reliably through automated tests.
- [ ] Pause before extracting proxy `apply` behavior until tests pin aggregation row method binding, model-method collisions, and Compat fallback method lookup.
- [ ] Investigate whether special-property typing can be improved further without changing `$.collection[id]`.
- [ ] Shrink generated `teamplay-env.d.ts` where helper types can take over interpretation without losing field JSDoc or readable hover output.
- [ ] Continue reviewing user-facing docs for object-tree examples and remove any stale non-object-tree guidance.
