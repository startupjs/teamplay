# sub() Function

The `sub()` function is used to subscribe to data from the server in TeamPlay. It can be used to subscribe to individual documents or to query multiple documents.

## Syntax

```javascript
sub(signal, [queryParams])
```

## Parameters

- `signal`: A signal representing the collection or document to subscribe to.
- `queryParams` (optional): An object containing query parameters when subscribing to multiple documents.

## Return Value

Returns a Promise that resolves to a signal representing the subscribed data.

## Examples

### Subscribing to a single document

```javascript
const $user = await sub($.users[userId])
console.log($user.name.get())
```

### Subscribing to a query (multiple documents)

```javascript
const $activeUsers = await sub($.users, { status: 'active' })
```

## Notes

- The `sub()` function is asynchronous and returns a Promise.
- When used in React components, it's recommended to use the `useSub()` hook instead, which handles the asynchronous nature of subscriptions in a React-friendly way.
- Subscribed data is automatically kept in sync with the server.
