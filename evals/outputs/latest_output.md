# Eval Gate Final Report

## What was inspected

- Canonical repository: `D:\Pipeline Orchestrator for Codex`.
- Local Marketplace entry: `C:\Users\win\plugins\pipeline-orchestrator-for-codex`, which is a junction to the canonical repository.
- Installed Codex cache: `C:\Users\win\.codex\plugins\cache\fx-studio-ai\pipeline-orchestrator-for-codex\0.5.0`.
- Runtime governance changes under `src/**`, `hooks/**`, `skills/**`, `commands/**`, `agents/**`, `dist/**`, and regression tests.
- Package surface produced by `npm pack --dry-run --json`.

## What was changed

- Added package hygiene via `.npmignore` so local reports, pipeline state, Codex state, telemetry, coverage, worktrees, and dependencies are excluded from the package artifact.
- Updated `.gitignore` so `dist/src/governance/pipeline-contract.js` is tracked and can be shipped with compiled runtime imports.
- Added `tests/integration/plugin/package-surface.test.ts` to prove the compiled governance module is packaged and `security-audit/**` plus `evals/telemetry/**` are excluded.
- Moved `security-audit/**` out of the plugin tree into `C:\Users\win\CodexCleanupBackups\pipeline-orchestrator-20260605-135151`.
- Removed local-only state from the installed cache while preserving tracked canonical `.pipeline/**` history in the repository.
- Synchronized the installed Codex cache with the canonical repository for all in-scope delivery files.

## What was not changed

- No runtime capability was faked; missing real-agent capability still blocks through the pipeline governance contract.
- No broad destructive cleanup was applied to untracked code; `src/governance/**` and governance tests were preserved as runtime hardening.
- The local Marketplace path was not copied over because it is already a junction to the canonical `D:` repository.
- `evals/telemetry/**` remains a local Eval Gate evidence area in the canonical repository but is excluded from the package and installed cache.

## Eval result

EVAL RESULT: PASS from `python .agents/skills/workflow-eval-gate/scripts/run_eval.py`.

behavior_cases: 5

Validation evidence:

- `npm run lint:types`: PASS.
- `npm run build`: PASS.
- `npm test -- --testTimeout=15000`: PASS, 127 test files and 955 tests.
- Focused timeout follow-up: `tests/integration/modes/review-only.test.ts` and `tests/unit/hooks/force-pipeline-agents.test.ts` both passed after the default 5s full run timed out in two cases.
- `python -m unittest evals.tests.test_hooks_config evals.tests.test_policy_hook evals.tests.test_telemetry_hook evals.tests.test_eval_gate evals.tests.test_hook_trust_docs`: PASS, 53 tests.
- `git diff --check`: PASS.
- `npm pack --dry-run --json` from the installed cache: `dist/src/governance/pipeline-contract.js` present, `security-audit/**` absent, `evals/telemetry/**` absent.

## Remaining risks

- The package surface is intentionally repo-shaped and still includes many source, test, docs, and eval files. The current hard guard only blocks known local-noise directories and proves the required governance runtime is present.
- Hook activation still depends on the trusted hook state in the Codex host. The installed plugin cache is aligned, but runtime trust is host-managed.
- The default `npm test` 5s per-test timeout can be too tight under load; the suite passed with `--testTimeout=15000`.

## Next safest step

Stage the cleaned delivery set, commit it on `codex/pipeline-plugin-cleanup-global-ready`, and use the installed cache smoke tests as the final local readiness proof before relying on the plugin from other projects on this computer.
