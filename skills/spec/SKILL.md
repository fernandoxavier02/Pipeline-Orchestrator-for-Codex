---
name: spec
description: Spec Lifecycle shortcut — pre-classifies task_type=Spec to skip the type-detection round in task-orchestrator. Same Phase-0/Phase-3 wrapper as /pipeline-orchestrator-for-codex:pipeline (information-gate, sentinel checkpoints, sanity-checker, final-validator, finishing-branch). Variant flags `--light` / `--heavy` / `--audit-only` route directly to skills/spec-light, spec-heavy, or spec-audit-only with their prescriptive 6/9/5-step procedures (Wave 2). Without a flag, dispatches to pipeline-controller, which uses the Wave 3-spec 4-signal classifier (explicit path / --type=spec flag / prose regex / glob fallback under .kiro/specs/) to select the right variant. Manual-only invocation via `/pipeline-orchestrator-for-codex:spec`.
disable-model-invocation: true
allowed-tools: update_plan, spawn_agent, wait_agent, send_input
argument-hint: "[--light | --heavy | --audit-only] [spec feature name or path to .kiro/specs/<feature>/]"
gates_at: [phase-1]
sentinel_checkpoints: [post_orchestrator]
---

# Spec Lifecycle entry-point (v4.12.0)

## VISIBLE_PLAN Contract

As the first assistant action for this workflow, call `update_plan` so the Codex UI opens the visible planning panel before any workflow/method gate, execution, file edit, dispatch, report generation, validation claim, terminal response, or phase transition. This is mandatory for this workflow and uses `references/visible-plan-contract.md` as the SSOT.

The visible plan must name the selected workflow/mode, declare the planned batches, and track PDD, DDD, ATDD, and TDD or the report-only evidence-first equivalent. Every batch must be followed by checkpoint validation, adversarial review, and a fix loop capped at 3 attempts before continuing. Keep exactly one item `in_progress` and update the plan after every gate, batch, review, correction, and final validation. If the visible plan cannot be opened or updated, stop and surface the blocker instead of proceeding invisibly.

## WORKFLOW_METHOD_GATE Contract

Before any execution, dispatch, file edit, report generation, validation claim, terminal response, or phase transition, show the workflow/method gate defined in `references/workflow-method-gate.md` and wait for the user's answer. State the selected workflow/mode, give the practical reason, and allow switching to `audit`, `bugfix`, `feature`, `ux`, `spec`, `brainstorm`, `review`, or `verify-completion` before continuing.

If the user switches workflow, rebuild the gate and ask again. If the gate cannot be shown or the user does not approve, stop before starting the workflow.

## NEXT_STEP Contract

When this workflow reaches any terminal state, emit the `NEXT_STEP` block defined in `references/workflow-next-step.md`. Use the workflow name from this file's frontmatter as `current_workflow`; if blocked or waiting on the user, point back to the same workflow instead of advancing.



## Codex Real-Agent Runtime Contract

Any operational path in this workflow that dispatches pipeline work MUST use real Codex `spawn_agent` with a `PIPELINE_AGENT_FQN` marker. If `spawn_agent` is unavailable, fails, or cannot return an isolated agent result, stop with `blocked-no-agent-runtime`. Do not continue inline, do not simulate subagents, and do not report the run as real multi-agent execution.

If a manual auxiliary review is offered after a runtime block, label it `manual_fallback_not_pipeline` and include exactly: "This is a manual fallback review, not a valid pipeline execution." It never counts as approval, PASS, or a valid pipeline execution.

For informational-only workflows, do not launch the recommended workflow from the help/router context. Recommend the command and stop unless the user explicitly invokes an executable workflow with real agent support.

## Codex Parent Protocol Contract

Codex does not execute Claude `Task` or direct `GATE_REQUEST` calls as the operational contract. Subagent work is dispatched with real `spawn_agent`. User decisions are emitted as `GATE_REQUEST` protocol blocks, answered in the parent context, persisted to `protocol-events.jsonl`, and mirrored to `gate-decisions.jsonl` when the gate is canonical. Malformed or unanswered protocol blocks block the workflow; they are never silently defaulted.

You are invoking `/pipeline-orchestrator-for-codex:spec` — a thin shortcut that delegates to the same `pipeline-controller` agent as `/pipeline-orchestrator-for-codex:pipeline`, but with `task_type` pre-fixed to `Spec`.

## Variant override via flag (Wave 4-spec, v4.12.0+)

Before delegating to the controller, inspect `$ARGUMENTS` for a leading variant-override flag. The check is purely additive — invocations without a flag keep the Wave 3-spec auto-classifier behavior.

- If `$ARGUMENTS` starts with `--light ` (with trailing space) OR `$ARGUMENTS` is exactly `--light`: strip the `--light` prefix and invoke `Skill(skill: "pipeline-orchestrator-for-codex:spec-light")` with the remaining `$ARGUMENTS` (may be empty).
- If `$ARGUMENTS` starts with `--heavy ` (with trailing space) OR `$ARGUMENTS` is exactly `--heavy`: strip the `--heavy` prefix and invoke `Skill(skill: "pipeline-orchestrator-for-codex:spec-heavy")` with the remaining `$ARGUMENTS`.
- If `$ARGUMENTS` starts with `--audit-only ` (with trailing space) OR `$ARGUMENTS` is exactly `--audit-only`: strip the `--audit-only` prefix and invoke `Skill(skill: "pipeline-orchestrator-for-codex:spec-audit-only")` with the remaining `$ARGUMENTS`.
- Otherwise (no recognized flag): proceed with the controller dispatch below — the Wave 3-spec 4-signal classifier picks the variant.

The `spec-light` / `spec-heavy` / `spec-audit-only` skills carry the prescriptive 6 / 9 / 5-step procedures (see `skills/spec-light/SKILL.md`, `skills/spec-heavy/SKILL.md`, `skills/spec-audit-only/SKILL.md`). Phase 0 (information-gate, sentinel) and Phase 3 (sanity / final-validator / finishing-branch) still wrap them via `pipeline-controller` when invoked through the auto-classify path.

## What this skill does

Spawn the `pipeline-controller` agent with real Codex `spawn_agent` and the user's request prefixed by `PRE_CLASSIFIED_TYPE=Spec`:

```
spawn_agent({
  agent_type: "worker",
  message: "PIPELINE_AGENT_FQN: pipeline-orchestrator-for-codex:core:pipeline-controller\nPRE_CLASSIFIED_TYPE=Spec\n\n$ARGUMENTS"
})
```

The controller returns a `PIPELINE COMPLETE` block as its tool result. Show it to the user **verbatim** — do NOT summarize, trim, or paraphrase.

## What this skill does NOT do

- **Does NOT skip information-gate** — gap detection on the spec artifacts (spec.json + requirements.md + design.md + tasks.md, plus research.md if applicable) is still mandatory.
- **Does NOT skip the variant skill's gates** — the prescriptive 4 / 5 / 3 mandatory parent-context question gates inside spec-light / spec-heavy / spec-audit-only run regardless of entry path.
- **Does NOT skip TDD** for spec-light or spec-heavy — ATDD seed (1 scenario per AC, EARS preserved) still gates implementation.
- **Does NOT skip sanity check or Pa de Cal** — Phase 3 runs identically (sanity verifies code+tests; Pa de Cal issues GO/CONDITIONAL/NO-GO).
- **Is NOT auto-invoked.** `disable-model-invocation: true` enforces manual-only triggering. Codex should never decide to run this skill on its own — it only runs when the user types `/pipeline-orchestrator-for-codex:spec`.

The ONLY phase shortened is Phase 0a (`task-orchestrator`): the classifier accepts `force_type=Spec` (via the `PRE_CLASSIFIED_TYPE` prefix) and skips the type-detection reasoning, but still resolves `pipeline_variant` (spec-light / spec-heavy / spec-audit-only) via the 4-signal classifier and computes complexity, ssot_status, and the populated `spec_context.yaml`. See `agents/core/task-orchestrator.md` Step 1a (Wave 3-spec).

## Spec path resolution

The variant skills (and the controller, when no flag is supplied) need a target spec directory. Resolution order:

1. **Explicit path in `$ARGUMENTS`** — e.g. `/pipeline-orchestrator-for-codex:spec .kiro/specs/auth-flow/` (recognized by Wave 3-spec signal #1).
2. **`spec_path` field in `.codex/pipeline.local.md`** frontmatter (project-level default).
3. **Glob fallback under `.kiro/specs/`** — if exactly one feature directory matches, use it; if zero or multiple, the controller asks the user in the parent context (NEVER guesses).

This resolution is owned by `task-orchestrator` Step 1a (Wave 3-spec); the entry-point itself does not pre-resolve — it only forwards `$ARGUMENTS` verbatim.

## Pass-through behavior

The `$ARGUMENTS` placeholder captures everything the user typed after the skill name. The full string is passed verbatim to the controller, prefixed by `PRE_CLASSIFIED_TYPE=Spec\n\n`. The controller's Step 1 recognizes the prefix, the `task-orchestrator` Step 1a strips and consumes it, and the rest of the 4-phase pipeline runs identically to a `/pipeline-orchestrator-for-codex:pipeline` invocation that classified as Spec.

## Why this exists

Without `/pipeline-orchestrator-for-codex:spec`, every spec lifecycle request burns one classification round on type-detection (was this an audit, a re-implementation, a fresh feature?). With `/pipeline-orchestrator-for-codex:spec`, you tell the controller upfront and it goes straight to gap detection on the spec artifacts and variant selection — saves tokens and prevents misclassification when the user already knows the input is a Kiro spec.

The variant-override flags (`--light` / `--heavy` / `--audit-only`) are the recommended path when the user knows the depth they want: they skip the full pipeline-controller wrapper and run the prescriptive variant skill directly.

## Reference docs

- Variant skills: `skills/spec-light/SKILL.md` (6 steps, default for small-to-medium scope), `skills/spec-heavy/SKILL.md` (9 steps, full content review + parallel adversarial), `skills/spec-audit-only/SKILL.md` (5 steps, no implementation — for already-shipped specs).
- Pipeline composition refs (team/step flow): `references/pipelines/spec-light.md`, `references/pipelines/spec-heavy.md`, `references/pipelines/spec-audit-only.md`.
- Wave 3-spec classifier logic: `agents/core/task-orchestrator.md` Step 1a (4-signal detection + spec_context resolution).
- Wave 1 backing agents: `agents/executor/type-specific/spec-format-gate.md`, `agents/executor/type-specific/spec-content-reviewer.md`, `agents/executor/type-specific/spec-post-impl-validator.md`, `agents/executor/spec-closer.md`.

## Achado #7 GATE_REQUEST handler (2026-05-07+, v5.2.0-rc.2+)

When the dispatched pipeline-controller (or any subagent it transitively dispatches via DISPATCH_REQUEST) returns a tool result containing `=== GATE_REQUEST v1 ===`, `=== DISPATCH_REQUEST v1 ===`, or `=== PLAN_MODE_REQUEST v1 ===` blocks AND ends with `STATUS: AWAITING_GATE_RESPONSES` / `AWAITING_DISPATCH_RESULTS` / `AWAITING_PLAN_MODE_RESULTS`, the parent main LLM MUST process them per `references/gate-request-protocol.md`:

1. Parse each block out of the tool result.
2. For `GATE_REQUEST`: ask the user in the parent context with the parsed question + options and persist the response.
3. For `DISPATCH_REQUEST` with `target_kind: agent`: invoke `spawn_agent(agent_type: "worker", message: "PIPELINE_AGENT_FQN: <target_name>\n<prompt>")`.
4. For `DISPATCH_REQUEST` with `target_kind: skill`: invoke `Skill(skill: target_name)`.
5. For `PLAN_MODE_REQUEST`: show a visible read-only plan in Codex when available; do not promise a literal Claude plan-mode tool when the runtime lacks it.
6. Aggregate responses/results into `GATE_RESPONSES` / `DISPATCH_RESULTS` / `PLAN_MODE_RESULTS` YAML payloads.
7. Re-dispatch the SAME subagent with the original prompt PLUS payloads prepended.
8. Repeat 1-7 until the subagent emits its terminal block (e.g., `PIPELINE COMPLETE`) without AWAITING_*.

Append every block emission and every response to `{PIPELINE_DOC_PATH}/protocol-events.jsonl` (NOT `gate-decisions.jsonl`). Named gates (ADVERSARIAL_GATE, FINAL_ADVERSARIAL_GATE, CLOSEOUT_CONFIRM, TDD_APPROVAL, PLAN_REJECTED, INFO_GATE_BLOCKED) ALSO get a canonical `gate-decisions.jsonl` entry with `decided_by: user` referencing the protocol event id. See `references/gate-request-protocol.md` "gate_id → canonical gate mapping" for the full table.

**Never silently default.** Malformed blocks → block and ask the user in the parent context ("malformed block — investigate, retry, or abort?"); do NOT guess.
