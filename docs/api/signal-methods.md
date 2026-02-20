# Signal Methods

TeamPlay signals come with a set of methods for interacting with the data they represent. These methods are available on all signals, whether they're created using `$()`, accessed through the root signal `$`, or returned by `sub()` or `useSub()`.

## get()

Retrieves the current value of the signal.

```javascript
const value = $signal.get()
```

## set(value)

Updates the value of the signal.

```javascript
await $signal.set(newValue)
```

Note: `set()` is asynchronous and returns a Promise.

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

## getId()

Returns the id for the current signal.

```javascript
const id = $.users[userId].getId()
```

## getIds()

Returns document ids for query or aggregation signals.

```javascript
const ids = $activeUsers.getIds()
```

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

- All methods that modify data (`set()`, `del()`, `push()`, `pop()`, `increment()`, `add()`, `assign()`) are asynchronous and return Promises. This ensures data consistency with the server.
- The `get()` method is synchronous and returns the current local value of the signal.
- These methods can be chained on nested signals, e.g., `$.users[userId].name.set('New Name')`.
 - For public documents, the `_id` field is present in `get()` results and matches the document id. Attempts to change `_id` are ignored.
