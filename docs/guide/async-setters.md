# Asynchronous Setters and Data Synchronization

In TeamPlay, operations that modify data (like `.set()` and `.del()`) are asynchronous. This means they return promises that resolve when the data has been successfully synced with the server. This design ensures that your client-side data stays consistent with the server-side data.

## Why Setters are Asynchronous

Asynchronous setters allow TeamPlay to:

1. Confirm that data changes have been successfully saved on the server.
2. Handle any potential network issues or conflicts.
3. Ensure that all clients have the most up-to-date data.

## Awaiting Setters

While TeamPlay automatically handles data synchronization in most cases, there might be situations where you need to ensure a specific operation has completed before proceeding. In these cases, you can await the setter operations:

```javascript
const updateUser = async () => {
  await $user.name.set('New Name')
  console.log('Name updated and synced with server!')
  // Proceed with operations that depend on the updated name
}
```

## Best Practices

1. In most cases, you don't need to await setters in React components. TeamPlay and React will handle updates and re-renders automatically.

2. Await setters when you have logic that depends on the updated data being saved to the server.

3. In React event handlers or effects where you're performing multiple operations, consider awaiting setters to ensure operations happen in the correct order:

```javascript
const handleFormSubmit = async (event) => {
  event.preventDefault()
  await $user.name.set(newName)
  await $user.email.set(newEmail)
  navigate('/profile')  // Only navigate after both updates are complete
}
```

By understanding and properly using asynchronous setters, you can ensure your application maintains data consistency and responds correctly to user actions.
