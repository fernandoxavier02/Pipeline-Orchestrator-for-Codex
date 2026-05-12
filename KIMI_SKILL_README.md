# Pipeline Orchestrator for Kimi

Kimi-port of the Pipeline Orchestrator plugin. Based on the canonical Claude Code source (`D:\Pipeline Orchestrator Claude\Pipeline-Orchestrator`) but completely independent — zero modifications to the canonical.

## Installation

Copy or symlink this entire `.kimi/skills/` directory into your project root:

```bash
# From the repo root
cp -r .kimi/skills/* <your-project>/.kimi/skills/
```

Or, for system-wide availability, copy to your Kimi user skills directory (location varies by installation).

## Available Skills

| Skill | Invocation | Purpose |
|---|---|---|
| `/pipeline` | `/pipeline [task]` | Full 4-phase pipeline with auto-classification |
| `/bugfix` | `/bugfix [bug description]` | Pre-classified Bug Fix pipeline |
| `/feature` | `/feature [feature description]` | Pre-classified Feature pipeline |
| `/audit` | `/audit [scope]` | Pre-classified Audit pipeline (report-only) |
| `/spec` | `/spec [feature description]` | Spec lifecycle pipeline |
| `/review` | `/review` | Review-only on uncommitted changes |

## Architecture

All skills are **thin delegators**. They spawn a single `pipeline-controller` subagent (`subagent_type: coder`) that contains the full 4-phase orchestration logic:

- **Phase 0:** Triage (task-orchestrator → information-gate → design-interrogator)
- **Phase 1:** Proposal + user confirmation
- **Phase 1.5:** Planning (conditional, MEDIA/COMPLEXA/Spec)
- **Phase 2:** Batch execution (TDD → implement → adversarial review)
- **Phase 3:** Closure (sanity → final adversarial → Pa de Cal → finishing-branch)

## Runtime Protocol

Because Kimi subagents may not have access to `AskUserQuestion` or nested `Agent` dispatches, the controller emits structured protocol blocks:

- `=== GATE_REQUEST v1 ===` → parent calls `AskUserQuestion`
- `=== DISPATCH_REQUEST v1 ===` → parent calls `Agent(subagent_type: coder/explore)`
- `=== PLAN_MODE_REQUEST v1 ===` → parent conducts read-only research

The parent (main LLM) processes these blocks and re-dispatches the controller with responses until `PIPELINE COMPLETE`.

## References

All reference documents live in `.kimi/skills/pipeline/references/`:

- `gate-request-protocol.md` — Block schema + parent handler protocol
- `gates.md` — 22-gate registry + hardness taxonomy
- `audit-trail.md` — Phase transition + gate decision log format
- `confidence.md` — Scoring schema
- `complexity-matrix.md` — Pipeline routing + proportional behavior
- `sentinel-integration.md` — State tracking
- `pipelines/*.md` — 18 pipeline variants (bugfix-light/heavy, feature-light/heavy, etc.)
- `checklists/*.md` — 8 adversarial checklists (auth, crypto, injection, etc.)

## Canonical Fidelity

This port preserves the canonical architecture:
- Thin delegator pattern (skill ONLY spawns controller)
- 4-phase workflow with proportional behavior
- Gate hardness taxonomy (MANDATORY/HARD/CIRCUIT_BREAKER/SOFT)
- Context-isolated adversarial review
- TDD mandatory for code-changing pipelines
- Confidence scoring (advisory)
- Audit trail (gate-decisions.jsonl + protocol-events.jsonl)

Adaptations for Kimi:
- `pipeline-orchestrator:core:*` subagent types → `coder` / `explore`
- `EnterPlanMode` / `ExitPlanMode` → parent read-only research
- `SetTodoList` for visible plan tracking

## License

Same as the canonical source.
