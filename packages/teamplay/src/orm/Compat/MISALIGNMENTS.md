# Remaining compat / non-compat gaps

Decision-ready список по текущим расхождениям. Фактическая карта находится в
`INVENTORY.md`.

| Mechanism | Risk / usage | Recommendation |
|---|---|---|
| `TEAMPLAY_COMPAT` switch | High until `SignalCompat` is removed. | Удалять последним. |

## Recommended Order

1. Убрать `SignalCompat`, затем `TEAMPLAY_COMPAT` / `isCompatEnv()`.
