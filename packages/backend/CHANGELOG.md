# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.3.34](https://github.com/startupjs/teamplay/compare/v0.3.33...v0.3.34) (2026-01-14)

**Note:** Version bump only for package @teamplay/backend





## [0.3.33](https://github.com/startupjs/teamplay/compare/v0.3.32...v0.3.33) (2026-01-14)

**Note:** Version bump only for package @teamplay/backend





## [0.3.32](https://github.com/startupjs/teamplay/compare/v0.3.31...v0.3.32) (2026-01-14)

**Note:** Version bump only for package @teamplay/backend





## [0.3.31](https://github.com/startupjs/teamplay/compare/v0.3.30...v0.3.31) (2026-01-14)

**Note:** Version bump only for package @teamplay/backend





## [0.3.30](https://github.com/startupjs/teamplay/compare/v0.3.29...v0.3.30) (2026-01-01)


### Features

* add offline support ([#21](https://github.com/startupjs/teamplay/issues/21)) ([77ed88c](https://github.com/startupjs/teamplay/commit/77ed88c8b39fab6b35c91c925cd7f42ba3477f98))





# v0.3.24 (Fri Nov 08 2024)

#### ⚠️ Pushed to `master`

- fix(backend -> redis): fix var usage before initialization ([@fcbvirus0k](https://github.com/fcbvirus0k))

#### Authors: 1

- Pavel Khazov ([@fcbvirus0k](https://github.com/fcbvirus0k))

---

# v0.3.23 (Fri Nov 08 2024)

#### ⚠️ Pushed to `master`

- fix(backend -> redis): typo ([@fcbvirus0k](https://github.com/fcbvirus0k))

#### Authors: 1

- Pavel Khazov ([@fcbvirus0k](https://github.com/fcbvirus0k))

---

# v0.3.22 (Fri Nov 08 2024)

#### 🚀 Enhancement

- feat(backend): export 'redisPrefix', 'generateRedisPrefix', 'getRedisOptions' [#11](https://github.com/startupjs/teamplay/pull/11) ([@fcbvirus0k](https://github.com/fcbvirus0k))

#### Authors: 1

- Pavel Khazov ([@fcbvirus0k](https://github.com/fcbvirus0k))

---

# v0.3.21 (Tue Nov 05 2024)

#### 🚀 Enhancement

- feat(backend): implement ability to pass additional options to redis [#10](https://github.com/startupjs/teamplay/pull/10) ([@fcbvirus0k](https://github.com/fcbvirus0k))

#### Authors: 1

- Pavel Khazov ([@fcbvirus0k](https://github.com/fcbvirus0k))

---

# v0.3.20 (Tue Nov 05 2024)

#### 🐛 Bug Fix

- refactor(backend, server): move 'getUniversalRedis' to helper and export it, export Redis [#9](https://github.com/startupjs/teamplay/pull/9) ([@fcbvirus0k](https://github.com/fcbvirus0k))

#### Authors: 1

- Pavel Khazov ([@fcbvirus0k](https://github.com/fcbvirus0k))

---

# v0.3.19 (Fri Oct 18 2024)

#### 🚀 Enhancement

- feat(backend/mongo): add support for TLS/SSL connection ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.3.7 (Sun Sep 08 2024)

#### 🚀 Enhancement

- feat: use patched sharedb-mingo-memory which fully supports $aggregate with $lookup ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.3.5 (Fri Sep 06 2024)

#### 🚀 Enhancement

- feat: allow running aggregations on server side [#6](https://github.com/startupjs/teamplay/pull/6) ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.3.3 (Tue Sep 03 2024)

#### 🐛 Bug Fix

- Bump version to: v0.3.2 \[skip ci\] ([@cray0000](https://github.com/cray0000))
- fix: fix aggregations support. Add unit tests for them [#5](https://github.com/startupjs/teamplay/pull/5) ([@cray0000](https://github.com/cray0000))

#### ⚠️ Pushed to `master`

- Merge branch 'master' of github.com:startupjs/teamplay ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.2.5 (Mon Aug 26 2024)

#### 🐛 Bug Fix

- fix(backend): fix accessControl, allow to pass a customValidator option for it ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.2.4 (Mon Aug 26 2024)

#### 🚀 Enhancement

- feat: add access control [#2](https://github.com/startupjs/teamplay/pull/2) ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.1.8 (Fri May 31 2024)

#### 🐛 Bug Fix

- fix: move uuid into utils package ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.1.7 (Fri May 31 2024)

#### 🐛 Bug Fix

- fix: use older uuid version which does not depend on the crypto module (RN does not have it) ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.1.6 (Fri May 31 2024)

#### ⚠️ Pushed to `master`

- chore: add .npmignore to all packages with CHANGELOG.md ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.1.5 (Mon May 27 2024)

#### 🚀 Enhancement

- feat: move backend implementation from startupjs. Add an example app. ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))
