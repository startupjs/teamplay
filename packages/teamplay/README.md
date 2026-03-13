# TeamPlay

> Full-stack signals ORM with multiplayer

Features:

- signals __*__
- multiplayer __**__
- ORM
- auto-sync data from client to DB and vice-versa __***__
- query DB directly from client __***__
- works in pure JS, on server (Node.js) and integrates with React

> __*__ deep signals -- with support for objects and arrays\
> __**__ concurrent changes to the same data are auto-merged using [OT](https://en.wikipedia.org/wiki/Operational_transformation)\
> __***__ similar to Firebase but with your own MongoDB-compatible database

## Installation

For installation and documentation see [teamplay.dev](https://teamplay.dev)

## ORM Compat Helpers

For legacy Racer-style model mixins (for example versioning libraries which call
`getAssociations()`), use ORM compat helpers from the `teamplay/orm` subpath:

```js
import BaseModel, { hasMany, hasOne, belongsTo } from 'teamplay/orm'
```

These helpers attach class-level associations and expose them through
`$doc.getAssociations()` on model signals.

## License

MIT
