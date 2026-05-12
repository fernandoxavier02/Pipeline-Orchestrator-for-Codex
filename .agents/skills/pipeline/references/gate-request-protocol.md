# GATE_REQUEST and DISPATCH_REQUEST protocol (Kimi port)

**Status:** Active. Adapted from the canonical Claude Code protocol for Kimi runtime.

**Purpose:** workaround the Kimi runtime constraint that `AskUserQuestion` and nested `Agent` dispatches may not be available in subagent contexts. Subagents cannot ask the user questions or dispatch nested subagents directly. This protocol formalizes the "hoist to parent" pattern: the subagent emits a structured block in its tool result, the parent (main LLM, where these tools work) processes the block and re-dispatches the subagent with the answer or result attached.

This protocol does NOT change which agents exist, what they classify, or what artifacts they produce. It only changes HOW an agent that needs an interactive surface delegates that surface upward.

---

## When to use which

| Subagent need | Block type to emit | Parent handles |
|---|---|---|
| Ask user a multiple-choice question | `GATE_REQUEST` | Calls `AskUserQuestion`, captures answer, re-dispatches subagent with `GATE_RESPONSE` payload |
| Dispatch a peer/leaf agent | `DISPATCH_REQUEST` | Calls `Agent(subagent_type, prompt)`, captures result, re-dispatches caller with `DISPATCH_RESULT` payload |
| Read-only research/planning | `PLAN_MODE_REQUEST` | Parent conducts read-only research via ReadFile/Glob/Grep, returns compiled findings |
| Continue without user interaction | (no block) | n/a — subagent returns final result normally |

A subagent MAY emit multiple blocks of different types in a single tool result. The parent processes them in declaration order.

---

## Block schemas

All blocks are emitted as fenced YAML in the subagent's tool result, with a sentinel header line for parser anchoring.

### GATE_REQUEST

```yaml
=== GATE_REQUEST v1 ===
gate_id: <unique-id-within-run>     # e.g. "explore-q1", "plan-approval", "tdd-scenario-3"
question: <full question text>
header: <max-12-char chip label>
multi_select: <true|false>          # default false
options:
  - label: "<text>"
    description: "<one-sentence trade-off>"
    recommended: <true|false>       # exactly one option may be recommended (first option per UI convention)
  - label: "<text>"
    description: "<...>"
context: |
  <optional 1-3 sentence context for the user — what's at stake>
=== END GATE_REQUEST ===
```

After emitting `GATE_REQUEST`, the subagent MUST stop work that depends on the answer and either: (a) emit additional blocks that don't need this answer, OR (b) end the tool result with `STATUS: AWAITING_GATE_RESPONSES` and the list of pending `gate_id`s.

### DISPATCH_REQUEST

```yaml
=== DISPATCH_REQUEST v1 ===
dispatch_id: <unique-id-within-run>
target_type: coder | explore        # Kimi subagent types
description: <short label for the parent's tool call>
prompt: |
  <full prompt text, multiline, verbatim — the parent passes this through>
context_for_parent: |
  <optional notes for the parent: why this dispatch, what the result is used for>
=== END DISPATCH_REQUEST ===
```

For `target_type: coder`, the parent uses `Agent(subagent_type: "coder", ...)`.  
For `target_type: explore`, the parent uses `Agent(subagent_type: "explore", ...)`.

### PLAN_MODE_REQUEST

```yaml
=== PLAN_MODE_REQUEST v1 ===
plan_id: <unique-id-within-run>
research_scope: |
  <multi-line description of what the parent should research>
expected_deliverables:
  - <bullet of what to produce>
  - <bullet>
=== END PLAN_MODE_REQUEST ===
```

The parent conducts read-only research using `ReadFile`, `Glob`, `Grep` in its own context, compiles findings into a plan, and re-dispatches the caller with the plan attached as `PLAN_MODE_RESULT`.

### Response payloads (parent → subagent on re-dispatch)

When the parent re-dispatches a subagent with answers, it prepends the original prompt with one of:

```
GATE_RESPONSES:
  <gate_id>:
    selected_label: "<option label the user picked>"
    selected_index: <0-based index>
    user_notes: "<text from user, if any>"
  <gate_id>: ...
```

```
DISPATCH_RESULTS:
  <dispatch_id>:
    success: true|false
    result: |
      <full text of the agent tool result>
    error: "<if success=false>"
  <dispatch_id>: ...
```

```
PLAN_MODE_RESULTS:
  <plan_id>:
    plan: |
      <full plan text the parent produced>
```

The subagent reads these payloads at the top of its prompt, applies them to its in-progress state, and continues from where it stopped.

---

## Parent-side handler protocol (Kimi)

When a parent dispatches a subagent that uses this protocol, it MUST:

1. Read the entire tool result for `=== <BLOCK_TYPE> v1 ===` ... `=== END <BLOCK_TYPE> ===` markers.
2. Process blocks in declaration order:
   - `GATE_REQUEST` → invoke `AskUserQuestion` with the gate's question + options. Collect answer.
   - `DISPATCH_REQUEST` → invoke the target via `Agent(subagent_type: <target_type>, description, prompt)`. Capture result.
   - `PLAN_MODE_REQUEST` → conduct read-only research via `ReadFile`/`Glob`/`Grep`, compile findings into a plan.
3. Aggregate all responses/results into `GATE_RESPONSES` / `DISPATCH_RESULTS` / `PLAN_MODE_RESULTS` payloads.
4. If the subagent's tool result ended with `STATUS: AWAITING_GATE_RESPONSES` (or AWAITING_DISPATCH_RESULTS, AWAITING_PLAN_MODE_RESULTS), re-dispatch the SAME subagent with the original prompt + the response payloads prepended.
5. If the subagent emitted blocks but did NOT end with AWAITING_*, the parent MUST still process the blocks but MAY skip the re-dispatch (the subagent decided it could continue past the blocks; the responses are still recorded for audit).
6. Persist every gate response and dispatch result to a SEPARATE log file `{PIPELINE_DOC_PATH}/protocol-events.jsonl` (NOT to `gate-decisions.jsonl`) with the `gate_id` / `dispatch_id` for cross-reference.

The parent MUST NOT silently default. If a `GATE_REQUEST` is malformed (missing required fields, no options), the parent emits an error to the user and does NOT re-dispatch the subagent until the malformed block is corrected.

---

## Audit-trail entries

**Schema collision with gate-decisions.jsonl:** the strict validator requires `decided_by` to be in the enum `{user, system, auto}` and `gate` to be a name from the gate registry. Protocol bookkeeping introduces neither value, so it MUST live in a separate log file.

**Separate file:** every block processing produces a `{PIPELINE_DOC_PATH}/protocol-events.jsonl` entry (NOT `gate-decisions.jsonl`). Schema:

```json
{"event":"GATE_REQUEST","gate_id":"<id>","phase":"<phase>","decision":"<selected_label>","decided_by":"gate_request_protocol_parent_handler","timestamp":"<iso>","detail":"<≤200 chars>"}
{"event":"DISPATCH_REQUEST","dispatch_id":"<id>","phase":"<phase>","target_type":"coder|explore","decision":"<success|error>","decided_by":"gate_request_protocol_parent_handler","timestamp":"<iso>","detail":"<≤200 chars>"}
{"event":"PLAN_MODE_REQUEST","plan_id":"<id>","phase":"<phase>","decision":"<plan_returned|aborted>","decided_by":"gate_request_protocol_parent_handler","timestamp":"<iso>","detail":"<≤200 chars>"}
```

Note the field is `event:`, NOT `gate:` — this signals to any reader that the file is not the gate decision log.

**Cross-reference back to gate-decisions.jsonl:** when the GATE_REQUEST corresponds to a NAMED gate in the registry, the parent SHOULD ALSO write the canonical `gate-decisions.jsonl` entry with `decided_by: user` and `detail` mentioning the protocol event id for traceability.

---

## gate_id → canonical gate mapping

| gate_id pattern | Canonical gate (registry) | Hardness |
|---|---|---|
| `phase-1-pipeline-proposal` | (no canonical gate) | n/a |
| `phase-2-tdd-approval-*` | `TDD_APPROVAL` | HARD |
| `phase-1-5-plan-approval` | `PLAN_REJECTED` (only when user rejects) | HARD |
| `phase-2-adversarial-batch-<N>` | `ADVERSARIAL_GATE` | SOFT |
| `phase-3-final-adversarial` | `FINAL_ADVERSARIAL_GATE` | SOFT |
| `phase-3-closeout` | `CLOSEOUT_CONFIRM` | SOFT |
| `phase-0-info-gate-<topic>` | `INFO_GATE_BLOCKED` (only when blocking) | HARD |
| Any other custom gate_id | (no canonical gate) | n/a |

---

## Backward compatibility

Subagents that do NOT emit any of these blocks behave identically to the pre-protocol contract. The protocol is additive: adoption is per-agent, opt-in via the agent body referencing this file.
