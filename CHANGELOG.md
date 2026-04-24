# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Strict real-agent dispatch contract for pipeline roles. `runRole` can now require a real Codex agent adapter and fails with `AgentRuntimeUnavailableError` instead of silently using local emulation.
- Runtime option `strictAgents` plus `agentRuntime` adapter plumbing for hosts that can bridge to `spawn_agent`.
- Hook observability log at `.codex/pipeline/hook-events.jsonl` for `UserPromptSubmit`, `PreToolUse`, and `Stop` hook decisions.

### Changed

- `/pipeline` command and skill docs now state that `spawn_agent` is mandatory and that missing agent support must block as `blocked-no-agent-runtime`.
- `sentinel-hook.cjs` now understands the runtime camelCase `sentinel-state.json` schema (`pipelineActive`, `expectedNext`, `updatedAt`) while retaining legacy snake_case compatibility.
- README installation examples now reference version `0.3.0` and document strict real-agent enforcement plus hook audit logs.

## [0.3.0] — 2026-04-17

### Parity contracts release — CC v3.8.0 parity ships as types, documentation, and one runtime behavior change. Runtime consolidation is deferred (see Known Limitations).

### Changed — runtime behavior

- **GAP-05** — `commands/pipeline.md` frontmatter restored to include `Write, Glob, Grep, TodoWrite` in `allowed-tools` (previously `Skill, Read, Bash, Task` only). This is the **single user-observable runtime change** between `0.2.1` and `0.3.0`: Codex will now grant these tools without prompting when `/pipeline` is invoked.

### Added — parity contracts & documentation (no runtime behavior change)

These additions document what the Codex runtime SHOULD do to match CC v3.8.0. They ship as typed contracts, reference implementations, and tests. **They are not yet wired into the runtime execution path** — HOTFIX behavior, user confirmation, and plan mode continue to use the pre-existing scattered branches in `src/controller/*`, `src/gates/*`, `src/review/*`, and `src/execution/*`. See Known Limitations below.

- **GAP-02** — Controller semantics consolidated in `skills/pipeline/SKILL.md`: ANTI-PROMPT-INJECTION invariants, GATE REGISTRY (aligned with `src/gates/gate-registry.ts`), PHASE ROLLBACK PATHS (mirrors CC v3.8.0's 4-row table), GATE_DECISION_LOG format (aligned with `gateDecisionSchema` in `src/domain/pipeline-schemas.ts`). Skill is now a textual SSOT for documentation — runtime enforcement remains distributed.
- **GAP-03** — Typed `ReductionPolicy` + `hotfixReductionPolicy()` reference implementation in `src/modes/hotfix-mode.ts`, plus the HOTFIX reduction table in `skills/pipeline/SKILL.md`. **Note:** runtime HOTFIX behavior still lives in scattered `input.mode === "--hotfix"` branches across `src/controller/classification-overrides.ts`, `src/gates/information-gate.ts`, `src/review/domain-checklists.ts`, `src/review/adversarial-review.ts`, `src/execution/executor-controller.ts`, `src/execution/quality-gate-router.ts`, `src/dispatcher/single-agent-runner.ts`, `src/controller/pipeline-controller.ts`, and `src/index.ts`. These branches are byte-identical to `0.2.1`; `hotfixReductionPolicy()` is not yet consulted by the controller. Consolidation is a follow-up (issue #TBD-1).
- **GAP-06** — `src/primitives/ask-user-question.ts` — blocking question serializer with gate traceability + option validation. DDD value object contract. **Not yet wired:** `src/controller/confirm-proposal.ts` continues to parse responses inline. Follow-up (issue #TBD-2).
- **GAP-07** — `src/primitives/plan-mode.ts` — session-scoped write-attempt telemetry. Caller-voluntary by design because Codex cannot intercept tool calls the way CC does. **Not yet wired.** Note: this file does NOT replace `src/controller/plan-mode.ts` (different concern: ImplementationPlan artifact); name collision is tracked as issue #TBD-4.
- **GAP-07 (shared types)** — `src/primitives/primitive-types.ts` — zod-validated Question/Response/Interaction/PlanSession value objects exported as `Readonly<>` for compile-time immutability.
- **GAP-08** — Re-scoped: the `agents/` vs `prompts/agents/` split is intentional (`agents/` = CC-style rich reference docs, `prompts/agents/` = runtime stubs loaded by `src/prompts/prompt-registry.ts`). Added READMEs to both directories and `tests/unit/agents-inventory.test.ts` to prevent future naive consolidations that would break runtime dispatch.
- **BDD scenarios** — `tests/bdd/hotfix.feature.test.ts` covers 8 Given/When/Then scenarios asserting the shape of `hotfixReductionPolicy()`. These are data-shape tests; they verify the contract, not the runtime behavior.
- **Parity integration test** — `tests/integration/controller-parity.test.ts` verifies every gate name from `src/gates/gate-registry.ts` appears in `skills/pipeline/SKILL.md` (lint-style coupling guard).
- **Frontmatter parity test** — `tests/unit/frontmatter-parity.test.ts` guards the 8-tool `allowed-tools` contract against regressions.
- **Version consistency test** — `tests/unit/version-consistency.test.ts` pins `plugin.json`, `package.json`, `hooks.json` banner, and CHANGELOG entries to the same version string.

### Changed — metadata

- **GAP-01 (demoted)** — Version bumped `0.2.1 → 0.3.0` (MINOR). The initial plan targeted `1.0.0` for "parity release", but the 3-parallel adversarial review plus a follow-up Codex-specialist audit confirmed: no public API change in `src/index.ts` exports justifies SemVer MAJOR. `0.3.0` is additive-only (new modules, new tests, new docs, one tool-allowlist widening).
- SessionStart banner now mentions `v0.3.0` and explicitly discloses "runtime wiring deferred".

### Known Limitations (scheduled for follow-up)

These are documented gaps between what the SKILL/CHANGELOG text promises and what the runtime actually does. The distance is deliberate for `0.3.0` — the parity contracts are in place, but wiring them is a separate sprint to avoid regression risk in the 26 execution-routing integration tests.

- **JSONL `detail` sanitization is not code-enforced.** `skills/pipeline/SKILL.md` describes a "truncate to 200 chars, strip `\n`/`\r`" invariant. Today `gateDecisionSchema.detail = z.string()` with no `.max()` and no transform. This is mitigated by `JSON.stringify` already escaping control chars (so the one-object-per-line JSONL structural invariant holds via the serializer), and by the fact that `detail` only receives controller-owned deterministic strings today. Follow-up: #TBD-3 tightens the schema with a 2-line zod `.transform()`.
- **HOTFIX runtime behavior does not consult `hotfixReductionPolicy()`.** The policy and the runtime branches happen to agree on 7 of 11 fields today, but silent drift is possible. Follow-up: #TBD-1 consolidates call-sites through the typed policy.
- **`askUserQuestion` and `createPlanMode` are exported but not invoked from any runtime call-site.** The controller's real confirmation and plan-mode paths pre-date these primitives. Follow-ups: #TBD-2 (wire confirmation) and #TBD-4 (resolve plan-mode naming collision).

### Audit trail

- Initial audit: `docs/superpowers/plans/2026-04-17-pipeline-codex-parity.md` (plan) + `docs/audits/2026-04-17-v1.0.0-parity-findings/` (3-parallel + Codex-specialist audits).
- Specialist audit conclusion: SemVer MAJOR not justified; behavioral parity achievable via the SKILL/`spawn_agent` path; orphan `src/` modules are reference implementations pending integration.

## [0.2.1] — previous release

Legacy version. See git history for pre-parity changes.
