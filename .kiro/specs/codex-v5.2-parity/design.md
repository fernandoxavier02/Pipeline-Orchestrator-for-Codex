# Design: Codex v5.2 Parity

## Architecture

The implementation keeps the existing TypeScript runtime as the Codex substrate and adds the missing v5.2 product surfaces around it:

- `src/protocol/**` owns protocol block parsing and `protocol-events.jsonl`.
- `src/run/**` owns `pipeline-runs` allocation and manifest handling.
- `src/trace/**` owns `TRACE.md` generation and validation.
- `skills/**`, `commands/**`, `agents/**`, and `references/**` mirror the Claude v5.2 workflow surface, adapted to Codex namespaces.

## Runtime Boundaries

`gate-decisions.jsonl` remains the canonical gate log. `protocol-events.jsonl` records request/response protocol events and is intentionally separate so non-gate protocol traffic does not corrupt gate validation.

`pipeline-runs` is the preparation/workflow root for brainstorm and spec lifecycle work. `.codex/pipeline` remains the Codex runtime state root for controller sessions, gate logs, confidence, checkpoints, and sentinel state.

`TRACE.md` is an audit artifact. It must be generated from authoritative runtime evidence and validated before closeout is reported as `GO`.

## Real-Agent Boundary

The product `/pipeline` path requires real agent dispatch. Local single-agent and multi-agent TypeScript runners remain available only as harnesses or explicit tests. This prevents claims of multi-agent parity when no `spawn_agent` bridge exists.

## Safety

All imported Claude workflow assets are adapted through the Codex namespace and checked by frontmatter/hook tests. Generated build output under `dist/**` is not manually edited.
