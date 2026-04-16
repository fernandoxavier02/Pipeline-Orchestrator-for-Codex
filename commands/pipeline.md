---
description: "Single-command multi-agent pipeline. Auto-classifies, confirms with the user, executes in batches, enforces adversarial review per batch, and finishes with quality gate plus final validation."
allowed-tools: Skill, Read, Bash, Task
argument-hint: [diagnostic|continue|review-only|--simples|--media|--complexa|--hotfix|--grill|--plan] <tarefa>
---

# /pipeline

Use a skill `pipeline-orchestrator-for-codex:pipeline`

Nao dependa de skills globais legadas.

This is the canonical `quality gate` and `final validation` entrypoint for the plugin.

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
