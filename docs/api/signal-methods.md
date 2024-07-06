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

## pop()

Removes and returns the last item from an array signal.

```javascript
const lastItem = await $signal.pop()
```

## increment(value)

Increments a numeric signal by the specified value (or by 1 if no value is provided).

```javascript
await $signal.increment(5)
```

## add(value)

Adds a new item to a collection signal, automatically generating a unique ID.

```javascript
const newId = await $signal.add({ name: 'New Item' })
```

## Notes

- All methods that modify data (`set()`, `del()`, `push()`, `pop()`, `increment()`, `add()`) are asynchronous and return Promises. This ensures data consistency with the server.
- The `get()` method is synchronous and returns the current local value of the signal.
- These methods can be chained on nested signals, e.g., `$.users[userId].name.set('New Name')`.
