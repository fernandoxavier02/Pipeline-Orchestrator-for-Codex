---
name: workflow-eval-gate
description: Use when repairing, auditing, testing, validating, or stabilizing this Pipeline Orchestrator repo's workflows, skills, hooks, commands, plugins, telemetry, evals, or agent behavior. Enforces local Eval Gate discipline and forbids success claims without passing eval evidence.
---

# Workflow Eval Gate

Use this repo-local skill whenever the task touches the Pipeline Orchestrator's
workflow behavior, plugin surfaces, skills, hooks, commands, telemetry, evals,
or agent/runtime contracts.

## Operating Rules

1. Inspect relevant files before editing. Map the relationship between
   workflow, skill, hook, command, plugin, telemetry, eval, policy, gate, trace,
   batch, and review surfaces.
2. Identify the broken behavior or validation gap in plain terms before
   proposing a repair.
3. Propose and implement the smallest safe change. Do not rewrite the
   orchestrator, refactor the project, add unrelated features, or change
   dependencies unless the user explicitly asks.
4. Treat `.codex/**` and `.agents/skills/workflow-eval-gate/**` as local
   governance for this repository. Do not claim they are packaged plugin hooks
   or globally active unless the active Codex hook/plugin configuration proves
   that.
5. Let the Codex hooks capture telemetry when they are trusted and enabled.
   When hooks are not active, run `python3 .codex/hooks/post_tool_use_telemetry.py`
   manually before claiming eval evidence.
6. Save the final report to `evals/outputs/latest_output.md`.
7. Run `python3 .agents/skills/workflow-eval-gate/scripts/run_eval.py` after
   changes. Never claim success unless it prints `EVAL RESULT: PASS` and exits
   with code 0.
8. Hook activation is an explicit Codex trust step. Open `/hooks`, review
   `.codex/hooks.json`, and trust only this repository root. If hook trust is
   not proven in the current session, run telemetry manually and say so.

## Final Report Contract

The final report must include these sections:

- What was inspected
- What was changed
- What was not changed
- Eval result
- Remaining risks
- Next safest step

Keep the report truthful. If tests or evals were not run, say that directly and
do not use success language.
