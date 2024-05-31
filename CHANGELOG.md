# v0.1.7 (Fri May 31 2024)

#### 🐛 Bug Fix

- `@teamplay/backend`, `teamplay`
  - fix: use older uuid version which does not depend on the crypto module (RN does not have it) ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.1.6 (Fri May 31 2024)

#### 🐛 Bug Fix

- `teamplay`
  - fix(teamplay): mock WeakRef and FinalizationRegistry to work in Expo ([@cray0000](https://github.com/cray0000))

#### ⚠️ Pushed to `master`

- `@teamplay/backend`, `@teamplay/cache`, `@teamplay/channel`, `@teamplay/debug`, `@teamplay/schema`, `@teamplay/server-aggregate`, `@teamplay/sharedb-access`, `@teamplay/sharedb-schema`, `teamplay`, `@teamplay/utils`
  - chore: add .npmignore to all packages with CHANGELOG.md ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# (Mon May 27 2024)

#### 🚀 Enhancement

- `@teamplay/backend`, `@teamplay/schema`, `@teamplay/server-aggregate`, `@teamplay/sharedb-access`, `@teamplay/sharedb-schema`, `teamplay`, `@teamplay/utils`
  - feat: move backend implementation from startupjs. Add an example app. ([@cray0000](https://github.com/cray0000))

#### ⚠️ Pushed to `master`

- chore: add name to example app ([@cray0000](https://github.com/cray0000))
- chore: add version to example app ([@cray0000](https://github.com/cray0000))
- chore: add explicit release commands to publish patch and minor since 'auto' doesn't take 0-based version into account ([@cray0000](https://github.com/cray0000))
- `teamplay`
  - readme: add example readme ([@cray0000](https://github.com/cray0000))
  - chore(example): add live reload support whenever client.js changes ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.1.4 (Thu May 23 2024)

#### 🐛 Bug Fix

- `@teamplay/channel`, `teamplay`
  - fix: rename old references to startupjs packages into teamplay packages ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.1.3 (Thu May 23 2024)

#### 🐛 Bug Fix

- `teamplay`
  - fix: add 'events' since sharedb client requires it to work correctly ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.1.2 (Thu May 23 2024)

#### 🐛 Bug Fix

- `@teamplay/cache`, `teamplay`
  - fix: re-export cache as 'teamplay/cache' ([@cray0000](https://github.com/cray0000))

#### ⚠️ Pushed to `master`

- chore: update 'release' script to do an actual release ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.1.1 (Thu May 23 2024)

#### 🐛 Bug Fix

- `@teamplay/cache`, `@teamplay/channel`, `@teamplay/debug`, `teamplay`
  - fix: dummy. trigger version bump ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))
