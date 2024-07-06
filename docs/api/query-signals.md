# Query Signals

Query signals in TeamPlay represent the result of a query on a collection. They are created using the `sub()` function or `useSub()` hook with query parameters.

## Creating a Query Signal

```javascript
const $activeUsers = await sub($.users, { status: 'active' })
```

## Properties and Methods

### ids

A signal containing an array of IDs for the documents in the query result.

```javascript
const userIds = $activeUsers.ids.get()
```

### map(callback)

Maps over the documents in the query result.

```javascript
const userNames = $activeUsers.map($user => $user.name.get())
```

### reduce(callback, initialValue)

Reduces the documents in the query result to a single value.

```javascript
const totalAge = $activeUsers.reduce(($user, total) => total + $user.age.get(), 0)
```

### find(predicate)

Finds the first document in the query result that satisfies the predicate.

```javascript
const $firstAdminUser = $activeUsers.find($user => $user.role.get() === 'admin')
```

## Iteration

Query signals are iterable, allowing you to use them in `for...of` loops:

```javascript
for (const $user of $activeUsers) {
  console.log($user.name.get())
}
```

## Notes

- Query signals are reactive. Changes to the underlying data or to the query result will automatically update components using the query signal.
- The documents within a query signal are themselves signals, allowing for nested reactivity.
