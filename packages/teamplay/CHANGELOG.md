# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.3.33](https://github.com/startupjs/teamplay/compare/v0.3.32...v0.3.33) (2026-01-14)

**Note:** Version bump only for package teamplay





## [0.3.32](https://github.com/startupjs/teamplay/compare/v0.3.31...v0.3.32) (2026-01-14)

**Note:** Version bump only for package teamplay





## [0.3.31](https://github.com/startupjs/teamplay/compare/v0.3.30...v0.3.31) (2026-01-14)

**Note:** Version bump only for package teamplay





## [0.3.30](https://github.com/startupjs/teamplay/compare/v0.3.29...v0.3.30) (2026-01-01)


### Features

* add offline support ([#21](https://github.com/startupjs/teamplay/issues/21)) ([77ed88c](https://github.com/startupjs/teamplay/commit/77ed88c8b39fab6b35c91c925cd7f42ba3477f98))





# v0.3.29 (Wed Dec 03 2025)

#### ⚠️ Pushed to `master`

- chore: improve TS types ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.3.28 (Wed Dec 03 2025)

#### 🚀 Enhancement

- feat: add basic TS types ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.3.27 (Wed Nov 19 2025)

#### 🐛 Bug Fix

- fix useEffect [#20](https://github.com/startupjs/teamplay/pull/20) ([@zag2art](https://github.com/zag2art) [@az-001-zkdm](https://github.com/az-001-zkdm))
- useEffect test failing [#19](https://github.com/startupjs/teamplay/pull/19) ([@zag2art](https://github.com/zag2art) [@az-001-zkdm](https://github.com/az-001-zkdm))

#### ⚠️ Pushed to `master`

- test(teamplay): add more tests for deleting array items, skip the useEffect test for now (needs to be fixed in future) ([@cray0000](https://github.com/cray0000))

#### Authors: 3

- [@az-001-zkdm](https://github.com/az-001-zkdm)
- [@zag2art](https://github.com/zag2art)
- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.3.26 (Mon Oct 27 2025)

#### 🚀 Enhancement

- feat(teamplay): add .assign() method to update specified keys in object ([@cray0000](https://github.com/cray0000))

#### ⚠️ Pushed to `master`

- chore(teamplay): migrate tests to mocha since the built-in node tested doesn't expose GC correctly ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.3.25 (Thu Oct 09 2025)

#### 🚀 Enhancement

- feat: Add `.extra` to Query to support $count [#17](https://github.com/startupjs/teamplay/pull/17) ([@zag2art](https://github.com/zag2art) [@az-001-zkdm](https://github.com/az-001-zkdm))

#### Authors: 2

- [@az-001-zkdm](https://github.com/az-001-zkdm)
- [@zag2art](https://github.com/zag2art)

---

# v0.3.22 (Fri Nov 08 2024)

#### 🚀 Enhancement

- feat(backend): export 'redisPrefix', 'generateRedisPrefix', 'getRedisOptions' [#11](https://github.com/startupjs/teamplay/pull/11) ([@fcbvirus0k](https://github.com/fcbvirus0k))

#### Authors: 1

- Pavel Khazov ([@fcbvirus0k](https://github.com/fcbvirus0k))

---

# v0.3.20 (Tue Nov 05 2024)

#### 🐛 Bug Fix

- refactor(backend, server): move 'getUniversalRedis' to helper and export it, export Redis [#9](https://github.com/startupjs/teamplay/pull/9) ([@fcbvirus0k](https://github.com/fcbvirus0k))

#### Authors: 1

- Pavel Khazov ([@fcbvirus0k](https://github.com/fcbvirus0k))

---

# v0.3.18 (Fri Sep 27 2024)

#### 🐛 Bug Fix

- fix: swich to using useDeferredValue by default. Add { defer: false } support to useSub() and to observer() (effective for any useSub inside) options to not use it. ([@cray0000](https://github.com/cray0000))
- fix(orm): typo in getCollection method's error message ([@fcbvirus0k](https://github.com/fcbvirus0k))

#### Authors: 2

- Pavel Khazov ([@fcbvirus0k](https://github.com/fcbvirus0k))
- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.3.17 (Thu Sep 26 2024)

#### 🚀 Enhancement

- feat(orm): implement getCollection method [#8](https://github.com/startupjs/teamplay/pull/8) ([@fcbvirus0k](https://github.com/fcbvirus0k))

#### Authors: 1

- Pavel Khazov ([@fcbvirus0k](https://github.com/fcbvirus0k))

---

# v0.3.16 (Mon Sep 23 2024)

#### 🐛 Bug Fix

- fix(teamplay/Doc): potential fix for the race condition during subscribe/unsubscribe ([@cray0000](https://github.com/cray0000))
- fix(teamplay): fix FinalizationRegistry mock unregister method ([@cray0000](https://github.com/cray0000))
- fix(teamplay): simplify FinalizationRegistry WeakRef mock ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.3.15 (Thu Sep 19 2024)

#### 🐛 Bug Fix

- fix(teamplay): adm destructor might run twice during hot reloading ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.3.14 (Thu Sep 19 2024)

#### 🐛 Bug Fix

- fix(teamplay): for React's useSub() and cache signals on the observer() level intead of using useRef() ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.3.13 (Wed Sep 18 2024)

#### 🐛 Bug Fix

- fix: fallback to empty array when the query ids are not there for some reason ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.3.12 (Fri Sep 13 2024)

#### 🐛 Bug Fix

- fix: don't throw on incorrect getIds() ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.3.11 (Fri Sep 13 2024)

#### ⚠️ Pushed to `master`

- fix FinalizationRegistry implementation through WeakRef ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.3.10 (Thu Sep 12 2024)

#### ⚠️ Pushed to `master`

- test: improve useSub and useAsyncSub tests ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.3.9 (Wed Sep 11 2024)

#### 🚀 Enhancement

- feat: implement useAsyncSub(). It returns undefined if there is no data yet. ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.3.8 (Wed Sep 11 2024)

#### 🚀 Enhancement

- feat: add useNow() to get current timestamp consistent between Suspense rerenders. Export useNow, useId, useTriggerUpdate, useScheduleUpdate ([@cray0000](https://github.com/cray0000))
- feat: implement FinalizationRegistry mock through WeakRef ([@cray0000](https://github.com/cray0000))

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

# v0.3.4 (Thu Sep 05 2024)

#### 🐛 Bug Fix

- fix(teamplay): fix .getId() for doc signals in aggregation results ([@cray0000](https://github.com/cray0000))

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

# v0.3.1 (Fri Aug 30 2024)

#### 🚀 Enhancement

- feat(access): add userId to the permission denied log ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.3.0 (Fri Aug 30 2024)

#### 🐛 Bug Fix

- fix: implement a classical useSub() and move update logic into observer component [#4](https://github.com/startupjs/teamplay/pull/4) ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.2.4 (Mon Aug 26 2024)

#### 🚀 Enhancement

- feat: add access control [#2](https://github.com/startupjs/teamplay/pull/2) ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.2.3 (Tue Aug 13 2024)

#### 🐛 Bug Fix

- fix(teamplay): don't try to call the destructor twice (might happen in strict mode, on background render, etc.) ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.2.2 (Thu Aug 08 2024)

#### 🐛 Bug Fix

- fix(teamplay): optimize setDiffDeep -- return the original object if the reference to be updated is the same object (don't try to perform a deep comparison) ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.2.1 (Tue Aug 06 2024)

#### 🐛 Bug Fix

- fix(teamplay): don't try to deep update non-plaid objects when doing setDiffDeep on local data ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.2.0 (Tue Aug 06 2024)

#### 🚀 Enhancement

- feat: implement aggregations; fix query rerender; [#1](https://github.com/startupjs/teamplay/pull/1) ([@cray0000](https://github.com/cray0000))

#### ⚠️ Pushed to `master`

- Update README.md ([@cray0000](https://github.com/cray0000))
- docs: fix createdAt in examples -- has to be unixtime ([@cray0000](https://github.com/cray0000))
- docs: add docs using rspress and deploy them to Github Pages ([@cray0000](https://github.com/cray0000))
- readme: document react integration and awaiting setters ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.1.16 (Wed Jul 03 2024)

#### 🚀 Enhancement

- feat: expose an explicit 'useSub()' function to be used inside React components instead of sub() ([@cray0000](https://github.com/cray0000))

#### ⚠️ Pushed to `master`

- readme: add Usage section with introduction and documentation ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.1.15 (Sat Jun 29 2024)

#### 🚀 Enhancement

- feat(channel): add 'authorize' option for server-side to authorize connection requests; add 'getConnectionUrl' option for client-side to modify the connection url ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.1.14 (Thu Jun 06 2024)

#### 🚀 Enhancement

- feat(teamplay): support passing array to sub() for multiple parallel subscriptions ([@cray0000](https://github.com/cray0000))

#### 🐛 Bug Fix

- fix(teamplay): correctly handle array indexes; add more array methods - reduce, find; return id from .add ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.1.13 (Wed Jun 05 2024)

#### 🐛 Bug Fix

- fix(teamplay/react): update signal ref if it changes ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.1.12 (Wed Jun 05 2024)

#### 🐛 Bug Fix

- fix(teamplay): change observer() update logic to use useSyncExternalStore; hold reference to signals within react context to prevent GCing them while component is still alive; don't unsubscribe from docs which were indirectly fetched by a query ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.1.11 (Sun Jun 02 2024)

#### 🐛 Bug Fix

- fix: allow only working with public collections on the server since there is no user-separation for private collections ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.1.10 (Sun Jun 02 2024)

#### 🚀 Enhancement

- feat(teamplay/Signal): add simple implementations for .pop() and .push() ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.1.9 (Sat Jun 01 2024)

#### 🚀 Enhancement

- feat(teamplay/Signal): add getId() method which returns the last segment ([@cray0000](https://github.com/cray0000))

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

#### 🐛 Bug Fix

- fix(teamplay): mock WeakRef and FinalizationRegistry to work in Expo ([@cray0000](https://github.com/cray0000))

#### ⚠️ Pushed to `master`

- chore: add .npmignore to all packages with CHANGELOG.md ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.1.5 (Mon May 27 2024)

#### 🚀 Enhancement

- feat: move backend implementation from startupjs. Add an example app. ([@cray0000](https://github.com/cray0000))

#### ⚠️ Pushed to `master`

- readme: add example readme ([@cray0000](https://github.com/cray0000))
- chore(example): add live reload support whenever client.js changes ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.1.4 (Thu May 23 2024)

#### 🐛 Bug Fix

- fix: rename old references to startupjs packages into teamplay packages ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.1.3 (Thu May 23 2024)

#### 🐛 Bug Fix

- fix: add 'events' since sharedb client requires it to work correctly ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.1.2 (Thu May 23 2024)

#### 🐛 Bug Fix

- fix: re-export cache as 'teamplay/cache' ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))

---

# v0.1.1 (Thu May 23 2024)

#### 🐛 Bug Fix

- fix: dummy. trigger version bump ([@cray0000](https://github.com/cray0000))

#### Authors: 1

- Pavel Zhukov ([@cray0000](https://github.com/cray0000))
