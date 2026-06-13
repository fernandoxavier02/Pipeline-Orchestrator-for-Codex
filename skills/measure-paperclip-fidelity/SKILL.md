---
name: measure-paperclip-fidelity
description: "Public Codex skill that measures Paperclip execution fidelity from a company id and renders the bundled mirror-fidelity report."
disable-model-invocation: true
allowed-tools: update_plan, Read, Bash
argument-hint: "<companyId>"
gates_at: [phase-0]
sentinel_checkpoints: [post_orchestrator]
---

# /pipeline-orchestrator-for-codex:measure-paperclip-fidelity

## VISIBLE_PLAN Contract

As the first assistant action for this workflow, call `update_plan` so the Codex UI opens the visible planning panel before any workflow/method gate, execution, file edit, dispatch, report generation, validation claim, terminal response, or phase transition. This is mandatory for this workflow and uses `references/visible-plan-contract.md` as the SSOT.

The visible plan must name the selected workflow/mode, declare the planned batches, and track PDD, DDD, ATDD, and TDD or the report-only evidence-first equivalent. Every batch must be followed by checkpoint validation, adversarial review, and a fix loop capped at 3 attempts before continuing. Keep exactly one item `in_progress` and update the plan after every gate, batch, review, correction, and final validation. If the visible plan cannot be opened or updated, stop and surface the blocker instead of proceeding invisibly.

## WORKFLOW_METHOD_GATE Contract

Before any report generation, execution, dispatch, file edit, validation claim, terminal response, or phase transition, show the workflow/method gate defined in `references/workflow-method-gate.md` and wait for the user's answer. State the selected workflow/mode, give the practical reason, and allow switching to `audit`, `bugfix`, `feature`, `ux`, `spec`, `brainstorm`, `review`, or `verify-completion` before continuing.

If the user switches workflow, rebuild the gate and ask again. If the gate cannot be shown or the user does not approve, stop before starting the workflow.

## NEXT_STEP Contract

When this workflow reaches any terminal state, emit the `NEXT_STEP` block defined in `references/workflow-next-step.md`. Use the workflow name from this file's frontmatter as `current_workflow`; if blocked or waiting on the user, point back to the same workflow instead of advancing.

This is the public plugin skill surface for Paperclip fidelity measurement.

Operational logic already exists in `../../references/paperclip/spec/lib/measure-fidelity.cjs`. Use this skill as the discoverable entrypoint that maps a user-provided `companyId` to that bundled script.

## Procedure

1. Require exactly one argument: the Paperclip `companyId`.
2. Before any shell command, accept only IDs matching `^[A-Za-z0-9_-]{1,64}$`; reject anything else and ask for a safe ID.
3. Run `node references/paperclip/spec/lib/measure-fidelity.cjs "$companyId"` with the validated ID as a single argv value.
4. Return the generated fidelity report verbatim.

## Rules

- Do not create or mutate Paperclip cards from this skill.
- Do not guess the `companyId`; ask for it if the user did not provide one.
- Do not paste an unvalidated `companyId` into a shell command.
- Treat the script output as the source of truth for fidelity scoring and reporting.
