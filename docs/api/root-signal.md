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

## Notes

- Public collections typically start with a lowercase letter (e.g., `users`, `posts`).
- Private collections start with an underscore (e.g., `_session`).
- The root signal is available globally in your application after setting up TeamPlay.

Remember that accessing a signal doesn't automatically fetch or subscribe to the data. To actually get the data you have to first subscribe to it with `sub()` function and then get it from the signal with `.get()`.
