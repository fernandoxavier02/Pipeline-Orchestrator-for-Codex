---
name: brainstorm
description: "Prepare a governed pipeline run before implementation. Allocates pipeline-runs/<NNN>-<slug>, captures intent, drives spec lifecycle skills, validates design/gap, then hands off to /pipeline."
agent_type: worker
gates_at: [phase-0, phase-1, phase-1.5]
sentinel_checkpoints: [post_orchestrator, phase_0_to_1, phase_1_to_2]
---

# Brainstorm — Codex v5.2 Preparation Front-End

## VISIBLE_PLAN Contract

Before any execution, file edit, dispatch, report generation, validation claim, or terminal response, call `update_plan` so the user sees the workflow plan in Codex. This is mandatory for this workflow and uses `references/visible-plan-contract.md` as the SSOT.

The visible plan must name the selected workflow/mode, declare the planned batches, and track PDD, DDD, ATDD, and TDD or the report-only evidence-first equivalent. Every batch must be followed by checkpoint validation, adversarial review, and a fix loop capped at 3 attempts before continuing. Keep exactly one item `in_progress` and update the plan after every gate, batch, review, correction, and final validation. If the visible plan cannot be opened or updated, stop and surface the blocker instead of proceeding invisibly.

## NEXT_STEP Contract

When this workflow reaches any terminal state, emit the `NEXT_STEP` block defined in `references/workflow-next-step.md`. Use the workflow name from this file's frontmatter as `current_workflow`; if blocked or waiting on the user, point back to the same workflow instead of advancing.

Use this skill before heavy `/pipeline` execution when the request still needs intake, spec shaping, design validation, or gap validation.

## Flow

1. Allocate a fresh `pipeline-runs/<NNN>-<slug>/` directory with:
   - `00-brainstorm/`
   - `01-spec/`
   - `02-validations/`
   - `03-execution/`
   - `attachments/`
   - `manifest.yaml`
2. Dispatch `agents/core/brainstorm-controller.md`.
3. The controller dispatches `agents/brainstorm/step-00-intake.md` and `agents/brainstorm/step-01-explore.md`.
4. Run the spec lifecycle skills when needed:
   - `spec-init`
   - `spec-requirements`
   - `spec-design`
   - `spec-tasks`
   - `validate-design`
   - `validate-gap`
5. Present the handoff decision: run `/pipeline`, save only, or abort.

## Achado #7 GATE_REQUEST handler

When the brainstorm controller or any child step returns `=== GATE_REQUEST v1 ===`, `=== DISPATCH_REQUEST v1 ===`, or `=== PLAN_MODE_REQUEST v1 ===`, the parent main context MUST process the block and persist the event in `protocol-events.jsonl`.

- `GATE_REQUEST`: collect the user decision in the parent context.
- `DISPATCH_REQUEST`: dispatch the target agent or skill from the parent context.
- `PLAN_MODE_REQUEST`: enter or exit the requested planning checkpoint.

Never silently default answers. Malformed blocks are blockers.

## Output

The handoff to `/pipeline` must include the run id, plan flag (`plan`, `no-plan`, or null), and the spec path under `pipeline-runs/<run-id>/01-spec/`.
