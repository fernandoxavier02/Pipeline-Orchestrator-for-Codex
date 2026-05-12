---
name: feature
description: Feature shortcut — skips type-classification by pre-fixing task_type=Feature. Same pipeline machinery as /pipeline. Invoked manually via `/feature [task]`. Variant flags `--light` / `--heavy` route directly to prescriptive procedures.
---

# Feature entry-point (Kimi port)

You are invoking `/feature` — a thin shortcut that delegates to the same `pipeline-controller` agent as `/pipeline`, but with `task_type` pre-fixed to `Feature`.

## Variant override via flag

- If arguments start with `--light `: strip and use feature-light procedure.
- If arguments start with `--heavy `: strip and use feature-heavy procedure.
- Otherwise: proceed with controller dispatch — auto-classification unchanged.

## What this skill does

```
Agent(
  subagent_type: "coder",
  description: "Orchestrate feature pipeline",
  prompt: "You are the pipeline-controller. PRE_CLASSIFIED_TYPE=Feature\n\nUser request: {{arguments}}"
)
```

## Runtime protocol

Same as `/pipeline` — process GATE_REQUEST, DISPATCH_REQUEST, PLAN_MODE_REQUEST blocks emitted by the controller. Re-dispatch with responses until PIPELINE COMPLETE.

## What this skill does NOT do

- **Does NOT skip information-gate** — gap detection (user story, DoD, scope) is mandatory.
- **Does NOT skip design-interrogator** for COMPLEXA features.
- **Does NOT skip TDD** — RED tests before GREEN.
- **Does NOT skip adversarial review**.
- **Does NOT skip sanity check or Pa de Cal**.
- **Is NOT auto-invoked.**
