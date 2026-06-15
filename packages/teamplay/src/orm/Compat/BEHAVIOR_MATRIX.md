# Compat / non-compat behavior matrix

Матрица содержит только текущие расхождения.

| Topic | Compat behavior | Non-compat behavior | Source area |
|---|---|---|---|
| Default signal class | `Signal.ts` chooses `SignalCompat`. | `Signal.ts` chooses base `Signal`. | `src/orm/Signal.ts`, `src/orm/compatEnv.js` |
