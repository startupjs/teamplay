# Remaining compat / non-compat gaps

Документ предназначен для принятия решений по финальному переводу LMS и зависимых пакетов на non-compat runtime. В таблице ниже оставлены только ещё не закрытые блоки.

Уже не включены в список:

- removed React hooks: `useDoc*`, `useQuery*`, `useBatch*`, `useQueryIds*`, `useQueryDoc*`;
- removed path/cursor surface: `.at()`, `.scope()`, `get(path)`, `peek(path)`, `set(path, value)`, path-overloads для mutators;
- removed legacy root-call collection add: `add(collection, object)`; use `$root[collection].add(object)`;
- removed imperative query/fetch/subscribe usage from LMS target branch: `.query()`, `.subscribe()`, `.unsubscribe()`, `.fetch()`, `.unfetch()`; use `sub()` / `unsub()`;
- added base methods: `setReplace()`, `setNull()`, `setDiff()`, `setDiffDeep()`, `setEach()`, `getCopy()`, `getDeepCopy()`, `getExtra()`;
- base string/array/increment current-signal methods and `useSub` / `useAsyncSub` / `useBatchSub`.
- aligned query params clone/hash: compat now drops object fields with `undefined` like non-compat and logs a transition warning.
- aligned subscription GC delay: both compat and non-compat default to a `3000ms` grace window.
- aligned `SignalCompat.set()` with base `Signal.set()`; replace semantics live in `setReplace()`.

## Remaining Decision Matrix

| Механизм | Насколько задействован в LMS / deps | Рекомендация | Комментарий |
|---|---|---|---|
| Refs: `ref()`, `removeRef()`, `refExtra()`, `refIds()` | Низко по количеству, но критично по смыслу. Текущий LMS scan: 7 real `.ref/.removeRef` callsites (`_session.user`, tutoring layout, media fullscreen, filter local value). `refExtra/refIds` в LMS targeted scan не найдены. Deps: `@startupjs/ui`, tenants/i18n могут всё ещё иметь refs. | Сначала убрать LMS refs вручную. Не переносить как permanent core по умолчанию; если deps блокируют, держать узкий adapter на переходный период. | Ref - это отдельная bidirectional data-binding model с lifecycle/detach semantics, а не простой alias. |
| Ref-aware model lookup and metadata | Низко-средне, зависит от оставшихся refs и deps. | Сохранять только в ref adapter, пока refs не убраны. При refactor-е не полагаться на model method / `getId()` / `getCollection()` через ref alias. | Compat умеет искать model method / metadata через dereferenced target. Base non-compat так не должен работать неявно. |
| `$root.start()` / `$root.stop()` derived sync | Низко по числу callsites, но критично. Текущий LMS scan: 4 direct root start/stop callsites в `useInitVirtualStagesAndSettings` и `useInitVirtualFields`. | Следующий приоритет. Лучше вынести LMS helper для virtual docs или перепроектировать virtual docs на explicit observers/computed flows. Не переносить как permanent core без отдельного дизайна. | Compat start/stop завязаны на deep source reactivity, `setDiffDeep`, sparse/nullish behavior, suspension handling и dirty target protection. |
| Model events: `change`, `all`, wildcard captures | Средне. В LMS много `useOn('change'/'all', ...)` usages; часть custom events, часть Racer-like model mutation events. Direct `$task.on('change', 'status')`: 3 dashboards. | Разделить custom events и model mutation events. Custom `emit/useOn/useEmit` можно оставить. Model `change/all` либо adapter, либо manual migration на explicit `observe`/domain events. | Custom events (`emit`, `useOn`, `useEmit`) уже отдельный surface; blocker именно automatic model mutation events. |
| Model-events suppression | Низко: active `.silent()` callsites в LMS/deps не найдены. | Не переносить в core. | Без model events отдельный `silent()` API не нужен. |
| Root ShareDB access: `$root.connection`, `model.root().connection` | Низко в LMS, но важно для rich-text. Текущий scan: direct `this.root().connection.get('texts', textId)` в `BaseCardModel`; rich-text UI уже использует explicit `getConnection()`. Deps могут ждать `model.connection` / `$root.connection`. | Не добавлять `connection` на любой signal. Перевести LMS оставшийся callsite на explicit `getConnection()`. Для deps - explicit accessor или узкий root/server adapter. | Это инфраструктурная зависимость, не signal-data API. |
| Legacy lifecycle: `model.close()` / `close(callback?)` | Высоко по no-arg `model.close()` в server/cron/api/hooks/webhooks. Targeted scan не нашёл real `close(callback)` callsites в LMS, но deps (`@startupjs/worker`, auth/permissions/tenants) могут ожидать legacy shape. | Оставить/поддержать simple `close()` lifecycle до финального cleanup. Callback form можно не расширять в LMS, но проверить deps перед removal. | Массовый no-op/cleanup lifecycle surface; важно отделять TeamPlay model `close()` от browser/socket/stream `.close()`. |
| Runtime `idFields` policy для `_id/id` | Средне, нужно явно включать только в legacy apps. | Default остаётся `['_id']`. Для LMS можно временно включить `idFields: ['_id', 'id']`, чтобы compat/noncompat имели одинаковую форму документов без массового refactor-а callsites. | Политика больше не compat-only: оба режима используют `Model.ID_FIELDS -> runtime idFields -> ['_id']`. |

## Recommended Order

| Шаг | Содержание | Результат |
|---|---|---|
| 1 | Зафиксировать временный adapter surface только для оставшихся блоков: refs, start/stop, model events, connection/close, id injection edge cases. | Понятная граница между permanent non-compat API и migration layer после удаления imperative query API. |
| 2 | Убрать LMS refs вручную: session user, tutoring layout, media fullscreen, filter local value. | Можно удалить/сузить ref adapter и ref-aware metadata fallback. |
| 3 | Разобрать virtual docs: `$root.start/$root.stop` + model events. | Решение: LMS helper, explicit observers или временный adapter. |
| 4 | Разделить `useOn('change'/'all')`: custom events vs model mutation events. | Список model-event callsites для ручной миграции или adapter-а. |
| 5 | Разобрать `connection` и `model.close()` lifecycle. | Explicit connection accessor и понятный root lifecycle без Racer-style leakage. |
| 6 | Smoke без compat: route transitions, rich-text, virtual fields/stages, task/status screens, server warnings for global-root private writes. | Проверка runtime/timing gaps, которые не ловятся static scan-ом. |

## Do Not Reintroduce

| Не возвращать в core | Почему |
|---|---|
| Path-first APIs: `get(path)`, `set(path, value)`, mutator path overloads | Это возвращает Racer cursor model и усложняет типизацию. |
| `.at()` / `.scope()` | Эти helpers уже убраны из target surface; dynamic traversal лучше закрывать локальными migration helpers, не core API. |
| Removed compat React hooks | Target React API уже object-tree based: `useSub`, `useAsyncSub`, `useBatchSub`. |
| `setEach` -> `assign` migration | Nullish semantics разные; `setEach` уже есть в base и должен использоваться там, где нужен per-key replace. |
| Global non-compat timing changes ради старого UI | Для route/subscription timing лучше adapter/smoke tests, а не изменение default behavior для всех non-compat проектов. |
