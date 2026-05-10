# Requirements: Codex v5.2 Parity

## Goal

Bring `pipeline-orchestrator-for-codex` to observable parity with the local Claude Code Pipeline Orchestrator v5.2.0 while preserving Codex runtime truth.

## Requirements

### R1 — Protocol Hoisting

The runtime shall parse and persist `GATE_REQUEST v1`, `DISPATCH_REQUEST v1`, and `PLAN_MODE_REQUEST v1` blocks emitted by agents or skills.

Acceptance criteria:
- Protocol events are written to `protocol-events.jsonl`, not mixed into `gate-decisions.jsonl`.
- Named user gates may dual-write a canonical gate entry when the event maps to a registered gate.
- Malformed protocol blocks fail closed with actionable diagnostics.

### R2 — Run Directory

The runtime shall allocate `pipeline-runs/<NNN>-<slug>/` for brainstorm/spec/preparation flows.

Acceptance criteria:
- Every run contains `00-brainstorm`, `01-spec`, `02-validations`, `03-execution`, and `attachments`.
- Every run contains `manifest.yaml` with schema version, run id, status, phase, type, complexity, handoff fields, and timestamps.
- Allocation is deterministic and collision-safe.

### R3 — Brainstorm Front-End

The plugin shall expose a brainstorm entrypoint that prepares a run before pipeline execution.

Acceptance criteria:
- `commands/brainstorm.md`, `skills/brainstorm/SKILL.md`, `agents/core/brainstorm-controller.md`, and two brainstorm step agents exist.
- The brainstorm flow supports plan flag propagation to the pipeline handoff.
- User decision points use protocol hoisting rather than silent defaults.

### R4 — Prescriptive Skills

The plugin shall ship v5.2 prescriptive workflow skills for bugfix, feature, audit, spec, validation, review, and completion checks.

Acceptance criteria:
- Each skill has frontmatter, step sequence, gates, and write-scope policy.
- Namespace references are adapted to `pipeline-orchestrator-for-codex`.
- Governed skills are included in hook/frontmatter enforcement.

### R5 — TRACE Closeout

The runtime shall emit a schema-versioned `TRACE.md` before any final `GO` claim.

Acceptance criteria:
- `references/trace-schema/v1.md` documents the trace contract.
- `scripts/validate-trace.cjs` validates traces standalone.
- Closeout surfaces the trace path or blocks when trace generation fails.

### R6 — Strict Real-Agent Pipeline

The `/pipeline` path shall require a real Codex agent adapter when running as the product pipeline.

Acceptance criteria:
- No silent fallback from product `/pipeline` to local single-agent emulation.
- Test harnesses may explicitly use local emulation.
- Missing real-agent runtime returns `blocked-no-agent-runtime`.
