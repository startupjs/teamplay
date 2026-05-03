# Usage

This guide will walk you through the basic concepts and usage of TeamPlay.

## Collections

In TeamPlay, data is organized into collections. There are two types:

1. **Public Collections**: These are shared across all users of your app. They typically start with a lowercase letter (e.g., `users`, `posts`).

    - public collections are stored in the DB on the server.
    - you must subscribe to any data from them before you can read or modify it.
    - use them to persist data to the DB and to synchronize it between all users.

2. **Private Collections**: These are specific to each user or session. They start with an underscore (e.g., `_session`).

    - private collections are stored only on the client.
    - use them to store any temporary data which you only need on the current page or in the current client session.

## Basic Operations on Signals

Every signal in TeamPlay comes with a set of useful methods:

- `.get()`: Retrieves the current value of the signal.
- `.set(value)`: Updates the value of the signal.
- `.del()`: Deletes the value (or removes an item from an array).
- `.push(value)`, `.pop()`, `.unshift(value)`, `.shift()`, `.insert(index, values)`, `.remove(index, howMany)`, `.move(from, to, howMany)`: Array mutators.
- `.stringInsert(index, text)`, `.stringRemove(index, howMany)`: String mutators.
- `.increment(value)`: Increments a numeric value.
- `.add(value)`: Adds a new document to a collection and returns its id.
- `.getId()`: Returns the id for a document or aggregation entry.
- `.getIds()`: Returns ids for query or aggregation signals.
- `.getCollection()`: Returns the collection name.

Example:

```javascript
import { $ } from 'teamplay'

// Get a user's name
const name = $.users[userId].name.get()

// Update a user's name
$.users[userId].name.set('Alice')

// Delete a user's profile picture
$.users[userId].profilePicture.del()
```

### `_id` in Public Documents

For public documents, the `_id` field is available in `get()` results and matches the document id. Attempts to set or modify `_id` are ignored.

## The `$()` Function: Creating Local Signals

The `$()` function is a powerful tool for creating local, reactive values:

1. Creating a simple value:

```javascript
import { $ } from 'teamplay'

const $count = $(0)
console.log($count.get()) // Outputs: 0
$count.set(5)
console.log($count.get()) // Outputs: 5
```

2. Creating a computed value (similar to a calculated spreadsheet cell):

```javascript
const $firstName = $('John')
const $lastName = $('Doe')
const $fullName = $(() => $firstName.get() + ' ' + $lastName.get())

console.log($fullName.get()) // Outputs: "John Doe"
$firstName.set('Jane')
console.log($fullName.get()) // Outputs: "Jane Doe"
```

## The `sub()` Function: Subscribing to Data

The `sub()` function is used to subscribe to data from the server:

1. Subscribing to a single document:

```javascript
import { $, sub } from 'teamplay'

const $user = await sub($.users[userId])
console.log($user.name.get())
```

2. Subscribing to a query (multiple documents):

```javascript
const $activeUsers = await sub($.users, { status: 'active' })
```

### Working with Query Signals

Query signals are special. They behave like a collection signal, but they're also iterable:

```javascript
// Iterate over active users
for (const $user of $activeUsers) {
  console.log($user.name.get())
}

// Or use array methods
const names = $activeUsers.map($user => $user.name.get())
```

Each `$user` in the loop is a scoped signal for that specific user document.

## Reactivity: Keeping Your App in Sync

TeamPlay's reactivity system ensures that whenever data changes, any part of your app using that data updates automatically. This happens behind the scenes, so you don't have to manually track and update data dependencies.

For example, if you're displaying a user's name in your app and that name changes in the database, TeamPlay will automatically update your app's UI to reflect the new name.

This reactivity works for both public and private collections, local signals created with `$()`, and subscribed data from `sub()`.

By using these tools and concepts, you can build powerful, real-time applications with ease using TeamPlay!
