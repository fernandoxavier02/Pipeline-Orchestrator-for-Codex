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
- multi-agent dispatcher for batch review and final adversarial review
- sentinel state persistence and sequence enforcement hooks
- prompt registry with required-output contract validation
- controller prompt-injection guard before controller consumption, including repository text that tries to supersede controller rules
- runtime dispatcher consults validated prompt files for shipped executor, review orchestrator, final adversarial orchestrator, and reviewer roles
- phase 2 and phase 3 runtime roles now also exist for checkpoint-validator, pre-tester, quality-gate-router, sanity-checker, and final-validator
- central prompt artifacts now also exist for sentinel, checkpoint-validator, design-interrogator, plan-architect, pre-tester, quality-gate-router, sanity-checker, and final-validator
- controller startup now preloads the shipped prompt bundle so central prompt contracts fail fast before execution
- continue mode
- batch execution with adversarial review
- config auto-detection from `.Codex/pipeline.local.md`, `package.json`, and common conventions
- final validation with `GO` / `CONDITIONAL` / `NO-GO` decisions
- recoverable `revalidate` / `replan` gate blocks can clear after later controller-authoritative resolution; terminal `stop` / `manual` gates stay sticky
- runtime closeout assembles a persisted closeout result from runtime outputs; the controller remains sovereign over confirmation, gate persistence, rollback routing, and final closeout authority
- public runtime stores are read-only (`session.load`, `checkpoints.list`); controller-owned writers stay internal for session, checkpoint, gate-log, confidence, and sentinel persistence

## Command Surface

- `/pipeline` is published from [`commands/pipeline.md`](./commands/pipeline.md)
- the command is intended to be the canonical entrypoint for this plugin
- it must not rely on a separate global `pipeline` skill installation

## Next Commands

- `npm install`
- `npm test`
- `npm run lint:types`
- inspect `docs/pipeline-orchestrator-codex/`
- use `docs/superpowers/plans/2026-04-01-pipeline-ssot-fidelity-plan.md` as the build authority
