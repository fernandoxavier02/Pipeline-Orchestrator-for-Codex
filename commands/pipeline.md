---
description: "Single-command multi-agent pipeline. Auto-classifies, confirms with the user, executes in batches, enforces adversarial review per batch, and finishes with quality gate plus final validation."
allowed-tools: Task, Read, Write, Bash, Glob, Grep, TodoWrite, Skill
argument-hint: "[diagnostic|continue|review-only|--simples|--media|--complexa|--hotfix|--grill|--plan] <tarefa>"
---

# /pipeline

Use a skill `pipeline-orchestrator-for-codex:pipeline`

Nao dependa de skills globais legadas.

This is the canonical `quality gate` and `final validation` entrypoint for the plugin.

## Codex Primitive Emulation

The Codex runtime does not expose `AskUserQuestion`, `EnterPlanMode`, or `ExitPlanMode` as native tools. The controller emulates these primitives through typed helpers:

- `AskUserQuestion` → `src/primitives/ask-user-question.ts` (blocking question serializer with user confirmation)
- `EnterPlanMode` / `ExitPlanMode` → `src/primitives/plan-mode.ts` (write-attempt telemetry during Phase 1.5 — caller must voluntarily report writes via `recordWriteAttempt`; Codex cannot intercept tool calls like CC does)

When the skill orchestrates user confirmation or plan mode, it MUST route through these helpers. Never attempt to call the CC-native tool names directly.

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
