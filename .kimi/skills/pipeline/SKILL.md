---
name: pipeline
description: Automated multi-agent pipeline for any project. Use when ANY task needs rigorous Bug Fix, Feature, User Story, Audit, or UX Simulation execution with TDD, adversarial review, and gate enforcement. Manual-only — never auto-invoked because every pipeline run has side effects (TDD-RED tests, code edits, commits proposed).
---

# Pipeline Orchestrator — Parent Handler Loop (Kimi port)

You are the **parent orchestrator** for the `/pipeline` skill. Your job is to run a persistent handler loop that spawns the `pipeline-controller` subagent, processes the protocol blocks it emits, and re-dispatches it with responses until the pipeline terminates.

The controller contains all 4-phase workflow logic but CANNOT call `AskUserQuestion` or nested `Agent` directly. It emits structured protocol blocks in its tool result. YOU must parse those blocks, invoke the appropriate Kimi tools, and feed the results back.

## What to do — Overview

1. Call `SetTodoList` with the pipeline phases.
2. Spawn the `pipeline-controller` as a `coder` subagent with the user's request.
3. Enter the **parent handler loop**: parse blocks → invoke tools → re-dispatch controller.
4. On `PIPELINE COMPLETE`, present results to the user and clear/update todo list.

## What NOT to do

- **Do NOT perform any file edits yourself.** All edits are delegated to the controller or its dispatched agents.
- **Do NOT attempt to "help" by pre-classifying the task.** The controller's task-orchestrator does that.
- **Do NOT bypass with reasoning like "this is too small for a pipeline".** If the user invoked `/pipeline`, they want the pipeline.
- **Do NOT silently default when blocks are malformed.** Ask the user.

---

## Phase 0: Initialize Visible Plan

Before spawning any agent, call `SetTodoList` to show the user the pipeline progress:

```yaml
SetTodoList:
  todos:
    - title: "Phase 0: Triage & Classification"
      status: in_progress
    - title: "Phase 1: Proposal & User Confirmation"
      status: pending
    - title: "Phase 1.5: Planning (conditional)"
      status: pending
    - title: "Phase 2: Batch Execution"
      status: pending
    - title: "Phase 3: Closure & Final Validation"
      status: pending
```

Update the todo list as the controller progresses through phases. When a phase completes, mark it `done` and the next `in_progress`.

**Timing rule:** Update `SetTodoList` after every phase transition, after every gate decision, after every batch checkpoint, and after the final validator decision. Never let the todo list drift more than one turn behind the actual controller state.

---

## Phase 1: Spawn Controller

Spawn the controller with the user's full request:

1. Extract the user's message text after `/pipeline` (or the shortcut like `/bugfix`, `/feature`). This is the REQUEST_TEXT.
2. Detect the skill install location by checking these paths in order:
   - `.agents/skills/pipeline/` (project-level)
   - `.kimi/skills/pipeline/` (project-level, dev mode)
   - `~/.kimi/skills/pipeline/` (user-level)
   The first existing directory is SKILL_ROOT. Use absolute paths when possible.
3. Pass SKILL_ROOT and REQUEST_TEXT to the controller:

```
Agent(
  subagent_type: "coder",
  description: "Pipeline controller",
  prompt: |
    You are the pipeline-controller for the pipeline-orchestrator plugin.

    SKILL_ROOT: <absolute-path-to-skill-directory>
    User request: <REQUEST_TEXT>

    Execute the full 4-phase workflow. Emit protocol blocks when you need
    user interaction, peer agent dispatch, or read-only research. End each
    turn with the appropriate STATUS line.
)
```

Capture the controller's full tool result. It will contain:
- Zero or more protocol blocks (`GATE_REQUEST`, `DISPATCH_REQUEST`, `PLAN_MODE_REQUEST`)
- A `STATUS:` line indicating what the parent must do next

---

## Phase 2: Parent Handler Loop

> **Reference:** The full protocol specification lives in `references/parent-handler-protocol.md`. The summary below is sufficient for the pipeline skill; other skills (bugfix, feature, audit, review, spec) should link to the reference file instead of duplicating this section.


**Loop invariant:** Repeat steps 1-7 until the controller's tool result contains `PIPELINE COMPLETE` and does NOT end with any `AWAITING_*` status.

### Step 2.1 — Parse Protocol Blocks

Scan the controller's tool result for structured blocks. Each block is delimited:

```
=== <BLOCK_TYPE> v1 ===
<yaml payload>
=== END <BLOCK_TYPE> ===
```

Block types to recognize:
- `GATE_REQUEST v1`
- `DISPATCH_REQUEST v1`
- `PLAN_MODE_REQUEST v1`

Also scan for the status line at the end:
```
STATUS: AWAITING_GATE_RESPONSES
pending_gate_ids:
  - <gate-id>
```
or
```
STATUS: AWAITING_DISPATCH_RESULTS
pending_dispatch_ids:
  - <dispatch-id>
```
or
```
STATUS: AWAITING_PLAN_MODE_RESULTS
pending_plan_ids:
  - <plan-id>
```

If no `AWAITING_*` status is present and `PIPELINE COMPLETE` is present, exit the loop.

### Step 2.2 — Execute GATE_REQUEST → AskUserQuestion

For each `GATE_REQUEST` block:

1. Extract fields:
   - `gate_id` (string)
   - `question` (string)
   - `header` (string, max 12 chars)
   - `multi_select` (boolean, default false)
   - `options` (array of `{ label, description?, recommended? }`)
   - `context` (optional string)

2. Call `AskUserQuestion` with:
   - `question`: the extracted `question`
   - `header`: the extracted `header`
   - `multi_select`: the extracted `multi_select`
   - `options`: the extracted `options`

3. Collect the user's response (selected option label(s)).

4. Build a `GATE_RESPONSES` payload:

```yaml
=== GATE_RESPONSES v1 ===
responses:
  - gate_id: <gate-id>
    selected:
      - label: "<selected-label>"
=== END GATE_RESPONSES ===
```

If multiple options were selected in a multi-select gate, include all selected labels.

### Step 2.3 — Execute DISPATCH_REQUEST → Agent

For each `DISPATCH_REQUEST` block:

1. Extract fields:
   - `dispatch_id` (string)
   - `target_type` (string: `coder` or `explore`)
   - `description` (string)
   - `prompt` (string — the full prompt for the subagent)
   - `context_for_parent` (optional string)

2. Call `Agent(` with:
   - `subagent_type`: the extracted `target_type`
   - `description`: the extracted `description`
   - `prompt`: the extracted `prompt`

3. Capture the subagent's full tool result (stdout + artifacts).

4. Build a `DISPATCH_RESULTS` payload:

```yaml
=== DISPATCH_RESULTS v1 ===
results:
  - dispatch_id: <dispatch-id>
    status: success | error | timeout
    output: |
      <subagent tool result verbatim>
=== END DISPATCH_RESULTS ===
```

If the subagent failed or timed out, set `status: error` and include any error message in `output`.

**Important:** Use `subagent_type: "coder"` for implementation/editing agents (task-orchestrator, executor-controller, adversarial scanners). Use `subagent_type: "explore"` for research/analysis agents (information-gate, design-interrogator, plan-architect).

### Step 2.4 — Execute PLAN_MODE_REQUEST → Read-Only Research

For each `PLAN_MODE_REQUEST` block:

1. Extract fields:
   - `plan_id` (string)
   - `research_scope` (string — what to research)
   - `expected_deliverables` (array of strings)

2. Conduct read-only research using `ReadFile`, `Glob`, and `Grep` as specified in `research_scope`. Do NOT write files, edit code, or run destructive commands during this phase.

3. Compile findings into a structured research report.

4. Build a `PLAN_MODE_RESULTS` payload:

```yaml
=== PLAN_MODE_RESULTS v1 ===
results:
  - plan_id: <plan-id>
    findings: |
      <compiled research report>
    deliverables:
      - <item 1>
      - <item 2>
=== END PLAN_MODE_RESULTS ===
```

### Step 2.5 — Aggregate and Re-dispatch Controller

1. Concatenate all response payloads (`GATE_RESPONSES`, `DISPATCH_RESULTS`, `PLAN_MODE_RESULTS`) into a single string.

2. Prepend this aggregate payload at the **top** of the controller's next prompt, followed by a separator:

```
<aggregate payloads>

---

Continue from where you stopped. Your previous turn ended awaiting:
- gate responses for: <gate-ids>
- dispatch results for: <dispatch-ids>
- plan mode results for: <plan-ids>
```

3. Re-dispatch the **same** controller agent with this prepended prompt. Use the same `subagent_type: "coder"` and description, but the prompt now starts with the responses.

4. Return to Step 2.1 with the new tool result.

---

## Phase 3: Terminal State

When the controller returns `PIPELINE COMPLETE` without any `AWAITING_*` status:

1. Extract the `PIPELINE COMPLETE` block and any final artifacts.
2. Present the block to the user verbatim.
3. Update `SetTodoList` — mark all phases `done`.
4. Exit the handler loop.

### PIPELINE COMPLETE block format

```
=== PIPELINE COMPLETE v1 ===
status: success | partial | failed
summary: |
  <human-readable summary>
artifacts:
  - path: <file-path>
    description: <what it contains>
next_steps:
  - <suggested action>
=== END PIPELINE COMPLETE ===
```

If `status: failed`, present the failure reason and ask the user whether to retry, continue, or abort.

---

## Error Handling

### Malformed Blocks

If the controller emits a block with:
- Missing required fields (e.g., `dispatch_id` without `target_type`)
- Invalid YAML syntax
- Unknown block type

Do NOT guess or silently ignore. Instead:

1. Call `AskUserQuestion` with:
   - `question`: "The pipeline controller emitted a malformed protocol block. How should I proceed?"
   - `header`: "Pipeline"
   - `options`:
     - `label`: "Investigate"
       `description`: "Show me the raw block so I can diagnose"
     - `label`: "Retry"
       `description`: "Re-dispatch the controller and hope it recovers"
     - `label`: "Abort"
       `description`: "Stop the pipeline and report the issue"

2. Follow the user's choice.

### Subagent Timeout or Crash

If a dispatched agent (Step 2.3) times out or crashes:

1. Set `status: error` in the `DISPATCH_RESULTS` payload.
2. Include any partial output or error message.
3. Re-dispatch the controller with this error result.
4. Let the controller decide whether to retry, skip, or escalate to the user.

### Circuit Breaker (Hard Limit)

To prevent infinite loops, enforce a **maximum of 20 re-dispatches** (controller turns after the initial spawn). Count every re-dispatch in Step 2.5. If the count reaches 20 and the controller has not emitted `PIPELINE COMPLETE`:

1. Stop the handler loop.
2. Present the user with a summary of what was accomplished and what is pending.
3. Ask via `AskUserQuestion` whether to continue (reset counter), save state for `/pipeline continue`, or abort.

### Controller Returns Plain Text (No Protocol Blocks)

If the controller returns a tool result that:
- Contains no `GATE_REQUEST`, `DISPATCH_REQUEST`, or `PLAN_MODE_REQUEST` blocks
- Does not end with any `AWAITING_*` status
- Does not contain `PIPELINE COMPLETE`

Then the controller has lost protocol alignment. Do NOT continue the loop blindly. Instead:

1. Call `AskUserQuestion`:
   - `question`: "The pipeline controller returned unexpected output with no protocol blocks. How should I proceed?"
   - `header`: "Pipeline"
   - `options`:
     - `label`: "Retry"
       `description`: "Re-dispatch the controller with a reminder of the protocol"
     - `label`: "Investigate"
       `description`: "Show me the raw output"
     - `label`: "Abort"
       `description`: "Stop the pipeline"

2. Follow the user's choice.

### Context Overflow / Token Limit

If the controller's prompt grows too large (context window pressure from prepended responses):

1. Summarize older responses instead of prepending them verbatim.
2. Keep only the last 3 rounds of `GATE_RESPONSES`, `DISPATCH_RESULTS`, and `PLAN_MODE_RESULTS`.
3. Archive full history to a file under `.pipeline/` if needed for audit.
4. Include a note in the prepended prompt: "[Earlier responses summarized due to context limit]".

### Controller Loop Detected

If you detect the controller is re-emitting the same requests without making progress (>3 identical turns):

1. Call `AskUserQuestion` to ask the user whether to continue, reset state, or abort.
2. If reset, clear all pending IDs and re-dispatch with a fresh prompt.

---

## Mode Detection from User Input

Parse REQUEST_TEXT to set the initial pipeline mode before spawning the controller:

| Pattern | Mode | Controller hint |
|---------|------|-----------------|
| `diagnostic` | DIAGNOSTIC | Stop after Phase 1 |
| `continue` | CONTINUE | Resume from Phase 2 |
| `review-only` | REVIEW-ONLY | Skip to final review |
| `--simples` | FULL + SIMPLES | Force simple classification |
| `--media` | FULL + MEDIA | Force medium classification |
| `--complexa` | FULL + COMPLEXA | Force complex classification |
| `--hotfix` | HOTFIX | Emergency bypass |
| `--grill` | FULL + GRILL | Force design interrogation |
| `--plan` | FULL + PLAN | Force plan mode |
| `--no-plan` | FULL + NO_PLAN | Skip plan mode |
| (default) | FULL | All 4 phases |

Pass the detected mode to the controller in its prompt:

```
Detected mode: <MODE>
User request: <REQUEST_TEXT>
```

---

## Exec-Window Protocol (Deterministic Scripts)

Before the controller (or any dispatched `coder` agent) edits files outside `.pipeline/`, an exec-window must be opened using deterministic Node.js scripts:

1. **Open:** Run `node {SKILL_ROOT}/scripts/open-exec-window.cjs --session-id=<id> --purpose=<text> --ttl-minutes=5`
2. **Validate:** Run `node {SKILL_ROOT}/scripts/validate-exec-window.cjs --session-id=<id>` before each edit batch
3. **Close:** Run `node {SKILL_ROOT}/scripts/close-exec-window.cjs --session-id=<id>` after the batch completes

The scripts enforce:
- Input validation (session_id >= 3 chars, purpose >= 3 chars)
- TTL bounds (1–60 minutes, default 5)
- Atomic write via temp-file + rename
- Audit log append to `.pipeline/sessions/audit.log`
- Mutual exclusion (refuse to open if an active exec-window already exists for the same session_id)

The parent may execute these scripts via `Shell` on behalf of the controller, or the controller may emit them in `Shell` tool calls. Never allow manual JSON write to `.exec-window` files.

---

## Compensating Controls (No Kimi Hook System)

Because Kimi does not support Claude-style hooks, enforce these compensating controls in the parent handler:

### Path Validation Before Allowing Edits

Whenever the controller or a dispatched agent attempts to write or edit a file:
1. If the path is under `.pipeline/` → allow
2. If an exec-window is active (validate script returns `status: valid`) → allow any path
3. Otherwise → block and emit a `GATE_REQUEST` asking the user to confirm the edit

Never silently allow edits outside `.pipeline/` without an active exec-window.

### Session Lock / Mutual Exclusion

Before spawning the controller in Step 1, check if `.pipeline/sessions/` contains any `.exec-window` files with `expires_at > now`. If one exists:
1. Call `AskUserQuestion` to warn the user about a concurrent pipeline session
2. Options: "Proceed anyway", "Wait for other session", "Abort"
3. If "Proceed anyway", generate a unique session_id to avoid collision

### Sentinel State Validation

The controller creates `{PIPELINE_DOC_PATH}/sentinel-state.json` at the start of Phase 0. Before spawning the final-validator (Phase 3b), the parent should verify that `sentinel-state.json` exists and contains at least:
- `session_id`
- `started_at`
- `classification`
- `phases_completed` array

If sentinel state is missing or incomplete, warn the user before proceeding to final validation.

### Gate Decision Logging

After every `GATE_REQUEST` is answered by the user, append a line to `.pipeline/sessions/gate-decisions.jsonl`:

```json
{"event":"gate-decided","gate_id":"<id>","selected":"<label>","timestamp":<epoch-ms>}
```

The parent is responsible for writing this log. The final-validator reads it to validate that all mandatory gates were passed.

---

## References

The controller may reference these documents. Keep them available for lookup:

- `references/gate-request-protocol.md` — Full protocol schema
- `references/gates.md` — Gate hardness taxonomy
- `references/audit-trail.md` — Audit log format
- `references/complexity-matrix.md` — Routing rules
- `references/sentinel-integration.md` — State tracking
- `references/workflow-next-step.md` — NEXT_STEP block format

Agent prompts live in `agents/` and are loaded by the controller via `ReadFile` before dispatch.
