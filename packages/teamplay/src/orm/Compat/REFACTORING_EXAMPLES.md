# Примеры рефакторинга compat API

Документ показывает целевые формы вызовов для случаев, где принято не переносить legacy path-first API в permanent non-compat core.

## Path getters

```js
// Было
const userId = model.get('_session.userId')
const url = $root.get('$render.url')

// Цель
const userId = model._session.userId.get()
const url = $root.$render.url.get()
```

Для dynamic id:

```js
// Было
const $class = model.at(`classes.${classId}`)
const name = model.get(`users.${userId}.name`)

// Цель
const $class = model.classes[classId]
const name = model.users[userId].name.get()
```

Для полностью dynamic path на переходный период допустим локальный helper/codemod, но не permanent core API:

```js
function child ($signal, segments) {
  return segments.reduce(($cursor, segment) => $cursor[segment], $signal)
}

const $target = child($root, pathSegments)
```

## Path setters

```js
// Было
await $store.set('startedAt', Date.now())
await $course.set('reportIds', reportIds)

// Если нужна обычная non-compat set semantics
await $store.startedAt.set(Date.now())

// Если caller ожидает compat replace semantics
await $course.reportIds.setReplace(reportIds)
```

Object replace:

```js
// Было: compat replace target object
await $settings.set('aiBot', nextAiBot)

// Цель
await $settings.aiBot.setReplace(nextAiBot)
```

Важно: не заменять автоматически на `.set(nextAiBot)`, если stale keys должны быть удалены именно replace-семантикой.

## `setDiff`

```js
// Было
$root.setDiff('$render.url', url)
$user.setDiff('tenantId', tenantId)

// Цель, если будет добавлен current-signal API
$root.$render.url.setDiff(url)
$user.tenantId.setDiff(tenantId)
```

Если `setDiff(value)` не добавлять, эквивалент надо писать явно:

```js
if ($user.tenantId.peek() !== tenantId) {
  await $user.tenantId.setReplace(tenantId)
}
```

## `setDiffDeep`

```js
// Было
$root.setDiffDeep('$render.params', params)
await $override.setDiffDeep('value', val)
await $description.setDiffDeep('', descriptionCopy)

// Цель
$root.$render.params.setDiffDeep(params)
await $override.value.setDiffDeep(val)
await $description.setDiffDeep(descriptionCopy)
```

Пустой path `''` в compat обычно означает текущий signal. В целевом API он исчезает.

## `setEach` не равен `assign`

```js
// Было
await $doc.setEach({ a: 1, b: null, c: undefined })

// Нельзя механически так:
await $doc.assign({ a: 1, b: null, c: undefined })
```

Причина: `assign` удаляет поля с `null`/`undefined`, а compat `setEach` ставит значения по per-key `set` semantics.

Целевой вариант, если нужен compat-like `setEach`:

```js
await $doc.setEach({ a: 1, b: null, c: undefined })
```

Целевой вариант без `setEach`, когда semantics понятна явно:

```js
await Promise.all([
  $doc.a.setReplace(1),
  $doc.b.setReplace(null),
  $doc.c.setReplace(undefined)
])
```

Если нужна deletion-on-nullish semantics, тогда `assign` подходит:

```js
await $doc.assign({ a: 1, b: null, c: undefined })
```

## Array/string mutators

```js
// Было
await $stage.push('fieldIds', fieldId)
await $stage.remove('fieldIds', index, 1)
await $text.stringInsert('value', 0, 'abc')

// Цель
await $stage.fieldIds.push(fieldId)
await $stage.fieldIds.remove(index, 1)
await $text.value.stringInsert(0, 'abc')
```

## `.scope()`

```js
// Было
const $course = this.scope(`courses.${this.get('courseId')}`)
const userId = model.scope().get('_session.userId')

// Цель
const courseId = this.courseId.get()
const $course = this.root().courses[courseId]
const userId = model.root()._session.userId.get()
```

Если `this.root()` не должен быть частью target API для данного класса, нужно передавать root signal явно в model/helper.

## Query flows

Простой query -> ids:

```js
// Было
const $$classes = model.query('classes', { scope: 'course', courseId })
await model.subscribe($$classes)
const classId = $$classes.getIds()[0]
const $class = model.at(`classes.${classId}`)

// Целевой смысл
// 1. Подписаться/получить query через новый query primitive.
// 2. Работать либо с query docs, либо явно подписать нужный doc по id.
const classId = queryIds[0]
const $class = model.classes[classId]
await sub($class)
```

Важно: нельзя полагаться на то, что `getIds()` автоматически materialize-ит docs в collection cache, если target API этого не гарантирует.

Query count / extra:

```js
// Было
const $$tenants = model.query('tenants', { domains: domain, $count: true })
await model.subscribe($$tenants)
const isOccupied = !!$$tenants.getExtra()

// Цель
// Использовать explicit count/extra query primitive или adapter до появления целевого API.
```

## Refs

Session/user ref:

```js
// Было
$session.ref('user', $user)

// Возможная целевая форма
// Явно хранить userId и подписывать user doc там, где он нужен.
await $session.userId.setReplace(userId)
const $user = $root.users[userId]
await sub($user)
```

UI local mirror:

```js
// Было
$localValue.ref($value)

// Возможная целевая форма
// Явная синхронизация через effect/observe с cleanup.
```

Refs не надо заменять direct assignment-ом, если важна bidirectional sync semantics.

## `$root.start/$root.stop`

```js
// Было
$root.start($virtualDoc.path(), $doc, ...deps, getter)
$root.stop($virtualDoc.path())

// Цель
// Отдельный explicit механизм virtual docs:
// - подписка на source/deps;
// - вычисление snapshot;
// - запись в target через setDiffDeep или setReplace;
// - cleanup observer/subscription.
```

Это не простой синтаксический refactor. `start` сохраняет child-signal reactivity, sparse arrays и public null normalization.

## Model events / `silent`

```js
// Было
const listener = $root.on('all', `${$virtualDoc.path()}.**`, handler)
getWritableSignal($doc).setDiffDeep($virtualDoc.getDeepCopy())
$doc.silent().setDiffDeep(nextValue)

// Цель
// Перейти на explicit observe/subscription/domain event.
```

`silent()` имеет смысл только вместе с compat model events. Custom events не являются автоматической заменой `change/all`.

## `root.connection`

```js
// Было
const shareDoc = $root.connection.get('texts', textId)

// Цель
// Использовать explicit connection accessor, переданный в rich-text/editor integration.
const shareDoc = connection.get('texts', textId)
```

На transition можно оставить root adapter, но не стоит делать `.connection` свойством любого signal.

## `close(callback)`

```js
// Было
model.close()
model.close(err => {
  if (err) throw err
})

// Цель
await model.close()
// или explicit root lifecycle helper, если model больше не должен иметь Racer-style close().
```

Для server/cron/deps нужен adapter, потому что таких callsites много.
