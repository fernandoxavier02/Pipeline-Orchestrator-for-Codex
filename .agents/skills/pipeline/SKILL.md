---
name: pipeline
description: >
  Automated multi-agent pipeline for any project. Use when ANY task needs rigorous
  Bug Fix, Feature, User Story, Audit, or UX Simulation execution with TDD,
  adversarial review, and gate enforcement. Invoked via `/pipeline [task]`.
  Manual-only — never auto-invoked because every pipeline run has side effects
  (TDD-RED tests, code edits, commits proposed).
---

# Pipeline Orchestrator — Thin Delegator (Kimi port)

This skill's ONLY job is to spawn the `pipeline-controller` agent. All orchestration logic lives in the controller's prompt, running in an isolated subagent context. This design eliminates main-LLM bypass of the pipeline protocol.

## What to do

Invoke the controller agent with the user's full request as prompt:

```
Agent(
  subagent_type: "coder",
  description: "Orchestrate pipeline for the user request",
  prompt: "You are the pipeline-controller. User request: {{arguments}}"
)
```

## What NOT to do

- **Do NOT perform any orchestration yourself.** The controller handles Phase 0, 1, 1.5, 2, 3.
- **Do NOT invoke file edits during this session yourself.** Delegate all edits to the controller.
- **Do NOT attempt to "help" by pre-classifying the task.** The controller's task-orchestrator does that.
- **Do NOT bypass with reasoning like "this is too small for a pipeline".** If the user invoked `/pipeline`, they want the pipeline. If it's truly too small, the controller will propose SIMPLES+DIRETO and ask for confirmation.

## Runtime protocol (Kimi adaptation)

Kimi subagents spawned via `Agent` tool MAY NOT have access to `AskUserQuestion` or nested `Agent` dispatches. Therefore, the controller emits structured protocol blocks in its tool result, and YOU (the parent main LLM) MUST process them.

### Block types the controller may emit

| Block | Purpose | Parent action |
|---|---|---|
| `=== GATE_REQUEST v1 ===` | Ask user a multiple-choice question | Call `AskUserQuestion` with the parsed question + options |
| `=== DISPATCH_REQUEST v1 ===` | Spawn a peer agent | Call `Agent(subagent_type: "coder" or "explore", description, prompt)` |
| `=== PLAN_MODE_REQUEST v1 ===` | Research-only planning phase | Conduct read-only research yourself (Glob/Grep/ReadFile), then return findings |

### Parent handler loop

When the controller returns a tool result containing protocol blocks AND ends with `STATUS: AWAITING_GATE_RESPONSES` / `AWAITING_DISPATCH_RESULTS` / `AWAITING_PLAN_MODE_RESULTS`:

1. Parse each block out of the tool result.
2. For `GATE_REQUEST`: invoke `AskUserQuestion` with the parsed `question`, `header`, and `options`. Collect the user's selection.
3. For `DISPATCH_REQUEST`: invoke `Agent(subagent_type: <choose coder or explore>, description: <description>, prompt: <prompt>)`. Capture full tool result.
4. For `PLAN_MODE_REQUEST`: conduct read-only research per `research_scope` using ReadFile/Glob/Grep, then compile findings.
5. Aggregate all responses/results into `GATE_RESPONSES` / `DISPATCH_RESULTS` / `PLAN_MODE_RESULTS` YAML payloads.
6. Re-dispatch the SAME controller agent with the original prompt PLUS the response payloads prepended at the top of the prompt.
7. Repeat steps 1-6 until the controller emits its terminal block (`PIPELINE COMPLETE`) without any AWAITING_* status.

**Never silently default.** If the controller emits a malformed block (missing required fields, invalid YAML), present the issue to the user via your own `AskUserQuestion` ("malformed block — investigate, retry, or abort?") rather than guessing.

### Visible plan tracking

Use `SetTodoList` to show pipeline progress to the user:
- Phase 0: Triage
- Phase 1: Proposal
- Phase 1.5: Planning (conditional)
- Phase 2: Batch Execution
- Phase 3: Closure

Update the todo list as the controller progresses through phases.

## When controller returns

The controller returns a `PIPELINE COMPLETE` block as its tool result. Pass it to the user verbatim.
