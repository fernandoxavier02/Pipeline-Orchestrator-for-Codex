# Claude v8 Portability Plan for Codex

Status: partial implementation, 2026-06-17

## Source Compared

- Source repo: `D:\Pipeline Orchestrator Claude\Pipeline-Orchestrator`
- Target repo: `D:\Pipeline Orchestrator for Codex`
- Source commits inspected:
  - `7ed816a` / v8.0.0: spec-authoring workflow take-over
  - `c289bc3` / v8.1.0: dispatch-pending preventive lock
  - `1854b60` / v8.2.0: deterministic Plan-Mode gate and hardened write locks
  - `ea5ca48` / v8.2.1: Plan-Mode plan-file exemption
  - `4f316a7` / v7.14.1: gate-decision SSOT and stale audit correction

## Improvements Found

1. Spec authoring take-over
   - Source: `/pipeline-orchestrator:spec` authors and seals a new specification, then stops before implementation.
   - Evidence: `skills/spec/SKILL.md`, `agents/core/spec-controller.md`, `references/run-orchestration-substrate.md`, `tests/regression/v8.0.0/F1_spec_authoring_surfaces.cjs`.
   - Codex gap: `skills/spec/SKILL.md` still describes legacy spec processing through `pipeline-controller`; TypeScript `WORKFLOW_NEXT_STEPS.spec` also routed to `spec-light/spec-heavy`.
   - Port status: TypeScript handoff changed so `spec` now advances to `spec-init`; full `spec-controller` port remains pending.

2. Shared run-orchestration substrate
   - Source: run directory allocation, manifest transition, and audit append are centralized in `lib/run-directory.cjs`, `lib/run-manifest.cjs`, and `lib/gate-decision-writer.cjs`.
   - Evidence: `references/run-orchestration-substrate.md`.
   - Codex gap: Codex has TypeScript stores for session, gates, sentinel, and checkpoints, but no single workflow-substrate module that defines shared run lifecycle ownership for brainstorm/spec/workflow controllers.
   - Port plan: create a TypeScript substrate only after the spec-controller shape is ported, to avoid a parallel system.

3. Dispatch-pending preventive lock
   - Source: v8.1.0 blocks production writes while `DISPATCH_REQUEST`, `GATE_REQUEST`, or `PLAN_MODE_REQUEST` is pending.
   - Evidence: `.claude/hooks/edit-guard-hook.cjs`, `docs/plans/2026-06-17-dispatch-pending-lock.md`, `tests/.../dispatch-pending-lock.test.cjs`.
   - Codex gap: `hooks/edit-guard-hook.cjs` enforces session lock and change-contract scope, but does not yet inspect sentinel pending protocol blocks.
   - Port plan: adapt to `.codex/pipeline` paths and Codex hook payloads with tests before enabling as blocking.

4. Deterministic Plan-Mode gate
   - Source: v8.2.0 requires an approved plan in signed state before production writes for code-changing workflows.
   - Evidence: `scripts/record-plan-gate.cjs`, `.claude/hooks/edit-guard-hook.cjs`, `tests/unit/record-plan-gate.test.cjs`.
   - Codex gap: `src/controller/plan-mode.ts` and `src/protocol/plan-mode-bypass.ts` enforce plan-mode protocol shape, but hook-level write blocking until approval is not ported.
   - Port plan: introduce Codex-native plan approval state and hook enforcement after pending-dispatch lock is in place.

5. Plan file exemption for Plan Mode
   - Source: v8.2.1 exempts `~/.claude/plans` from Plan-Mode write blocking to avoid deadlocking the plan itself.
   - Evidence: `ea5ca48` and `plan-mode-exemption.test.cjs`.
   - Codex gap: Codex equivalent plan-file location must be verified before porting; do not assume Claude paths.
   - Port plan: identify Codex plan artifact path first, then exempt only that path plus `.codex/pipeline/**`.

6. Gate-decision SSOT/schema drift hardening
   - Source: canonical 8-value decision vocabulary and writer-side schema enforcement.
   - Evidence: `lib/contracts/gate-decision.cjs`, `lib/gate-decision-writer.cjs`, v7.14.1 release notes.
   - Codex status: partially ported. `src/state/gate-log.ts` already centralizes write provenance and maps canonical decisions to the local `pass|block|skip|partial` schema.
   - Port plan: keep the local schema unless a compatibility migration is requested.

## Portability Plan

### Batch 1: Safe TypeScript Workflow Graph

- Change `src/workflow/next-step.ts` so `spec` starts authoring via `spec-init`.
- Preserve `spec-light`, `spec-heavy`, and `spec-audit-only` as existing-spec processing workflows.
- Add/adjust tests in `tests/unit/workflow/next-step.test.ts`.

Acceptance:

- `/pipeline-orchestrator-for-codex:spec` terminal handoff points to `/pipeline-orchestrator-for-codex:spec-init`.
- `spec-tasks` still routes to `spec-light` or `spec-heavy` by complexity.
- `spec-light/heavy/audit-only` still close through `verify-completion`.

### Batch 2: Spec Authoring Runtime Parity

- Port or Codex-adapt `agents/core/spec-controller.md`.
- Add `agents/brainstorm/step-01c-ideation.md` and the spec adversarial critic only with prompt/stub parity tests.
- Update `skills/spec/SKILL.md` to dispatch the new controller after the controller exists.
- Keep existing spec-processing variants unchanged.

Acceptance:

- Spec authoring produces `spec.json`, `requirements.md`, `design.md`, `tasks.md`, and `research.md`.
- The authoring run stops before implementation.
- Existing spec-processing tests still pass.

### Batch 3: Codex Run-Orchestration Substrate

- Factor shared TypeScript helpers only where current stores duplicate behavior.
- Reuse `src/state/gate-log.ts`, `src/state/session-store.ts`, `src/state/checkpoint-store.ts`, and `src/sentinel/sentinel-state.ts`.
- Avoid copying Claude CJS directly.

Acceptance:

- Brainstorm/spec/workflow controllers share run id, manifest/session, and audit append rules.
- No new writer bypasses `src/state/gate-log.ts`.

### Batch 4: Preventive Locks

- Port pending-dispatch lock to `hooks/edit-guard-hook.cjs` using `.codex/pipeline` state.
- Add plan approval state and deterministic Plan-Mode write lock.
- Add Codex-specific plan-file exemption only after verifying the real artifact path.

Acceptance:

- Production writes are blocked while protocol blocks are pending.
- Production writes are blocked until required code-changing plans are approved.
- Plan artifact writes are not blocked by their own gate.

## Current Implementation

This pass has two partial ports:

- Batch 1 was already reflected in the working tree: `spec` next-step handoff points to `spec-init`, while `spec-light`, `spec-heavy`, and `spec-audit-only` remain execution/processing variants.
- Batch 4 was partially ported in TypeScript controller state: `executionPlanGate` is persisted in session and sentinel state, code-writing workflows require approval before controller-managed execution, and `PLAN_GATE_ACTIVE` records a hard block when a run tries to execute with the gate still open.

Not ported yet:

- Claude hook-level pending-dispatch lock.
- Claude hook-level production-write lock.
- Codex-specific plan-file exemption, because the Codex plan artifact path still needs live verification.
- Full v8.0.0 spec-controller/spec-authoring runtime parity.

This deliberately does not claim full v8.0/v8.2 runtime parity.
