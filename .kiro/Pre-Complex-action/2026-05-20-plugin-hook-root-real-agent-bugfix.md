# Pre-Complex Action: Plugin hook root and real-agent proof

## Context

User request: fix the operational bug where plugin hook enforcement can fail because hook commands interpolate `${CODEX_PLUGIN_ROOT}` instead of the canonical Codex plugin hook root `${PLUGIN_ROOT}`.

Workflow: `bugfix-heavy`
Type: `Bug Fix`
Complexity: `COMPLEXA`
Controller FQN: `pipeline-orchestrator-for-codex:core:pipeline-controller`

## Domain Truth

- Plugin hook commands must prefer `${PLUGIN_ROOT}`.
- `CODEX_PLUGIN_ROOT` may still exist in older or local compatibility contexts, so runtime resolvers must keep it as fallback.
- `CLAUDE_PLUGIN_ROOT` remains legacy compatibility only.
- Operational pipeline execution cannot be reported as real unless there is evidence for `spawn_agent` and `wait_agent`.
- Inline execution is not a substitute for a real-agent runtime.

## Batches

1. Add tests that fail when `hooks/hooks.json` uses `${CODEX_PLUGIN_ROOT}` for command interpolation.
2. Update hook root resolution order to `PLUGIN_ROOT`, then `CODEX_PLUGIN_ROOT`, then `CLAUDE_PLUGIN_ROOT`.
3. Add eval/BDD coverage that blocks operational success claims without real `spawn_agent` and `wait_agent` evidence.
4. Run focused tests after each batch, then lint, build, full tests if feasible, Eval Gate, and adversarial review.

## Risks

- A local test harness may still set only `CODEX_PLUGIN_ROOT`.
- Existing dirty telemetry and `CLAUDE.md` changes are not owned by this bugfix and must not be reverted.
- A parent controller did dispatch a real Codex subagent for this run. Repository telemetry still must not claim operational plugin success unless the telemetry artifacts themselves record `spawn_agent` and `wait_agent` evidence.
