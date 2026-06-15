# Current compat / non-compat gaps

Фактические расхождения `teamplay` после `0.5.0-alpha.36`.

## Runtime Switches

| File / function | Compat behavior | Non-compat behavior | Risk |
|---|---|---|---|
| `src/orm/compatEnv.js` / `isCompatEnv()` | Compat включается через `globalThis.teamplayCompatibilityMode` или `TEAMPLAY_COMPAT=1`. | Обычный режим, если флаги не выставлены. | Финальный switch можно убрать только после закрытия остальных строк. |
| `src/orm/Signal.ts` / `DefaultSignal` | Default signal constructor: `SignalCompat`. | Default signal constructor: `Signal`. | Главная публичная развилка. |
