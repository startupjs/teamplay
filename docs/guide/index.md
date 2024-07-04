# Introduction

TeamPlay is a powerful and easy-to-use ORM (Object-Relational Mapping) that allows you to work with your data in a natural, dot-notation style. It's designed to make data management in your app seamless and intuitive.

## Features

- **Signals**: Deep signals with support for objects and arrays
- **Multiplayer**: Concurrent changes to the same data are auto-merged using [Operational Transformation](https://en.wikipedia.org/wiki/Operational_transformation)
- **ORM**: Intuitive Object-Relational Mapping for your data
- **Auto-sync**: Seamless synchronization between client and database
- **Client-side Querying**: Query your database directly from the client
- **Versatile**: Works in pure JS, on server (Node.js), and integrates with React

TeamPlay offers functionality similar to Firebase but allows you to use your own MongoDB-compatible database.

## The Big Idea: Deep Signals

At the heart of TeamPlay is the concept of "deep signals." Think of your entire data structure as a big tree. With TeamPlay, you can navigate this tree using simple dot notation, just like you would access properties in a JavaScript object.

For example, to access a user's name, you might write:

```js
$.users[userId].name
```

This creates a "signal" pointing to that specific piece of data. Signals are smart pointers that know how to get and set data, and they automatically update your app when the data changes.

Continue reading to learn more about how to use TeamPlay in your applications.
