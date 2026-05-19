---
name: verify-completion
description: Verify completion and success claims with fresh evidence. Use before claiming a task is complete, a fix works, tests pass, or a feature is ready for GO.
allowed-tools: update_plan, spawn_agent, wait_agent, send_input
argument-hint: <claim-type> <claim>
disable-model-invocation: true
gates_at: [phase-1]
sentinel_checkpoints: [post_orchestrator]
---

# verify-completion

## VISIBLE_PLAN Contract

As the first assistant action for this workflow, call `update_plan` so the Codex UI opens the visible planning panel before any workflow/method gate, execution, file edit, dispatch, report generation, validation claim, terminal response, or phase transition. This is mandatory for this workflow and uses `references/visible-plan-contract.md` as the SSOT.

The visible plan must name the selected workflow/mode, declare the planned batches, and track PDD, DDD, ATDD, and TDD or the report-only evidence-first equivalent. Every batch must be followed by checkpoint validation, adversarial review, and a fix loop capped at 3 attempts before continuing. Keep exactly one item `in_progress` and update the plan after every gate, batch, review, correction, and final validation. If the visible plan cannot be opened or updated, stop and surface the blocker instead of proceeding invisibly.

## WORKFLOW_METHOD_GATE Contract

Before any execution, dispatch, file edit, report generation, validation claim, terminal response, or phase transition, show the workflow/method gate defined in `references/workflow-method-gate.md` and wait for the user's answer. State the selected workflow/mode, give the practical reason, and allow switching to `audit`, `bugfix`, `feature`, `ux`, `spec`, `brainstorm`, `review`, or `verify-completion` before continuing.

If the user switches workflow, rebuild the gate and ask again. If the gate cannot be shown or the user does not approve, stop before starting the workflow.

## NEXT_STEP Contract

When this workflow reaches any terminal state, emit the `NEXT_STEP` block defined in `references/workflow-next-step.md`. Use the workflow name from this file's frontmatter as `current_workflow`; if blocked or waiting on the user, point back to the same workflow instead of advancing.


## Codex Real-Agent Runtime Contract

Any operational path in this workflow that dispatches pipeline work MUST use real Codex `spawn_agent` with a `PIPELINE_AGENT_FQN` marker. If `spawn_agent` is unavailable, fails, or cannot return an isolated agent result, stop with `blocked-no-agent-runtime`. Do not continue inline, do not simulate subagents, and do not report the run as real multi-agent execution.

For informational-only workflows, do not launch the recommended workflow from the help/router context. Recommend the command and stop unless the user explicitly invokes an executable workflow with real agent support.

## Overview

This skill prevents false completion claims. A task, fix, or feature is only complete when supported by fresh evidence that matches the scope of the claim.

## When to Use

- Before saying a task is complete
- Before saying a bug is fixed
- Before saying tests pass
- Before moving to the next task in autonomous execution
- Before reporting `GO` from feature-level validation
- Before trusting another subagent's success report

Do not use this skill for early planning or speculative status updates.

## Inputs

Provide:
- The exact claim to verify
- Claim type:
  - `TASK`
  - `FIX`
  - `TEST_OR_BUILD`
  - `FEATURE_GO`
- Validation commands discovered by the controller
- Fresh command output and exit codes
- Relevant task IDs, requirement IDs, and design refs where applicable
- For feature-level claims:
  - requirements coverage status
  - design alignment status
  - integration status
  - blocked task status

## Outputs

Return one of:
- `VERIFIED`
- `NOT_VERIFIED`
- `MANUAL_VERIFY_REQUIRED`

Also return:
- Claim reviewed
- Evidence used
- Scope/evidence mismatch, if any

Use the language specified in `spec.json`.

## Gate Function

1. Identify the exact claim.
2. Identify the exact command or checklist that proves that claim.
3. Require fresh evidence from the current code state.
4. Check exit code, failure count, skipped scope, and missing coverage.
5. Reject claims that are broader than the evidence.
6. If mandatory validation cannot be completed, return `MANUAL_VERIFY_REQUIRED`.
7. Only then allow the claim.

## Claim-Specific Rules

### TASK
Require:
- task-local verification evidence
- no unresolved blocking findings from review
- evidence aligned with the task boundary

### FIX
Require:
- evidence that the original symptom is resolved
- no broader regressions in the relevant verification scope

### TEST_OR_BUILD
Require:
- actual command output
- exit code
- no inference from unrelated checks

### FEATURE_GO
Require:
- full test suite result
- runtime smoke boot result showing the built artifact reaches its first usable state
- requirements coverage assessment
- cross-task integration assessment
- design end-to-end alignment assessment
- blocked tasks assessment

A passing test suite alone is not enough for `FEATURE_GO`.

## Stop / Escalate

Return `MANUAL_VERIFY_REQUIRED` when:
- No canonical validation command is known
- The required environment is unavailable
- A mandatory manual verification step cannot be executed

Return `NOT_VERIFIED` when:
- The command failed
- Evidence is stale
- Evidence is partial
- The claim exceeds the evidence
- The feature still has unresolved blocked tasks or uncovered requirements

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| “The subagent said it succeeded” | Reported success is not verification evidence. |
| “Tests passed earlier” | Fresh evidence only. |
| “Build should be fine because lint passed” | Lint does not prove build success. |
| “Tests passed and build succeeded, so it must run” | Type erasure, module loading, native ABI, and boot-time config issues can still fail at runtime. |
| “The feature is done because all tasks are checked off” | `FEATURE_GO` also requires coverage, integration, and design alignment. |

## Output Format

```md
## Verification Result
- STATUS: VERIFIED | NOT_VERIFIED | MANUAL_VERIFY_REQUIRED
- CLAIM_TYPE: TASK | FIX | TEST_OR_BUILD | FEATURE_GO
- CLAIM: <exact claim>
- EVIDENCE: <command/checklist and result>
- GAPS: <scope/evidence mismatch or missing validation>
- NOTES: <next action if not verified>
```
