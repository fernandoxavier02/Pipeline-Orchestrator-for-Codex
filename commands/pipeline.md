---
description: "Single-command multi-agent pipeline. Auto-classifies, confirms with the user, executes in batches, enforces adversarial review per batch, and finishes with quality gate plus final validation."
allowed-tools: update_plan, spawn_agent, wait_agent, send_input
argument-hint: "[diagnostic|continue|review-only|--simples|--media|--complexa|--hotfix|--grill|--plan] <tarefa>"
---

# /pipeline-orchestrator-for-codex:pipeline

Use a skill `pipeline-orchestrator-for-codex:pipeline`

Nao dependa de skills globais legadas.

This is the canonical `quality gate` and `final validation` entrypoint for the plugin.

## Agent Execution Contract

`/pipeline-orchestrator-for-codex:pipeline` supports two runtime modes:

### `strictAgents = true` (Operational Default)
`spawn_agent` plus `wait_agent` is mandatory. The controller spawns real pipeline agents with context isolation, and the parent waits for completed results before processing protocol blocks. If the parent agent toolchain is unavailable, stop with `blocked-no-agent-runtime`.
The runtime must also prove subagent artifact collection, gate recording, hook/checkpoint recording, and structured final state before any result can count as a valid pipeline execution.

### `strictAgents = false` (Diagnostic/Test Harness Only)
The runtime uses **parallel local emulation** via TypeScript heuristic functions. All "agents" run as async functions in the same Node process with **zero context isolation**. This is a test harness and contract validator, not production multi-agent execution.

**Operational behavior:** production-grade use of `/pipeline-orchestrator-for-codex:pipeline` requires `strictAgents = true` plus working `spawn_agent`, `wait_agent`, and continuation support (`send_input` or fresh re-dispatch). Harness mode is diagnostic/test-only, requires an explicit diagnostic/test path, and must not be reported as real multi-agent execution.

## Codex Primitive Emulation

The controller exposes the Claude-style checkpoints through Codex-native surfaces:

- `GATE_REQUEST v1` → parent-context user question, persisted response, and controller re-dispatch with `GATE_RESPONSES`
- workflow selection → the Phase 1 proposal must print `WORKFLOW SELECTED`, ask whether to keep it, and accept `audit`, `bugfix`, `feature`, `ux`, or `spec` as workflow-switch responses before execution
- `PLAN_MODE_REQUEST v1` → Phase 1.5 emits read-only planning work. When the host supports native Codex Plan Mode, the parent may use it; otherwise the generated implementation plan is the visible fallback.

When the skill orchestrates user confirmation, workflow selection, or plan mode, it MUST route through these protocol blocks. Never attempt to call Claude-native tool names directly.

## VISIBLE_PLAN

As the first assistant action, open a visible Codex plan with `update_plan` using the contract in `references/visible-plan-contract.md`. Do this before the workflow method gate, before Phase 0 dispatch, and before any execution, report, validation claim, or file edit. The plan must cover the selected workflow, batches, adversarial review after every batch, and mandatory PDD, DDD, ATDD, and TDD or report-only evidence-first equivalents. Keep one item `in_progress` and update it after every gate, batch, review, and final validation.

## WORKFLOW_METHOD_GATE

After the visible plan is open, and still before dispatching Phase 0, spawning any agent, opening execution, editing files, or producing a report, show the first visible method gate from `references/workflow-method-gate.md` and wait for the user's answer. This is the first user-decision contract for `/pipeline-orchestrator-for-codex:pipeline`: state the auto-selected workflow/mode, explain the reason in one sentence, and allow the user to keep it or switch to `audit`, `bugfix`, `feature`, `ux`, `spec`, `brainstorm`, `review`, or `verify-completion`.

If the user switches the workflow, rebuild the gate and ask again. If the later task-orchestrator classification disagrees with the approved workflow, surface the changed recommendation and ask again before execution.

## Instructions

1. Use the skill `pipeline-orchestrator-for-codex:pipeline`.
2. Pass `$ARGUMENTS` as the initial pipeline request.
3. Keep the official flow:
   - automatic triage
   - proposal + user confirmation
   - execution in batches
   - adversarial review per batch
   - closure + final validation
4. Preserve the official modes:
   - `FULL`
   - `DIAGNOSTIC`
   - `CONTINUE`
   - `REVIEW-ONLY`
   - `HOTFIX`
5. Preserve the official gates:
   - information-gate
   - confirmacao do usuario
   - quality gate
   - micro-gate
   - adversarial gate
   - final validation
6. If this command was invoked, never replace it with inline execution. Use real `spawn_agent`, then `wait_agent`, and use `send_input` when continuing an existing controller thread; if any parent-agent primitive is unavailable, stop with `blocked-no-agent-runtime`.
7. If a manual auxiliary review is offered after a block, it must be labeled `manual_fallback_not_pipeline`, must say exactly "This is a manual fallback review, not a valid pipeline execution.", and must not return `pipeline_valid: true`.

## NEXT_STEP

Every terminal `/pipeline-orchestrator-for-codex:pipeline` response must include the `NEXT_STEP` block described in `references/workflow-next-step.md`. If the run is blocked, point back to the blocking workflow; if the run closes, suggest `verify-completion` or return `stop` when final verification is already complete.
