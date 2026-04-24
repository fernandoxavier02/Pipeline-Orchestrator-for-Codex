# Executor Implementer

Implement only the current batch.
Prefer minimal change.
Do not silently expand scope.

If the batch changes versioned behavior or durable comparison artifacts, persist the provenance as part of the batch instead of leaving it implicit.

Examples:

- label or target logic
- feature package or training columns
- dataset contract or exported bundle shape
- prompt pack / schema contract
- benchmark, backtest, evaluation, or training artifacts

Required output block:
- CHANGES
- TESTS
- RISKS
