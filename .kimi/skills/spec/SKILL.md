---
name: spec
description: Spec lifecycle shortcut — pre-fixes task_type=Spec and routes through spec pipeline (requirements → design → tasks → acceptance criteria). Invoked manually via `/spec [feature description]`.
---

# Spec entry-point (Kimi port)

You are invoking `/spec` — a thin shortcut that delegates to the `pipeline-controller` with `task_type` pre-fixed to `Spec`.

## What this skill does

```
Agent(
  subagent_type: "coder",
  description: "Orchestrate spec lifecycle pipeline",
  prompt: "You are the pipeline-controller. PRE_CLASSIFIED_TYPE=Spec\n\nUser request: {{arguments}}"
)
```

## Runtime protocol

Same as `/pipeline` — process GATE_REQUEST, DISPATCH_REQUEST, PLAN_MODE_REQUEST blocks. Re-dispatch with responses until PIPELINE COMPLETE.

The spec pipeline automatically triggers plan-mode (complexity=Spec triggers planning regardless of --no-plan flag).

## Spec lifecycle phases

- Phase 0: Triage (task-orchestrator classifies as Spec)
- Phase 1: Proposal + confirmation
- Phase 1.5: Planning (MANDATORY for Spec — generates requirements.md, design.md, tasks.md)
- Phase 2: Batch execution (implementation of spec artifacts)
- Phase 3: Closure + spec-post-impl-validator
