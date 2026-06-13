# Portability Closeout v7.12

## Snapshot

- Ledger owner: `TASK-001`
- Canonical target: `v7.12.0`
- Codex baseline: `v0.5.0`
- Source audit: `docs/GAP_ANALYSIS_CANONICAL_VS_CODEX.md`
- Scope of this ledger: repo-state evidence only; no Marketplace, installed-cache, or live-session portability claim is made here.
- Wave 1 disposition: `done` at `repo-only` + `generated-build` scope; cache/live-plugin claims are explicitly deferred.

## Status Legend

| Status | Meaning |
| --- | --- |
| `open` | The audit gap is still open or only has documentary traces. |
| `partial` | The repo already contains relevant runtime, reference, or test scaffolding, but the canonical v7.12 contract is not yet proven complete. |
| `closed` | The repo already shows enough local evidence to treat the audit item as closed at repo layer. |
| `preserved` | Codex-only extension; not a parity gap and must not be removed to fake parity. |

## Claim Boundary

| Layer | Meaning | Current proof state |
| --- | --- | --- |
| `repo-only` | Source files, tests, references, specs, and docs in this checkout. | Proven by this ledger. |
| `generated-build` | Build artifacts regenerated from source, usually `dist/**`. | Proven by the current `npm run build` validation. |
| `marketplace/local copy` | Published package or copied plugin bundle outside this checkout. | Not proven. |
| `installed-cache` | The Codex-installed plugin cache actually used by the host. | Not proven. |
| `live-smoke` | Observed behavior from a live Codex session using the intended installed cache. | Not proven. |

Rules:

- Do not translate `repo-only` progress into publication, activation, or live portability claims.
- `commands/**` remain compatibility or documentation surfaces unless package and cache evidence prove otherwise.
- Real multi-agent claims still require actual `spawn_agent`/`wait_agent` runtime evidence; repo text alone is insufficient.

## Gap Ledger

### Group 1 — New Task Types and Skills

| Audit ID | Gap | Wave | Depends on | Status | Repo evidence now | Next proof needed |
| --- | --- | --- | --- | --- | --- | --- |
| `3.1` | Public `user-story` skill surface | `Wave 2` | `3.4` | `partial` | `references/pipelines/user-story-light.md`, `references/pipelines/user-story-heavy.md`, `src/controller/parse-mode.ts`, `src/controller/workflow-selection.ts`, `src/controller/build-proposal.ts` | Add `skills/user-story/**`, package-surface tests, and cache-boundary proof. |
| `3.2` | Public `ux-sim` skill surface | `Wave 2` | `3.4` | `partial` | `src/controller/parse-mode.ts`, `agents/executor/type-specific/ux-simulator.md`, `agents/executor/type-specific/ux-accessibility-auditor.md`, `agents/executor/type-specific/ux-qa-validator.md` | Add `skills/ux-sim/**`, report-only proof, and package-surface tests. |
| `3.3` | Public `measure-paperclip-fidelity` skill | `Wave 6A` | `6.1` | `closed` | `skills/measure-paperclip-fidelity/SKILL.md` exposes the public skill, `src/workflow/next-step.ts` has an explicit informational next-step rule, and package/skill-surface tests prove the repo package includes the skill and points to `references/paperclip/spec/lib/measure-fidelity.cjs`. | Repo/package-surface proof complete; installed-cache and live Paperclip execution remain out of scope until explicitly validated. |
| `3.4` | Skill-dispatch routing by public skill identity | `Wave 1` | none | `partial` | `src/controller/parse-mode.ts` now parses direct workflow commands for `feature`, `bugfix`, `audit`, `spec`, `user-story`, `ux-sim`, and Paperclip aliases; covered by `tests/unit/controller/paperclip-parse-mode.test.ts` and `tests/integration/plugin/workflow-runtime-routing.test.ts` | Public `skills/user-story/**` and `skills/ux-sim/**` still need to land in Wave 2 before this can move from router parity to full public-surface closure. |
| `3.5` | Brainstorm `step-01b-alternatives` role prompt | `Wave 2` | none | `closed` | `agents/brainstorm/step-01b-alternatives.md` now exists; `agents/core/brainstorm-controller.md` includes the 10-step sequence; `src/security/dispatch-contract.ts` registers `step-01b-alternatives`; `src/index.ts` accepts `brainstorm-alternatives-choice`; focused tests cover surface, dispatch, and gate response handling | Keep package/cache/live smoke claims out of this row unless a later closeout validates those layers. |

### Group 2 — Core Hardening

| Audit ID | Gap | Wave | Depends on | Status | Repo evidence now | Next proof needed |
| --- | --- | --- | --- | --- | --- | --- |
| `4.1` | 35-gate canonical-equivalent registry | `Wave 1` | none | `closed` | `references/gates.md` now records the 36-row Codex runtime inventory, `tests/unit/gates/gate-registry-reference.test.ts` keeps it aligned with `src/gates/gate-registry.ts`, the named canonical-era delta gates (`COMPLEXITY_GATE`, `STEP_1_7_ROUTING`, `STEP_1_7_RECURSION_GUARD`, `STOP_BEFORE_PA_DE_CAL`) are first-class registry rows, and focused controller/closeout tests prove emission or enforcement for all four | Keep gate inventory covered by full suite and Eval Gate before claiming broader Wave 1 closure. |
| `4.2` | 5-level hardness taxonomy including `AUDIT` | `Wave 1` | none | `closed` | `src/gates/gate-types.ts`, `src/domain/pipeline-schemas.ts`, `src/state/gate-log.ts`, `src/validation/final-validator.ts`, and focused tests now accept `AUDIT` and prove it does not block closeout | Keep this covered as later Wave 1 work touches gate compatibility and closeout logic. |
| `4.3` | 10-agent Plan Mode roster and enforcement | `Wave 4` | `5.2` | `partial` | `src/controller/plan-mode.ts`, `src/protocol/protocol-events.ts`, `src/protocol/protocol-handler.ts`, and `tests/integration/claude-v710-parity.test.ts` show protocol support | Add the machine-readable roster and host-backed enforcement proof for all mandatory agents. |
| `4.4` | Safe medium parallel dispatch | `Wave 4` | `5.2` | `partial` | `references/complexity-matrix.md` and `tests/unit/execution/executor-parity-contract.test.ts` already mention `parallel_eligible` behavior | Add file-scope disjointness checks and real-runtime blocking when required subagent capability is absent. |
| `4.5` | `CHANGE_CONTRACT` plus `SCOPE LOCK CHECK` | `Wave 3` | none | `partial` | `references/implementation-discipline.md` and existing edit guards show intent, but not the full canonical contract | Add contract generation/ingestion, deny-path proof, and runtime enforcement tests. |
| `4.6` | Visible progress protocol mapped to Codex primitives | `Wave 3` | none | `partial` | `references/visible-plan-contract.md` exists and governed skills already depend on `update_plan` | Prove end-to-end visible progress behavior for the targeted waves. |
| `4.7` | HMAC-signed sentinel state | `Wave 3` | none | `partial` | `src/sentinel/sentinel-state.ts` and `hooks/sentinel-hook.cjs` exist | Add integrity signing and tamper-detection tests without committing secret material. |
| `4.8` | Independent diff-discipline loop | `Wave 3` | none | `partial` | `agents/quality/diff-discipline-reviewer.md` exists and `references/implementation-discipline.md` defines the discipline surface | Add explicit retry-cap wiring and evidence that defects route back through the fix loop. |

### Group 3 — Observability and Telemetry

| Audit ID | Gap | Wave | Depends on | Status | Repo evidence now | Next proof needed |
| --- | --- | --- | --- | --- | --- | --- |
| `5.1` | Opt-in Langfuse tracing | `Wave 5` | `5.2` | `open` | No runtime `langfuse` module or hook integration was found under `src/**` or `hooks/**` | Add opt-in tracing, sanitization, and inert-by-default tests. |
| `5.2` | Race-safe `RunDirectory.allocate` parity | `Wave 4` | none | `partial` | `src/run/run-directory.ts` and `tests/unit/run/run-directory.test.ts` already provide atomic directory allocation | Re-check canonical id shape, collision behavior, and cross-surface usage before closing. |
| `5.3` | Runtime fidelity reporter | `Wave 5` | `5.6` | `partial` | Paperclip-only fidelity code exists in `references/paperclip/spec/lib/mirror-fidelity-report.cjs` | Add runtime-facing fidelity reporting using the gate system vocabulary. |
| `5.4` | Run-log aggregation with dedup | `Wave 5` | none | `open` | No dedicated `run-log` runtime module was found under `src/**` | Add the aggregator, dedup policy, and stop-hook regression tests. |
| `5.5` | User score collection | `Wave 5` | none | `open` | Current repo has confidence scoring (`src/state/confidence-score.ts`), not user score persistence | Add a separate score writer and evidence that it cannot corrupt gate logs. |
| `5.6` | Gate-decision writer as canonical SSOT | `Wave 1` | none | `closed` | `src/state/gate-log.ts` remains the only authorized writer, `tests/unit/lint/decided-by-centralization.test.ts` forbids hardcoded `decided_by` outside it, `tests/unit/lint/gate-log-writer-centralization.test.ts` forbids direct `gate-decisions.jsonl` writes outside the writer module, `tests/unit/state/gate-log.test.ts` pins the canonical 8-value to local 4-value decision map, and `src/protocol/protocol-handler.ts` routes protocol-selected labels through `normalizeCanonicalGateDecision` before writing named gates | Keep the local four-value persisted format until a deliberate migration proves safe support for a wider persisted vocabulary. |
| `5.7` | Execution identity tracing | `Wave 5` | none | `partial` | `src/observability/execution-identity.ts` is already consumed by `src/state/gate-log.ts` and has unit coverage | Reconcile current tracing with the v7.12 observability matrix and claim level. |
| `5.8` | Telemetry correlation and discovery pointer | `Wave 5` | `5.2` | `partial` | `references/openai-codex-kb/INDEX.md`, `evals/**`, and execution identity tracing provide a local base | Add explicit correlation fields across runtime, hooks, and reports, plus user-facing discovery proof. |

### Group 4 — Advanced Paperclip

| Audit ID | Gap | Wave | Depends on | Status | Repo evidence now | Next proof needed |
| --- | --- | --- | --- | --- | --- | --- |
| `6.1` | Complete flow-mirror library | `Wave 6A` | none | `partial` | `references/paperclip/spec/lib/**` now carries a frozen 13-module Codex flow-mirror inventory with paired tests, including the newly covered `measure-fidelity.cjs`; `tests/unit/paperclip/flow-mirror-inventory.test.ts` and `references/paperclip/spec/lib/measure-fidelity.test.cjs` prove the local repo inventory. | Canonical-source comparison or an explicit Codex-equivalent deviation is still required before claiming complete canonical flow-mirror parity; live Paperclip dispatch/smoke remains out of scope until explicitly validated. |
| `6.2` | Company provisioner inventory proof | `Wave 6A` | `6.1` | `closed` | `references/paperclip/scripts/provision-pipeline-company.cjs` exports the roster/skill inventory; `tests/unit/paperclip/provisioner-contract.test.ts` proves 47 unique cargos, 11 installable custom skills, workflow file existence, core skills, extra skill installability, and duplicate-free `desiredSkills`. | Repo-only proof complete; live Paperclip deployment remains out of scope until explicitly validated. |
| `6.3` | Idempotent stop-hook fidelity report | `Wave 6A` | `5.3` | `closed` | `hooks/session-cleanup-hook.cjs` writes `.codex/pipeline/fidelity-reports/<run_id>.json` with exclusive creation; `tests/unit/hooks/session-cleanup-hook.test.ts` proves one report per run id. | Repo-only proof complete; live hook trust remains out of scope until explicitly validated. |

### Group 5 — Tests and Regression

| Audit ID | Gap | Wave | Depends on | Status | Repo evidence now | Next proof needed |
| --- | --- | --- | --- | --- | --- | --- |
| `7.1` | Versioned regression suite `v6.0.0 -> v7.12.0` | `Wave 6B` | corresponding waves | `closed` | `tests/regression/canonical-version-manifest.json` indexes the canonical `v6.0.0 -> v7.12.0` range with explicit `covered` and `deferred` statuses; `tests/regression/canonical-version-manifest.test.ts` proves non-deferred entries point at existing repo evidence; `tests/regression/canonical-version-invariants.test.ts` verifies one executable invariant for every covered canonical release. `v6.0.0` remains explicitly deferred because no specific v6.0.0 invariant was ported in the current Codex waves. | Repo-only versioned regression coverage for ported canonical releases is closed; this does not claim the full canonical regression suite was translated. |
| `7.2` | BDD parity coverage | `Wave 6B` | corresponding waves | `closed` | `tests/bdd/wave6b-paperclip-parity.feature.test.ts` converts every `tests/compat/wave6b-paperclip-scenarios.json` fixture into Given/When/Then-style natural-language coverage while preserving the deterministic fixture as the source of truth; existing `tests/bdd/**` coverage remains in place for hotfix, governed routes, dispatch protection, edit authorization, session lifecycle, sentinel checkpoints, real-agent runtime, and state adapter integration. | Repo-only BDD parity for Wave 6B is closed; it does not prove installed-cache, Marketplace, VPS, or live plugin execution. |
| `7.3` | Compatibility fixtures | `Wave 6B` | none | `closed` | `tests/compat/wave6b-paperclip-scenarios.json` covers audit, bugfix, feature, hotfix, spec, user-story, and UX-like Paperclip scenarios; `tests/compat/wave6b-paperclip-scenarios.test.ts` verifies each scenario against existing command, skill, classifier override, and flow-template surfaces. | Repo-only fixture coverage is closed; installed-cache, Marketplace, VPS, and live plugin execution are not claimed. |

### Group 6 — Documentation and Kiro Specs

| Audit ID | Gap | Wave | Depends on | Status | Repo evidence now | Next proof needed |
| --- | --- | --- | --- | --- | --- | --- |
| `8.1` | Migration guides | `Wave 6B` | corresponding waves | `closed` | `docs/migrations/claude-to-codex.md` explains the Codex adaptation, command/skill mapping, real-agent runtime boundary, `blocked-no-agent-runtime`, and repo-only proof limits. `tests/unit/docs/documentation-surface.test.ts` guards the file. | Repo-only migration guide coverage is closed; installed-cache, Marketplace, VPS, and live plugin execution are not claimed. |
| `8.2` | Interactive HTML diagrams | `Wave 6B` | corresponding waves | `closed` | `docs/diagrams/runtime-surfaces.md` documents the runtime-surface flow across commands, skills, runtime, hooks, references, tests, Eval Gate, and closeout evidence. `docs/diagrams/runtime-surfaces.html` provides a static interactive diagram with expandable claim-boundary sections. `tests/unit/docs/documentation-surface.test.ts` guards both diagram artifacts and the runtime boundary. | Repo-only diagram coverage is closed; the diagrams do not prove installed-cache, Marketplace, VPS, or live plugin behavior. |
| `8.3` | Canonical examples | `Wave 6B` | corresponding waves | `closed` | `docs/examples/audit-flow.md`, `docs/examples/feature-flow.md`, and `docs/examples/spec-flow.md` provide evidence-backed examples tied to existing commands, skills, fixtures, BDD/spec tests, and explicit runtime boundaries. `tests/unit/docs/documentation-surface.test.ts` guards the example surface. | Repo-only example coverage is closed; examples do not prove Marketplace, installed-cache, VPS, or live plugin behavior. |
| `8.4` | Kiro spec `paperclip-task-tree-factory` | `Wave 6B` | `6.1` | `closed` | `.kiro/specs/paperclip-task-tree-factory/` now includes `spec.json`, `requirements.md`, `design.md`, and `tasks.md`, with focused proof in `tests/unit/paperclip/task-tree-factory-spec.test.ts`. | Repo-only spec surface is closed; installed-cache, Marketplace, VPS, and live Paperclip execution are not claimed. |

## Preserved Codex-Only Extensions

| Extension | Status | Evidence |
| --- | --- | --- |
| OpenAI/Codex knowledge base | `preserved` | `references/openai-codex-kb/INDEX.md` and companion KB articles |
| Kimi port root | `preserved` | `.kimi/` exists as a Codex-side extension point |
| Local Eval Gate | `preserved` | `evals/README.md`, `evals/tests/**`, `evals/outputs/latest_output.md` |
| Larger local BDD/test surface | `preserved` | `tests/bdd/**`, broad `tests/unit/**`, `tests/integration/**` footprint |

## Consistency Pass

### Audit-to-wave coverage

- Group 1 (`3.1-3.5`) maps to `Wave 1`, `Wave 2`, and `Wave 6A`.
- Group 2 (`4.1-4.8`) maps to `Wave 1`, `Wave 3`, and `Wave 4`.
- Group 3 (`5.1-5.8`) maps to `Wave 1`, `Wave 4`, and `Wave 5`.
- Group 4 (`6.1-6.3`) maps to `Wave 6A`.
- Group 5 (`7.1-7.3`) maps to `Wave 6B`.
- Group 6 (`8.1-8.4`) maps to `Wave 6B`.

### Task-to-wave coverage

| Task | Wave coverage |
| --- | --- |
| `TASK-001` | Ledger bootstrap and claim boundary |
| `TASK-002` | `Wave 1` |
| `TASK-003` | `Wave 2` |
| `TASK-004` | `Wave 3` |
| `TASK-005` | `Wave 4` |
| `TASK-006` | `Wave 5` |
| `TASK-007` | `Wave 6A` |
| `TASK-008` | `Wave 6B` |
| `TASK-009` | Cross-wave closeout |
| `TASK-010` | Cross-wave TDD/BDD/DDD/adversarial governance |

### Ledger checks

- Recorded audit gaps: `31`
- Preserved Codex-only extensions recorded: `4`
- Claim layers recorded: `5`
- No row in this ledger claims Marketplace publication, installed-cache sync, or live-smoke portability without direct proof.

## Final Closeout Evidence

| Artifact | Status | Evidence boundary |
| --- | --- | --- |
| Technical report | `present` | `reviews/technical-report.md` records repo-level findings, validation, publication boundary, and remaining risks. |
| Executive report | `present` | `reviews/executive-report.md` states the board-facing `repo-only` decision and the remaining publication proof needed before any public claim. |
| Final specialized review | `present` | `docs/audits/2026-06-13-pip-72-final-specialized-codex-harness-review.md` records zero findings for the reviewed documentation slice. |
| Eval Gate report | `present` | `evals/outputs/latest_output.md` records the latest evaluated closeout claim. |

Publication/cache/live-smoke validation remains explicitly out of scope for this closeout because no Marketplace copy, installed Codex cache, or live plugin smoke proof was executed.
