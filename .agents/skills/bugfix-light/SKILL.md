---
name: bugfix-light
description: Prescriptive 8-step bug fix workflow for SIMPLES/MEDIA bugs (max 2 files, ~50 lines diff). Imported from Pulsar bugfix workflow per spec §21. Use when complexity classification is light. Steps 1-4 inline (analysis + point fix), steps 5-6 subagent (validation + persistence check), 7-8 inline gates (complexity gate + Pa de Cal). Closes 3 audit gaps Light 3 (invariants BEFORE), Light 5 (RED→regression promotion), Light 6 (persistence quick check). Manual-only invocation via /pipeline-orchestrator-for-codex:bugfix-light or via /pipeline-orchestrator-for-codex:bugfix --light.
disable-model-invocation: true
allowed-tools: spawn_agent
argument-hint: [bug description with repro details]
sequence: [1, 2, 3, 4, 5, 6, 7, 8]
sequence_lock: true
gates_at: [7, 8]
sentinel_checkpoints: [pre_7]
stop_rule_max_failures: 2
---

# Bug Fix Light Workflow (8 prescriptive steps)

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

For informational-only workflows, do not launch the recommended workflow from the help/router context. Recommend the command and stop unless the user explicitly invokes an executable workflow with real agent support.

## Codex Parent Protocol Contract

Codex does not execute Claude `Task` or direct `GATE_REQUEST` calls as the operational contract. Subagent work is dispatched with real `spawn_agent`. User decisions are emitted as `GATE_REQUEST` protocol blocks, answered in the parent context, persisted to `protocol-events.jsonl`, and mirrored to `gate-decisions.jsonl` when the gate is canonical. Malformed or unanswered protocol blocks block the workflow; they are never silently defaulted.

This skill executes a deterministic 8-step procedure for SIMPLES/MEDIA bugs. The procedure is **non-negotiable**: order is locked, execution mode per step is locked, and gates cannot be skipped. The 6 audit gaps from spec §21.1 are closed by enriched steps 3, 5, 6.

## When to use this skill

Use **bugfix-light** when ALL of the following hold:
- Bug touches at most 2 files
- Diff is expected to be at most ~50 lines
- No cross-cutting business rules / persistence / concurrency / multi-user impact at first glance
- Bug is reproducible deterministically

If any of these does not hold, the workflow auto-escalates at step 7 (Complexity Gate) and recommends migrating to `bugfix-heavy`.

## Steps overview

| # | Step | File | execution_mode | agent_type | Gate? |
|---|------|------|----------------|------------|-------|
| 1 | Understand Behavior | [steps/01-understand-behavior.md](steps/01-understand-behavior.md) | inline | — | no |
| 2 | Simple Bug Analysis (RED test) | [steps/02-simple-bug-analysis.md](steps/02-simple-bug-analysis.md) | inline | — | no |
| 3 | Impact Check (invariants BEFORE) | [steps/03-impact-check.md](steps/03-impact-check.md) | inline | — | no |
| 4 | Point Fix (TDD GREEN) | [steps/04-point-fix.md](steps/04-point-fix.md) | inline | — | no |
| 5 | Post-Fix Validation (RED→regression) | [steps/05-post-fix-validation.md](steps/05-post-fix-validation.md) | subagent | general-purpose | no |
| 6 | Persistence Quick Check | [steps/06-persistence-quick-check.md](steps/06-persistence-quick-check.md) | subagent | general-purpose | no |
| 7 | Complexity Gate | [steps/07-complexity-gate.md](steps/07-complexity-gate.md) | inline | — | yes (GATE_REQUEST) |
| 8 | Pa de Cal (final GO/NO-GO) | [steps/08-pa-de-cal.md](steps/08-pa-de-cal.md) | inline | — | yes (GATE_REQUEST) |

## Execution rules (8 enforcement rules — non-negotiable)

These rules are baked into the frontmatter contract. The dispatch-guard hook + sentinel-hook validate them at runtime. Violations are blocked deterministically — there is no agent discretion.

1. **Sequence lock** — steps execute strictly in order 1→2→3→4→5→6→7→8. No skip, no reorder. Validated via `sequence:` + `sequence_lock: true` in this SKILL.md plus `expected_next:` in each step.
2. **Execution-mode lock** — each step declares `execution_mode: inline | subagent` in its frontmatter. The agent CANNOT swap modes at runtime. Inline steps run in main context; subagent steps call spawn_agent with the declared `agent_type`.
3. **Agent-type whitelist** — when `execution_mode: subagent`, the step declares the EXACT `agent_type:` allowed. dispatch-guard rejects any other agent.
4. **Output schema** — each step declares `expected_outputs:`. The next step verifies inputs match before proceeding. Fail-closed.
5. **GATE_REQUEST gates obrigatórios** — steps 7 and 8 declare `gate_required: true`. The skill MUST emit a GATE_REQUEST at those points. Prose substitution is forbidden.
6. **STOP RULE** — 2 consecutive failures (build, test, validation) halt the pipeline. `stop_rule_max_failures: 2` enforced by sanity-checker + checkpoint-validator.
7. **Audit log append-only** — every gate decision, GATE_REQUEST answer, step transition, and STOP event is appended to `.pipeline/gate-decisions.jsonl`.
8. **Sentinel checkpoints** — sentinel-hook validates state before step 7 (`sentinel_checkpoints: [pre_7]`). Outside this checkpoint, sentinel blocks execution.

## How execution flows

1. The skill is invoked via `/pipeline-orchestrator-for-codex:bugfix-light "<bug description>"` (or via `/pipeline-orchestrator-for-codex:bugfix --light` after pipeline-controller dispatch).
2. The orchestrator reads `sequence:` from this file and walks the steps.
3. For each step, the orchestrator opens `steps/0X-*.md`, reads the frontmatter, and:
   - if `execution_mode: inline`, the agent processes the step body in main context using `allowed_tools` from the step
   - if `execution_mode: subagent`, the agent calls spawn_agent with `agent_type:` and passes `expected_inputs` from previous steps
4. Outputs are accumulated; `expected_next` chains to the following step.
5. Gates (steps 7, 8) raise GATE_REQUEST before transitioning out.
6. On any failure, the STOP RULE rule may halt the pipeline.

## Reference docs

- Test strategy across the 8 steps: [tests/tests-bugfix-light.md](tests/tests-bugfix-light.md)
- Design rationale: `designs/pipeline-orchestrator-v5-consolidated.md` §21
- Pulsar source playbook (read-only ancestor): `D:\Projeto Pulsar\.claude\commands\Prompts\Bug_fix\light\` (LIGHT_01..07 + LIGHT_PA_DE_CAL + TESTS_BUGFIX_LIGHT)

## Gap closures relative to v4.3.1 plugin

- **Light 3 — invariants BEFORE the fix**: enforced in `steps/03-impact-check.md` (REQUIRED OUTPUT block listing invariants + edge cases is mandatory before step 4).
- **Light 5 — RED → regression promotion**: enforced in `steps/05-post-fix-validation.md` (PROMOTION ACTION subsection + commit `test(regression): promote bug-X repro to regression suite`).
- **Light 6 — Persistence Quick Check**: net-new step, no v4.3.1 equivalent. Enforced in `steps/06-persistence-quick-check.md` (rerun-twice protocol + `persistence_stable` / `side_effects_detected` outputs).
