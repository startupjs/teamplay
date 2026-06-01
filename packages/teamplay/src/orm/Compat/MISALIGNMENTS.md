# Misalignments compat / non-compat

Документ предназначен для принятия решений разработчиками. Он не повторяет полную инвентаризацию; одна строка здесь означает одно миграционное решение или группу близких решений.

Рекомендации учитывают три ограничения:

| Ограничение | Следствие |
|---|---|
| Non-compat уже используется в других проектах | Существующие методы non-compat не меняем без отдельного breaking decision. |
| LMS и зависимости реально используют почти весь compat surface | Нужен не только refactor LMS, но и migration adapter для `@startupjs/*` / `@dmapper/*`. |
| Path-first API, `.at()` и `.scope()` не являются целевым API | Их не переносим в permanent non-compat core; допускаем временный adapter и codemod/refactor callers. |

## Сводка evidence

Грубый static scan по runtime-коду. Числа не являются точным AST-аудитом, но показывают масштаб.

| Pattern | Текущий LMS | `master-old` | `@dmapper/*` runtime-ish | `@startupjs/*` runtime-ish | Вывод |
|---|---:|---:|---:|---:|---|
| `.at(` | 1817 | 1796 | 141 | 24 | Было в Racer-era и остаётся массовым. Не переносить в core, но нужен adapter/codemod. |
| `.scope(` | 1757 | 1716 | 119 | 27 | То же, особенно model/server code. |
| `.get('path')` | 3271 | 3144 | 127 | 172 | Массовый path getter. Цель: child traversal. |
| `.set('path', ...)` | 1058 | 1006 | 74 | 37 | Массовый path mutator. Цель: child traversal + `setReplace` при replace intent. |
| `.setDiff(` | 298 | 281 | 74 | 24 | Используется в LMS UI/server и deps. |
| `.setDiffDeep(` | 92 | 87 | 8 | 2 | Используется для deep copy/sync flows. |
| `.setEach(` | 108 | 102 | 19 | 6 | Нельзя заменить на `assign` механически. |
| `.query(` | 1249 | 1190 | 55 | 7 | Server/model/deps сильно завязаны на imperative Racer query API. |
| `.getIds(` | 409 | 378 | 12 | 2 | Часто идёт вместе с query materialization assumptions. |
| `.getExtra(` | 81 | 79 | 6 | 2 | Count/aggregation/data provider flows. |
| `.ref(` / `.removeRef(` | 6 / 2 | 4 / 2 | 1 / 0 | 3 / 1 | Мало callsites, но это layout/session/UI bindings и deps. |
| `$root.start/stop`, model events, `silent` | Небольшой объём | Было в `master-old` | Почти нет | Почти нет | Критично для virtual fields/stages; лучше adapter + целевой redesign. |
| `.connection`, `.close()` | 24 / 174 | 22 / 153 | 14 / 20 | 0 / 17 | Server/rich-text/worker lifecycle. Нужен adapter или explicit lifecycle API. |
| Doc hooks: `useDoc*` / `useBatchDoc*` / `useAsyncDoc*` | ~739 | ~735 | 62 | 17 | Массовая зависимость UI от compat subscription lifecycle. |
| Query hooks: `useQuery*` / `useBatchQuery*` / ids/doc variants | ~797 | ~778 | 33 | 41 | Массовая зависимость от compat query shape/readiness/materialization. |
| `useBatch()` | 288 | 282 | 7 | 0 | Это явный Suspense/materialization barrier, не просто helper. |

Выводы по hooks выше основаны не только на scan-е callsites, но и на runtime-коде/тестах:

| Источник | Что подтверждает |
|---|---|
| `src/orm/Compat/hooksCompat.js` | Hooks с path-аргументами, normalization sync/batch options, null fallbacks, extra-query shape, ids/doc helper hooks. |
| `src/react/useSub.ts` | Default `defer`, `renderAttemptCleanup`, batch/async/Suspense behavior и reuse предыдущего signal. |
| `src/react/promiseBatcher.ts`, `test/promiseBatcher.js` | `useBatch()` ждёт readiness checks только после initial subscription promises; checks alone не suspend-ят. |
| `src/orm/Compat/queryReadiness.js`, `test/compatBatchReadiness.js` | Точная readiness semantics для normal/extra/aggregation queries и null ids. |
| `src/react/convertToObserver.js` | Compat-marked components откладывают observer update после active execution context вместо полного drop-а update. |
| `src/react/trapRender.js`, `src/react/renderAttemptDestroyer.ts` | Missing `useBatch()` dev error и Suspense shell keepalive / attempt cleanup mechanics. |

## Decision matrix

| Misalignment | Compat behavior | Non-compat behavior | Влияние на LMS/deps | Рекомендация | Почему |
|---|---|---|---|---|---|
| `Signal.set(value)` semantics | Compat `set` для non-`undefined` работает как replace на target path. | Base local/private `set` использует internal `dataTree.set()` и может обновлять object/array через `setDiffDeep` in-place. | Механический перевод `model.set('a.b', obj)` -> `model.a.b.set(obj)` может изменить replace intent на reactivity-friendly update path. | Добавить permanent core API `setReplace(value)`; не менять `set(value)`. | Это сохраняет совместимость существующих non-compat проектов и даёт явный инструмент для LMS migration. |
| `setReplace(path, value)` | Path overload есть через compat `set(path, value)`. | Path overload не нужен в target API. | Массовые path-first writes. | В core добавлять только `setReplace(value)`. Path-first форму закрывать adapter-ом и codemod/refactor. | Цель перехода - уйти от Racer path-first cursor model. |
| `setReplace(undefined)` | Local/private compat сохраняет explicit `undefined`; public subpath normalize-ит `undefined` в `null`; whole public doc через base `set(undefined)` может удалить doc. | Требуемого explicit API пока нет. | Nullish writes есть в tests и могут быть скрыты в setEach/data sync. | Отдельно утвердить semantics перед реализацией. Предварительно: local/private strict replace to `undefined`; public subpath normalize to `null`; whole public doc `setReplace(undefined)` запретить или явно определить. | Это самый рискованный edge-case нового API; лучше не оставлять implicit. |
| Path-first mutators/getters | `get(path)`, `set(path, value)`, `del(path)`, `push(path, value)`, `stringInsert(path, ...)` и т.д. | Base методы работают на current signal. | Массово в LMS и deps; было уже в `master-old`. | Не переносить в permanent core. Сделать migration adapter и codemod/refactor на child traversal. | API наращивать можно, но path-first overloads противоречат целевой модели и усложняют типизацию. |
| `.at()` / `.scope()` | Основной Racer cursor API; `.scope()` всегда от root. | Не целевой non-compat API. | Массово в LMS/deps; много dynamic paths. | Не переносить в core. Для dynamic paths временно держать adapter или локальный migration helper; для статических/dynamic-id путей переписывать на child traversal. | Иначе non-compat сохранит старую Racer модель почти целиком. |
| `setDiff(value)` | Exact-equality no-op; objects/arrays не deep-equal, replace всё равно происходит. Есть path overload. | Нет permanent API в base. | Часто используется для UI state и deps (`@startupjs/ui`, `@dmapper/fields`, tables). | Добавить `setDiff(value)` как current-signal method без path overload; path overload только adapter/refactor. | Метод небольшой, additive, снижает churn в LMS/deps, но не тянет Racer path API в core. |
| `setDiffDeep(value)` | Recursive diff/delete stale keys, array diff, batch для observers. Есть path overload. | Есть low-level utility, но нет такого public current-signal API. | Используется для копий документов, virtual sync, tenant/settings/forms. | Рассмотреть permanent `setDiffDeep(value)` без path overload. Path overload только adapter/refactor. | Поведение уже покрыто тестами и полезно вне LMS, но API должен быть explicit current-signal. |
| `setEach(object)` | Per-key compat `set`; `null`/`undefined` ставятся как значения по storage semantics. Есть path overload. | Base `assign` удаляет fields при `null`/`undefined`. | Используется в LMS/deps; много save/update flows. | Не заменять на `assign`. Либо добавить `setEach(object)` без path overload, либо refactor на explicit per-key operations. | Семантика принципиально отличается от `assign`; механическая замена приведёт к потере nullish fields. |
| `assign(value)` | Compat только forward-ит через ref и дальше вызывает base `assign`. | Есть base API, deletion-on-nullish. | Может быть целевой заменой только там, где deletion-on-nullish желательна. | Оставить как есть; не использовать как универсальную замену `setEach`. | `assign` уже имеет понятную non-compat semantics. |
| Local vs public nullish writes | Local `undefined` сохраняется; public `undefined` normalizes to `null`. | Base tests уже частично поддерживают это на low-level/public layer. | Важно для sparse arrays, remote docs, started targets, `setEach`. | Сохранить различие в новых explicit APIs и документировать. | Попытка унифицировать local/public nullish semantics сломает Racer parity и public JSON semantics. |
| Public subpath write на missing doc | Compat умеет fallback через cached raw state после create/add/snapshot drop. | Base subpath set на non-existing public doc throws. | Старый server/model code может писать subpath сразу после create/add без subscribe. | Не менять base резко. Для LMS/deps держать adapter или найти/refactor create -> subpath write sequences. | Base throw защищает от ошибок, но compat fallback скрывал отсутствие subscription/fetch. |
| Imperative `query()` / `subscribe()` / `fetch()` | Racer-like query helper, shorthand params, root subscribe many, full materialization wait, `getIds/getExtra`. | Non-compat primitives отличаются по shape/lifecycle. | Самая крупная server-side зависимость: cron/tasks/server/model/deps. | Держать migration adapter дольше остальных. Параллельно проектировать целевой query API/refactor server flows. | Это не только синтаксис, а readiness/materialization/transport semantics. |
| Query materialization | Compat может materialize query docs в collection cache; code часто делает query -> getIds -> direct model access. | Non-compat не должен полагаться на такой side effect. | Примеры: `server/courses.js`, `modelHelpers/mixScope.js`, tasks/report flows. | В adapter сохранить для LMS. В refactor examples требовать explicit doc subscription/fetch или работу с query docs. | Иначе возможны missing doc reads после `getIds()`. |
| Query params with `undefined` | Compat normalizes `undefined` to `null` like Racer. | Non-compat может drop-нуть keys через JSON clone/stringify. | Optional filters могут менять hash/cache/result. | Для adapter сохранить compat normalization. Для target API сделать explicit: callers не должны передавать semantic `undefined`. | Query hash stability влияет на subscriptions и cache. |
| Refs | Private-source refs, bidirectional sync, ref path resolution, refExtra/refIds. | Нет того же Racer ref layer. | Небольшое число callsites, но есть `Root/useGlobalInit`, tutoring layouts, media fullscreen, `@startupjs/ui Tabs`, i18n/tenants. | Держать adapter для deps и текущего LMS. Для новых flows не использовать; постепенно refactor на explicit binding/subscription. | Ref - не sugar, а отдельная data-binding model с batch/reflection semantics. |
| `$root.start/$root.stop` | Derived sync через deps -> target, `setDiffDeep`, deep reactivity, sparse/nullish behavior. | Нет такого base API. | Критично для `useInitVirtualFields` и `useInitVirtualStagesAndSettings`. | Не переносить как permanent core без нового дизайна. Держать adapter; отдельно перепроектировать virtual docs. | Текущее поведение слишком domain-specific и связано с model events/silent. |
| Model events `change/all`, `silent()` | Compat model mutation events with pattern captures; `silent` suppresses them. | Non-compat model events layer disabled; custom events не эквивалентны. | Используется мало, но критично в virtual docs/task status/timer/event flows. | Adapter для legacy. Для target code заменить на explicit observe/subscription/domain events. | Перенос model events в core расширит surface старой Racer модели. |
| `root.connection` | Root даёт ShareDB connection напрямую. | Не является clean signal API. | Rich-text flows и deps ждут direct ShareDB connection. | Не добавлять на любой signal. Сохранить root/server adapter или дать explicit exported accessor. | Это инфраструктурная зависимость, не data signal behavior. |
| `close(callback)` | Legacy model close callback, массово в server/cron/deps. | Non-compat lifecycle другой. | Много server code делает `model.close()` без await/callback. | Сохранить adapter или explicit compatible root lifecycle API. | Переписать весь server lifecycle сразу дорого; behavior понятный и изолированный. |
| `_id` + `id` injection | Compat public docs/queries/aggregations добавляют оба поля. | Base добавляет `_id`, не `id`. | Возможны ожидания `doc.id`, особенно старый LMS/deps. | Не менять base. Adapter может добавлять `id`; target refactor на `_id`. | Добавление `id` в base меняет форму данных для всех non-compat проектов. |
| `publicOnly` private writes | Compat позволяет private mutations при `publicOnly`. | Non-compat блокирует. | Может проявиться в client private/session writes. | Сохранить non-compat strict behavior. LMS adapter может временно ослаблять, но target - исправить callers/config. | Strict publicOnly безопаснее и уже является non-compat contract. |
| Sync hooks options: `useDoc/useQuery` | В compat env force-ят `async:false`, `renderAttemptCleanup:true`, `defer:false`. | В non-compat без options остаются default `useSub` options: `async:false`, `defer` по умолчанию `true`, без render-attempt cleanup marker. | Route/tab transitions могут получить deferred old signal/params, stale/empty reads или другой Suspense timing. | Не менять non-compat defaults глобально. Для LMS/deps держать compat hooks wrapper или explicit adapter options; отдельно smoke suite без compat. | Это runtime lifecycle, а не синтаксис. Static refactor не докажет корректность. |
| Batch hooks options: `useBatchDoc/useBatchQuery` | Всегда force-ят `batch:true`, `async:false`, `renderAttemptCleanup:true`, `defer:false`; это не gated by `isCompatEnv()`. | Core `useSub` не даёт такого контракта сам по себе. | В LMS `useBatch()` используется как hard barrier на экранах stage/admin/payment/tables. | Сохранить batch-hook semantics в adapter. Не переносить как implicit default всех non-compat hooks. | Batch hooks - сознательный barrier; сделать его default для core значит изменить поведение других проектов. |
| `useBatch()` closing call invariant | После `useBatch*` нужно вызвать `useBatch()`. Если batch активирован и render завершился без закрытия, `trapRender` бросает dev error. | Без compat/batch wrapper такого invariant может не быть или он будет другим. | Уже ловили runtime ошибку при незакрытом batch. Ошибка полезная, но миграционно шумная. | Оставить invariant в adapter и добавить lint/codemod/runtime smoke на missing `useBatch()`. | Проблема хорошо детектится автоматически; не стоит размывать контракт. |
| `useBatch()` readiness barrier | `promiseBatcher` ждёт initial subscription promises, затем microtask flush, затем readiness checks. Checks без initial promise не suspend-ят. | Обычный `Promise.all` или простой Suspense не эквивалентны. | UI часто ожидает, что после `useBatch()` query docs уже материализованы в local tree. | В adapter сохранить текущую materialization barrier. В target API readiness должен быть explicit contract. | Иначе возможны гонки: query resolved, ids есть, а docs ещё не читаются синхронно. |
| Query readiness для batch hooks | Extra query ready только когда `extra` есть; aggregation ready по `docs`/`extra`/aggregation raw; обычный query ждёт ids и materialized docs, `null` ids игнорируются. | Non-compat query hooks не должны неявно повторять Racer materialization semantics. | Влияет на `$count`, `$queryName`, `$aggregationName`, `$aggregate`, `_id: {$in: ids}` helpers. | Держать в adapter. Для target query API разделить "subscription ready" и "docs materialized". | Это разные уровни готовности; смешивание будет ломать либо LMS, либо новые проекты. |
| Null doc/query fallback in hooks | `useDoc(collection, null)` подписывается на `__NULL__`; `useQuery(collection, null)` подписывается на `{ _id: '__NON_EXISTENT__' }` и warn once. | В target API лучше explicit skip/conditional render; fallback сейчас не gated by compat env. | LMS часто использует dummy ids; часть undefined состояний может быть скрыта fallback-ом. | В adapter fallback сохранить. В target добавить/использовать explicit `skip` pattern или не вызывать hook до готовности id/query. | Fallback предотвращает crash, но скрывает ошибку состояния и закрепляет dummy-doc convention. |
| Extra-query return shape | `useQuery$` для `$count/$queryName/$aggregationName` возвращает `$query.extra`; `useQuery` возвращает `[$query.get(), $collection]`, а не сам query signal. | Target API может естественно хотеть отдельный count/aggregation/query result shape. | Callers могут ожидать именно value + collection cursor и писать в `$collection[id]`. | В adapter сохранить shape. В target лучше split hooks или явно документировать result object. | Текущий tuple shape смешивает result value и collection cursor ради Racer parity. |
| Batch query helper hooks: ids/doc variants | `useBatchQueryIds`, `useBatchQueryDoc` строятся поверх compat batch query hooks, сортируют по входному ids list, используют `_id ?? id`, default `$sort: { createdAt: -1 }` для doc. Non-batch ids/doc helpers удалены из compat export surface. | В non-compat core таких helpers может не быть или их shape может быть другим. | Batch helpers остаются частью LMS/deps batch barrier flow; non-batch helpers должны жить в application helpers. | Держать batch helpers в adapter. Product-specific non-batch helpers refactor to local project helpers. | Это удобные LMS-era abstractions, но не обязательно primitives Teamplay core. |
| Observer update during active render | Compat hooks mark component; observer update during active execution context не теряется, а queueMicrotask-ом пробуется после render. | Non-compat component без marker просто блокирует update during active execution context. | Может проявляться как "первый render не обновился" на route switches и sync subscriptions. | Не делать global behavior. Оставить только для compat-marked components и покрыть smoke tests. | Глобальное deferred update поведение может добавить лишние renders в non-compat проектах. |
| Render-attempt cleanup / Suspense shell keepalive | `renderAttemptCleanup` arms renderAttemptDestroyer. При thrown thenable observer shell может остаться alive до завершения promise и выполнить attempt cleanup. | Без marker `trapRender` уничтожает shell на thrown thenable, кроме paths с explicit suspense gate. | Влияет на GC/cache/subscription cleanup при Suspense на начальном render. | Adapter должен сохранять marker. Target API должен использовать explicit suspense gate только там, где это нужно. | Это тонкий lifecycle механизм; переносить его как implicit behavior рискованно. |
| Async hooks | `useAsyncDoc/useAsyncQuery` идут через `useAsyncSub` и возвращают `undefined` до готовности, не используя sync compat normalization. | Это ближе к обычному non-compat async behavior. | Используются заметно меньше, но могут быть safer migration target для отдельных экранов. | Не считать полной заменой sync/batch hooks. Использовать точечно там, где UI готов к loading state. | Async hooks меняют user-visible loading behavior; механическая замена sync hooks невозможна. |

## Рекомендации по порядку работ

| Шаг | Содержание | Результат |
|---|---|---|
| 1 | Реализовать и покрыть тестами `setReplace(value)` в non-compat и compat. | Безопасная база для refactor path-first `set`. |
| 2 | Решить public/local `setReplace(undefined)` contract. | Убирает главный semantic gap до codemod. |
| 3 | Добавить, если подтверждено, current-signal `setDiff(value)`, `setDiffDeep(value)`, `setEach(object)` без path overloads. | Снижает объём adapter-only legacy API. |
| 4 | Зафиксировать hooks adapter contract: sync options, batch barrier, query readiness, null fallbacks, extra-query shape, observer compat marker. | Самая рискованная UI часть перехода остаётся контролируемой и тестируемой. |
| 5 | Сделать migration adapter для path-first API, `.at()`, `.scope()`, query helpers, refs/start/events/close/connection. | LMS и deps могут жить в non-compat runtime на переходном слое. |
| 6 | Начать codemod/refactor LMS с простых path-first getters/mutators и hook-side path calls. | Уменьшение зависимости от adapter без изменения domain logic. |
| 7 | Отдельно проектировать query/ref/start/events replacement и target hooks API. | Избежать переноса Racer runtime целиком в core. |
| 8 | До отключения compat прогнать LMS smoke suite без compat: route transitions, tab switches, screens с `useBatch()`, count/aggregation queries, dummy-id states. | Подтверждение runtime lifecycle, которое нельзя получить только static scan. |

## Что не стоит делать

| Антипаттерн | Почему |
|---|---|
| Менять `Signal.set(value)` на compat replace | Риск breaking changes для существующих non-compat проектов. |
| Добавлять `set(path, value)` / `get(path)` / `.at()` / `.scope()` в permanent core | Это закрепит Racer cursor API в новой модели. |
| Массово заменить `setEach` на `assign` | Nullish semantics разные. |
| Переписать query helpers только синтаксически | Основная разница в materialization/readiness/transport, а не только в форме вызова. |
| Перевести `useDoc/useQuery/useBatch*` на обычные non-compat hooks без adapter/smoke tests | Отличается `defer`, cleanup, Suspense shell lifecycle, query readiness и return shape. |
| Делать hook-side string paths permanent API | Это сохранит Racer cursor model через React hooks, даже если убрать path-first mutators. |
| Убрать adapter для deps на раннем этапе | `@startupjs/*` и `@dmapper/*` имеют runtime usage legacy API. |
