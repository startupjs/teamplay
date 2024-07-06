# $ (Root Signal)

The root signal `$` is the entry point for accessing all your data in TeamPlay. It represents the root of your data tree and allows you to navigate through your collections and documents using dot notation.

## Usage

```javascript
$.collectionName.documentId.field
```

## Examples

### Accessing a public collection

```javascript
const $users = $.users
```

### Accessing a specific document in a collection

```javascript
const $user = $.users.userId
```

### Accessing a field in a document

```javascript
const $userName = $.users.userId.name
```

### Accessing a private collection

```javascript
const $sessionData = $._session
```

## Simplifications

### Private '_session' Collection

For convenience, TeamPlay allows you to access the private '_session' collection without the underscore:

```javascript
// These are equivalent:
const $sessionData1 = $._session
const $sessionData2 = $.session
```

This simplification makes it easier to work with session data without constantly typing the underscore.

### Destructuring Assignment Simplification

When destructuring properties from a signal object, TeamPlay provides a convenient shorthand for properties starting with '$'. The '$' is automatically removed from the property name:

```javascript
const { $name, $age } = $({ name: 'John', age: 20 })

// This is equivalent to:
const { name: $name, age: $age } = $({ name: 'John', age: 20 })
```

This simplification allows for more concise and readable code when working with multiple signals from an object.

## Notes

- Public collections typically start with a lowercase letter (e.g., `users`, `posts`).
- Private collections start with an underscore or dollar sign (e.g., `_session`, `$page`).
- The root signal is available globally in your application after setting up TeamPlay.
- Remember that accessing a signal doesn't fetch or subscribe to the data. To actually retrieve or subscribe to the data, you need to use methods like `.get()` or the `sub()` function.
- If you need to access an actual property named '$', use '$$' instead. For example:
  ```javascript
  const { $$specialProp } = $({ $specialProp: 'value' })
  ```
  This is a rare case and is only needed if your data actually contains properties starting with '$'.
