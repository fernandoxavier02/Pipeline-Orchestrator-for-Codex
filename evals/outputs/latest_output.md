# Eval Gate Final Report

## What was inspected

- Local Eval Gate telemetry hook: `.codex/hooks/post_tool_use_telemetry.py`.
- Deterministic eval runner: `.agents/skills/workflow-eval-gate/scripts/run_eval.py`.
- Eval Gate documentation: `evals/README.md`.
- Regression tests for telemetry and eval behavior under `evals/tests/**`.
- Current repository validation commands and Git diff hygiene.

## What was changed

Telemetry now records an execution heartbeat even when Git has no changed files. The hook no longer exits silently on a clean worktree. Instead, it writes the telemetry artifacts and marks the trace with `execution_observed: true`, `execution_identity`, `execution_event`, and `git_state` as `clean` or `dirty`.

The eval runner now treats empty `changed_files.txt` as valid only when the trace explicitly proves an execution was observed. Without `execution_observed: true`, an empty changed-file inventory still fails.

The hook also separates generic hook execution from plugin execution. `execution_observed` means the telemetry hook ran; `plugin_execution.observed` is only true when the hook payload contains a Pipeline Orchestrator command marker. This prevents the heartbeat from being overstated as proof that the plugin itself ran.

Regression tests were added so a clean execution without Git changes still refreshes telemetry, so the eval runner rejects empty telemetry unless the execution heartbeat is present, and so a payload containing `/pipeline-orchestrator-for-codex:pipeline` is marked distinctly.

## What was not changed

No runtime TypeScript orchestration code, plugin manifest, command entrypoint, skill contract, packaged cache, marketplace config, or global Codex config was changed in this fix.

This change does not yet add the separate contract test for "operational pipeline review or bugfix without `spawn_agent` must fail." It fixes the telemetry heartbeat problem first.

## Eval result

EVAL RESULT: PASS / eval runner passed.

behavior_cases: 4

Validation evidence:

- `python3 -m unittest evals.tests.test_telemetry_hook evals.tests.test_eval_gate`: PASS, 31 tests.
- `npm run lint:types`: PASS.
- `python3 -m unittest evals.tests.test_hooks_config evals.tests.test_policy_hook evals.tests.test_telemetry_hook evals.tests.test_eval_gate evals.tests.test_hook_trust_docs`: PASS, 46 tests.
- `npm run build`: PASS.
- `git diff --check`: PASS.
- `npm test`: PASS, 123 files and 894 tests.
- `python3 .agents/skills/workflow-eval-gate/scripts/run_eval.py`: PASS.

## Remaining risks

The hook is still a local Codex project hook. It proves local Eval Gate telemetry behavior for this repository, not that every installed/global plugin execution in every Codex session is already wired to the same telemetry path.

The next missing safety check is an explicit eval case that fails when a Pipeline Orchestrator operational review or bugfix claims execution without real `spawn_agent`/`wait_agent` evidence. This fix adds the telemetry identity fields needed for that next gate, but it does not yet enforce the dispatch contract itself.

## Next safest step

Add the `spawn_agent` contract eval: operational pipeline review or bugfix without real agent dispatch evidence must fail, even if the narrative report says the review passed.
