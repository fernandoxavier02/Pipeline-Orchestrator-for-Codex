---
name: paperclip-overview
description: "Public Codex skill that lists the governed Paperclip dispatch skills and their intended use."
disable-model-invocation: true
allowed-tools: update_plan, spawn_agent, wait_agent
argument-hint: "[optional Paperclip workflow question]"
gates_at: [phase-0]
sentinel_checkpoints: [post_orchestrator]
---

# /pipeline-orchestrator-for-codex:paperclip-overview

## VISIBLE_PLAN Contract

As the first assistant action for this workflow, call `update_plan` so the Codex UI opens the visible planning panel before any workflow/method gate, execution, file edit, dispatch, report generation, validation claim, terminal response, or phase transition. This is mandatory for this workflow and uses `references/visible-plan-contract.md` as the SSOT.

The visible plan must name the selected workflow/mode, declare the planned batches, and track PDD, DDD, ATDD, and TDD or the report-only evidence-first equivalent. Every batch must be followed by checkpoint validation, adversarial review, and a fix loop capped at 3 attempts before continuing. Keep exactly one item `in_progress` and update the plan after every gate, batch, review, correction, and final validation. If the visible plan cannot be opened or updated, stop and surface the blocker instead of proceeding invisibly.

## WORKFLOW_METHOD_GATE Contract

Before any execution, dispatch, file edit, report generation, validation claim, terminal response, or phase transition, show the workflow/method gate defined in `references/workflow-method-gate.md` and wait for the user's answer. State the selected workflow/mode, give the practical reason, and allow switching to `audit`, `bugfix`, `feature`, `ux`, `spec`, `brainstorm`, `review`, or `verify-completion` before continuing.

If the user switches workflow, rebuild the gate and ask again. If the gate cannot be shown or the user does not approve, stop before starting the workflow.

## NEXT_STEP Contract

When this workflow reaches any terminal state, emit the `NEXT_STEP` block defined in `references/workflow-next-step.md`. Use the workflow name from this file's frontmatter as `current_workflow`; if blocked or waiting on the user, point back to the same workflow instead of advancing.

This is the public plugin skill surface for the Paperclip command index.

Operational content lives in `../../commands/paperclip-overview.md`. Read that command file and summarize the available Paperclip skills. Do not create Paperclip cards from this overview skill.

This `SKILL.md` is the discoverable plugin entrypoint. The command file is retained as compatibility documentation.

If the user asks to execute a Paperclip workflow from here, recommend the exact `paperclip-*` skill and stop. Execution must happen through the target skill. If real Codex `spawn_agent` support is unavailable for an executable workflow, stop with `blocked-no-agent-runtime`. Do not continue inline. Any spawned pipeline work must use a `PIPELINE_AGENT_FQN` marker.
