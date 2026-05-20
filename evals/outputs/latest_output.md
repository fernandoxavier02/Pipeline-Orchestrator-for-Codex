# Eval Gate Final Report

## What was inspected

- Plugin front-door behavior for `@pipeline-orchestrator-for-codex` mentions in `hooks/force-pipeline-agents.cjs`.
- Canonical pipeline first-action contract from `commands/pipeline.md` and `skills/pipeline/SKILL.md`.
- Existing hook regression coverage in `tests/unit/hooks/force-pipeline-agents.test.ts`.
- Local Eval Gate structure and telemetry files under `evals/**`.

## What was changed

- `@pipeline-orchestrator-for-codex` without an explicit narrower workflow now resolves to the canonical `pipeline` workflow instead of falling through to the generic pipeline-worthy message.
- The injected pipeline hook message now matches the documented order: call `update_plan` first, present `WORKFLOW_METHOD_GATE` second, then read and dispatch `agents/core/pipeline-controller.md`.
- Added a regression test proving that a plain plugin mention enters the canonical pipeline front door and requires `PIPELINE_AGENT_FQN: pipeline-orchestrator-for-codex:core:pipeline-controller`.
- Strengthened the explicit `/pipeline-orchestrator-for-codex:pipeline` test so it also checks for `update_plan` and `WORKFLOW_METHOD_GATE`.

## What was not changed

- No plugin manifest, marketplace/cache install, command entrypoint, controller TypeScript, global Codex config, or published package state was changed.
- No manual edits were made to `dist/**`; `npm run build` was run successfully after the source change.
- The hook still cannot execute the controller by itself at `UserPromptSubmit`; it can only inject a stronger mandatory instruction into the Codex host. Real enforcement still depends on the parent runtime honoring the hook message and exposing `spawn_agent`, `wait_agent`, and `send_input`.

## Eval result

EVAL RESULT: PASS from `python .agents/skills/workflow-eval-gate/scripts/run_eval.py`.

behavior_cases: 5

Validation evidence:

- `npm test -- tests/unit/hooks/force-pipeline-agents.test.ts`: PASS, 7 tests.
- `npm run lint:types`: PASS.
- `npm run build`: PASS.
- `python -m unittest evals.tests.test_hooks_config evals.tests.test_policy_hook evals.tests.test_telemetry_hook evals.tests.test_eval_gate evals.tests.test_hook_trust_docs`: PASS, 52 tests.
- `npm test`: PASS, 123 test files and 898 tests.
- `git diff --check`: PASS.
- `python .agents/skills/workflow-eval-gate/scripts/run_eval.py`: PASS.

## Remaining risks

- This closes the documented `@plugin` routing gap at the hook instruction layer. It does not create a new Codex host primitive that automatically calls `controller.start(...)` from `plugin.json`.
- If the Codex app ignores `UserPromptSubmit` hook system messages or the local hooks are not trusted in `/hooks`, the parent assistant can still drift. That is a host/runtime trust issue, not solved by this hook-only patch.
- The truly deterministic fix would require an official plugin front-controller capability from Codex, or a supported host binding that maps plugin mention directly to the controller runtime.

## Next safest step

Publish or sync this plugin build only after confirming the installed cache/marketplace copy contains the changed `hooks/force-pipeline-agents.cjs`, then run one real `@pipeline-orchestrator-for-codex` smoke test in a fresh Codex session and verify that the first assistant action is `update_plan`.
