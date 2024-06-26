# Teamplay Backend

> Create a new ShareDB backend instance

## Installation

```sh
yarn add @teamplay/backend
```

## Requirements

## Configuration

The package can be configured using the following environment variables:

- `MONGO_URL`: Specifies the URL for the MongoDB connection. MongoDB is used as the primary database unless overridden by setting `NO_MONGO` to `true`.
- `NO_MONGO`: When set to `true`, this variable disables the use of MongoDB. In this case, the package will utilize a Mingo database, persisting data to SQLite.
- `DB_PATH`: Defines the file path for the SQLite database. This setting is relevant when `NO_MONGO` is `true`. If `DB_PATH` is not specified, the default file 'sqlite.db' will be used.
- `DB_LOAD_SNAPSHOT`: An optional variable that can be set with a path to a SQLite snapshot file. This setting is relevant when `NO_MONGO` is `true`. If provided, the SQLite database will be initialized from this snapshot.
- `DB_READONLY`: Set to `true` to disable persistence to SQLite.
- `REDIS_URL`: URL for the Redis connection.
- `NO_REDIS`: Set to `true` to use a mocked Redis client.

### Database Initialization

The backend toggles between MongoDB and Mingo for database operations, influenced by environment settings:

- **MongoDB**: Used when `MONGO_URL` is set and `NO_MONGO` is `false`.
- **Mingo and SQLite**: Activated by setting `NO_MONGO` to `true`. Mingo handles operations, while SQLite is used solely for data persistence, initialized from `DB_PATH` if provided.
- **SQLite Snapshot**: When `DB_LOAD_SNAPSHOT` is set, SQLite is initialized with this pre-populated data snapshot and pulls data to Mingo.

This setup ensures flexibility in database management based on environment configurations.
Data persistence can be disabled by setting `DB_READONLY` to `true`.

### Cloning Existing SQLite Snapshots

In scenarios where there is a need to create new SQLite database snapshots based on existing ones, the combination of `DB_LOAD_SNAPSHOT` and `DB_PATH` environment variables can be effectively utilized for cloning. This feature is particularly useful for initializing new environments or testing purposes.

To clone an existing snapshot, set `DB_LOAD_SNAPSHOT` to the path of the existing snapshot file (e.g., `snapshot.db`) and specify a new file name in `DB_PATH` for the cloned database (e.g., `clone-snapshot.db`).

For example:
```bash
NO_MONGO=true DB_LOAD_SNAPSHOT=snapshot.db DB_PATH=clone-snapshot.db startupjs server
```

Upon server initialization with these settings, the system will clone the data from `snapshot.db` into a new database file named `clone-snapshot.db`. Subsequently, the server will continue operations using the new `clone-snapshot.db` as its database source. This cloning process provides a seamless way to replicate and utilize existing database states in new instances.

## Usage

To use the backend package in your StartupJS project, import and initialize it as follows:

```js
import getBackend from '@teamplay/backend'

export default async function runServer () {
  const backend = await getBackend(options)
  // ...
}
```

where `options` are:

- `pollDebounce`: the minimum delay between subsequent database polls. It is used individually for each collection in the database. This is used to batch updates and reduce load on the database.

## License

MIT

(c) Decision Mapper - http://decisionmapper.com
