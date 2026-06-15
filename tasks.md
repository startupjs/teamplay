# TeamPlay Architecture Tasks

This file is the active task list for [architecture.md](./architecture.md) and [typing-architecture.md](./typing-architecture.md). It is intentionally current-state focused, not a historical checklist. Completed work is summarized by area so the remaining tasks stay visible.

## Execution Rules

- Keep public runtime APIs stable unless there is an explicit product decision to change them.
- Preserve the object-tree UX: `$`, `$.collection[id]`, `sub()`, `useSub()`, and `Signal<SchemaType>`.
- Prefer checked runtime helpers over detached facade types.
- Keep changes small, add focused tests before moving behavior, and verify frequently.
- Keep generated `teamplay-env.d.ts` refactors readable in editors and preserve useful field JSDoc.
- Update this file, `architecture.md`, and `typing-architecture.md` when the direction changes.

## Completed Summary

- Public entry and subscription surfaces are checked: `index.ts`, `sub.ts`, and `useSub.ts`.
- Shared subscription result helpers are in place for `sub()`, `useSub()`, and `useAsyncSub()`.
- Runtime/public signal contracts are separated from the public `Signal<T>` facade.
- Central signal kind types drive document, collection, query, aggregation, local array, and nested value shapes.
- Collection/query/aggregation top-level mutators are blocked in public types where runtime rejects them.
- Aggregation generics are output-first and support arbitrary explicit output shapes.
- Query `ids` and `extra` metadata are modeled and documented.
- Runtime descriptors, path rules, model-pattern rules, root aliases, and generated `require.context` helper parity are covered.
- `defineSchema()` and schema-module default-interface augmentation support the `Signal<Game>` schema UX.
- A shared schema fixture matrix covers runtime, type, Babel/JSDoc, and generated-env behavior.
- Strict external consumer type tests validate package exports without `allowJs`.
- Small default runtime modules have been converted to TypeScript where useful.
- `idFields` is checked TypeScript.
- `SignalBase.ts` delegates the following checked slices:
  - symbols and getter names,
  - path and alias rules,
  - runtime segment/root/private-path access,
  - mutation target guards,
  - metadata methods,
  - array readers,
  - read dispatch,
  - `set()` / `del()` value mutation routing,
  - shared storage routing for array/string/increment mutators.
- Standard `npm test` and the pre-commit hook run type, server, and client suites.
- Client tests use numeric filename ordering plus a path-order Jest sequencer instead of an explicit file list.

## Active Tasks

### 1. Manual Editor Display Pass

This cannot be verified reliably through automated tests.

- [ ] Check hover and completion quality for `Signal<T>` document props.
- [ ] Check hover and completion quality for `Signal<T[]>` collection props.
- [ ] Check `sub()` result display for documents, collections, queries, and aggregations.
- [ ] Check `useSub()` result display for the same cases.
- [ ] Check query `ids` and `extra` hovers.
- [ ] Check generated schema default-interface hovers.
- [ ] Record any display regressions before changing overloads or generated type shape.

### 2. Proxy `apply` Boundary

Do not extract proxy method binding until tests pin the tricky behavior.

- [ ] Add focused tests for normal model method lookup through extremely late bindings.
- [ ] Add focused tests for data-field/model-method name collisions.
- [ ] Add focused tests for aggregation row method binding back to source documents.
- [ ] Add focused tests for aggregation setter restrictions.
- [ ] Add focused tests for default missing-method behavior.
- [ ] After tests exist, consider moving small pieces of `extremelyLateBindings.apply()` into checked helpers.

### 3. Generated Env Cleanup

The generated file is correct enough, but it still owns more interpretation than ideal.

- [ ] Inspect generated `teamplay-env.d.ts` for repeated policy that helper types could own.
- [ ] Identify one safe reduction that does not hurt hover readability or field JSDoc.
- [ ] Add/update generated-env snapshots for the change.
- [ ] Run Babel plugin tests and TeamPlay type tests.
- [ ] Keep schema-module augmentation behavior covered for relative imports, aliases, explicit extensions, and monorepo-style output paths.

### 4. Query Metadata And Broad Index UX

The object-tree API stays as `$.collection[id]`.

- [ ] Re-check whether special-property typing can improve without adding `doc(id)` or weakening broad document indexing.
- [ ] Keep `$query.ids` precise.
- [ ] Keep `$query.extra` explicit.
- [ ] Preserve query-as-`Signal<T[]>` assignability.
- [ ] Add type tests for any new special-property behavior.
- [ ] Keep runtime collision tests for document ids named `ids`, `extra`, and model method names.

### 5. Remaining JavaScript Boundaries

Prefer conversion for default modules when it removes useful declaration shims or tightens a shared rule.

- [ ] Review remaining default `.d.ts` shims for broad `any`.
- [ ] Type the small storage-read boundary (`dataTree.get`, `dataTree.getRaw`, `dataTree.getLogicalRootSnapshot`, `privateData.getPrivateData`) so checked metadata helpers can read current values directly without injected reader callbacks.
- [ ] Convert small default `.js` modules to `.ts` only when the boundary is stable and tests are nearby.
- [ ] Keep `Doc.d.ts`, `Query.d.ts`, and `Aggregation.d.ts` aligned with actual JS exports while those modules remain JavaScript.

### 6. User-Facing Docs

Docs should reinforce the intended object-tree mental model.

- [ ] Review remaining docs for stale alternatives to `$.collection[id]`.
- [ ] Keep examples centered on `$`, `$.collection[id]`, `sub()`, `useSub()`, and `Signal<SchemaType>`.
- [ ] Keep query metadata docs clear about `ids`, `extra`, and document-id collisions.
- [ ] Keep TypeScript support docs clear about generated env setup, schema default interfaces, and known module-resolution requirements.

## Verification Checklist

Use the smallest useful verification while iterating, then broaden before committing runtime changes.

- Type-only/public typing change:
  - [ ] `npm run test-types` from `packages/teamplay`
  - [ ] `npm run test-types:external` from `packages/teamplay`
- Babel/generator change:
  - [ ] `yarn workspace babel-plugin-teamplay test`
  - [ ] `npm run test-types` from `packages/teamplay`
- `SignalBase.ts` or runtime helper change:
  - [ ] Focused server tests for the touched behavior
  - [ ] `npm run test-types` from `packages/teamplay`
  - [ ] `npm run test-types:external` from `packages/teamplay`
  - [ ] `npm run lint`
  - [ ] Full root `npm test` before commit
- Client/runtime React change:
  - [ ] Focused or full `npm run test-client` from `packages/teamplay`

## Parking Lot

These are known but not active until there is a concrete product or maintenance reason:

- Full `SignalBase.ts` conversion. Continue slices instead.
- New document accessor APIs such as `$.users.doc(id)`. Do not add solely for TypeScript.
- Full JSON Schema support. Keep the TeamPlay-supported subset explicit.
