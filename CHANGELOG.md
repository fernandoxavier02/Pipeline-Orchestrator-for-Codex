# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-04-17

### Parity release — aligns Codex plugin with Claude Code pipeline-orchestrator v3.8.0.

### Fixed

- **GAP-05** — `commands/pipeline.md` frontmatter restored to include `Write, Glob, Grep, TodoWrite` in `allowed-tools`. Previously the Codex command could not invoke file writes, pattern searches, or todos.
- **GAP-03** — HOTFIX reduction table is now in `skills/pipeline/SKILL.md` and implemented as typed `ReductionPolicy` in `src/modes/hotfix-mode.ts`. Previously only prose description existed.
- **GAP-02** — Controller semantics consolidated into `skills/pipeline/SKILL.md` (ANTI-PROMPT-INJECTION invariants, GATE REGISTRY, PHASE ROLLBACK PATHS, GATE_DECISION_LOG). Skill is now a textual SSOT, aligned with real `gateDecisionSchema` in `src/domain/pipeline-schemas.ts`.
- **GAP-08** — Re-scoped: the `agents/` vs `prompts/agents/` split is intentional (agents = reference docs, prompts = runtime stubs). Added READMEs to both directories and an inventory test to prevent future naive consolidations that would break runtime dispatch.

### Added

- **GAP-06, GAP-07** — Emulated primitives with DDD:
  - `src/primitives/ask-user-question.ts` — blocking question serializer with gate traceability.
  - `src/primitives/plan-mode.ts` — session-scoped write-attempt telemetry (caller-voluntary; Codex cannot intercept tool calls like CC does).
  - `src/primitives/primitive-types.ts` — zod-validated Question/Response/Interaction/PlanSession value objects (exported as `Readonly<>` for immutability).
- **BDD scenarios** — `tests/bdd/hotfix.feature.test.ts` covers 8 Given/When/Then scenarios for HOTFIX reduction policy.
- **Parity integration test** — `tests/integration/controller-parity.test.ts` verifies every gate in `gate-registry.ts` is documented in the skill.
- **Agents inventory test** — `tests/unit/agents-inventory.test.ts` locks the intentional `agents/` vs `prompts/agents/` split.
- **Frontmatter parity test** — `tests/unit/frontmatter-parity.test.ts` guards the 8-tool allowed-tools contract.

### Changed

- **GAP-01** — Version bumped `0.2.1 → 1.0.0` reflecting parity with CC v3.8.0.
- SessionStart banner now mentions v1.0.0 and `--hotfix` mode.

## [0.2.1] — previous release

Legacy version. See git history for pre-parity changes.
