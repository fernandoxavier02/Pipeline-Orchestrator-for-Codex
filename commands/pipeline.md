---
description: "Single-command multi-agent pipeline. Auto-classifies, confirms with the user, executes in batches, enforces adversarial review per batch, and finishes with quality gate plus final validation."
allowed-tools: Task, Read, Write, Bash, Glob, Grep, TodoWrite, Skill
argument-hint: "[diagnostic|continue|review-only|--simples|--media|--complexa|--hotfix|--grill|--plan] <tarefa>"
---

# /pipeline

Use a skill `pipeline-orchestrator-for-codex:pipeline`

Nao dependa de skills globais legadas.

This is the canonical `quality gate` and `final validation` entrypoint for the plugin.

## Strict Real-Agent Contract

`spawn_agent is mandatory` for `/pipeline`. The command is an explicit request for Codex subagent execution, so the controller must spawn the pipeline agents rather than executing their work inline.

If the host runtime cannot provide `spawn_agent`, the pipeline must stop with `blocked-no-agent-runtime`. Do not silently fall back to TypeScript local emulation for `/pipeline`; local TypeScript dispatch is only a contract/test harness unless a real agent adapter is supplied.

## Codex Primitive Emulation

The controller exposes the Claude-style checkpoints through Codex-native surfaces:

- `AskUserQuestion` → `src/primitives/ask-user-question.ts` (blocking question serializer with user confirmation)
- workflow selection → the Phase 1 proposal must print `WORKFLOW SELECTED`, ask whether to keep it, and accept `audit`, `bugfix`, `feature`, `ux`, or `spec` as workflow-switch responses before execution
- `EnterPlanMode` / `ExitPlanMode` → Phase 1.5 emits `PLAN_MODE_REQUEST v1` plus `src/primitives/plan-mode.ts` write-attempt telemetry. When the host supports native Codex Plan Mode, the parent should enter it at this checkpoint; otherwise the generated implementation plan is the visible fallback.

When the skill orchestrates user confirmation, workflow selection, or plan mode, it MUST route through these helpers/protocol blocks. Never attempt to call the CC-native tool names directly.

## VISIBLE_PLAN

Before dispatching or executing the workflow, open a visible Codex plan with `update_plan` using the contract in `references/visible-plan-contract.md`. The plan must cover the selected workflow, batches, adversarial review after every batch, and mandatory PDD, DDD, ATDD, and TDD or report-only evidence-first equivalents. Keep one item `in_progress` and update it after every gate, batch, review, and final validation.

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
6. If the work is non-trivial, route through the pipeline skill. If it is trivial, let the skill decide proportional execution.

## NEXT_STEP

Every terminal `/pipeline` response must include the `NEXT_STEP` block described in `references/workflow-next-step.md`. If the run is blocked, point back to the blocking workflow; if the run closes, suggest `verify-completion` or return `stop` when final verification is already complete.
