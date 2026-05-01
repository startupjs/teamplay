# Access Control

Access control defines which ShareDB operations are allowed for a collection. Access files are server-only model files and are removed from client bundles by the TeamPlay Babel plugin.

## Define Rules

Access rules live in `access.ts`:

```ts
// models/users/access.ts
import { accessControl } from 'teamplay'

export default accessControl({
  read: ({ session }) => Boolean(session.userId),
  create: ({ session }) => Boolean(session.userId),
  update: ({ session, doc }) => session.userId === doc.id,
  delete: false
})
```

The object can contain four keys:

- `create`: controls new document creation.
- `read`: controls reading existing documents.
- `update`: controls writes to existing documents.
- `delete`: controls document deletion.

Each rule can be:

- `true`: always allow the operation.
- `false`: deny the operation.
- omitted: deny the operation.
- a function: decide from the operation context.
- `{ fn }`: ShareDB access validator object form.

Validator functions can return a boolean or a promise resolving to a boolean.

## Rule Contexts

`create` receives the new document:

```ts
create: ({ type, newDoc, collection, docId, session }) => {
  return Boolean(session.userId && newDoc.name)
}
```

Shape:

```ts
{
  type: 'create'
  newDoc: User
  collection: string
  docId: string
  session: { userId?: string }
}
```

`read` receives the existing document:

```ts
read: ({ doc, session }) => {
  return doc.public || doc.ownerId === session.userId
}
```

Shape:

```ts
{
  type: 'read'
  doc: User
  collection: string
  docId: string
  session: { userId?: string }
}
```

`update` receives the document before and after the operation, plus raw ShareDB ops:

```ts
update: ({ doc, newDoc, ops, session }) => {
  return doc.ownerId === session.userId && newDoc.ownerId === doc.ownerId
}
```

Shape:

```ts
{
  type: 'update'
  doc: User
  newDoc: User
  ops: unknown[]
  collection: string
  docId: string
  session: { userId?: string }
}
```

`delete` receives the existing document:

```ts
delete: ({ doc, session }) => {
  return doc.ownerId === session.userId
}
```

Shape:

```ts
{
  type: 'delete'
  doc: User
  collection: string
  docId: string
  session: { userId?: string }
}
```

## Document And Session Types

The first generic is the document shape. The second generic is the session shape.

```ts
import { accessControl } from 'teamplay'
import type User from './schema.ts'

interface Session {
  userId?: string
  role?: 'admin' | 'member'
}

export default accessControl<User, Session>({
  read: ({ doc, session }) => {
    return doc.public || doc.ownerId === session.userId || session.role === 'admin'
  },
  create: ({ newDoc, session }) => {
    return Boolean(session.userId && newDoc.name)
  },
  update: ({ doc, newDoc, session }) => {
    if (session.role === 'admin') return true
    return doc.ownerId === session.userId && newDoc.ownerId === doc.ownerId
  },
  delete: ({ doc, session }) => {
    return session.role === 'admin' || doc.ownerId === session.userId
  }
})
```

If you omit the session generic, `session` defaults to:

```ts
{ userId?: string }
```

## Custom Rule Values

If your ShareDB access setup uses a custom validator that accepts extra rule values, pass the third generic:

```ts
export default accessControl<User, Session, 'admin' | 'owner'>({
  read: 'owner',
  delete: 'admin'
})
```

Only use this when your backend access validator is configured to understand those values.

## Client Security

Access rules should stay server-only. The TeamPlay Babel plugin removes `accessControl()` calls from client bundles:

```ts
export default undefined
```

This lets client code import the same file graph without bundling authorization logic.
