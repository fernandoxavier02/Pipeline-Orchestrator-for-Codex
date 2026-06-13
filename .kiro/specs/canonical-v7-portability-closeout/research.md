# Research Log: Canonical v7 Portability Closeout

## Discovery Scope

This spec was generated from `docs/GAP_ANALYSIS_CANONICAL_VS_CODEX.md`, dated 2026-06-11. The audit compares:

- Canonical repository: `D:\Pipeline Orchestrator Claude\Pipeline-Orchestrator`
- Codex repository: `D:\Pipeline Orchestrator for Codex`
- Canonical version: `v7.12.0`
- Codex baseline: `v0.5.0`, with prior parity target `v5.2.0`

The goal is not to copy files mechanically. The canonical is CommonJS-oriented and Claude Code-oriented; this repository is TypeScript ESM and Codex-oriented. The correct unit of work is feature behavior, evidence, and runtime contract.

## Steering Findings

- `.kiro/CONSTITUTION.md` requires evidence over assumption, SSOT over convenience, and no public promise beyond runtime/test support.
- `.kiro/steering/product.md` defines the product value as operational reliability: decisions, evidence, gates, and Go/Conditional/No-Go clarity.
- `.kiro/steering/tech.md` identifies the key runtime surfaces: `skills/pipeline/SKILL.md`, `commands/pipeline.md`, `src/**`, `hooks/**`, `agents/**`, `prompts/**`, `references/**`, Eval Gate, and generated `dist/**`.
- `.kiro/steering/structure.md` says docs are explanatory context and must not replace runtime or tests.

## Audit Findings Used

The audit groups the missing work into six areas:

1. New task types and public skills: `user-story`, `ux-sim`, `measure-paperclip-fidelity`, skill-dispatch wiring, and brainstorm `step-01b-alternatives`.
2. Core hardening: 35-gate registry, 5-level hardness taxonomy including `AUDIT`, Plan Mode roster/enforcement, real parallel dispatch for medium work, CHANGE_CONTRACT/SCOPE LOCK, visible progress, HMAC signed sentinel state, and diff discipline loop.
3. Observability and telemetry: Langfuse opt-in tracing, race-safe run directory allocation, fidelity reporter, run-log dedup, user score collection, gate-decision writer SSOT, telemetry correlation, and discovery pointer.
4. Advanced Paperclip: full flow mirror, company provisioner, idempotent stop fidelity report.
5. Regression and compatibility tests: versioned regressions from v6.0.0 to v7.12.0, BDD parity, and compat fixtures.
6. Documentation and Kiro specs: migration guides, HTML diagrams, examples, and the missing `paperclip-task-tree-factory` spec.

## Adaptation Decisions

- Freeze the port target at canonical `v7.12.0` for this spec. Canonical v8 is explicitly out of scope until a new audit updates the gap map.
- Preserve Codex-exclusive extensions: OpenAI/Codex KB, Kimi port, local Eval Gate, and larger existing test corpus.
- Treat each claimed gap as "verify then port" because the repository already contains partial or later work for some items.
- Require every wave to update tests and Eval Gate evidence before being called done.
- Keep publication/cache sync separate from repository implementation. A later closeout task may prove repo -> Marketplace/cache parity, but implementation tasks must not claim publication by default.
- Do not treat `commands/**` as a Codex plugin public command surface. New public behavior must ship as plugin skills through `plugin.json:skills`, with installed-cache and smoke evidence. `commands/**` may remain compatibility or documentation only.
- Treat `agents/**` Markdown files as internal role prompts for this plugin. Real Codex custom subagents require `.codex/agents/*.toml`, load/selection tests, and host `spawn_agent` smoke proof.
- Preserve the fail-closed pipeline contract. If the operational path lacks real `spawn_agent`, `wait_agent`, artifact collection, gate recording, hook/checkpoint recording, or structured final state, it must stop with `blocked-no-agent-runtime`. Harness emulation or manual review can run only as diagnostics with `pipeline_valid: false`.
- Record the manifest-hook source conflict explicitly: the system `plugin-creator` skill warns generated scaffolds to omit unsupported `hooks`, while this repository's consolidated Codex KB says `plugin.json:hooks` is valid and already part of the plugin packaging contract. For this repo, do not remove bundled hooks unless live official docs and ingestion validation prove the KB is stale.
- Every implementation wave must define TDD, BDD, and DDD validation before completion, run an independent adversarial review after each test group, loop fixes up to three times, and use a fresh no-context alternative agent after a third repeated failure.
- Treat adversarial review independence itself as a runtime capability. A review, alternative correction agent, or final specialized reviewer counts only when it runs through real Codex `spawn_agent`/`wait_agent` with artifact collection; otherwise the operational path blocks with `blocked-no-agent-runtime`.
- Treat Task 10 as a cross-wave gate rather than a final cleanup task. Every wave must carry its own test-plan, adversarial-review, loop-cap, and harness-proof evidence before closing.
- Require canonical-version regression coverage in the same wave as the behavior being ported. Later regression/docs waves may consolidate fixtures but must not defer protection for behavior already shipped.
- Require package-surface proof plus installed-cache smoke proof before claiming complete portability for public plugin, skill, hook, or workflow behavior. `repo-only` remains a valid narrower claim for local implementation work.
- Allow Codex-native equivalents only with explicit equivalence proof: same public trigger, observable behavior, gate/blocking semantics, telemetry/evidence, dedicated tests, ledger entry, and adversarial approval.

## Risks

- Copying CommonJS modules directly into TypeScript would create a parallel runtime instead of true Codex adaptation.
- Adding Plan Mode, scope lock, parallel dispatch, or Langfuse tracing without consulting Codex-specific KB can produce a feature that looks ported but fails in the actual Codex host.
- Updating docs before runtime creates the same doc-runtime drift this repository is meant to prevent.
- Running all waves as one large change would make regression triage unreliable.

## Synthesis

The port should be implemented as six independently shippable waves:

1. Foundation: gate/hardness/gate-decision SSOT plus skill-dispatch wiring.
2. Public task types: `user-story`, `ux-sim`, and brainstorm alternatives.
3. Implementation discipline: signed sentinel, diff discipline, CHANGE_CONTRACT/SCOPE LOCK, visible progress.
4. Execution maturity: race-safe run directories, Plan Mode roster/enforcement, and real medium parallel dispatch when the Codex host proves the required runtime capabilities.
5. Observability: deduped run logs, fidelity reports, scores, telemetry correlation, discovery pointer, Langfuse opt-in.
6. Paperclip, regression, and docs: flow mirror, provisioner, measure-fidelity skill, stop fidelity, compat/regression suites, migration docs, diagrams, examples, and `paperclip-task-tree-factory`.
