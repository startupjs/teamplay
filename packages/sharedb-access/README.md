## @teamplay/sharedb-access

### Install

```
yarn add @teamplay/sharedb-access
```

### Usage

```js
const shareDbAccess = require('@teamplay/sharedb-access')
new shareDbAccess(backend, options)
```

### Parameters

`options (Object)`:
* `backend`: your ShareDB backend instance
* `options (optional)`:
  * `dontUseOldDocs`: if `true` then don't save unupdated docs for update action. **Default**: `false`.
  * `opCreatorUserIdPath`: path to `userId` for op's meta
  * `readGrantsLimit`: how many documents a connection is remembered to be allowed to read (see "Reads through ops" below). **Default**: `10000`.


Using `sharedb-access` you can control `create`, `read`, `update`, and `delete` database operation for every collection. You can use two types of rules: `allow` and `deny`. By default all operations are denied. So, you should add some rules to allow them. If at least one `allow` rule allows the write, and no `deny` rules deny the write, then the write is allowed to proceed.

You can call `allow` and `deny` rules as many times as you like. The functions should return `true` if they think the operation should be allowed for `allow` rules and denied for `deny` rules. Otherwise they should return `false`, or nothing at all (`undefined`).

#### Create

```js
// Allow create-operation for collection 'items'

// docId - id of your doc for access-control
// doc   - document object
// session - your connect session

backend.allowCreate('items', async (docId, doc, session) => {
  return true
})

// Deny creation if user is not admin
backend.denyCreate('items', async (docId, doc, session) => {
  return !session.isAdmin
})

// So, finally, only admins can create docs in 'items' collection
// the same results is if you just write:

backend.allowCreate('items', async (docId, doc, session) => {
  return session.isAdmin
})
```
#### Read

Interface is like `create`-operation

```js
backend.allowRead('items', async (docId, doc, session) => {
  // Allow all operations
  return true
})

backend.denyRead('items', async (docId, doc, session) => {
  // But only if the reader is owner of the doc
  return doc.ownerId !== session.userId
})
```

##### Reads through ops

A client also gets a document's data as ops: when it fetches or subscribes from a version (a reconnect, a refetch), resubscribes a query with the versions of its results, or submits an op that is transformed against ops it had not seen. The `read` rules apply there too, to the document as it is now:

* a fetch or subscribe from a version is refused like a snapshot read; in a bulk request only the refused documents get the error;
* a query resubscribe is not refused: documents of its results the client may no longer read are resubscribed from their current version, so it gets none of their ops;
* an op of a document the connection was allowed to read passes at once (live updates cost nothing extra); any other document is checked once against its current snapshot;
* a deletion carries no data and always passes; a deleted document's earlier ops are judged by its last state before the deletion, never by its empty state (a rule may well pass an empty document).

A document a connection was allowed to read stays readable to it, with its live updates, until it reads the document again and is refused, or reconnects.

Every message is checked before ShareDB handles it, so its shape is checked here too: a fetch or subscribe version, a bulk request (an array of ids, or a versions map), a query resubscribe's results and a snapshot fetch's id must be in the form ShareDB's client sends them (string ids with no duplicates in a bulk array, non-negative integer versions, real arrays). Any other shape is refused with `ERR_MESSAGE_BADLY_FORMED` rather than passed on: ShareDB's own check leaves some of these unvalidated (a bulk `b` beyond `typeof === 'object'`, so a bulk unsubscribe with a huge `length` would loop and a duplicated id would leak a stream; the snapshot-fetch id not at all, so an operator object would reach the database as a query), and it reads array-likes and strings as lists too. A doc id may not be `length`, `prototype`, `__proto__` or an `Object.prototype` name, nor may a versions map be array-like (a numeric `length`): ShareDB builds maps and runs iterators over these ids, so one would turn a one-doc request into an N-length loop. A client write (create, op, delete) to such an id is refused the same way, since that doc could never be read back. A reading request without a collection name (or with one ShareDB refuses, such as `__proto__`) is refused with `ERR_ACCESS_DENY_READ` before anything is read. The work a request costs is linear in its size; bound the size of the messages your transport accepts (`maxMessageSize` of `@teamplay/channel`, 16 MiB by default).

A connection's messages reach ShareDB in the order they came, also while some of them wait for this check.

When one of these checks cannot be made (the database fails, a rule throws), the request or the op is refused with `ERR_ACCESS_CHECK_FAILED`; the cause is logged on the server (`console.error`), never sent to the client. The log line ShareDB writes for a refused live op names the op without its content.

#### Delete

Interface is like `create`-operation

```js
backend.allowDelete('items', async (docId, doc, session) => {
  // Only owners can delete docs
  return doc.ownerId === session.userId
})

backend.denyDelete('items', async (docId, doc, session) => {
  // But deny deletion if it's a special type of docs
  return doc.type === 'liveForever'
})
```

#### Update

```js
// docId - id of your doc for access-control
// oldDoc  - document object (before update)
// session - your connect session
// ops    - array of OT operations
// newDoc  - document object (after update)

const allowUpdateAll = async (docId, oldDoc, session, ops, newDoc) => {
  return true
}

backend.allowUpdate('items', allowUpdateAll);
```

## MIT License 2020
