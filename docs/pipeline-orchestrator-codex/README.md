# Pipeline Orchestrator for Codex

This documentation package maps the original Claude-oriented `Pipeline-Orchestrator` into an implementation-ready Codex specification with functional parity as the target.

## Reading Order

1. [00-overview.md](./00-overview.md)
2. [01-runtime-architecture.md](./01-runtime-architecture.md)
3. [02-phase-flow.md](./02-phase-flow.md)
4. [03-gates-and-hardness.md](./03-gates-and-hardness.md)
5. [04-agents-catalog.md](./04-agents-catalog.md)
6. [05-prompts-and-behaviors.md](./05-prompts-and-behaviors.md)
7. [06-references-and-variants.md](./06-references-and-variants.md)
8. [07-codex-translation-matrix.md](./07-codex-translation-matrix.md)
9. [08-implementation-blueprint-for-codex.md](./08-implementation-blueprint-for-codex.md)
10. [09-gap-analysis.md](./09-gap-analysis.md)
11. [10-source-inventory.md](./10-source-inventory.md)

## Package Intent

The package is intentionally split into two layers:

- faithful documentation of the original plugin's behavior
- Codex-oriented translation and implementation guidance

This makes it suitable both for audit work and for future port implementation.
