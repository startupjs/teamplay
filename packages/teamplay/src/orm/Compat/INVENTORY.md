# Инвентаризация compat / non-compat

Документ фиксирует фактические различия между compat-режимом Teamplay и текущим non-compat runtime. Это не план миграции и не список рекомендаций.

`src/orm/Compat/README.md` может быть устаревшим. Для этой инвентаризации источником истины считается текущий код `teamplay`, тесты и usage в LMS.

Более детальная матрица поведения, извлечённая из тестов compat/non-compat, вынесена в `src/orm/Compat/BEHAVIOR_MATRIX.md`.

Варианты миграции и ограничения целевого non-compat API фиксируются в `src/orm/Compat/MIGRATION_OPTIONS.md`.

Decision-ready список misalignments с рекомендациями находится в `src/orm/Compat/MISALIGNMENTS.md`; примеры рефакторинга - в `src/orm/Compat/REFACTORING_EXAMPLES.md`.

## Как включается режим

Compat определяется через `globalThis.teamplayCompatibilityMode` или `process.env.TEAMPLAY_COMPAT === '1'`.

Источник: `src/orm/compatEnv.js:1`.

В LMS compat сейчас включён явно:

| Место | Поведение |
|---|---|
| `vector-inline/package.json` | Основные scripts (`start`, `web`, `build`, `start-production`) запускаются с `TEAMPLAY_COMPAT=1`. |
| `vector-inline/scripts/start-watch-server.cjs` | Watch server прокидывает `TEAMPLAY_COMPAT: '1'`. |
| `vector-inline/worker.js` | `process.env.TEAMPLAY_COMPAT ??= '1'`. |
| `vector-inline/cron/index.js` | `process.env.TEAMPLAY_COMPAT ??= '1'`. |
| `vector-inline/server/compat/createRacerModel.js` | Выставляет `globalThis.teamplayCompatibilityMode = true`. |

## LMS usage snapshot

Грубая статическая оценка по `vector-inline`, без `node_modules`, lock-файлов, `dist`, `build`. В числах есть шум, но порядок зависимости от legacy API виден.

| Паттерн | Кол-во совпадений |
|---|---:|
| `.at(` | 1817 |
| `.scope(` | 1757 |
| `.subscribe(` | 1425 |
| `.getIds(` | 409 |
| `.setDiff(` | 298 |
| `useBatch(` | 288 |
| `useDoc(` | 421 |
| `useQuery(` | 184 |
| `.setEach(` | 108 |
| `.setDiffDeep(` | 92 |
| `.getExtra(` | 81 |
| `.ref(` | 6 |

Примеры мест, где видны Racer-like вызовы: `routing/routeAdapter.tsx`, `server/courses.js`, `cron/tasks/*.js`, `modelHelpers/*.js`, `main/pages/PStage/index.js`, `main/pages/PDashboard/index.js`.

## Dependent packages usage snapshot

Грубая статическая оценка по установленным `vector-inline/node_modules/@dmapper` и `vector-inline/node_modules/@startupjs`, без `dist`, `build`, source maps и lock-файлов. В числах есть документация и тесты пакетов, но runtime usage тоже присутствует.

| Паттерн | Кол-во совпадений |
|---|---:|
| `.at(` | 353 |
| `.scope(` | 271 |
| `.setDiff(` | 101 |
| `.setEach(` | 31 |
| `.getIds(` | 18 |
| `.setDiffDeep(` | 15 |
| `.connection` | 12 |
| `.getExtra(` | 8 |
| `.ref(` | 4 |
| `.removeRef(` | 1 |
| `.close()` | 37 |

Примеры runtime-зависимостей: `@dmapper/rich-text-editor` использует `model.connection` / `$root.connection`; `@startupjs/worker` использует `model.close()`, `model.at()`, `model.setEach()`; `@dmapper/permissions`, `@dmapper/tenants`, `@dmapper/chat`, `@startupjs/i18n`, `@startupjs/ui` используют `.at()`, `.scope()`, `.setDiff*()`, `.ref()`.

## Матрица различий

| Зона | Фича / поведение | Compat | Non-compat | Источники | LMS usage / примеры | Что проверить |
|---|---|---|---|---|---|---|
| Runtime | Определение режима | Включается через `TEAMPLAY_COMPAT=1` или `globalThis.teamplayCompatibilityMode`. | Используется, когда оба признака отсутствуют. | `src/orm/compatEnv.js:1` | LMS почти везде стартует с compat-флагом. | Где runtime создаётся без npm scripts: worker, cron, тесты, standalone scripts. |
| Runtime | Default signal class | `DefaultSignal` становится `SignalCompat`. | `DefaultSignal` становится базовым `Signal`. | `src/orm/Signal.ts:92` | Все импорты `teamplay`/`$root` получают другой runtime-класс. | Какие публичные API ожидаются потребителями `Signal` в LMS и зависимых пакетах. |
| Runtime | Root proxy `connection` / `root()` | Root proxy в compat дополнительно отдаёт `connection`; root traversal переводится на явный метод `root()`, а `root` без вызова остаётся обычным child-path. | `root()` доступен на базовом `Signal`; специальных proxy-getters для `root` нет. | `src/orm/SignalBase.ts`, `src/orm/getSignal.ts`, `test/signalCompat.js`, `test/signalMetadata.js` | Есть прямые `$root.connection` / `this.root().connection` в rich-text flows после миграции; старые `model.root.get('_session.userId')` должны стать `model.root()._session.userId.get()`. В deps: `@dmapper/rich-text-editor`, `@dmapper/versioning` tests. | Уточнить, какие обращения к `.root` являются Teamplay model API, а какие CSS/component `.root`. |
| Runtime | Model lookup через refs | Если модель не найдена по текущему path, compat пробует dereferenced path через `resolveRefSegmentsSafe`. | Возвращается базовый `Signal` без ref fallback. | `src/orm/getSignal.ts:125` | Связано с `ref`, `refExtra`, `refIds`. | Есть ли модели/методы, доступные только через ref-алиас. |
| Runtime / policy | `publicOnly` и private mutations | `setPublicOnly()` deprecated no-op; private mutations разрешены. Server global-root private writes warn once per collection. | То же поведение. | `src/orm/connection.ts:48`, `src/orm/privateData.js:17` | Request-scoped `_session` / `_page` writes остаются легитимными. | Проверять warning-и на случайные private writes через global `$` на сервере. |
| Lifecycle | Subscription GC delay | Default GC delay = `3000ms`. | Default GC delay = `3000ms`. | `src/orm/subscriptionGcDelay.ts:1` | Поведение выровнено: быстрые `unsub -> sub` циклы получают одинаковый grace window. | Проверять route/tab transitions smoke-тестами как обычный lifecycle risk, но это больше не compat/non-compat gap. |
| Cursor API | `.at(path)` | Есть в `SignalCompat`; принимает строку/число/segments, возвращает относительный cursor. | Не является compat-independent API базового `Signal` в том же виде. | `src/orm/Compat/SignalCompat.js:71` | `.at(` около 1817 совпадений. | Сколько usage реально относится к Teamplay model, а сколько к другим объектам. |
| Cursor API | `.scope(path)` | Есть в `SignalCompat`; строит путь от root signal. Без аргументов возвращает root. | Не является compat-independent API базового `Signal` в том же виде. | `src/orm/Compat/SignalCompat.js:699` | `.scope(` около 1757 совпадений. | Серверные model helpers и старые startupjs helpers. |
| Cursor API | `.path(subpath)` | В compat `.path()` возвращает текущий path, `.path(subpath)` возвращает joined path. | Базовый `Signal.path()` не покрывает тот же overload. | `src/orm/Compat/SignalCompat.js:63` | Используется косвенно в hooks/events/refs. | Где path передаётся как signal или string взаимозаменяемо. |
| Cursor API | `getCopy`, `getDeepCopy` | Compat поддерживает current signal copy helpers; legacy optional subpath больше не является целевой формой. | Base `Signal` теперь имеет `getCopy()` и `getDeepCopy()` на текущем signal. | `src/orm/SignalBase.ts`, `src/orm/Compat/SignalCompat.js:55`, `test/signalConvenienceMethods.js`, `test/signalCompat.js:340` | Нужно проверить usage отдельно. | Path/subpath copy helpers переписывать на child traversal перед вызовом copy method. |
| Cursor API | `getId`, `getCollection` через refs | Compat сначала resolve-ит ref target, потом вызывает base method. | Без compat ref fallback поведение отличается. | `src/orm/Compat/SignalCompat.js:79` | Модели LMS часто вызывают `this.getCollection()` / `this.getId()`. | В каких случаях `this` может быть ref-алиасом. |
| Subscription API | `.query(collection, params)` | Legacy helper на signal/root; возвращает query или aggregation signal. | Query создаётся через non-compat primitives, но `.query` как Racer helper не является тем же API. | `src/orm/Compat/SignalCompat.js:105` | Много server/cron code строит `$$query = model.query(...)` через model helpers. | Где используются query signals imperatively, а где через hooks. |
| Subscription API | `.subscribe(...items)` / `.unsubscribe(...items)` | Поддерживает subscribe self и subscribe many, callback-like legacy shape. | Non-compat использует `sub()` / `unsub()` для explicit single-signal flows; Racer-style root subscribe-many/callback shape не переносится. | `src/orm/Compat/SignalCompat.js:117`, `src/orm/sub.ts` | `.subscribe(` около 1425 совпадений. | Серверные flows: `await model.subscribe($doc, $$query)` мигрировать на `await Promise.all([sub($doc), sub($$query)])` и `unsub(...)`. |
| Subscription API | `.fetch()` / `.unfetch()` | Fetch-only варианты subscribe/unsubscribe. | Non-compat transport equivalent: `sub($doc, { mode: 'fetch' })`, `sub($collection, params, { mode: 'fetch' })`, cleanup через `unsub($signal)`. Racer-like methods остаются compat-only. | `src/orm/Compat/SignalCompat.js:127`, `src/orm/sub.ts` | Нужно проверить usage отдельно. | Отличить fetch-only server code от live subscriptions. |
| Subscription API | `.getExtra()` | Для aggregation возвращает `get()`, для query возвращает `extra.get()`. Compat дополнительно сохраняет legacy/ref behavior. | Base `Signal.getExtra()` теперь работает для query/aggregation/current signal и возвращает `undefined` для ordinary signals. | `src/orm/SignalBase.ts`, `src/orm/Compat/SignalCompat.js:137`, `test/signalConvenienceMethods.js` | `.getExtra(` около 81 совпадения; например cleanup cron и model helpers. | Где extra используется для count/aggregation и какие формы query params. |
| Subscription API | `.close(callback)` | Закрывает root context и unregister finalizer. | Нет legacy callback API в том же виде. | `src/orm/Compat/SignalCompat.js:144` | `model.close()` массово используется в cron/server/API/webhooks/hooks; похожий pattern есть в `@startupjs/worker`, `@startupjs/auth-lti`, `@dmapper/permissions`, `@dmapper/tenants`. | Отделить Teamplay/Racer model `.close()` от unrelated `.close()` на browser/socket/stream objects. |
| Mutators | `get(path)` / `peek(path)` overload | Compat принимает subpath или varargs и resolve-ит relative target; `peek()` учитывает refs. | Base API не гарантирует тот же overload/ref behavior. | `src/orm/Compat/SignalCompat.js:166` | Часто встречаются `model.scope(...).get(...)`, `$doc.get('field')`. | Сколько вызовов используют subpath overload, а не direct child cursor. |
| Mutators | `set(path, value)` overload | Compat поддерживает optional subpath; `undefined` проходит через compat delete/set semantics. | Base `set` работает на текущем signal без Racer-style overload. | `src/orm/Compat/SignalCompat.js:204` | Много старого UI/model code. | Отличить `set(value)` от `set(path, value)`. |
| Mutators | `add(collection, object)` на root | Removed from compat: use collection-signal traversal instead. | Base collection add works through collection signal only: `model[collection].add(object)`. | `src/orm/SignalBase.ts` | LMS runtime callsites migrated. | Dependency tests/readme may still mention old examples. |
| Mutators | `setNull(path, value)` | Compat legacy helper: пишет value только если target сейчас `null/undefined`; path overload остаётся legacy. | Base `Signal.setNull(value)` теперь работает на текущем signal. | `src/orm/SignalBase.ts`, `src/orm/Compat/SignalCompat.js:235`, `test/signalConvenienceMethods.js` | Нужно проверить usage отдельно. | Path-first usage переписывать на child traversal. |
| Mutators | `create(path?, value?)` | Removed from compat: use collection-signal `add({ ..., id })`. | Base does not expose document-level create; collection `add()` is the noncompat create path. | `src/orm/SignalBase.ts` | LMS runtime callsites migrated. | Direct ShareDB `doc.create(...)` is unrelated and remains. |
| Mutators | `setDiffDeep(path?, value)` | Compat recursive Racer-like diff через compat mutators; выполняется внутри runtime batch. Path overload/ref/silent behavior остаются compat-only. | Base `Signal.setDiffDeep(value)` теперь работает на текущем signal без path overload. | `src/orm/SignalBase.ts`, `src/orm/Compat/SignalCompat.js:275`, `test/signalConvenienceMethods.js` | `.setDiffDeep(` около 92 совпадений; routing, permissions patches, forms. | Path-first вызовы переписывать на child traversal; проверить recursive delete/set behavior. |
| Mutators | `setDiff(path?, value)` | Compat делает no-op при Racer-like equality, иначе replace. Объекты/массивы сравниваются не deep-equal. Path overload/ref behavior остаются compat-only. | Base `Signal.setDiff(value)` теперь работает на текущем signal без path overload. | `src/orm/SignalBase.ts`, `src/orm/Compat/SignalCompat.js:289`, `test/signalConvenienceMethods.js` | `.setDiff(` около 298 совпадений; routing и UI state. | Path-first вызовы переписывать на child traversal; проверить exact-equality no-op. |
| Mutators | `setEach(path?, object)` | Compat по ключам вызывает compat `set`; batch-ит обновления. Path overload/ref behavior остаются compat-only. | Base `Signal.setEach(object)` теперь работает на текущем signal без path overload. | `src/orm/SignalBase.ts`, `src/orm/Compat/SignalCompat.js:305`, `test/signalConvenienceMethods.js` | `.setEach(` около 108 совпадений; uploader, sidebar, patches. | Path-first вызовы переписывать на child traversal; не заменять mechanically на `assign`. |
| Mutators | `del(path?)` missing public doc | Compat проглатывает ошибку удаления несуществующего public doc/subpath. | Base deletion error не проглатывается так же. | `src/orm/Compat/SignalCompat.js:329` | Много cleanup/delete flows. | Какие удаления могут быть идемпотентными. |
| Mutators | Array mutators with path overload | Compat поддерживает `push`, `unshift`, `insert`, `pop`, `shift`, `remove`, `move` с optional path. | Base API работает на текущем signal без всех legacy overloads. | `src/orm/Compat/SignalCompat.js:361` | Нужно проверить usage отдельно. | Особенно card editors / reorder flows. |
| Mutators | String mutators with path overload | Compat поддерживает `stringInsert(path?, index, text)` и `stringRemove(path?, index, howMany)`. | Base API не совпадает по legacy overload. | `src/orm/Compat/SignalCompat.js:505` | Нужно проверить rich text/editor integrations. | Где есть collaborative text ops. |
| Mutators | `assign(value)` | Compat forward-ит через ref, затем вызывает base `assign`. | Base `assign` есть, но без compat ref forwarding. | `src/orm/Compat/SignalCompat.js:548` | Нужно проверить usage. | Может быть важно для ref aliases. |
| Events | Custom events | `emit`, `useOn`, `useEmit` экспортируются; custom events работают независимо от model events. | Экспорт есть тот же, custom events остаются. | `src/orm/Compat/eventsCompat.js:12`, `src/index.ts:227` | `useOn` используется в LMS, например stage/store UI. | Отличить custom events от model `change/all`. |
| Events | Model events `change` / `all` | Включены только когда `isCompatEnv() === true`; pattern matching поддерживает path patterns. | `isModelEventsEnabled()` false, model events не эмитятся. | `src/orm/Compat/modelEvents.js:11`, `src/orm/Compat/SignalCompat.js:555`, `test/signalCompat.js:3401` | Есть прямые `useOn('change'/'all')` и `$root.on('all')`: virtual fields/stages, display/private calcs, survey editor, dashboards, pricing, URL synchronizer, task status polling. | Отделить настоящие model events от custom events и DOM-ish `useOn` misuse. |
| Refs | `ref(path, target)` | Создаёт ref link, может быть mirror-only для query/aggregation; пишет ref metadata. | Non-compat не использует тот же Racer ref layer. | `src/orm/Compat/SignalCompat.js:600`, `test/rootScopedRefsAndEvents.js:21` | Реальные LMS usages: `Root/useGlobalInit.js` (`_session.user`), `main/Layout/Tutoring`, `v5/apps/main/Layout/Tutoring`, `components/Media`, `main/components/FilterV2`. В deps: `@startupjs/ui` Tabs, `@dmapper/tenants`, `@startupjs/i18n`. | Проверить жизненный цикл ref при смене session/user/tenant/tutoringSession. |
| Refs | `refExtra(path)` / `refIds(path)` | Legacy helpers для query extra/ids. | Нет такой формы в базовом runtime. | `src/orm/Compat/SignalCompat.js:651`, `src/orm/Compat/SignalCompat.js:665` | Нужно проверить usage отдельно. | Query extra/ids aliases. |
| Refs | `removeRef(path?)` | Останавливает ref, удаляет link, копирует target value обратно через `setDiffDeepBypassRef`. | Нет той же semantics. | `src/orm/Compat/SignalCompat.js:676` | Нужно проверить usage отдельно. | Возможны ожидания “detach but keep snapshot”. |
| Derived state | `start(targetPath, deps..., getter)` | Compat-only fallback на root: observe deps, пишет target через `setDiffDeep`, skip tick на thenable. | Не является обычным non-compat API. | `src/orm/SignalBase.ts:682`, `src/orm/Compat/startStopCompat.js:8`, `test/signalCompat.js:2710` | Реальные LMS usages: `clientHelpers/hooks/useInitVirtualStagesAndSettings.js`, `clientHelpers/hooks/useInitVirtualFields.js`. Они строят `_virtualStages`, `_virtualSettings`, `_virtualFields`. | Отделить compat `$root.start()` от domain model methods `.start()` и unrelated media/animation `.start()`. |
| Derived state | `stop(targetPath)` | Compat-only fallback на root, останавливает reaction из `start`. | Не является обычным non-compat API. | `src/orm/SignalBase.ts:691`, `src/orm/Compat/startStopCompat.js:63`, `test/signalCompat.js:2710` | Реальные LMS usages: cleanup в `useInitVirtualStagesAndSettings.js` и `useInitVirtualFields.js`. | Отделить compat `$root.stop()` от media/animation/domain `.stop()`. |
| Query internals | Materialize query docs into collection cache | Compat при init/insert кладёт query docs в collection raw cache, если doc ещё нет. | Non-compat этого не делает. | `src/orm/Query.js:911`, `test/subscriptionManagers.js:1218` | Есть patterns query -> ids/docs -> direct model read/cursor: `server/api/handlers/courses/aiInsightsScores.js` читает `model.get('classes.' + $$classes.getIds()[0])`; `server/courses.js` создаёт `model.at('classes.' + $$classes.getIds()[0])`; `model/files.js` после `filesQuery.getIds()` пишет `this.at(id).del('parentId')`. | Для каждого такого flow проверить, была ли doc subscription или reliance на query materialization. |
| Query internals | Query params clone/hash with `undefined` | Compat теперь использует тот же `JSON.parse(JSON.stringify(params))` clone/hash path, что и non-compat: object keys с `undefined` теряются. Дополнительно compat логирует transition warning. | Non-compat поведение совпадает, но warning не пишет. | `src/orm/Query.js`, `test/subscriptionManagers.js` | LMS static scan не нашел явных runtime usages; warning нужен для переходного периода. | Если warning проявится в smoke/runtime, нормализовать query params явно на caller-е. |
| DataTree | Immediate subpath writes after add | Compat и non-compat используют local raw data как optimistic source of truth, пока ShareDB doc.data пустой или doc object был пересоздан. | Поведение выровнено для local add snapshot; compat-only `doc.fetch()` fallback для полностью missing local state остаётся отдельно. | `src/orm/dataTree.js:351`, `src/orm/dataTree.js:397`, `test/publicDocCreateConsistency.js` | Важно для UI fire-and-forget add flows. | Если local raw snapshot тоже отсутствует, subpath write всё ещё считается missing-doc write. |
| DataTree | Fetch fallback for missing public doc state | Compat при missing state делает `doc.fetch()` fallback. | Non-compat не делает fallback. | `src/orm/dataTree.js:411` | Может скрывать отсутствие subscription/fetch в старом коде. | Найти public doc writes без явного subscribe/fetch. |
| Hooks | Legacy compat hooks removed | `useDoc`, `useQuery`, `useBatch` и related async/batch helpers раньше экспортировались из `Compat/hooksCompat.js`. | Эти path-based hooks удалены; target API: `useSub`, `useAsyncSub`, `useBatchSub`. | `src/index.ts`, `src/react/useSub.ts` | LMS migration переводит callsites на object-tree API. | Historical inventory row: old fallback/options behavior теперь должен сохраняться в миграционных callsites явно, если нужно. |
| Hooks | Batch subscription options | Legacy batch hooks force-или `async:false`, `batch:true`, `defer:false`. | `useBatchSub` force-ит `async:false`, `batch:true`, но сохраняет обычный default `defer`; legacy migration can pass `{ defer:false }`. | `src/react/useSub.ts` | `useBatch(` около 288 совпадений в старом LMS scan. | Проверить, что migration callsites с legacy timing явно передают `{ defer:false }`. |
| React observer | Render-attempt cleanup marker | При `renderAttemptCleanup` hook marks component and arms attempt cleanup. | Без renderAttemptCleanup marker не ставится. | `src/react/useSub.ts:264`, `src/react/useSub.ts:407` | Связано с trapRender warning/cleanup behavior. | Компоненты с sync hooks и Suspense. |
| React observer | Deferred update replay during execution context | Если update происходит внутри execution context и component marked compat, update откладывается в microtask. | Без compat marker replay path не включается. | `src/react/convertToObserver.js:37` | Может влиять на “update during render” edge cases. | Проверить компоненты, где subscription resolve/mutation случается во время render attempt. |
| Events / batching | `silent()` wrapper | Compat создаёт proxy wrapper, который подавляет model events при включенном silent. | Base runtime не имеет той же model-events silent layer. | `src/orm/Compat/SignalCompat.js:160`, `src/orm/Compat/SignalCompat.js:714` | Нужно проверить usage `.silent(`. | Только важно, если используются model events. |

## Проверка открытых пунктов

Отдельная проверка выполнена после первого прохода. Этот раздел фиксирует только факты, без решений и рекомендаций.

| Тема | Результат проверки | Источники / примеры | Что всё ещё открыто |
|---|---|---|---|
| `master-old` Racer behavior | `origin/master-old` доступен. Старый `package.json` не содержит `TEAMPLAY_COMPAT`; scripts запускают старый `startupjs` напрямую. Ветка подтверждает, что `$root.start/$root.stop`, `.ref/.removeRef`, `.silent`, `$root.connection`, `model.close()`, `getIds/getExtra`, model events уже использовались до Teamplay migration. | `git grep` по `origin/master-old`: `clientHelpers/hooks/useInitVirtualFields.js`, `clientHelpers/hooks/useInitVirtualStagesAndSettings.js`, `main/Layout/Tutoring/index.js`, `main/stages/fields/richText/*`, `cron/tasks/*`, `server/hooks.js`, `model/*`. | Ветка не была вынесена в отдельный worktree; проверка была read-only через `git grep` / `git show`. |
| Зависимые пакеты `@dmapper/*`, `@startupjs/*` | Legacy API используется не только в LMS. Найдены runtime usages в `@dmapper/rich-text-editor`, `@dmapper/permissions`, `@dmapper/tenants`, `@dmapper/chat`, `@startupjs/worker`, `@startupjs/i18n`, `@startupjs/ui`. | Counts по node_modules: `.at(` 353, `.scope(` 271, `.setDiff(` 101, `.setEach(` 31, `.connection` 12, `.close()` 37. | Часть совпадений находится в docs/tests пакетов; при планировании миграции нужно отделить runtime imports от readme/tests. |
| `model.connection`, `model.root()`, `.close()` | Есть прямой runtime usage. `$root.connection` / `this.root().connection` нужны rich-text flows для ShareDB docs. `model.close()` массово используется server/cron/api/hooks/webhooks. Старые `model.root.get(...)` требуют миграции на `model.root()._session...`. | LMS: `main/stages/fields/richText/FRichTextEdit.web.js`, `main/stages/fields/richText/FormulaPlugin.js`, `main/stages/MT_materials/edit/MTEditContent/index.js`, `modelCards/CardModel/BaseCardModel.js`, `helpers/filters.js`, `server/hooks.js`, `cron/tasks/*.js`. Deps: `@dmapper/rich-text-editor`, `@startupjs/worker`. | Нужно уточнить, какие `.root` matches относятся к component styles/API и не являются model API. |
| `start/stop`, `ref/refExtra/refIds/removeRef`, `silent` | `start/stop` реально используются в virtual fields/stages. `ref/removeRef` используются для session/user/tenant/tutoringSession/fullscreen/local UI bindings. `silent` используется для подавления model events при обратной записи из virtual docs. `refExtra/refIds` в LMS/deps не найдены в targeted scan. | LMS: `clientHelpers/hooks/useInitVirtualFields.js`, `clientHelpers/hooks/useInitVirtualStagesAndSettings.js`, `Root/useGlobalInit.js`, `main/Layout/Tutoring/index.js`, `v5/apps/main/Layout/Tutoring/index.js`, `components/Media/index.js`, `main/components/FilterV2/index.js`, `main/components/Event/index.js`. Tests: `test/signalCompat.js:2710`, `test/rootScopedRefsAndEvents.js:21`, `test/signalCompat.js:3476`. | Для `.start/.stop` много false positives от media/animation/domain methods; для финального списка нужны typed/runtime callsites. |
| Query materialization dependency | Есть подозрительные flows, где после query используются `getIds()`/`getExtra()` и затем прямой access к docs через `model.get`, `model.at`, `this.at`. По targeted scan найдено 214 server/cron/model occurrences с `getIds/getExtra` в query-like flows. | Примеры: `server/api/handlers/courses/aiInsightsScores.js` (`model.get('classes.' + $$classes.getIds()[0])`), `server/courses.js` (`model.at('classes.' + $$classes.getIds()[0])`), `model/files.js` (`filesQuery.getIds()` -> `this.at(id).del('parentId')`). | Нужно пройти key flows и определить, где query materialization достаточна, а где нужна явная doc subscription. |
| Hooks behavior без compat | Legacy path-based hooks больше не экспортируются. Non-compat `useSub` сохраняет default `defer:true`; `useSub(..., { batch:true })` включает batch barrier, а `useBatchSub` является sugar над ним. | `src/react/useSub.ts`, `src/react/trapRender.js`, `src/react/promiseBatcher.ts`. | Нужны smoke-тесты/ручной прогон LMS по route transitions, screens с `useBatchSub()`, stage player/dashboard и forms. |

## Следующий этап

После ревью этой инвентаризации можно добавить отдельные колонки с вариантами решения и обоснованием по каждой строке.
