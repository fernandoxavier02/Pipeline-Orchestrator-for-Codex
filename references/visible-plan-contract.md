# Visible Plan Contract

Every public command or skill workflow must open a Codex-visible plan as its first assistant action. This mirrors the Superpowers Codex pattern: the parent model calls `update_plan`, the UI shows the plan, and the workflow keeps that plan current as work advances.

The visible plan is not the same as the internal `PLAN_MODE_REQUEST v1` event. `PLAN_MODE_REQUEST v1` is protocol telemetry for planning checkpoints. The user-facing Codex plan panel is opened by calling `update_plan`.

## Block Shape

```yaml
VISIBLE_PLAN:
  workflow: <workflow-name>
  selected_mode: <Audit | Implement | Bug Fix | UX | Spec | Review | Validate | Brainstorm>
  plan_surface: update_plan
  batches_required: true
  methodologies:
    PDD: plan before execution
    DDD: domain boundaries and invariants before implementation decisions
    ATDD: acceptance criteria before execution
    TDD: failing test or evidence-first equivalent before change/claim
  after_each_batch:
    - checkpoint
    - adversarial review
    - fix loop, max 3 attempts
    - update_plan
  terminal_block: NEXT_STEP
```

## Required Behavior

- Call `update_plan` as the first assistant action, before workflow/method confirmation, file edits, dispatch, code execution, report generation, terminal responses, phase transitions, or completion claims.
- Keep exactly one plan item `in_progress`.
- Update the plan after each batch, checkpoint, adversarial review, fix attempt, user gate, and final validation.
- Every workflow uses batches. For report-only workflows, a batch is an analysis axis, journey, artifact, or validation slice.
- Every batch receives adversarial review. Findings are fixed in a loop capped at 3 attempts; after 3 failed attempts, stop with `NO-GO` or a user decision gate.
- TDD is mandatory for code-changing workflows: prove RED before implementation, then GREEN, then refactor/cleanup when needed.
- ATDD is mandatory for behavior-facing workflows: define acceptance criteria before execution and verify them before closeout.
- DDD is mandatory before implementation decisions: name the relevant domain concepts, boundaries, invariants, and SSOT ownership.
- PDD is mandatory for every workflow: the visible plan is the executable protocol for the run.

## Report-Only Equivalent

Audit, UX, review, validation, and brainstorm flows may not write production code. They still must use evidence-first equivalents:

- TDD equivalent: define the report/check artifact that would fail if required evidence is missing.
- ATDD equivalent: define acceptance criteria for the report, spec, validation, or user journey.
- DDD equivalent: define domain boundaries, ownership, risk surfaces, and invariants being inspected.
- PDD: keep the visible `update_plan` current from start to terminal `NEXT_STEP`.

## Minimum Plan Items

Every workflow plan must include at least:

1. Confirm workflow and selected mode.
2. Define scope, domain boundaries, and acceptance criteria.
3. Plan batches and evidence gates.
4. Run batch with TDD/ATDD/DDD/PDD or report-only equivalent.
5. Run adversarial review for the batch.
6. Resolve findings or stop at the fix-loop cap.
7. Validate completion.
8. Emit `NEXT_STEP`.

This contract is not decorative. If a workflow cannot open or maintain the visible plan, it must stop and report the blocker instead of proceeding invisibly.
