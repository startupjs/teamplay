# Варианты миграции compat -> non-compat

Документ фиксирует рабочую рамку для перехода LMS и зависимых модулей с compat-режима на non-compat. Это не финальный план работ, а место для решений и вариантов по группам поведения.

Основа:

| Артефакт | Роль |
|---|---|
| `src/orm/Compat/INVENTORY.md` | Общая инвентаризация compat/non-compat различий и LMS/deps usage. |
| `src/orm/Compat/BEHAVIOR_MATRIX.md` | Детальная матрица поведения по тестам. |
| `src/orm/Compat/MIGRATION_OPTIONS.md` | Варианты миграции и ограничения целевого API. |
| `src/orm/Compat/MISALIGNMENTS.md` | Decision-ready список несовпадений с рекомендациями. |
| `src/orm/Compat/REFACTORING_EXAMPLES.md` | Before/after примеры для решений “не переносить, рефакторить”. |

## Принятые ограничения

| Ограничение | Смысл |
|---|---|
| Non-compat уже используется в других проектах | Существующее non-compat API можно наращивать, но проблематично менять или сокращать. Любое изменение текущей semantics существующего метода считается потенциально breaking. |
| Path-first overloads не являются целевым API | Формы `set(path, value)`, `get(path)`, `del(path)`, `push(path, value)`, `stringInsert(path, ...)` и аналогичные overloads не переносим как постоянную часть non-compat API. |
| `.at()` и `.scope()` не являются целевым API | Эти cursor helpers могут существовать во временном adapter/shim, но целевая миграция должна уходить на explicit child traversal. |
| Новые методы должны быть current-signal methods | Если нужен новый API, предпочтительная форма: `$signal.method(value)`, без первого path-аргумента. Пример: `$signal.setReplace(value)`. |
| Compat можно использовать как временный migration layer | Часть legacy API может жить во временном adapter-е, но не должна задавать форму целевого non-compat API. |

## Целевая форма вызовов

| Legacy compat форма | Целевая non-compat форма |
|---|---|
| `model.get('a.b')` | `model.a.b.get()` |
| `model.peek('a.b')` | `model.a.b.peek()` |
| `model.set('a.b', value)` | `model.a.b.set(value)` или `model.a.b.setReplace(value)` |
| `model.setDiff('a.b', value)` | `model.a.b.setDiff(value)` |
| `model.setDiffDeep('a.b', value)` | `model.a.b.setDiffDeep(value)` |
| `model.setEach('a.b', object)` | `model.a.b.setEach(object)` |
| `model.del('a.b')` | `model.a.b.del()` |
| `model.push('a.b', item)` | `model.a.b.push(item)` |
| `model.stringInsert('a.b', index, text)` | `model.a.b.stringInsert(index, text)` |
| `model.at('a.b')` | `model.a.b` |
| `model.scope('a.b')` | Явный traversal от root signal. |

## API evolution rules

| Правило | Почему |
|---|---|
| Не менять semantics существующего `Signal.set(value)` без отдельного breaking migration | В non-compat он уже используется в других проектах. Изменение `set` на compat-like replace может сломать reactivity и ожидания local/private object updates. |
| Добавлять explicit методы вместо overloads | Новый метод с одной понятной ответственностью проще типизировать, тестировать и мигрировать. |
| Не добавлять path overloads в новые методы | Иначе non-compat снова начнёт наследовать Racer-like cursor model, от которого планируется уйти. |
| Разделять permanent API и migration adapter | LMS может временно нуждаться в legacy surface, но это не означает, что он должен становиться core API. |
| Для зависимых модулей учитывать runtime usage отдельно | Даже если LMS переписан, `@startupjs/*` и `@dmapper/*` могут продолжать требовать legacy compat behavior. |

## `set` / `setReplace`

Идея: добавить в non-compat явный `setReplace(value)` как аналог compat `set(value)` для случаев, где нужна replacement semantics на текущем signal.

| Вопрос | Рабочая позиция |
|---|---|
| Менять ли `Signal.set(value)` в non-compat? | Нет, по умолчанию не менять. Это существующий API для других проектов. |
| Добавлять ли `Signal.setReplace(value)`? | Да, как explicit current-signal method для replacement semantics. |
| Нужен ли `setReplace(path, value)`? | Нет как целевой API. Для migration можно временно закрывать adapter-ом, но core method должен быть `setReplace(value)`. |
| Что делает `setReplace(undefined)` на local/private? | Сохраняет explicit `undefined` по local/private Racer-like semantics. |
| Что делает `setReplace(undefined)` на public doc/subpath? | Public subpath нормализует `undefined` в `null`; whole public doc `undefined` удаляет документ. |
| Нужен ли `setReplace` в compat? | Имеет смысл добавить как alias/explicit API, чтобы migration code мог одинаково работать в обоих режимах. |

## Группы поведения и варианты

| Группа | Потенциальный permanent non-compat API | Временный adapter/shim | Refactor callers |
|---|---|---|---|
| Replace writes | `setReplace(value)` | `set(path, value)` -> resolve path -> `setReplace(value)` | Переписать на child traversal и `setReplace`. |
| `setDiff` | `setDiff(value)` без path overload. | `setDiff(path, value)` adapter. | Переписать на child traversal. |
| `setDiffDeep` | `setDiffDeep(value)` без path overload. | `setDiffDeep(path, value)` adapter. | Переписать на child traversal. |
| `setEach` | `setEach(object)` без path overload. | `setEach(path, object)` adapter. | Проверить, где можно заменить на explicit per-key operations, а где нужен именно `setEach`. |
| Getters with path | Не добавлять. | `get(path)` / `peek(path)` adapter. | Переписать на child traversal. |
| Array/string/increment path overloads | Не добавлять. | Path-first adapter для legacy modules. | Переписать на child traversal. |
| `.at()` / `.scope()` | Не добавлять как target API. | Adapter на время migration. | Переписать на direct child traversal/root traversal. |
| `query()` / imperative subscribe/fetch | Signal-level helpers are removed; transport-level fetch mode lives in `sub(..., { mode: 'fetch' })`. Query result materialization is shared between modes. | Adapter only for remaining readiness gaps, not for public `.fetch()` API. | Переписать server/client flows на non-compat query primitives. |
| `ref/removeRef/refExtra/refIds` | Неочевидно; это отдельная legacy data-binding модель. | Adapter вероятно нужен для LMS/deps на переходный период. | Заменять на явные derived state/subscriptions там, где возможно. |
| `$root.start/$root.stop` | Не переносить как есть без отдельного дизайна. | Adapter для virtual fields/stages. | Переписать virtual state на явные observers/computed flows. |
| Model events / `silent` | Не переносить как core без отдельного решения. | Adapter, если legacy listeners остаются. | Заменять на explicit subscriptions/reactions/domain events. |
| `root.connection` / `close(callback)` | Возможно оставить в server adapter, не как общий signal API. | Adapter для rich-text/server/worker deps. | Перевести callers на explicit connection/root lifecycle APIs. |
| `_id/id` identity fields | Default не менять: `['_id']`. Для LMS включить runtime `idFields: ['_id', 'id']` как migration bridge. | Единая policy для compat/noncompat без массовой LMS-миграции. | Позже можно постепенно переписать callers на `_id` и убрать `id` из runtime config. |

## Зоны, где нельзя механически заменить на base API

| Legacy behavior | Почему простая замена опасна |
|---|---|
| `setEach(object)` -> `assign(object)` | `setEach` ставит `null`/`undefined` как значения по compat semantics; `assign` удаляет поля при `null`/`undefined`. |
| `set(path, object)` -> child `.set(object)` | Для local/private base `.set(object)` может использовать internal deep diff. Если caller ожидает строго replace, нужен `setReplace(object)`. |
| Public `undefined` writes | Local `undefined` и public `undefined` ведут себя по-разному: local сохраняет `undefined`, public normalizes to `null`. |
| `query.subscribe()` -> обычный `sub()` | Compat imperative query waits for full materialization and dense docs; обычная lifecycle semantics может отличаться. |
| `ref` -> direct assignment | Compat refs двусторонние, batch-aware и могут mirror-ить query extra/aggregation rows. Direct assignment не эквивалентен. |
| `start` -> simple computed value | Compat `start` сохраняет child signal reactivity, deep source mutations, sparse arrays и null-normalized public sync. |
| Model events -> custom events | Compat model `change/all` привязаны к data mutations и pattern captures; custom events не заменяют это автоматически. |

## Открытые решения

| Тема | Что решить |
|---|---|
| Path overload adapters for mutators | Насколько долго держать временный adapter для `setDiff(path, value)`, `setDiffDeep(path, value)`, `setEach(path, object)`. |
| Query adapter lifespan | Насколько долго сохранять Racer-like imperative query API для LMS/deps. |
| Refs/start/model events | Переносить частями, держать adapter, или переписывать LMS flows. |
| Dependent modules | Какие legacy APIs нужны не LMS напрямую, а `@startupjs/*` и `@dmapper/*`. |
