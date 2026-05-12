---
name: bugfix
description: Bug Fix shortcut — skips type-classification by pre-fixing task_type=Bug Fix. Same pipeline machinery as pipeline (information-gate, design-interrogator, plan-architect, executor-controller, adversarial review, sanity, Pa de Cal). Manual-only — never auto-invoked because every bug-fix run has side effects (TDD-RED tests created, code edited, commits proposed).
---

# Bug Fix entry-point (Kimi port)

You are invoking `/bugfix` — a thin shortcut that delegates to the same `pipeline-controller` agent as `/pipeline`, but with `task_type` pre-fixed to `Bug Fix`.

## Variant override via flag

Before delegating to the controller, inspect the user's arguments for a leading variant-override flag:

- If arguments start with `--light `: strip the flag and proceed with bugfix-light variant behavior.
- If arguments start with `--heavy `: strip the flag and proceed with bugfix-heavy variant behavior.
- Otherwise: proceed with the controller dispatch below — auto-classification is unchanged.

## What this skill does

Spawn the `pipeline-controller` agent with the user's request prefixed by `PRE_CLASSIFIED_TYPE=Bug Fix`:

```
Agent(
  subagent_type: "coder",
  description: "Orchestrate bug fix pipeline",
  prompt: "You are the pipeline-controller. PRE_CLASSIFIED_TYPE=Bug Fix\n\nUser request: {{arguments}}"
)
```

The controller returns a `PIPELINE COMPLETE` block as its tool result. Show it to the user **verbatim** — do NOT summarize, trim, or paraphrase.

## Runtime protocol

Kimi subagents MAY NOT have access to `AskUserQuestion` or nested `Agent` dispatches. When the controller returns a tool result containing `=== GATE_REQUEST v1 ===`, `=== DISPATCH_REQUEST v1 ===`, or `=== PLAN_MODE_REQUEST v1 ===` blocks AND ends with `STATUS: AWAITING_*`, process them per the protocol:

1. Parse each block out of the tool result.
2. For `GATE_REQUEST`: invoke `AskUserQuestion` with the parsed question + options.
3. For `DISPATCH_REQUEST`: invoke `Agent(subagent_type: <target_type>, description, prompt)`.
4. For `PLAN_MODE_REQUEST`: conduct read-only research via ReadFile/Glob/Grep, compile findings.
5. Aggregate responses into `GATE_RESPONSES` / `DISPATCH_RESULTS` / `PLAN_MODE_RESULTS` YAML payloads.
6. Re-dispatch the SAME controller agent with the original prompt + payloads prepended.
7. Repeat until the controller emits `PIPELINE COMPLETE` without AWAITING_*.

**Never silently default.** Malformed blocks → present to user via `AskUserQuestion`.

## What this skill does NOT do

- **Does NOT skip information-gate** — gap detection (repro steps, error logs, env) is still mandatory.
- **Does NOT skip design-interrogator** for COMPLEXA bugs.
- **Does NOT skip TDD** — RED test must prove the fix before GREEN.
- **Does NOT skip per-batch adversarial review** — security-sensitive bugs keep MANDATORY adversarial review.
- **Does NOT skip sanity check or Pa de Cal** — Phase 3 runs identically.
- **Is NOT auto-invoked.** Manual-only triggering.
