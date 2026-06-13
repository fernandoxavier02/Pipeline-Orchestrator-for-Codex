# Requirements

**Version:** 0.1.1
**Date:** 2026-06-12
**Status:** ready_for_wave_gate

## Introduction

The Codex port of `pipeline-orchestrator-for-codex` has a solid v0.5.0 base, but the canonical Claude Code repository has advanced to v7.12.0. The audit in `docs/GAP_ANALYSIS_CANONICAL_VS_CODEX.md` identifies a two-major-version gap across gates, task types, implementation discipline, Plan Mode, parallel execution, telemetry, Paperclip, regression tests, and docs.

This spec turns that audit into an executable Kiro plan. It freezes the target at canonical v7.12.0, preserves Codex-specific extensions, and requires each wave to prove behavior with runtime code, tests, and Eval Gate evidence before any parity claim.

## Glossary

- **Canonical_Repo**: The Claude Code source repository at `D:\Pipeline Orchestrator Claude\Pipeline-Orchestrator`, version v7.12.0 for this spec.
- **Codex_Repo**: This repository, `D:\Pipeline Orchestrator for Codex`.
- **Portability_Target**: Functional parity with canonical v7.12.0, adapted to Codex primitives and TypeScript ESM.
- **Wave**: A shippable group of related gaps that can be implemented, tested, and reviewed without requiring later waves to be complete.
- **Runtime_Evidence**: Code, tests, hooks, logs, Eval Gate output, smoke result, or persisted artifact proving behavior.
- **Parity_Claim**: Any statement that a canonical behavior is implemented, active, published, or available in the Codex plugin.

## Boundary

This spec owns the planning and implementation track for closing the v5.2-to-v7.12 gap identified by the audit. It does not own canonical v8 work, publication to Marketplace/cache, or deletion of the TypeScript runtime. It also does not auto-approve implementation of all waves; each wave requires its own workflow/method gate before execution. Those require separate evidence and, if needed, separate specs.

## Prework

- Source audit is available at `docs/GAP_ANALYSIS_CANONICAL_VS_CODEX.md`.
- Steering and repository authority files are available: `.kiro/CONSTITUTION.md`, `.kiro/steering/product.md`, `.kiro/steering/tech.md`, `.kiro/steering/structure.md`, and `AGENTS.md`.
- Runtime truth remains the highest project-level evidence for implementation claims after system/developer instructions and local governance.
- Publication/cache activation is unresolved prework for any future public portability claim and must be handled by a separate wave gate.

## Requirements

### REQ-001: Freeze and Verify the Portability Baseline

**User Story:** As the repository owner, I want the v7.12 portability target frozen and verified against the current Codex repo state, so that implementation starts from evidence instead of stale assumptions.

#### Acceptance Criteria

1. WHEN the portability work begins, THE Portability_Track SHALL record canonical target `v7.12.0`, Codex baseline `v0.5.0`, and source audit path `docs/GAP_ANALYSIS_CANONICAL_VS_CODEX.md`.
2. WHEN a gap from the audit is selected for implementation, THE Portability_Track SHALL first verify whether that gap is still open, partially implemented, or already closed in `skills/**`, `commands/**`, `src/**`, `hooks/**`, `agents/**`, `references/**`, `tests/**`, and `evals/**`.
3. IF verification shows a claimed gap is already closed, THEN THE Portability_Track SHALL record the evidence and skip duplicate implementation.
4. IF verification shows the audit conflicts with runtime truth, THEN THE Portability_Track SHALL treat runtime truth as higher authority and update the implementation plan rather than forcing the audit claim.
5. WHEN a wave closes, THE Portability_Track SHALL update the local evidence summary before moving to the next wave.

### REQ-002: Restore Foundation Parity for Gates and Skill Dispatch

**User Story:** As a pipeline user, I want gate decisions, gate hardness, and public workflow routing to match the canonical v7.12 behavior where applicable, so that workflows block, route, and report consistently.

#### Acceptance Criteria

1. WHEN Wave 1 completes, THE Gate_Registry SHALL expose the canonical 35-gate inventory or a documented Codex-specific equivalent with every missing/bypassed gate justified.
2. WHEN Wave 1 completes, THE Hardness_Model SHALL support `MANDATORY`, `HARD`, `CIRCUIT_BREAKER`, `SOFT`, and `AUDIT`, with `AUDIT` never blocking execution.
3. WHEN Wave 1 completes, THE Gate_Decision_Writer SHALL provide the SSOT for writing `gate-decisions.jsonl` with the canonical decision vocabulary.
4. WHEN Wave 1 completes, THE Skill_Dispatch_Router SHALL dispatch public workflow shortcuts by skill identity where required by v7.12, not only by derived task type.
5. IF a mandatory gate is marked bypassable by `--hotfix`, `--force`, or any equivalent override, THEN THE Foundation_Gate SHALL fail the wave.

### REQ-003: Add v7.12 Public Task Shortcuts

**User Story:** As a user invoking the plugin, I want first-class `user-story` and `ux-sim` skills plus the missing brainstorm alternative agent, so that common workflows do not require manual task-type inference.

#### Acceptance Criteria

1. WHEN Wave 2 completes, THE Public_Skill_Surface SHALL include `skills/user-story`, `skills/user-story-light`, and `skills/user-story-heavy` or an intentionally documented Codex-native equivalent with the same public trigger, observable behavior, gate semantics, telemetry/evidence, dedicated tests, ledger entry, and adversarial approval.
2. WHEN Wave 2 completes, THE Public_Skill_Surface SHALL include `skills/ux-sim`, `skills/ux-sim-light`, and `skills/ux-sim-heavy` or an intentionally documented Codex-native equivalent with the same public trigger, observable behavior, gate semantics, telemetry/evidence, dedicated tests, ledger entry, and adversarial approval.
3. WHEN `ux-sim` runs, THE workflow SHALL remain report-only unless the user separately authorizes implementation.
4. WHEN Wave 2 completes, THE Brainstorm_Internal_Role_Prompt_Surface SHALL include `step-01b-alternatives` or an intentionally documented Codex-native equivalent, and SHALL state that Markdown under `agents/**` is not proof of a real Codex custom subagent unless paired with `.codex/agents/*.toml` and host spawn evidence.
5. IF any `commands/**` file is touched, THEN THE Public_Skill_Surface SHALL treat it as compatibility/documentation only; new public Codex plugin behavior SHALL be delivered through `skills/<name>/SKILL.md`, `plugin.json:skills`, installed-cache proof, and smoke evidence.
6. IF any Codex-native equivalent is used instead of a canonical artifact name or file, THEN THE Portability_Track SHALL prove equivalent public trigger, observable behavior, gate/blocking semantics, telemetry/evidence, dedicated tests, ledger entry, and adversarial approval before it can satisfy the canonical gap.

### REQ-004: Enforce Implementation Discipline

**User Story:** As a maintainer, I want canonical implementation-discipline safeguards ported to Codex, so that scope creep and unauthorized writes are caught before they become silent drift.

#### Acceptance Criteria

1. WHEN Wave 3 completes, THE Sentinel_State SHALL be protected against tampering with HMAC or an equivalent integrity mechanism.
2. WHEN Wave 3 completes, THE Diff_Discipline_Review SHALL run with an independent fix loop and explicit maximum attempts.
3. WHEN Wave 3 completes, THE Change_Contract SHALL define allowed files, forbidden files, diff budget, and bootstrap instructions before write operations.
4. WHEN Wave 3 completes, THE Scope_Lock_Check SHALL enforce the Change_Contract before edits or writes.
5. WHEN Wave 3 completes, THE Visible_Progress_Surface SHALL map canonical progress protocol semantics to Codex-visible planning primitives.

### REQ-005: Mature Plan Mode and Parallel Execution

**User Story:** As an operator running complex work, I want the v7.10 Plan Mode and safe medium parallel dispatch adapted to Codex, so that agents act with the right approval boundary and parallelism only happens when file scopes are disjoint.

#### Acceptance Criteria

1. WHEN Wave 4 completes, THE Run_Directory_Allocator SHALL allocate run directories with exclusive creation and collision-resistant run ids.
2. WHEN Wave 4 completes, THE Plan_Mode_Roster SHALL define the 10 mandatory Plan Mode agents in a machine-readable file.
3. WHEN one of the mandatory Plan Mode agents is dispatched, THE Dispatch_Guard SHALL enforce `PLAN_MODE_REQUEST` to `PLAN_MODE_RESULTS` behavior unless a documented bypass applies.
4. WHEN medium work is `parallel_eligible`, THE Parallel_Dispatcher SHALL verify file-scope disjointness before launching parallel agents.
5. IF Codex host capabilities do not support real `spawn_agent`, `wait_agent`, required artifact collection, gate recording, hook/checkpoint recording, or structured final state for an operational path, THEN THE Parallel_Dispatcher SHALL stop with `blocked-no-agent-runtime`; diagnostic harness or manual fallback MAY run only when explicitly requested and SHALL report `pipeline_valid: false`.

### REQ-006: Add v7 Observability and Telemetry

**User Story:** As an operator debugging a pipeline run, I want canonical-grade run logs, fidelity reports, scores, correlation, and opt-in Langfuse traces, so that I can reconstruct what happened without reading prose guesses.

#### Acceptance Criteria

1. WHEN Wave 5 completes, THE Run_Log_Aggregator SHALL append material run-log events with deduplication based on stable event fields.
2. WHEN Wave 5 completes, THE Fidelity_Reporter SHALL report pipeline fidelity using the same decision and hardness vocabulary used by the gate system.
3. WHEN Wave 5 completes, THE User_Score_Collection SHALL persist user scores without corrupting gate evidence.
4. WHEN Wave 5 completes, THE Telemetry_Correlation SHALL include correlation fields across runtime, hooks, and reports.
5. WHEN Langfuse environment variables are present and tracing is enabled, THE Langfuse_Integration SHALL send sanitized opt-in traces; otherwise it SHALL remain inert.
6. IF telemetry contains secrets, raw prompts beyond allowed scope, or private payloads, THEN THE Sanitizer SHALL block or redact before persistence or export.

### REQ-007: Complete Paperclip, Regression, and Documentation Portability

**User Story:** As a maintainer using Paperclip and regression tests, I want advanced Paperclip support and versioned regression coverage ported after core runtime gaps are stable, so that the remaining canonical surface is useful and protected from future drift.

#### Acceptance Criteria

1. WHEN Wave 6 completes, THE Paperclip_Flow_Mirror SHALL include the complete canonical flow-mirror library and paired tests, adapted to Codex paths.
2. WHEN Wave 6 completes, THE Paperclip_Provisioner SHALL prove the expected role and skill inventory or document a Codex-specific deviation.
3. WHEN Wave 6 completes, THE Measure_Paperclip_Fidelity skill SHALL expose fidelity measurement to users.
4. WHEN Wave 6 completes, THE Stop_Hook_Fidelity_Report SHALL generate at most one fidelity report per run.
5. WHEN Wave 6 completes, THE Regression_Suite SHALL include compatibility fixtures, BDD parity where relevant, and versioned regression coverage for ported canonical releases.
6. WHEN Wave 6 completes, THE Documentation_Surface SHALL include migration guides, examples, diagrams, and the `paperclip-task-tree-factory` Kiro spec where still applicable.

### REQ-008: Close Out With Honest Parity Evidence

**User Story:** As the repository owner, I want final closeout to distinguish local implementation, tests, Marketplace/cache sync, and real plugin smoke behavior, so that no one mistakes a repo change for a published and loaded plugin.

#### Acceptance Criteria

1. WHEN any wave is declared done, THE Closeout_Report SHALL list changed files, tests run, Eval Gate result, and remaining risks.
2. WHEN a public parity claim is made, THE Closeout_Report SHALL cite Runtime_Evidence from the correct layer: repo, generated build, Marketplace copy, installed Codex cache, or live smoke behavior.
3. IF `src/**`, workflow, skill, hook, command, telemetry, gate, trace, batch, or review behavior changes, THEN Eval Gate SHALL run before declaring success.
4. IF `dist/**` must change, THEN it SHALL be generated by build and not edited manually.
5. IF Marketplace/cache publication is not performed, THEN THE Closeout_Report SHALL explicitly say the repo is updated but publication/cache activation is not proven.

### REQ-009: Enforce Test and Adversarial Review Governance

**User Story:** As the repository owner, I want every implementation wave to carry TDD, BDD, DDD, focused harness validation, and adversarial review loops, so that the generated implementation plan cannot be ignored by Codex agents when executed.

#### Acceptance Criteria

1. WHEN an implementation wave begins, THE Wave_Gate SHALL define the TDD red/green/refactor tests, BDD behavior scenarios, DDD/domain invariants, and Codex harness checks required for that wave before code changes begin.
2. WHEN a TDD test group completes, THE Wave_Gate SHALL dispatch an independent adversarial review before the wave may proceed to the next test group.
3. WHEN a BDD test group completes, THE Wave_Gate SHALL dispatch an independent adversarial review before the wave may proceed to the next test group.
4. WHEN a DDD/domain-invariant group completes, THE Wave_Gate SHALL dispatch an independent adversarial review before the wave may proceed to the next test group.
5. IF any adversarial review, alternative agent, or final specialized reviewer cannot run as a real Codex subagent through `spawn_agent`/`wait_agent` with artifact collection, THEN THE Wave_Gate SHALL stop with `blocked-no-agent-runtime`, SHALL report `pipeline_valid: false`, and SHALL mark any manual or harness fallback as `manual_fallback_counts_as_pipeline: false`.
6. IF any adversarial review finds a defect, THEN THE Wave_Gate SHALL route the defect back to the responsible implementation agents and repeat the fix/review loop up to three times.
7. IF the third loop still finds a defect in the same problem area, THEN THE Wave_Gate SHALL spawn a fresh independent alternative agent with no forked project context to propose a different correction path before continuing.
8. WHEN a wave claims completion, THE Wave_Gate SHALL include manifest, skill frontmatter, hook deny path, hook `type: "command"`, public skill dispatch, installed-cache boundary, Eval Gate, relevant package-surface checks, and canonical-version regression tests for behavior ported in that wave in the validation matrix.
9. WHEN a public plugin, skill, hook, or workflow behavior is claimed as complete portability rather than repo-only progress, THE Closeout_Report SHALL include at least package-surface proof and installed-cache smoke proof; `repo-only` evidence MAY close a local implementation wave but SHALL NOT close the full portability spec.
10. IF the final adversarial review reports any high, medium, or low finding, THEN THE Wave_Gate SHALL NOT declare the spec or implementation complete.
11. WHEN final completion is claimed, THE Closeout_Report SHALL cite a zero-finding final adversarial review from fresh specialized agents covering Codex harness architecture, engineering quality, and plugin execution adaptability.

## Coverage Matrix

| Requirement | Acceptance Criteria | Planned Test / Evidence |
| --- | --- | --- |
| REQ-001 | AC1-AC5 | Ledger consistency check, source audit cross-check, runtime evidence review |
| REQ-002 | AC1-AC5 | Gate registry tests, hardness policy tests, gate-decision writer tests, skill dispatch tests |
| REQ-003 | AC1-AC6 | Public skill manifest/path tests, UX report-only tests, brainstorm role prompt dispatch evidence |
| REQ-004 | AC1-AC5 | Sentinel integrity tests, diff discipline loop tests, change contract and scope lock deny tests |
| REQ-005 | AC1-AC5 | Run directory race tests, Plan Mode roster tests, dispatch guard tests, parallel scope tests |
| REQ-006 | AC1-AC6 | Run-log dedup tests, fidelity report tests, score persistence tests, telemetry sanitizer tests |
| REQ-007 | AC1-AC6 | Paperclip flow mirror tests, provisioner inventory tests, fidelity skill tests, regression/BDD fixtures |
| REQ-008 | AC1-AC5 | Wave closeout report review, Eval Gate output, package/cache claim boundary checks |
| REQ-009 | AC1-AC11 | Wave gate checklist, adversarial review artifacts, loop-cap evidence, final specialized review evidence |
