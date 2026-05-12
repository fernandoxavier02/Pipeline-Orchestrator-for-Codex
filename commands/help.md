---
description: "List all Pipeline Orchestrator execution forms and recommend the best command/flow when the user includes a task."
allowed-tools: Read, Grep, Glob
argument-hint: "[optional task or instruction to classify and recommend]"
---

# /pipeline-orchestrator-for-codex:help

Use the skill `pipeline-orchestrator-for-codex:help`.

This command is informational. It lists the plugin's public execution forms and, when `$ARGUMENTS` includes a task or instruction, recommends the best Pipeline Orchestrator command sequence for that task.

Do not execute the recommended workflow from help. Return the recommendation and the exact command(s) the user can run.
