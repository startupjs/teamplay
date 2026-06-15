# Signal Methods

TeamPlay signals come with a set of methods for interacting with the data they represent. These methods are available on all signals, whether they're created using `$()`, accessed through the root signal `$`, or returned by `sub()` or `useSub()`.

## get()

Retrieves the current value of the signal.

```javascript
const value = $signal.get()
```

## peek()

Retrieves the current value without tracking it for reactive rendering.

```javascript
const value = $signal.peek()
```

## set(value)

Updates the value of the signal.

```javascript
await $signal.set(newValue)
```

Note: `set()` is asynchronous and returns a Promise.

## setReplace(value)

Replaces the current signal value without deep-diffing object or array branches.

```javascript
await $signal.setReplace(nextValue)
```

Use this when stale object keys must be removed by replacing the whole value at the current path.

## setNull(value)

Sets the value only when the current value is `null` or `undefined`.

```javascript
await $settings.theme.setNull('light')
```

If the current value is already non-nullish, `setNull()` is a no-op.

## setDiff(value)

Replaces the current value unless the previous and next values are exactly equal.

```javascript
await $counter.setDiff(1)
await $profile.setDiff({ name: 'Ada' })
```

`setDiff()` is not a recursive diff. Equivalent object and array values still replace the current value; only exact equality (`===`) and `NaN` vs `NaN` are skipped.

## setDiffDeep(value)

Applies a recursive diff below the current signal path.

```javascript
await $profile.setDiffDeep({
  name: 'Ada',
  settings: {
    theme: 'dark'
  }
})
```

Stale object keys are removed recursively. Empty target objects are preserved, so `await $filters.setDiffDeep({})` leaves `$filters.get()` as `{}` rather than `undefined`.

## setEach(object)

Sets multiple object fields with per-key replace semantics.

```javascript
await $user.setEach({
  firstName: 'Ada',
  lastName: 'Lovelace',
  avatar: null
})
```

Unlike `assign()`, `setEach()` does not treat `null` as delete. `null` is stored as `null`. `undefined` follows normal `setReplace()` semantics: private values keep the key with `undefined`, while public document subpaths are normalized to `null`.

## del()

Deletes the value of the signal or removes an item from an array.

```javascript
await $signal.del()
```

Note: `del()` is asynchronous and returns a Promise.

## push(value)

Adds a value to the end of an array signal.

```javascript
await $signal.push(newItem)
```

## unshift(value)

Adds a value to the start of an array signal.

```javascript
await $signal.unshift(newItem)
```

## pop()

Removes and returns the last item from an array signal.

```javascript
const lastItem = await $signal.pop()
```

## shift()

Removes and returns the first item from an array signal.

```javascript
const firstItem = await $signal.shift()
```

## insert(index, values)

Inserts one or more values into an array signal at the specified index.

```javascript
await $signal.insert(2, ['a', 'b'])
```

## remove(index, howMany)

Removes one or more values from an array signal and returns the removed items.

```javascript
const removed = await $signal.remove(1, 2)
```

## move(from, to, howMany)

Moves one or more values within an array signal and returns the moved items.

```javascript
const moved = await $signal.move(0, 2, 1)
```

## increment(value)

Increments a numeric signal by the specified value (or by 1 if no value is provided).

```javascript
await $signal.increment(5)
```

## stringInsert(index, text)

Inserts text into a string value at the specified index.

```javascript
await $signal.stringInsert(3, 'hello')
```

## stringRemove(index, howMany)

Removes a substring from a string value.

```javascript
await $signal.stringRemove(1, 2)
```

## add(value)

Adds a new item to a collection signal, automatically generating a unique ID.

```javascript
const newId = await $signal.add({ name: 'New Item' })
```

`add()` accepts configured identity fields as a provided document ID. It also accepts legacy `id` and `_id` inputs.
If both are provided, they must be equal, otherwise `add()` throws.

## getId()

Returns the usable string id for the document-like value represented by the current signal.

```javascript
const id = $.users[userId].getId()
```

For direct public document signals and query item signals, TeamPlay already knows the document id from the path and returns that id directly. For nested document-like values, private values, and aggregation rows, TeamPlay first checks string `_id` and `id` fields on the current value. If neither exists, it falls back to the string leaf segment of the signal path.

If an explicit `_id` or `id` exists but is not a string, `getId()` returns `undefined`. The root signal and collection signals do not have ids and throw.

## getIds()

Returns usable string ids for query or aggregation signals.

```javascript
const ids = $activeUsers.getIds()
```

For query signals, ids come from the subscribed query metadata. For aggregation signals, ids are read from each row's string `_id` or `id` field. Rows without a usable string id are omitted, so the result is always a `string[]`.

## getExtra()

Returns extra metadata for query signals or rows for aggregation signals.

```javascript
const count = $activeUsers.getExtra()
const rows = $statsAggregation.getExtra()
```

For query signals, this is equivalent to `$query.extra.get()`. For aggregation signals, it returns the same value as `.get()`. For ordinary signals, it returns `undefined`.

## getCopy()

Returns a shallow copy of the current value.

```javascript
const copy = $user.profile.getCopy()
```

Objects and arrays are copied at the top level only; nested objects keep their references.

## getDeepCopy()

Returns a deep copy of the current value.

```javascript
const copy = $user.profile.getDeepCopy()
```

`getDeepCopy()` is useful when preparing an editable draft or snapshot that should not mutate the signal's live value.

## getCollection()

Returns the collection name for the signal.

```javascript
const collection = $.users[userId].getCollection()
```

## parent(levels = 1)

Returns the parent signal. If levels is greater than the path depth, returns the root signal.

```javascript
const $doc = $.users[userId]
const $collection = $doc.parent()
```

## leaf()

Returns the last path segment as a string.

```javascript
const key = $.users[userId].leaf()
```

## path()

Returns the dot-separated path of the signal.

```javascript
const path = $.users[userId].name.path() // 'users.abc123.name'
```

## toString()

Returns a debug label for the signal. Primitive string coercion uses only the path, while `toString()` includes the `Signal` label:

```javascript
String($.users[userId].name)                      // 'users.abc123.name'
$.users[userId].name.toString()                   // '[Signal users.abc123.name]'
Object.prototype.toString.call($.users[userId])   // '[object Signal]'
```

## getAssociations()

Returns association metadata registered on the signal's model class.

```javascript
const associations = $.users[userId].getAssociations()
```

This is mostly useful for model-integration libraries and legacy ORM helpers.

## assign(object)

Assigns multiple properties to a signal at once. This method iterates through the object's own properties and sets or deletes them on the signal.

```javascript
// Set multiple properties at once (adds new properties if they don't exist)
await $user.assign({
  firstName: 'John',
  lastName: 'Smith',
  age: 30
})

// Update existing properties and add new ones, others remain unchanged
await $user.assign({
  age: 31,              // updates existing property
  email: 'john@example.com'  // adds new property
})

// Delete properties by assigning null or undefined
await $user.assign({
  middleName: null,     // deletes middleName
  nickname: undefined   // deletes nickname
})
```

**Behavior:**
- For non-null/undefined values: calls `.set(value)` on the child signal (adds property if it doesn't exist)
- For null/undefined values: calls `.del()` on the child signal
- Only assigns own properties (not inherited ones)
- Returns a Promise that resolves when all operations complete

## Notes

- All methods that modify data (`set()`, `setReplace()`, `setNull()`, `setDiff()`, `setDiffDeep()`, `setEach()`, `del()`, `push()`, `pop()`, `increment()`, `add()`, `assign()`) are asynchronous and return Promises. This ensures data consistency with the server.
- The `get()` method is synchronous and returns the current local value of the signal.
- These methods can be chained on nested signals, e.g., `$.users[userId].name.set('New Name')`.
- For public documents, configured identity fields are present in `get()` results and match the document id. `idFields` defaults to `['_id']`; attempts to change configured identity fields are ignored.
