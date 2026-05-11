# Schemas

Schemas describe collection document shape. TeamPlay uses them for backend validation and TypeScript inference.

## Define A Schema

Create one `schema.ts` per collection:

```ts
// models/users/schema.ts
import { defineSchema } from 'teamplay'

export default defineSchema({
  name: {
    type: 'string',
    required: true,
    label: 'Name',
    description: 'Public display name'
  },
  email: { type: 'string' },
  active: { type: 'boolean' },
  createdAt: { type: 'number', required: true }
})
```

`defineSchema()` currently returns the schema unchanged at runtime. It marks the schema as intentionally defined and gives TypeScript the best literal inference without needing `as const`.

Plain exported schema objects still work for backward compatibility, but `defineSchema()` is the conventional form.

## Document Type

The generated `teamplay-env.d.ts` makes the schema module's default export usable as the document type:

```ts
import type User from './models/users/schema.ts'
import { Signal } from 'teamplay'

class UserModel extends Signal<User> {
  displayName () {
    return this.name.get()
  }
}
```

You can still use `FromJsonSchema` manually when needed:

```ts
import { type FromJsonSchema } from 'teamplay'
import schema from './models/users/schema.ts'

type User = FromJsonSchema<typeof schema>
```

## Validation

Enable schema validation on the backend:

```ts
import { createBackend } from 'teamplay/server'

const backend = createBackend({
  validateSchema: true
})
```

Stored documents should be JSON-compatible: strings, numbers, booleans, nulls, arrays, and plain objects. Prefer `Date.now()` numbers over `Date` instances.

## Private Root Schemas

Public collection schemas describe one document in a database collection. Private root schemas are different: they describe the whole private value.

```ts
// models/_session/schema.ts
import { defineSchema } from 'teamplay'

export default defineSchema({
  userId: { type: 'string' },
  banner: {
    type: 'object',
    properties: {
      visible: { type: 'boolean' }
    }
  }
})
```

This makes `$._session`, `$.session`, and `$.$session` typed:

```ts
$._session.userId.get()       // string | undefined
$.session.banner.visible.get() // boolean | undefined
```

Private schemas are used for TypeScript and editor field metadata only. They are skipped by backend JSON-schema validation because private collections live on the client and are not stored as shared database collections.

## Simplified Schema

Most TeamPlay apps use simplified schemas. If the root schema does not have `type: 'object'`, TeamPlay treats the top-level object as the collection document's properties:

```ts
export default defineSchema({
  title: { type: 'string', required: true },
  description: { type: 'string' },
  properties: {
    type: 'object',
    properties: {
      color: { type: 'string' }
    }
  }
})
```

That means fields can be named `title`, `description`, `type`, `required`, `properties`, and other JSON Schema keywords.

## Full JSON Schema

Use full JSON Schema when you need root-level JSON Schema keywords:

```ts
export default defineSchema({
  type: 'object',
  required: ['title'],
  properties: {
    title: { type: 'string' },
    description: { type: 'string' }
  }
})
```

## Labels And Descriptions

The type generator reads simple schema files and adds JSDoc for signal fields when it can statically find literal `label` and `description` values:

```ts
export default defineSchema({
  name: {
    type: 'string',
    label: 'Name',
    description: 'Public display name'
  }
})
```

Then editor suggestions for `$user.name` and `$user.$name` can show the schema text.

This is best-effort. If the schema is built dynamically, TeamPlay still infers the document shape from TypeScript, but field JSDoc may be skipped.
