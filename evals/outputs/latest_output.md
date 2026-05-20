# Eval Gate Final Report

## What was inspected

- Plugin hook registration in `hooks/hooks.json`.
- Hook metadata/root resolution in `hooks/hook-events.cjs`, `hooks/dispatch-guard.cjs`, and `hooks/force-pipeline-agents.cjs`.
- Local Eval Gate telemetry hook in `.codex/hooks/post_tool_use_telemetry.py`.
- Deterministic eval runner in `.agents/skills/workflow-eval-gate/scripts/run_eval.py`.
- Regression tests for hook root resolution, telemetry, and eval behavior under `tests/**` and `evals/tests/**`.
- Behavior cases in `evals/cases/orchestrator_behavior.yaml`.

## What was changed

- Plugin hook commands now use the canonical Codex plugin root interpolation `${PLUGIN_ROOT}` instead of `${CODEX_PLUGIN_ROOT}`.
- Runtime helpers preserve compatibility fallback order: `PLUGIN_ROOT`, then `CODEX_PLUGIN_ROOT`, then `CLAUDE_PLUGIN_ROOT`.
- The force-pipeline-agents hook now reports the correct agent root contract: `${PLUGIN_ROOT}/agents`, with legacy variables only as fallbacks.
- Telemetry now accumulates operational plugin evidence across hook calls. A pipeline command or `PIPELINE_AGENT_FQN` marks plugin execution as observed, `spawn_agent` marks spawn evidence, and `wait_agent` marks wait evidence.
- The eval runner now fails an operational plugin success claim unless telemetry proves all three: pipeline agent FQN, `spawn_agent` evidence, and `wait_agent` evidence.
- Regression tests were added for ATDD/TDD/BDD coverage: canonical `PLUGIN_ROOT` hook commands, trusted frontmatter resolution from `PLUGIN_ROOT`, hook event metadata from `PLUGIN_ROOT`, telemetry accumulation of `spawn_agent` and `wait_agent`, and Eval Gate rejection of successful plugin reports without real-agent evidence.

## What was not changed

- No plugin manifest, command entrypoint, global Codex config, or remote publication state was changed.
- Parallel Claude work was not edited or removed. Current unrelated dirty work includes `CLAUDE.md`, `src/workflow/next-step.ts`, and untracked `skills/codex-kb-*`.

## Eval result

EVAL RESULT: BLOCKED in the current workspace state.

The Eval Gate runner now fails because the workspace contains parallel Claude changes outside this bugfix scope: `src/workflow/next-step.ts`, `dist/src/workflow/next-step.js`, and untracked `skills/codex-kb-*`. These files are intentionally not edited by this bugfix closeout.

behavior_cases: 5

Validation evidence:

- `npm test -- --run tests/unit/version-consistency.test.ts tests/unit/hooks/dispatch-frontmatter-enforcement.test.ts tests/unit/hooks/hook-events-sanitization.test.ts tests/unit/hooks/force-pipeline-agents.test.ts`: PASS, 37 tests.
- `python3 -m unittest evals.tests.test_eval_gate evals.tests.test_telemetry_hook`: PASS, 36 tests.
- `python3 -m unittest evals.tests.test_hooks_config evals.tests.test_policy_hook evals.tests.test_telemetry_hook evals.tests.test_eval_gate evals.tests.test_hook_trust_docs`: PASS, 52 tests.
- `npm run lint:types`: PASS.
- `npm run build`: PASS.
- `git diff --check`: PASS.
- `python3 .agents/skills/workflow-eval-gate/scripts/run_eval.py`: BLOCKED by parallel Claude workspace changes outside this bugfix scope.
- `npm test`: BLOCKED by parallel Claude workspace changes. The full suite fails in workflow inventory tests because unrelated `skills/codex-kb-*` are present while `WORKFLOW_NEXT_STEPS` coverage is outside this hook-root bugfix scope.
- Manual hook simulation with only `PLUGIN_ROOT` for `hooks/force-pipeline-agents.cjs`: PASS.
- Manual hook simulation with only `PLUGIN_ROOT` for `hooks/dispatch-guard.cjs`: PASS.

## Remaining risks

- Hook trust still depends on the Codex app `/hooks` trust state for this repository. This run manually refreshed telemetry because the session cannot prove the UI trust toggle.
- Marketplace/cache copies were synced for the changed hook, telemetry, Eval Gate, and regression test files. Checksums matched between the source repo, local marketplace copy, and installed cache copy for the core changed files at sync time.
- Telemetry proves that the parent controller invoked `spawn_agent` and `wait_agent`; it does not require the spawned agent to finish successfully before the eval can verify real-agent dispatch evidence.
- The full `npm test` suite should be rerun after the parallel Claude workflow stabilizes its `skills/codex-kb-*` and `src/workflow/next-step.ts` changes. Focused regression tests for this bugfix pass.

## Next safest step

After the parallel Claude workflow finishes its KB/workflow changes, rerun full `npm test` once more to prove the whole repo is quiet under the stable workspace state.
