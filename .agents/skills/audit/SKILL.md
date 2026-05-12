---
name: audit
description: Audit shortcut — skips type-classification by pre-fixing task_type=Audit. Same pipeline machinery as /pipeline. Invoked manually via `/audit [scope]`. Variant flags `--light` / `--heavy` route to prescriptive 9-step procedures. Report-only — no production code changes.
---

# Audit entry-point (Kimi port)

You are invoking `/audit` — a thin shortcut that delegates to the same `pipeline-controller` agent as `/pipeline`, but with `task_type` pre-fixed to `Audit`.

## Variant override via flag

- If arguments start with `--light `: strip and use audit-light procedure.
- If arguments start with `--heavy `: strip and use audit-heavy procedure.
- Otherwise: proceed with controller dispatch — auto-classification unchanged.

## What this skill does

```
Agent(
  subagent_type: "coder",
  description: "Orchestrate audit pipeline",
  prompt: "You are the pipeline-controller. PRE_CLASSIFIED_TYPE=Audit\n\nUser request: {{arguments}}"
)
```

## Runtime protocol

Same as `/pipeline` — process GATE_REQUEST, DISPATCH_REQUEST, PLAN_MODE_REQUEST blocks. Re-dispatch with responses until PIPELINE COMPLETE.

## What this skill does NOT do

- **Does NOT skip information-gate** — scope/axes/baseline gap detection is mandatory.
- **Does NOT permit any code change.** Audit is REPORT-ONLY by Iron Law.
- **Does NOT skip evidence requirement** — every finding cites file:line or is tagged `[HYPOTHESIS]` / `[DESIGN]`.
- **Does NOT skip sanity check or Pa de Cal** — report completeness + risk matrix quality.
- **Is NOT auto-invoked.**
