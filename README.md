# Pipeline-Orchestrator-for-Codex

Codex-oriented documentation and implementation groundwork for a functional port of the original Claude Code `Pipeline-Orchestrator`.

## Documentation Package

The initial mapping package lives in:

- [`docs/pipeline-orchestrator-codex/README.md`](./docs/pipeline-orchestrator-codex/README.md)

It covers:

- runtime architecture
- phase flow
- gates and hardness
- agent catalog
- prompt behavior
- references and variants
- Claude-to-Codex translation
- implementation blueprint
- gap analysis
- source inventory

## Implementation Status

- controller scaffold
- persistent state
- gates and hardness
- dispatcher abstraction
- prompt registry with required-output contract validation
- controller prompt-injection guard before controller consumption, including repository text that tries to supersede controller rules
- continue mode
- batch execution with adversarial review
- config auto-detection from `.Codex/pipeline.local.md`, `package.json`, and common conventions
- final validation with `GO` / `CONDITIONAL` / `NO-GO` decisions
- runtime closeout helper with operator confirmation, controller-owned execution proof, gate-log evidence, and rollback hints
- public runtime stores are read-only (`session.load`, `checkpoints.list`); controller-owned writers stay internal

## Next Commands

- `npm install`
- `npm test`
- `npm run lint:types`
- inspect `docs/pipeline-orchestrator-codex/`
- use `docs/superpowers/plans/2026-04-01-pipeline-ssot-fidelity-plan.md` as the build authority
