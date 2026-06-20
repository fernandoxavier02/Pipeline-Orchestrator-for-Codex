# Eval Gate Final Report

## What was inspected

- Repository: `D:\Pipeline Orchestrator for Codex`.
- Active request: publish and synchronize the runtime-subagent fix across the canonical repo, GitHub, Codex marketplace-backed plugin directory, and installed Codex plugin cache.
- Local contracts: `AGENTS.md`, `.kiro/CONSTITUTION.md`, `.kiro/steering/product.md`, `.kiro/steering/tech.md`, `.kiro/steering/structure.md`, `.agents/skills/workflow-eval-gate/SKILL.md`, `.agents/skills/bugfix-heavy/SKILL.md`, and `evals/README.md`.
- Runtime/code surfaces: `src/adapters/codex-cli-process-runtime.ts`, `src/cli/agent-runtime-loader.ts`, `hooks/**`, `commands/**`, `skills/**`, `.agents/skills/**`, `dist/**`, and runtime/gate tests.
- Publication surfaces: `.codex-plugin/plugin.json`, `.agents/plugins/marketplace.json`, `C:\Users\win\.agents\plugins\marketplace.json`, `C:\Users\win\.agents\plugins\pipeline-orchestrator-for-codex`, and `C:\Users\win\.codex\plugins\cache\fx-studio-ai\pipeline-orchestrator-for-codex\0.5.1`.
- behavior_cases: 5.

## What was changed

- Fixed the Codex CLI process runtime so `codex-cli` / `codex-cli-process` use a safe real-agent runtime by default instead of dangerous bypass flags.
- Kept dangerous bypass behavior behind explicit `codex-cli-dev-bypass` / `codex-cli-process-dev-bypass` aliases, which remain blocked by `CAPABILITY_GATE`.
- Added deterministic tests proving the safe runtime passes the capability gate and the explicit dev-bypass path remains blocked.
- Preserved the prior deterministic workflow hardening changes in hooks, controller, gate log, ledger evidence, final validation, batch-loop evidence, and completion enforcement.
- Rebuilt `dist/**` from source.
- Refreshed the installed Codex cache at `C:\Users\win\.codex\plugins\cache\fx-studio-ai\pipeline-orchestrator-for-codex\0.5.1`.
- Refreshed the marketplace-backed global plugin at `C:\Users\win\.agents\plugins\pipeline-orchestrator-for-codex`.
- Verified the global marketplace entry still points to `./plugins/pipeline-orchestrator-for-codex` with `INSTALLED_BY_DEFAULT`.
- Created filesystem backups before replacement:
  - `C:\Users\win\.codex\plugins\cache\fx-studio-ai\pipeline-orchestrator-for-codex\0.5.1-backup-sync-*`
  - `C:\Users\win\.agents\plugins\pipeline-orchestrator-for-codex-backup-sync-*`

## Batch review and fix loop

- Batch 1, source/runtime: adversarial review found the default process adapter was self-identifying as `dev-bypass`; fix applied and focused runtime/gate tests passed.
- Batch 2, host config and executable resolution: adversarial review found broken Codex TOML and Windows wrapper risk; TOML was repaired and the adapter now resolves the real `codex.exe`.
- Batch 3, cache/global adoption: adversarial review found stale global plugin content and missing runtime dependencies in one installed copy; both install targets were rebuilt from the same package and dependencies were restored.
- Batch 4, publication parity: package-file parity was checked across canonical repo, Codex cache, and marketplace-backed global plugin before moving to commit/push.

## What was not changed

- No new dependency was added.
- No prompt-only recommendation was used as an enforcement mechanism.
- No remote/VPS installation was altered.
- The global marketplace registry schema was not rewritten because its existing entry was already correct and installed by default.
- Hook trust in the active Codex UI was not asserted; telemetry is treated as manual/local unless `/hooks` proves trust.

## Eval result

EVAL RESULT: PASS from `python .agents/skills/workflow-eval-gate/scripts/run_eval.py`.

Direct publication evidence:

- `npm pack --dry-run --json` identified 1111 package files.
- Package parity passed for all 1111 files across:
  - `D:\Pipeline Orchestrator for Codex`
  - `C:\Users\win\.codex\plugins\cache\fx-studio-ai\pipeline-orchestrator-for-codex\0.5.1`
  - `C:\Users\win\.agents\plugins\pipeline-orchestrator-for-codex`
- External-cwd smoke passed for the Codex cache CLI: `CAPABILITY_GATE: PASS`.
- External-cwd smoke passed for the marketplace-backed global plugin CLI: `CAPABILITY_GATE: PASS`.
- Global marketplace entry passed: `pipeline-orchestrator-for-codex`, path `./plugins/pipeline-orchestrator-for-codex`, policy `INSTALLED_BY_DEFAULT`.

The local Codex installation now has the same packaged plugin files in the canonical repo, the installed Codex cache, and the marketplace-backed global plugin directory.

## Remaining risks

- Files excluded by `.npmignore`, such as `evals/telemetry/**`, are intentionally not part of package parity.
- `node_modules/**` is operational dependency state, not package source; it was restored/copied for local runtime smoke but is not counted as canonical package source.
- The active Codex app may require a restart or plugin reload before UI-discovered skills reflect the refreshed global plugin files.
- Hook activation still depends on `/hooks` trust in the Codex UI.

## Next safest step

Commit and push the validated source changes, then rerun the public slash command from a different project to confirm the Codex UI has reloaded the updated global plugin surface.
