# TeamPlay Agent Notes

TeamPlay is a full-stack signal ORM built on top of ShareDB. The main user-facing API is the object-tree signal model: `$`, `$.collection[id]`, `sub()`, `useSub()`, and `Signal<SchemaType>`.

Before making nontrivial changes, read:

- [architecture.md](./architecture.md) for the monorepo layout and runtime architecture.
- [typing-architecture.md](./typing-architecture.md) for the TypeScript and generated type architecture.
- [tasks.md](./tasks.md) for the current backlog, known priorities, and verification guidance. Treat it as context unless the user explicitly asks you to work through backlog items.

Basic working rules:

- Preserve public runtime APIs and the object-tree UX unless the user explicitly asks for a product change.
- Prefer small, focused changes with nearby tests. Run focused tests while iterating and broader tests before commits.
- Keep runtime behavior and TypeScript behavior aligned; update the architecture docs when the direction changes.
- Work only in this project. Neighboring folders mentioned in old notes are not available in this environment.
- The TS-authored packages (`teamplay`, `@teamplay/schema`, and `@teamplay/utils`) publish compiled `dist/` files but use the `teamplay-ts` export condition for source during development. When running hand-written Node checks against workspace packages, pass `-C teamplay-ts` (or `--conditions=teamplay-ts`) so Node resolves the current `src/` files instead of the generated `dist/` files.
