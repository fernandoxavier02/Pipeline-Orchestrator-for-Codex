---
description: Pre-execution preparation pipeline (Kiro-clone integrated). Runs brainstorming + spec lifecycle (init/requirements/design/tasks) before optional handoff to /pipeline-orchestrator-for-codex:pipeline. Mandatory for MEDIA/COMPLEXA/Spec tasks via auto-dispatch from pipeline-controller.
argument-hint: "<task description> [--resume <run-id>] [--type <Type>] [--no-impl] [--skip-validate-gap]"
---

# /pipeline-orchestrator-for-codex:brainstorm

Entry command for the pre-execution brainstorm + spec lifecycle pipeline.

## VISIBLE_PLAN

Before dispatching or executing the workflow, open a visible Codex plan with `update_plan` using the contract in `references/visible-plan-contract.md`. The plan must cover the selected workflow, batches, adversarial review after every batch, and mandatory PDD, DDD, ATDD, and TDD or report-only evidence-first equivalents. Keep one item `in_progress` and update it after every gate, batch, review, and final validation.

## Behavior

1. Parse arguments. Recognize flags: `--resume <run-id>`, `--type <Type>`, `--no-impl`, `--skip-validate-gap`.
2. Dispatch the `brainstorm-controller` agent with the parsed arguments. The controller is the N1 orchestrator and handles the full workflow.
3. **Achado #7 / GATE_REQUEST protocol (2026-05-07+):** the brainstorm-controller subagent CANNOT call `AskUserQuestion` directly (Claude Code runtime strips it from subagent tool manifest). When the controller's tool result contains `=== GATE_REQUEST v1 ===` blocks and ends with `STATUS: AWAITING_GATE_RESPONSES`, you (the parent main LLM) MUST: (a) parse each GATE_REQUEST block, (b) invoke `AskUserQuestion` with the parsed question + options, (c) collect the user's selection, (d) re-dispatch brainstorm-controller with `GATE_RESPONSES: <yaml>` prepended to the original prompt. Repeat until the controller emits its final `BRAINSTORM PIPELINE COMPLETE` block. Full protocol spec in `references/gate-request-protocol.md`.

## Flags

- `--resume <run-id>`: resume a partial run from `pipeline-runs/<run-id>/manifest.yaml`. Picks up at the last completed step.
- `--type <Feature|Bug Fix|Audit|User Story|UX Simulation|Spec>`: pre-classify task type, skip type detection in step-00-intake.
- `--no-impl`: stop after Phase 1 (spec lifecycle complete). Do not offer handoff to /pipeline-orchestrator-for-codex:pipeline.
- `--skip-validate-gap`: skip step-04 (validate-gap). Use for greenfield projects without prior codebase.

## Output

Creates or updates a directory at `pipeline-runs/<NNN>-<slug>/` with the schema documented in `docs/superpowers/specs/2026-05-06-pipeline-brainstorm-design.md` (Run-dir schema section).

## NEXT_STEP

After the brainstorm controller finishes, surface the `NEXT_STEP` block described in `references/workflow-next-step.md`. If the brainstorm is blocked or waiting on the user, the block points back to `brainstorm`; if it passes, it points to the next spec/pipeline handoff.

## See Also

- `agents/core/brainstorm-controller.md` — N1 orchestrator
- `docs/examples/brainstorm-feature.md` — full walkthrough
- `references/glossary.md` — Brainstorm Phase, Prep Run, Run Directory
