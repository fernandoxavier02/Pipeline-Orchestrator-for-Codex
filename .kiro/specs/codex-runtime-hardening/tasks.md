# Implementation Tasks: Codex Runtime Hardening

**Status:** ready-to-plan
**Total tasks:** 10
**Estimated effort:** 8-14 days
**Critical path:** Task 1 -> Task 3 -> Task 4 -> Task 5

## Requirement-Task Mapping

| Requirement | Task | Primary files |
| --- | --- | --- |
| R1 | T1 | `AGENTS.override.md`, `runtime/codex/AGENTS.override.md` |
| R2 | T2 | `pipeline.runtime.json`, prompt-facing consistency tests |
| R3 | T3 | `hooks/codex-hooks.json`, `.codex/hooks/**`, patch parser |
| R4 | T4 | `.pipeline/codex/change-contract.json`, scope lock |
| R5 | T5 | `scripts/codex-pipeline-runner.cjs` |
| R6 | T6 | `schemas/codex-pipeline/**` |
| R7 | T7 | `.codex/hooks/codex-completion-check.cjs`, trace writer |
| R8 | T8 | `runtime/codex/subagent-capability.cjs`, event logging |
| R9 | T9 | `runtime/claude/**`, `runtime/codex/**`, `runtime/shared/**` |
| R10 | T10 | `tests/**`, `evals/outputs/latest_output.md` |

---

# PHASE 1 - P0 Enforcement Floor

## Task 1: Create Codex Runtime Contract Override

**Requirement:** R1
**Priority:** P0
**Estimated effort:** 1-2 hours

### 1.1 Add root `AGENTS.override.md`

- [ ] File: `AGENTS.override.md`
- [ ] Declare `CODEX_RUNTIME`.
- [ ] Quarantine Claude-only tool names as non-operational in Codex.
- [ ] Point to `pipeline.runtime.json`, runner, Codex hooks and CHANGE_CONTRACT.
- [ ] Keep concise; do not duplicate long runtime docs.

### 1.2 Add static test for contract markers

- [ ] File: `tests/unit/codex-runtime-contract.test.ts`
- [ ] Assert `CODEX_RUNTIME` marker exists.
- [ ] Assert Claude-only tool names are listed as quarantined.
- [ ] Assert file size stays below agreed instruction budget.

### Acceptance Criteria

- [ ] `AGENTS.override.md` exists.
- [ ] `AGENTS.md` is not overwritten.
- [ ] Static test passes.

## Task 2: Add Runtime Manifest and Drift Tests

**Requirement:** R2
**Priority:** P1
**Estimated effort:** 2-4 hours

### 2.1 Create `pipeline.runtime.json`

- [ ] File: `pipeline.runtime.json`
- [ ] Include runtime contract version, canonical entrypoints, Codex state dir and hook config path.
- [ ] Add agent count fields only after verifying current counts.

### 2.2 Add prompt-facing consistency test

- [ ] File: `tests/unit/runtime-manifest.test.ts`
- [ ] Parse manifest.
- [ ] Scan selected prompt-facing files for stale version/count/runtime literals.
- [ ] Fail on known stale strings once current canonical values are established.

### Acceptance Criteria

- [ ] Manifest parses as JSON.
- [ ] Test blocks drift in prompt-facing files.
- [ ] Historical docs can keep old facts only with explicit historical marker.

## Task 3: Create Codex-Native Hooks and Patch Parser

**Requirement:** R3
**Priority:** P0
**Estimated effort:** 4-8 hours

### 3.1 Add `hooks/codex-hooks.json`

- [ ] Use Codex event names.
- [ ] Add `PreToolUse` matcher for `^apply_patch$|Edit|Write`.
- [ ] Add `PreToolUse` matcher for `^Bash$`.
- [ ] Add completion hook registration where supported by local Codex config.

### 3.2 Add patch parser

- [ ] File: `runtime/codex/patch-parser.cjs` or `.codex/hooks/lib/patch-parser.cjs`
- [ ] Extract targets from Add/Update/Delete/Move patch headers.
- [ ] Normalize paths relative to repo root.
- [ ] Fail closed on edit-like patches with no resolvable targets.

### 3.3 Add Bash write guard

- [ ] File: `.codex/hooks/codex-bash-write-guard.cjs`
- [ ] Detect redirects, `rm`, `mv`, copy-overwrite and common write operators.
- [ ] Validate targets against CHANGE_CONTRACT when runtime is Codex.

### 3.4 Add hook tests

- [ ] File: `tests/unit/codex-hooks-config.test.ts`
- [ ] File: `tests/unit/codex-patch-parser.test.ts`
- [ ] File: `tests/integration/codex-bash-write-guard.test.ts`

### Acceptance Criteria

- [ ] apply_patch targets are extracted and tested.
- [ ] Bash write bypass is denied in test.
- [ ] Hook denial shape uses Codex-supported `hookSpecificOutput`.

## Task 4: Implement CHANGE_CONTRACT Fail-Closed Scope Lock

**Requirement:** R4
**Priority:** P0
**Estimated effort:** 4-8 hours

### 4.1 Define CHANGE_CONTRACT schema

- [ ] File: `schemas/codex-pipeline/change-contract.schema.json` or TypeScript/Zod equivalent.
- [ ] Include `allowed_files`, `forbidden_files`, `required_checks`, `acceptance_checks`, `approved`.

### 4.2 Implement scope lock

- [ ] File: `.codex/hooks/codex-scope-lock.cjs`
- [ ] Deny edits when `PIPELINE_RUNTIME=codex` and no approved CHANGE_CONTRACT exists.
- [ ] Validate all apply_patch targets.
- [ ] Persist allow/deny event to `.pipeline/codex/events.jsonl`.

### 4.3 Add integration tests

- [ ] File: `tests/integration/codex-scope-lock.test.ts`
- [ ] Cover no contract -> deny.
- [ ] Cover allowed target -> allow.
- [ ] Cover forbidden target -> deny.
- [ ] Cover unresolved target -> deny.

### Acceptance Criteria

- [ ] Scope lock fails closed.
- [ ] Every target in a multi-file patch is checked.
- [ ] Events are persisted for allow and deny decisions.

---

# PHASE 2 - Runner and Schemas

## Task 5: Build Deterministic Codex Pipeline Runner

**Requirement:** R5
**Priority:** P0
**Estimated effort:** 1-2 days

### 5.1 Add runner

- [ ] File: `scripts/codex-pipeline-runner.cjs`
- [ ] Initialize `.pipeline/codex/state.json`.
- [ ] Initialize `.pipeline/codex/events.jsonl`.
- [ ] Own the transition table.
- [ ] Stop on invalid transition or invalid step output.

### 5.2 Add state tests

- [ ] File: `tests/unit/codex-runner-state.test.ts`
- [ ] Test valid transition path.
- [ ] Test invalid transition blocks.
- [ ] Test invalid JSON blocks.

### Acceptance Criteria

- [ ] Runner never advances on malformed step output.
- [ ] Final state is constrained to `VALIDATED`, `BLOCKED` or `FAILED`.

## Task 6: Add Structured Step Schemas

**Requirement:** R6
**Priority:** P1
**Estimated effort:** 1 day

### 6.1 Add schemas

- [ ] `schemas/codex-pipeline/classify-task-output.schema.json`
- [ ] `schemas/codex-pipeline/plan-output.schema.json`
- [ ] `schemas/codex-pipeline/implement-output.schema.json`
- [ ] `schemas/codex-pipeline/review-output.schema.json`
- [ ] `schemas/codex-pipeline/final-validate-output.schema.json`

### 6.2 Add parser/validator

- [ ] File: `runtime/codex/step-output-validator.cjs` or TypeScript equivalent.
- [ ] Include schema version in every parsed output.

### 6.3 Add schema tests

- [ ] File: `tests/unit/codex-step-schemas.test.ts`
- [ ] Valid fixtures pass.
- [ ] Missing required fields fail.
- [ ] Wrong `required_next_step` fails when checked by runner.

### Acceptance Criteria

- [ ] Every runner step has a versioned schema.
- [ ] Invalid step payloads fail deterministically.

## Task 7: Add Completion Check and Trace Writer

**Requirement:** R7
**Priority:** P1
**Estimated effort:** 4-8 hours

### 7.1 Implement trace writer

- [ ] File: `runtime/codex/trace-writer.cjs` or TypeScript equivalent.
- [ ] Write `.pipeline/codex/trace.md`.
- [ ] Include changed files, checks, review evidence, skipped checks and final status.

### 7.2 Implement completion checker

- [ ] File: `.codex/hooks/codex-completion-check.cjs` or runner-integrated equivalent.
- [ ] Require evidence for patch, checks, adversarial review and trace.
- [ ] Block with `BLOCKED_INCOMPLETE_TRACE` on missing required evidence.

### 7.3 Add tests

- [ ] File: `tests/integration/codex-completion-check.test.ts`
- [ ] Missing review evidence blocks.
- [ ] Missing checks evidence blocks unless approved skip reason exists.
- [ ] Complete trace validates.

### Acceptance Criteria

- [ ] Run cannot claim done without required evidence.
- [ ] Final report has paths to state, events, trace and checks.

## Task 8: Make Subagent Availability Explicit

**Requirement:** R8
**Priority:** P1
**Estimated effort:** 4-8 hours

### 8.1 Add capability module

- [ ] File: `runtime/codex/subagent-capability.cjs`
- [ ] Detect whether real Codex subagent execution is available in the current runtime.
- [ ] Expose modes: `real-subagent`, `inline-review`, `blocked-no-agent-runtime`.

### 8.2 Integrate with runner review step

- [ ] If real subagents are required and unavailable, stop with `blocked-no-agent-runtime`.
- [ ] If fallback is allowed, record fallback mode in events.

### 8.3 Add tests

- [ ] File: `tests/unit/subagent-capability.test.ts`
- [ ] Required unavailable -> blocked.
- [ ] Optional unavailable -> inline fallback recorded.
- [ ] Real available -> lifecycle events required.

### Acceptance Criteria

- [ ] No final report claims real multi-agent execution without logged spawn evidence.
- [ ] Prompt-facing docs do not say subagents are automatic unless proven.

---

# PHASE 3 - Runtime Separation and Verification

## Task 9: Separate Claude and Codex Runtime Assets

**Requirement:** R9
**Priority:** P2
**Estimated effort:** 1-2 days

### 9.1 Create runtime layout

- [ ] `runtime/claude/`
- [ ] `runtime/codex/`
- [ ] `runtime/shared/`

### 9.2 Move or mirror Codex assets

- [ ] Put stable Codex runner/hook docs under `runtime/codex/`.
- [ ] Keep executable scripts in the location required by existing repo conventions.
- [ ] Keep `commands/pipeline.md` short and discoverable.

### 9.3 Label Claude-only files

- [ ] Add headers or notes to Claude-only contracts.
- [ ] Ensure Claude-only tool names do not appear as Codex operational instructions.

### 9.4 Add separation tests

- [ ] File: `tests/unit/runtime-separation.test.ts`
- [ ] Verify runtime map exists.
- [ ] Verify Claude-only files are labeled.
- [ ] Verify Codex contract does not depend on Claude-only tools.

### Acceptance Criteria

- [ ] Public command maps to effective Codex runtime path.
- [ ] Runtime-specific assumptions are labeled.

## Task 10: Add Acceptance Tests, Eval Gate and Closeout Evidence

**Requirement:** R10
**Priority:** P2
**Estimated effort:** 1 day

### 10.1 Run focused checks

- [ ] `npm run lint:types`
- [ ] `npm run build`
- [ ] `npm test`
- [ ] Focused Vitest commands for new tests if full suite is too heavy.

### 10.2 Run Eval Gate

- [ ] `python .agents/skills/workflow-eval-gate/scripts/run_eval.py`
- [ ] Update `evals/outputs/latest_output.md` if the change touches governed workflow/plugin/hook/command/script surfaces.
- [ ] Record whether hooks were trusted/active or only tested as files.

### 10.3 Final implementation report

- [ ] Include Summary.
- [ ] Include Files changed.
- [ ] Include Tests/checks run.
- [ ] Include Assumptions.
- [ ] Include Risks.
- [ ] Include Anything not done.

### Acceptance Criteria

- [ ] Checks are real, not claimed.
- [ ] Eval Gate result is recorded when applicable.
- [ ] Remaining live-runtime proof gaps are explicit.

---

# Checkpoints

## Checkpoint 1: P0 Enforcement Floor

Required before proceeding:

- [ ] `AGENTS.override.md` exists.
- [ ] Codex hook config parses.
- [ ] apply_patch parser tests pass.
- [ ] Scope lock denies edits without approved CHANGE_CONTRACT.

## Checkpoint 2: Runner and Schemas

Required before proceeding:

- [ ] Runner transition tests pass.
- [ ] Step schemas parse valid fixtures and reject invalid fixtures.
- [ ] Trace writer produces required fields.

## Checkpoint 3: Runtime Separation

Required before proceeding:

- [ ] Runtime layout exists.
- [ ] Manifest maps public command to Codex runtime.
- [ ] Claude-only assets are labeled.

## Checkpoint 4: Final Validation

Required before declaring PASS:

- [ ] `npm run lint:types`
- [ ] `npm run build`
- [ ] `npm test` or documented focused substitute.
- [ ] Eval Gate PASS if governed surfaces changed.
- [ ] Final report distinguishes file-level tests from live Codex hook trust.

## Verification Checklist

### Pre-Implementation

- [ ] Inspect current `hooks/hooks.json`, `.codex/hooks.json`, `commands/pipeline.md`, `skills/pipeline/SKILL.md`, `src/**` and tests.
- [ ] Confirm whether existing dirty worktree changes are related before editing.
- [ ] Establish baseline checks or document why baseline cannot run.

### Post-Implementation

- [ ] New files are in expected runtime/spec paths.
- [ ] No `dist/**` manual edits.
- [ ] No new dependencies unless explicitly approved.
- [ ] No public docs claim live hook/subagent activation without proof.

## Open Questions Resolution

| Question | Status | Default decision |
| --- | --- | --- |
| Root-only or templated `AGENTS.override.md` | Open | Start root-only, mirror to `runtime/codex/` only as source template if needed |
| Approval source for CHANGE_CONTRACT | Open | Require approved contract before production edits |
| Runner location | Open | Start in `scripts/`; move to `runtime/codex/` after stable |
| Live subagent proof | Open | Treat as unavailable until proven in current Codex runtime |
| Prompt-facing scan breadth | Open | Start with minimal critical set; expand after P0 |
