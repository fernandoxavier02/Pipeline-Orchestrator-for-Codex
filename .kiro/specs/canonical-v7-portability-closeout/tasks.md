# Tasks

**Version:** 0.1.1
**Date:** 2026-06-12
**Status:** ready-for-wave-gate
**Total tasks:** 10 major tasks across 6 waves
**Execution rule:** verify each gap before porting; do not claim parity without runtime evidence. Task 10 is a cross-wave gate, not a final sequential task; every wave must satisfy its relevant TDD, BDD, DDD, adversarial-review, and harness-proof clauses before that wave can close.

## Requirement-Task Mapping

| Requirement | Task(s) |
| --- | --- |
| REQ-001 | TASK-001, TASK-009 |
| REQ-002 | TASK-002, TASK-009 |
| REQ-003 | TASK-003, TASK-009 |
| REQ-004 | TASK-004, TASK-009 |
| REQ-005 | TASK-005, TASK-009 |
| REQ-006 | TASK-006, TASK-009 |
| REQ-007 | TASK-007, TASK-008, TASK-009 |
| REQ-008 | TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007, TASK-008, TASK-009 |
| REQ-009 | TASK-010 |

## Wave Plan

1. Wave 1: Foundation.
2. Wave 2: Public task shortcuts.
3. Wave 3: Implementation discipline.
4. Wave 4: Plan Mode and parallel execution.
5. Wave 5: Observability.
6. Wave 6: Paperclip, regression, and docs.

---

## TASK-001: Create the Portability Evidence Ledger

_Owner:_ plan-architect  
_Requirements:_ REQ-001, REQ-008  
_Boundary:_ `docs/**`, `evals/outputs/latest_output.md` evidence references only.

- [ ] 1.1 Create `docs/PORTABILITY_CLOSEOUT_V7_12.md`.
  - Done means the file lists every audit gap from `docs/GAP_ANALYSIS_CANONICAL_VS_CODEX.md` with section id, title, wave, dependency, status, and evidence placeholder.
- [ ] 1.2 Mark Codex-exclusive features as preserved, not gaps.
  - Done means OpenAI/Codex KB, Kimi port, Eval Gate, and existing larger test surface are listed as protected Codex extensions.
- [ ] 1.3 Add a "claim boundary" section.
  - Done means the ledger explicitly separates repo implementation, generated build, Marketplace/local copy, installed cache, and live smoke proof.
- [ ] 1.4 Run a ledger consistency pass.
  - Done means every task in this file maps to at least one ledger wave and every audit group has an owner wave.

---

## TASK-002: Wave 1 - Foundation Gates, Hardness, Gate Decisions, and Skill Dispatch

_Owner:_ executor-controller  
_Requirements:_ REQ-002, REQ-008, REQ-009  
_Boundary:_ `src/gates/**`, `src/state/gate-log.ts`, `src/domain/**`, `src/controller/**`, `references/gates/**`, `references/complexity-matrix.md`, focused tests.

- [ ] 2.1 Verify the current gate inventory against the audit before editing.
  - Done means the ledger states which of the 35 canonical gates are present, missing, partial, or intentionally different.
- [ ] 2.2 Verify and migrate gate schema/protocol compatibility before adding registry entries.
  - Done means hardness types, schemas, final validator assumptions, protocol gate mapping, fixtures, and old `gate-decisions.jsonl` compatibility are updated or explicitly proven unaffected.
- [ ] 2.3 Add or adapt missing gate registry entries.
  - Done means mandatory gates cannot be bypassed by force/hotfix paths unless a requirement explicitly allows it.
- [ ] 2.4 Add the `AUDIT` hardness level.
  - Done means type definitions, registry entries, validation, and tests accept `AUDIT` while proving it never blocks.
- [ ] 2.5 Consolidate the gate-decision writer as SSOT.
  - Done means writes to `gate-decisions.jsonl` go through the central writer and use the canonical decision vocabulary.
- [ ] 2.6 Verify/adapt/add skill-dispatch routing needed by v7.12.
  - Done means explicit skill entrypoints can route without relying only on inferred task type, while existing task-type routing remains backward compatible.
- [ ] 2.7 Validate Wave 1.
  - Done means `npm run lint:types`, `npm run build`, `npm test`, `python .agents/skills/workflow-eval-gate/scripts/run_eval.py`, canonical-version regression coverage for behavior ported in this wave, and Task 10 wave-governance evidence run or any blocker is documented. Focused Vitest subsets may substitute for `npm test` only after a real `npm test` attempt is documented as blocked by Windows memory/IPC behavior.

---

## TASK-003: Wave 2 - Public User Story, UX Simulation, and Brainstorm Alternatives

_Owner:_ executor-controller  
_Requirements:_ REQ-003, REQ-008, REQ-009  
_Depends:_ Task 2.6  
_Boundary:_ `skills/**`, `agents/brainstorm/**`, `references/pipelines/**`, `.codex/agents/**` only if real Codex custom subagents are intentionally added, focused integration tests.

- [ ] 3.1 Verify existing `user-story` and `ux-sim` routing support.
  - Done means the ledger records existing pipeline variants and controller support before new files are added.
- [ ] 3.2 Add `user-story` public skills.
  - Done means `skills/user-story`, `skills/user-story-light`, and `skills/user-story-heavy` exist or the ledger records the approved Codex equivalent with the same trigger, observable behavior, gate semantics, telemetry/evidence, tests, and adversarial approval.
- [ ] 3.3 Add `ux-sim` public skills.
  - Done means `skills/ux-sim`, `skills/ux-sim-light`, and `skills/ux-sim-heavy` exist or the ledger records the approved Codex equivalent with the same trigger, observable behavior, gate semantics, telemetry/evidence, tests, and adversarial approval.
- [ ] 3.4 Enforce `ux-sim` report-only behavior.
  - Done means tests or runtime guards show UX simulation does not open write/implementation paths by default.
- [x] 3.5 Add `agents/brainstorm/step-01b-alternatives.md` as an internal role prompt.
  - Done means the brainstorm sequence can include alternatives without breaking existing step order, and the ledger states this Markdown prompt is not a real Codex custom subagent unless `.codex/agents/*.toml` and host spawn proof are added.
- [ ] 3.6 Prove public plugin surface through skills, not new commands.
  - Done means no new `commands/**` file is used as a Codex public-entry criterion; public behavior is proven through plugin skills, manifest/cache boundary, and smoke evidence.
- [ ] 3.7 Clarify internal role prompts versus real Codex custom subagents.
  - Done means Markdown files under `agents/**` are labeled as internal role prompts, and any real Codex custom subagent requirement has `.codex/agents/*.toml` plus load/selection tests.
- [ ] 3.8 Validate Wave 2.
  - Done means `npm run lint:types`, `npm run build`, `npm test`, `python .agents/skills/workflow-eval-gate/scripts/run_eval.py`, canonical-version regression coverage for behavior ported in this wave, and Task 10 wave-governance evidence run or blockers are documented. Focused Vitest subsets may substitute for `npm test` only after a real `npm test` attempt is documented as blocked by Windows memory/IPC behavior.

---

## TASK-004: Wave 3 - Implementation Discipline and Scope Protection

_Owner:_ executor-controller  
_Requirements:_ REQ-004, REQ-008, REQ-009  
_Boundary:_ `src/sentinel/**`, `src/review/**`, `agents/quality/**`, `hooks/**`, `references/implementation-discipline.md`, focused tests.

- [ ] 4.1 Verify existing sentinel and diff-discipline support.
  - Done means the ledger distinguishes existing implementation from gaps in signing, review loop, and enforcement.
- [ ] 4.2 Add signed sentinel-state integrity.
  - Done means sentinel state tampering is detected and secret material is not committed.
- [ ] 4.3 Wire diff-discipline review loop.
  - Done means the reviewer has an independent loop with maximum attempts and produces actionable failures.
- [ ] 4.4 Implement CHANGE_CONTRACT generation or ingestion.
  - Done means allowed files, forbidden files, diff budget, and bootstrap guidance are captured before edits.
- [ ] 4.5 Enforce Scope Lock checks.
  - Done means write/edit paths are denied when they fall outside the active change contract.
- [ ] 4.6 Prove active hook enforcement.
  - Done means every enforcement hook changed by the wave is registered from the intended layer, uses `type: "command"` where enforcement is required, is trusted/active where applicable, and has a deny/log smoke test.
- [ ] 4.7 Map visible progress to Codex planning primitives.
  - Done means user-visible progress uses the local plan/update mechanism without pretending Claude `TaskCreate` exists in Codex.
- [ ] 4.8 Validate Wave 3.
  - Done means `npm run lint:types`, `npm run build`, `npm test`, `python .agents/skills/workflow-eval-gate/scripts/run_eval.py`, canonical-version regression coverage for behavior ported in this wave, and Task 10 wave-governance evidence exist. Focused Vitest subsets may substitute for `npm test` only after a real `npm test` attempt is documented as blocked by Windows memory/IPC behavior; any skipped command requires an explicit recorded justification.

---

## TASK-005: Wave 4 - Plan Mode Roster and Safe Parallel Dispatch

_Owner:_ executor-controller  
_Requirements:_ REQ-005, REQ-008, REQ-009  
_Boundary:_ `src/run/**`, `src/controller/plan-mode.ts`, `src/dispatcher/**`, `src/execution/**`, `hooks/dispatch-guard.cjs`, `references/openai-codex-kb/**`, focused tests.

- [ ] 5.1 Verify `RunDirectory.allocate` behavior.
  - Done means race safety and collision-resistant ids are tested or the gap is recorded.
- [ ] 5.2 Harden run directory allocation if needed.
  - Done means exclusive creation prevents two runs from claiming the same directory.
- [ ] 5.3 Add the 10-agent Plan Mode roster.
  - Done means the roster is machine-readable and referenced by enforcement/tests.
- [ ] 5.4 Enforce Plan Mode in dispatch guard/runtime.
  - Done means mandatory agents follow `PLAN_MODE_REQUEST` to `PLAN_MODE_RESULTS` or block with clear evidence.
- [ ] 5.5 Implement medium parallel eligibility checks.
  - Done means `parallel_eligible` batches verify disjoint file scopes before dispatch.
- [ ] 5.6 Validate Codex host capability for real parallel dispatch.
  - Done means unavailable mandatory runtime support stops with `blocked-no-agent-runtime`; only explicit diagnostic harness/manual fallback may continue and must report `pipeline_valid: false`.
- [ ] 5.7 Validate Wave 4.
  - Done means `npm run lint:types`, `npm run build`, `npm test`, `python .agents/skills/workflow-eval-gate/scripts/run_eval.py`, canonical-version regression coverage for behavior ported in this wave, and Task 10 wave-governance evidence exist. Focused Vitest subsets may substitute for `npm test` only after a real `npm test` attempt is documented as blocked by Windows memory/IPC behavior; any skipped command requires an explicit recorded justification.

---

## TASK-006: Wave 5 - Observability, Fidelity, Scores, Correlation, and Langfuse

_Owner:_ executor-controller  
_Requirements:_ REQ-006, REQ-008, REQ-009  
_Depends:_ Task 5.2 for run identity and directory stability where needed.  
_Boundary:_ `src/observability/**`, `src/run/**`, `src/reports/**`, `src/state/**`, `hooks/**`, `.codex/hooks/**`, `package.json` only if dependency approval is explicit.

- [ ] 6.1 Verify existing execution identity and gate-log capabilities.
  - Done means the ledger names what is already mature and what is still missing.
- [ ] 6.2 Add run-log aggregation with dedup.
  - Done means repeated stop-hook or runtime events do not duplicate material log entries.
- [ ] 6.3 Add fidelity reporter.
  - Done means reports use the same gate decision and hardness vocabulary as runtime.
- [ ] 6.4 Add user score collection.
  - Done means scores are persisted separately from gate evidence and cannot corrupt gate logs.
- [ ] 6.5 Add telemetry correlation and discovery pointer.
  - Done means run artifacts can be correlated across runtime, hook, and report surfaces.
- [ ] 6.6 Add opt-in Langfuse integration.
  - Done means no traces are sent without env/config opt-in, and sanitized traces are sent when enabled.
- [ ] 6.7 Validate Wave 5.
  - Done means `npm run lint:types`, `npm run build`, `npm test`, `python .agents/skills/workflow-eval-gate/scripts/run_eval.py`, sanitizer/telemetry coverage, canonical-version regression coverage for behavior ported in this wave, and Task 10 wave-governance evidence exist. Focused Vitest subsets may substitute for `npm test` only after a real `npm test` attempt is documented as blocked by Windows memory/IPC behavior; any skipped command requires an explicit recorded justification.

---

## TASK-007: Wave 6A - Paperclip Advanced Port

_Owner:_ plan-architect  
_Requirements:_ REQ-007, REQ-008, REQ-009  
_Boundary:_ `references/paperclip/**`, `skills/measure-paperclip-fidelity/**`, stop hooks, Paperclip-focused tests.

- [ ] 7.1 Verify current Paperclip flow-mirror library completeness.
  - Done means all canonical modules/tests from the audit are mapped to present/missing/partial Codex paths.
- [ ] 7.2 Complete flow-mirror library and paired tests.
  - Done means the library supports the canonical flow set adapted to Codex paths.
- [ ] 7.3 Verify and complete the company provisioner.
  - Done means role and skill inventory is tested or deviations are documented.
- [ ] 7.4 Add `measure-paperclip-fidelity` skill.
  - Done means users can run fidelity measurement through a public skill surface.
- [ ] 7.5 Add idempotent stop fidelity reporting.
  - Done means repeated stop hook execution produces at most one fidelity report per run.
- [ ] 7.6 Validate Wave 6A.
  - Done means `npm run lint:types`, `npm run build`, `npm test`, `python .agents/skills/workflow-eval-gate/scripts/run_eval.py`, Paperclip coverage, canonical-version regression coverage for behavior ported in this wave, and Task 10 wave-governance evidence exist. Focused Vitest subsets may substitute for `npm test` only after a real `npm test` attempt is documented as blocked by Windows memory/IPC behavior; any skipped command requires an explicit recorded justification.

---

## TASK-008: Wave 6B - Regression, Compatibility, and Documentation

_Owner:_ quality-reviewer  
_Requirements:_ REQ-007, REQ-008, REQ-009  
_Depends:_ TASK-002 through TASK-007 for feature-specific regression coverage.  
_Boundary:_ `tests/regression/**`, `tests/compat/**`, `tests/bdd/**`, `docs/migrations/**`, `docs/diagrams/**`, `docs/examples/**`, `.kiro/specs/paperclip-task-tree-factory/**`.

- [x] 8.1 Add compatibility fixtures.
  - Done means `tests/compat/**` covers audit, bugfix, feature, hotfix, spec, and UX-like scenarios where applicable.
- [x] 8.2 Consolidate regression tests by canonical version as features land.
  - Done means v6.0.0 through v7.12.0 invariants were added in the same waves as the behavior they protect; Wave 6B only consolidates fixtures, residual gaps, and documented skipped/deferred behavior.
- [x] 8.3 Align BDD feature coverage.
  - Done means natural-language scenarios cover the key canonical behaviors without replacing deterministic tests.
- [x] 8.4 Add migration guides.
  - Done means guides explain Codex adaptation, not just Claude migration text copied verbatim.
- [x] 8.5 Add diagrams and examples.
  - Done means diagrams/examples are accurate against the Codex runtime and do not promise unimplemented behavior.
- [x] 8.6 Create `.kiro/specs/paperclip-task-tree-factory`.
  - Done means the Paperclip spec exists with `spec.json`, `requirements.md`, `design.md`, and `tasks.md` if still applicable after Wave 6A.
- [x] 8.7 Validate Wave 6B.
  - Done means `npm run lint:types`, `npm run build`, `npm test`, `python .agents/skills/workflow-eval-gate/scripts/run_eval.py`, docs review, and Task 10 wave-governance evidence exist. Focused Vitest subsets may substitute for `npm test` only after a real `npm test` attempt is documented as blocked by Windows memory/IPC behavior; any skipped command requires an explicit recorded justification.

---

## TASK-009: Final Closeout and Optional Publication Boundary

_Owner:_ final-validator  
_Requirements:_ REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008  
_Depends:_ TASK-010.7 zero-finding final specialized review evidence before final closeout may be produced.  
_Boundary:_ closeout docs, build output generated by `npm run build`, optional Marketplace/cache proof only if explicitly executed.

- [ ] 9.1 Run final repo validation.
  - Done means `npm run lint:types`, `npm run build`, `npm test`, and `python .agents/skills/workflow-eval-gate/scripts/run_eval.py` are recorded. Focused Vitest subsets may substitute for `npm test` only after a real `npm test` attempt is documented as blocked by Windows memory/IPC behavior.
- [ ] 9.2 Review generated `dist/**`.
  - Done means any `dist/**` changes are build-generated and match source changes.
- [ ] 9.3 Attach zero-finding final specialized review evidence.
  - Done means Task 10.7 has completed with `spawn_agent`, `wait_agent`, artifact collection, and zero findings before any final closeout report is produced.
- [ ] 9.4 Produce final closeout report.
  - Done means the report lists changed files, skipped/deferred items, tests, Eval Gate result, risks, and exact parity claim level.
- [ ] 9.5 Update or explicitly defer front-door package metadata.
  - Done means `.codex-plugin/plugin.json`, `package.json`, marketplace entry, installed cache path, and `hooks/hooks.json` user-facing text are updated or explicitly deferred based on runtime/cache smoke proof.
- [ ] 9.6 If publication/cache sync is in scope, prove each layer separately.
  - Done means repo, Marketplace/local copy, installed Codex cache, and live smoke behavior are each named with evidence.
- [ ] 9.7 If publication/cache sync is not in scope, say so explicitly.
  - Done means final status cannot be misread as "published and active" when only repo implementation was completed.
- [ ] 9.8 Require installed-cache proof for complete public portability claims.
  - Done means public plugin, skill, hook, or workflow behavior cannot be labeled complete portability unless package-surface proof and installed-cache smoke proof exist; otherwise the report uses a narrower claim such as `repo-only`.

---

## TASK-010: Cross-Wave TDD, BDD, DDD, and Adversarial Review Governance

_Owner:_ final-adversarial-orchestrator  
_Requirements:_ REQ-009  
_Boundary:_ test plans, tests, review artifacts, Eval Gate reports, and wave closeout evidence.

- [ ] 10.1 Define the test plan before each wave implementation.
  - Done means each wave names required TDD red/green/refactor tests, BDD scenarios, DDD/domain invariants, and Codex harness checks before code changes begin.
- [ ] 10.2 Run adversarial review after every TDD test group.
  - Done means no TDD group can be treated as complete until a real `spawn_agent`/`wait_agent` independent review with artifact collection passes or routes defects back to implementation.
- [ ] 10.3 Run adversarial review after every BDD test group.
  - Done means no BDD group can be treated as complete until a real `spawn_agent`/`wait_agent` independent review with artifact collection passes or routes defects back to implementation.
- [ ] 10.4 Run adversarial review after every DDD/domain-invariant group.
  - Done means no DDD group can be treated as complete until a real `spawn_agent`/`wait_agent` independent review with artifact collection passes or routes defects back to implementation.
- [ ] 10.5 Enforce the three-loop repair cap.
  - Done means the same problem area gets at most three implementation/review loops before escalation.
- [ ] 10.6 Spawn a fresh alternative agent after three failed loops.
  - Done means the alternative agent is a real Codex subagent, is independent, does not fork project context, and is asked for a previously unseen correction path.
- [ ] 10.7 Run final specialized Codex harness review.
  - Done means fresh specialized real Codex subagents review architecture, engineering quality, and Codex plugin execution adaptability through `spawn_agent` plus `wait_agent` with artifact collection; if that runtime is unavailable, the task stops with `blocked-no-agent-runtime`, reports `pipeline_valid: false`, and any manual/harness fallback does not count as pipeline evidence. Completion is blocked unless the final review has zero findings.
- [ ] 10.8 Validate the plugin/skill/hook/package matrix.
  - Done means the wave closeout proves manifest schema/path existence, new skill folder/frontmatter alignment, skill `description` trigger clarity/tightness, governed-skill tests, hook deny path, hook `type: "command"`, public skill dispatch, installed-cache boundary, Eval Gate, and relevant package-surface checks.

## Task Graph Sanity Review

Verdict: PASS.

Reasoning:

- Every requirement maps to at least one task.
- Each wave has verification before implementation and validation after implementation.
- High-risk areas have explicit boundaries and dependencies.
- Publication/cache activation is separated from local repo implementation.
- Task 10 is a mandatory cross-wave gate, not postponed cleanup; each wave validation requires Task 10 evidence.
- TDD, BDD, DDD, and adversarial review governance is explicit and blocks final completion until zero findings.
- The task graph is intentionally sequential by wave; parallel work may happen only inside a wave after file-scope checks prove it is safe.
