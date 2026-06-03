# Remaining compat / non-compat gaps

Документ предназначен для принятия решений по финальному переводу LMS и зависимых пакетов на non-compat runtime. В таблице ниже оставлены только ещё не закрытые блоки.

Уже не включены в список:

- removed React hooks: `useDoc*`, `useQuery*`, `useBatch*`, `useQueryIds*`, `useQueryDoc*`;
- removed path/cursor surface: `.at()`, `.scope()`, `get(path)`, `peek(path)`, `set(path, value)`, path-overloads для mutators;
- removed legacy root-call collection add: `add(collection, object)`; use `$root[collection].add(object)`;
- added base methods: `setReplace()`, `setNull()`, `setDiff()`, `setDiffDeep()`, `setEach()`, `getCopy()`, `getDeepCopy()`, `getExtra()`;
- base string/array/increment current-signal methods and `useSub` / `useAsyncSub` / `useBatchSub`.
- aligned query params clone/hash: compat now drops object fields with `undefined` like non-compat and logs a transition warning.
- aligned subscription GC delay: both compat and non-compat default to a `3000ms` grace window.
- deprecated `publicOnly` private-write guard: `setPublicOnly()` is a no-op in both modes; server global-root private writes log a warning.

## Remaining Decision Matrix

| Механизм | Насколько задействован в LMS / deps | Рекомендация | Комментарий |
|---|---|---|---|
| Imperative query API: `.query()`, `.subscribe()`, `.unsubscribe()`, `.fetch()`, `.unfetch()` | Высоко. Старый scan показывал около `1249` `.query(` в LMS и usage в `@dmapper/*` / `@startupjs/*`. Много server/cron/model flows. | Держать временный adapter для LMS/deps. Параллельно переводить flows на explicit non-compat query/subscription primitives. | Это не только синтаксис: compat query API включает shorthand params, root subscribe-many, fetch/live transport selection and readiness semantics. |
| Refs: `ref()`, `removeRef()`, `refExtra()`, `refIds()` | Низко по количеству, но критично по смыслу. LMS: session/user, tutoring layouts, media fullscreen, filter UI. Deps: `@startupjs/ui`, tenants/i18n. | Не переносить как permanent core по умолчанию. Держать adapter на переходный период; новые flows писать через explicit binding/subscription. | Ref - это отдельная bidirectional data-binding model с batch/reflection semantics, а не простой alias. |
| Ref-aware model lookup and metadata | Средне, зависит от ref usage. | Сохранять в adapter вместе с refs. При refactor-е убирать ситуации, где model method доступен только через ref alias. | Compat умеет искать model method / `getId()` / `getCollection()` через dereferenced target. Base non-compat так не должен работать неявно. |
| `$root.start()` / `$root.stop()` derived sync | Низко по числу callsites, но критично: virtual fields/stages/settings. | Не переносить как permanent core без отдельного дизайна. Лучше вынести LMS helper или перепроектировать virtual docs на explicit observers/computed flows. | Compat start/stop завязаны на deep source reactivity, `setDiffDeep`, sparse/nullish behavior, suspension handling и dirty target protection. |
| Model events: `change`, `all`, wildcard captures | Средне-низко, но есть важные flows: virtual docs, task status/timer/event flows, dashboards/pricing/url sync. | Adapter для legacy. Target code переводить на explicit observe/subscription/domain events. | Custom events (`emit`, `useOn`, `useEmit`) остаются отдельно; здесь речь именно про Racer-like model mutation events. |
| `silent()` / model-events suppression | Низко, но связано с virtual docs и обратной записью. | Держать только вместе с model-events adapter. Не делать core signal API без отдельной причины. | Без model events `silent()` почти не имеет смысла как отдельная runtime-фича. |
| Root ShareDB access: `$root.connection`, `model.root().connection` | Средне. Rich-text/editor flows и deps ждут прямой ShareDB connection. | Не добавлять connection на любой signal. Дать explicit exported accessor или root/server adapter. | Это инфраструктурная зависимость, не signal-data API. |
| Legacy lifecycle: `close(callback)` | Высоко в server/cron/api/hooks/webhooks и `@startupjs/worker`. | Держать explicit compatible lifecycle API или adapter. Постепенно переводить callers на awaitable root lifecycle. | `close(callback)` массовый и относительно изолированный; переписать всё сразу дорого. |
| Compat `id` injection вместе с `_id` | Средне, нужно дополнительно проверить runtime callsites. | Не менять base semantics. Target refactor на `_id`; adapter может временно добавлять `id` для old flows. | Base добавляет `_id`, compat добавляет `_id` + `id` для docs/query/aggregation/local add. Добавление `id` в base меняет форму данных для non-compat проектов. |
| Public subpath write on missing doc / immediate writes after add | Средне в server/model code. | Найти sequences `add` -> immediate subpath writes. Где нужно, добавить explicit subscribe/fetch flow или narrow adapter. | Compat может использовать cached raw state, пока ShareDB doc snapshot ещё пустой. Base non-compat считает doc missing и может throw. |

## Recommended Order

| Шаг | Содержание | Результат |
|---|---|---|
| 1 | Зафиксировать временный adapter surface только для оставшихся блоков: imperative query API/readiness, refs, start/stop, model events/silent, connection/close, id injection edge cases. | Понятная граница между permanent non-compat API и migration layer. |
| 2 | Пройти LMS server/model query flows: `.query()` / `.subscribe()` / `.fetch()` / `getIds()` / `getExtra()`. | Список мест, где нужен adapter, explicit query primitive или сохранение compat readiness/transport semantics. |
| 3 | Отдельно разобрать refs и virtual docs (`start/stop`, `silent`, model events). | Решение: оставить LMS helper, adapter или перепроектировать flows. |
| 4 | Разобрать server lifecycle: `connection`, `close(callback)`. | Явный lifecycle API без Racer-style model object leakage. |
| 5 | Smoke без compat: route transitions, rich-text, virtual fields/stages, query-heavy server flows, task/status screens, server warnings for global-root private writes. | Проверка runtime/timing gaps, которые не ловятся static scan-ом. |

## Do Not Reintroduce

| Не возвращать в core | Почему |
|---|---|
| Path-first APIs: `get(path)`, `set(path, value)`, mutator path overloads | Это возвращает Racer cursor model и усложняет типизацию. |
| `.at()` / `.scope()` | Эти helpers уже убраны из target surface; dynamic traversal лучше закрывать локальными migration helpers, не core API. |
| Removed compat React hooks | Target React API уже object-tree based: `useSub`, `useAsyncSub`, `useBatchSub`. |
| `setEach` -> `assign` migration | Nullish semantics разные; `setEach` уже есть в base и должен использоваться там, где нужен per-key replace. |
| Global non-compat timing changes ради старого UI | Для route/subscription timing лучше adapter/smoke tests, а не изменение default behavior для всех non-compat проектов. |
