---
name: review
description: Review-only shortcut — runs final adversarial review on current uncommitted changes without any implementation. Report-only, no code edits. Invoked manually via `/review`.
---

# Review-Only entry-point (Kimi port)

You are invoking `/review` — a shortcut that runs the final adversarial review directly on current uncommitted changes, skipping Phase 0–2 entirely.

## What this skill does

1. Detect modified files using `git diff --name-only`.
2. Spawn the `pipeline-controller` with `mode=review-only`.
3. The controller spawns `final-adversarial-orchestrator` directly.
4. Output: FINAL_ADVERSARIAL_REPORT.
5. No fixes — report only (user decides what to do).

```
Agent(
  subagent_type: "coder",
  description: "Run review-only adversarial scan",
  prompt: "You are the pipeline-controller. MODE=review-only\n\nDetect uncommitted changes and run final-adversarial-orchestrator."
)
```

## Runtime protocol

Process any GATE_REQUEST blocks from the controller (e.g., closeout options). Re-dispatch with responses until PIPELINE COMPLETE.
