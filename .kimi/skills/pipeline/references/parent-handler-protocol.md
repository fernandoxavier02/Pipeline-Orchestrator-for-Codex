---
name: parent-handler-protocol
description: Reference document for the Kimi parent handler loop. Loaded by SKILL.md files that need the full 7-step protocol handler. Not a standalone skill.
---

# Parent Handler Protocol (Kimi)

This document defines the canonical parent handler loop for processing protocol blocks emitted by the `pipeline-controller` subagent.

All `/pipeline` skills (pipeline, bugfix, feature, audit, review, spec) use this protocol. Do NOT duplicate this logic in each SKILL.md. Link to this file instead.

## Overview

The parent spawns the `pipeline-controller` as a `coder` subagent. The controller emits structured blocks in its tool result. The parent parses these blocks, invokes the appropriate Kimi tools, and feeds results back via re-dispatch.

## Block Types

| Block | Purpose | Parent Action |
|---|---|---|
| `=== GATE_REQUEST v1 ===` | Ask user a multiple-choice question | Call `AskUserQuestion` |
| `=== DISPATCH_REQUEST v1 ===` | Spawn a peer agent | Call `Agent(subagent_type: coder/explore)` |
| `=== PLAN_MODE_REQUEST v1 ===` | Research-only planning | Conduct read-only research |

## Handler Loop

**Loop invariant:** Repeat steps 1-7 until the controller's tool result contains `PIPELINE COMPLETE` and does NOT end with any `AWAITING_*` status.

### Step 1 — Parse Protocol Blocks

Scan the controller's tool result for structured blocks. Each block is delimited:

```
=== <BLOCK_TYPE> v1 ===
<yaml payload>
=== END <BLOCK_TYPE> ===
```

Also scan for the status line at the end:
```
STATUS: AWAITING_GATE_RESPONSES
pending_gate_ids:
  - <gate-id>
```
(or `AWAITING_DISPATCH_RESULTS` / `AWAITING_PLAN_MODE_RESULTS`).

If no `AWAITING_*` status is present and `PIPELINE COMPLETE` is present, exit the loop.

### Step 2 — Execute GATE_REQUEST → AskUserQuestion

For each `GATE_REQUEST` block:

1. Extract fields: `gate_id`, `question`, `header`, `multi_select`, `options`, `context`
2. Call `AskUserQuestion` with extracted fields
3. Collect user's response
4. Build `GATE_RESPONSES` payload:

```yaml
=== GATE_RESPONSES v1 ===
responses:
  - gate_id: <gate-id>
    selected:
      - label: "<selected-label>"
=== END GATE_RESPONSES ===
```

### Step 3 — Execute DISPATCH_REQUEST → Agent

For each `DISPATCH_REQUEST` block:

1. Extract fields: `dispatch_id`, `target_type`, `description`, `prompt`
2. Call `Agent(` with `subagent_type: target_type`, `description`, `prompt`
3. Capture subagent's full tool result
4. Build `DISPATCH_RESULTS` payload:

```yaml
=== DISPATCH_RESULTS v1 ===
results:
  - dispatch_id: <dispatch-id>
    status: success | error | timeout
    output: |
      <subagent tool result verbatim>
=== END DISPATCH_RESULTS ===
```

Use `coder` for implementation agents, `explore` for research agents.

### Step 4 — Execute PLAN_MODE_REQUEST → Read-Only Research

For each `PLAN_MODE_REQUEST` block:

1. Extract fields: `plan_id`, `research_scope`, `expected_deliverables`
2. Conduct read-only research using `ReadFile`, `Glob`, `Grep`
3. Compile findings
4. Build `PLAN_MODE_RESULTS` payload:

```yaml
=== PLAN_MODE_RESULTS v1 ===
results:
  - plan_id: <plan-id>
    findings: |
      <compiled research report>
    deliverables:
      - <item 1>
=== END PLAN_MODE_RESULTS ===
```

### Step 5 — Aggregate and Re-dispatch Controller

1. Concatenate all response payloads into a single string
2. Prepend at the **top** of the controller's next prompt:

```
<aggregate payloads>

---

Continue from where you stopped. Your previous turn ended awaiting:
- gate responses for: <gate-ids>
- dispatch results for: <dispatch-ids>
- plan mode results for: <plan-ids>
```

3. Re-dispatch the **same** controller agent with this prepended prompt
4. Return to Step 1

## Error Handling

### Malformed Blocks

If the controller emits invalid blocks, call `AskUserQuestion` with options: Investigate, Retry, Abort.

### Circuit Breaker

Enforce a **maximum of 20 re-dispatches**. If reached without `PIPELINE COMPLETE`, stop and ask the user.

### Plain Text Response

If the controller returns no blocks and no `PIPELINE COMPLETE`, it has lost protocol alignment. Ask the user: Retry, Investigate, Abort.

### Context Overflow

Summarize older responses. Keep only last 3 rounds. Archive full history to `.pipeline/` if needed.

## SetTodoList Timing

Update `SetTodoList` at these exact moments:
- After **every phase transition** (0→1, 1→1.5, 1.5→2, 2→3)
- After **every gate decision** (user answers a GATE_REQUEST)
- After **every batch completion** (checkpoint pass/fail)
- After **final validator decision** (GO/CONDITIONAL/NO-GO)
- On `PIPELINE COMPLETE` (mark all phases `done`)

Never let the todo list drift more than one turn behind the actual controller state.
