---
name: audit
description: Audit shortcut — skips task-orchestrator type-classification by pre-fixing task_type=Audit. Same pipeline machinery as /pipeline-orchestrator-for-codex:pipeline (information-gate, design-interrogator, plan-architect, executor-controller, sanity, Pa de Cal). Invoked manually via `/pipeline-orchestrator-for-codex:audit [scope]` — never auto-invoked because every audit run produces a structured report (AUDIT_REPORT) that the user must consciously trigger. Variant flags `--light` / `--heavy` route directly to skills/audit-light or skills/audit-heavy with their prescriptive 9-step procedures imported from Pulsar.
disable-model-invocation: true
allowed-tools: update_plan, spawn_agent, wait_agent
argument-hint: [audit scope description — modules, axes, baseline]
gates_at: [phase-1]
sentinel_checkpoints: [post_orchestrator]
---

# Audit entry-point (v4.5.0)

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

You are invoking `/pipeline-orchestrator-for-codex:audit` — a thin shortcut that delegates to the same `pipeline-controller` agent as `/pipeline-orchestrator-for-codex:pipeline`, but with `task_type` pre-fixed to `Audit`.

## Variant override via flag (Slice 3a v4.5.0+)

Before delegating to the controller, inspect `$ARGUMENTS` for a leading variant-override flag. The check is purely additive — invocations without a flag keep the existing auto-classify behavior.

- If `$ARGUMENTS` starts with `--light ` (with trailing space) OR `$ARGUMENTS` is exactly `--light`: strip the `--light` prefix and invoke `Skill(skill: "pipeline-orchestrator-for-codex:audit-light")` with the remaining `$ARGUMENTS` (may be empty).
- If `$ARGUMENTS` starts with `--heavy ` (with trailing space) OR `$ARGUMENTS` is exactly `--heavy`: strip the `--heavy` prefix and invoke `Skill(skill: "pipeline-orchestrator-for-codex:audit-heavy")` with the remaining `$ARGUMENTS`.
- Otherwise (no recognized flag): proceed with the controller dispatch below — auto-classification is unchanged.

The `audit-light` and `audit-heavy` skills carry the prescriptive 9-step procedures imported from Pulsar (`D:\Projeto Pulsar\.claude\commands\Prompts\Audtiroria\`). Phase 0 (information-gate) and Phase 3 (sanity / final-validator / finishing-branch) still wrap them via `pipeline-controller` when invoked through the auto-classify path.

## What this skill does

Spawn the `pipeline-controller` agent with real Codex `spawn_agent` and the user's request prefixed by `PRE_CLASSIFIED_TYPE=Audit`:

```
spawn_agent({
  agent_type: "worker",
  fork_context: false,
  message: "PIPELINE_AGENT_FQN: pipeline-orchestrator-for-codex:core:pipeline-controller\nPRE_CLASSIFIED_TYPE=Audit\n\n$ARGUMENTS"
})
```

The controller returns a `PIPELINE COMPLETE` block as its tool result. Show it to the user **verbatim** — do NOT summarize, trim, or paraphrase.

## What this skill does NOT do

- **Does NOT skip information-gate** — gap detection (scope, axes, baseline, stakeholder) is still mandatory.
- **Does NOT skip design-interrogator** for COMPLEXA audits — scope clarity still applies.
- **Does NOT permit any code change.** Audit pipelines are REPORT-ONLY by Iron Law. Every audit agent (`audit-intake`, `audit-domain-analyzer`, `audit-compliance-checker`, `audit-risk-matrix-generator`) is read-only by frontmatter and prompt.
- **Does NOT skip per-step evidence requirement** — every finding cites file:line or is tagged `[HYPOTHESIS]` / `[DESIGN]`.
- **Does NOT skip sanity check or Pa de Cal** — Phase 3 runs identically (sanity verifies report completeness; Pa de Cal issues GO/CONDITIONAL/NO-GO on the report quality + risk matrix).
- **Is NOT auto-invoked.** `disable-model-invocation: true` enforces manual-only triggering. Codex should never decide to run this skill on its own — it only runs when the user types `/pipeline-orchestrator-for-codex:audit`.

The ONLY phase shortened is Phase 0a (`task-orchestrator`): the classifier accepts `force_type=Audit` (via the `PRE_CLASSIFIED_TYPE` prefix) and skips the type-classification reasoning, but still computes complexity, pipeline_variant, and ssot_status. See `agents/core/task-orchestrator.md` Step 1a.

## Pass-through behavior

The `$ARGUMENTS` placeholder captures everything the user typed after the skill name. The full string is passed verbatim to the controller, prefixed by `PRE_CLASSIFIED_TYPE=Audit\n\n`. The controller's Step 1 recognizes the prefix, the `task-orchestrator` Step 1a strips and consumes it, and the rest of the 4-phase pipeline runs identically to a `/pipeline-orchestrator-for-codex:pipeline` invocation that classified as Audit.

## Why this exists

Without `/pipeline-orchestrator-for-codex:audit`, every "audit the auth layer" or "review data integrity" request burns one classification round to deduce `type=Audit`. With `/pipeline-orchestrator-for-codex:audit`, you tell the controller upfront and it goes straight to scope/baseline gap detection — saves tokens and prevents misclassification as Bug Fix when the user already knows it's a read-only audit.

The variant-override flags (`--light` / `--heavy`) are the recommended path when the user knows the depth they want: they skip the full pipeline-controller wrapper and run the prescriptive 9-step skill directly.

## Achado #7 GATE_REQUEST handler (2026-05-07+, v5.2.0-rc.2+)

When the dispatched pipeline-controller (or any subagent it transitively dispatches via DISPATCH_REQUEST) returns a tool result containing `=== GATE_REQUEST v1 ===`, `=== DISPATCH_REQUEST v1 ===`, or `=== PLAN_MODE_REQUEST v1 ===` blocks AND ends with `STATUS: AWAITING_GATE_RESPONSES` / `AWAITING_DISPATCH_RESULTS` / `AWAITING_PLAN_MODE_RESULTS`, the parent main LLM MUST process them per `references/gate-request-protocol.md`:

1. Parse each block out of the tool result.
2. For `GATE_REQUEST`: ask the user in the parent context with the parsed question + options and persist the response.
3. For `DISPATCH_REQUEST` with `target_kind: agent`: invoke `spawn_agent(agent_type: "worker", fork_context: false, message: "PIPELINE_AGENT_FQN: <target_name>\n<prompt>")`.
4. For `DISPATCH_REQUEST` with `target_kind: skill`: invoke `Skill(skill: target_name)`.
5. For `PLAN_MODE_REQUEST`: show a visible read-only plan in Codex when available; do not promise a literal Claude plan-mode tool when the runtime lacks it.
6. Aggregate responses/results into `GATE_RESPONSES` / `DISPATCH_RESULTS` / `PLAN_MODE_RESULTS` YAML payloads.
7. Re-dispatch the SAME subagent with the original prompt PLUS payloads prepended.
8. Repeat 1-7 until the subagent emits its terminal block (e.g., `PIPELINE COMPLETE`) without AWAITING_*.

Append every block emission and every response to `{PIPELINE_DOC_PATH}/protocol-events.jsonl` (NOT `gate-decisions.jsonl`). Named gates (ADVERSARIAL_GATE, FINAL_ADVERSARIAL_GATE, CLOSEOUT_CONFIRM, TDD_APPROVAL, PLAN_REJECTED, INFO_GATE_BLOCKED) ALSO get a canonical `gate-decisions.jsonl` entry with `decided_by: user` referencing the protocol event id. See `references/gate-request-protocol.md` "gate_id → canonical gate mapping" for the full table.

**Never silently default.** Malformed blocks → block and ask the user in the parent context ("malformed block — investigate, retry, or abort?"); do NOT guess.
