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
