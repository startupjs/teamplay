# $() Function

The `$()` function is used to create local, reactive values in TeamPlay. These values are not synchronized with the server but can be used for local state management within your application.

## Syntax

```javascript
$([initialValue])
```

## Parameters

- `initialValue` (optional): The initial value for the signal. Can be of any type.

## Return Value

Returns a signal object that can be used to get and set the value.

## Examples

### Creating a simple value

```javascript
const $count = $(0)
console.log($count.get()) // Outputs: 0
$count.set(5)
console.log($count.get()) // Outputs: 5
```

### Creating a computed value

```javascript
const $firstName = $('John')
const $lastName = $('Doe')
const $fullName = $(() => $firstName.get() + ' ' + $lastName.get())

console.log($fullName.get()) // Outputs: "John Doe"
$firstName.set('Jane')
console.log($fullName.get()) // Outputs: "Jane Doe"
```

### Creating an object with multiple signals

```javascript
const { $name, $age } = $({ name: 'Alice', age: 30 })
console.log($name.get()) // Outputs: "Alice"
console.log($age.get()) // Outputs: 30
```

## Notes

- The `$()` function is typically used for local state that doesn't need to be synchronized with the server.
- When used with a function argument, it creates a computed value that automatically updates when its dependencies change.
- The signals created by `$()` are reactive, meaning that components using these signals will automatically re-render when the values change (when used with the `observer()` HOC).
