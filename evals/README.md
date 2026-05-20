# Local Eval Gate

The Eval Gate is a repo-local validation layer for changes to the Pipeline Orchestrator for Codex. It checks whether work on workflows, skills, hooks, commands, scripts, telemetry, gates, traces, batches, reviews, and policy surfaces still has enough evidence before a result is reported as passing.

It does not rewrite the orchestrator, replace the TypeScript runtime, or make the plugin globally active by itself. It is local project governance around this repository.

## Files

- `.codex/config.toml`: local Codex project settings for this workspace.
- `.codex/hooks.json`: local hook registration for the Eval Gate scripts.
- `.codex/hooks/pre_tool_use_policy.py`: conservative command policy checks before tool use.
- `.codex/hooks/post_tool_use_telemetry.py`: records changed files, git diff, and a JSON trace.
- `.codex/hooks/stop_eval_gate.py`: runs the deterministic eval at stop time.
- `.agents/skills/workflow-eval-gate/SKILL.md`: human and agent workflow contract for using the Eval Gate.
- `.agents/skills/workflow-eval-gate/scripts/run_eval.py`: deterministic runner that validates the cases file structure, evidence, telemetry, scope review, validation evidence, and output claims.
- `evals/cases/orchestrator_behavior.yaml`: behavior cases the runner evaluates.
- `evals/outputs/latest_output.md`: latest claimed assistant output to evaluate.
- `evals/telemetry/latest_trace.json`: latest trace evidence as valid JSON.
- `evals/telemetry/changed_files.txt`: latest changed-file inventory.
- `evals/telemetry/git_diff.patch`: latest diff evidence.
- `evals/tests/**`: Python unit tests for the runner, hooks, policy, telemetry, and documentation contract.

## How It Works

The gate has three practical parts.

First, the policy hook checks risky shell commands before execution. It is intentionally narrow: it catches common destructive or out-of-scope patterns, but it is not a full sandbox and does not replace engineering judgment.

Second, the telemetry hook captures evidence from the current execution and working tree: an execution heartbeat, changed files, current diff, and a JSON trace. This gives the eval runner something concrete to verify instead of relying on narrative claims.

Third, the eval runner reads the behavior cases file, latest output, and telemetry artifacts. It fails when required evidence is missing, when the changed-file inventory is absent, when an empty changed-file inventory has no execution heartbeat, when scope review is missing, when unexpected files lack justification, when validation command evidence is missing, when claims are unsupported, or when the final report says the work passed without the expected eval artifacts.

## Hook Trust

Codex hook activation is a manual trust step. Open `/hooks`, inspect `.codex/hooks.json`, and trust only this repository root if the commands match the local files above.

If the session cannot prove the hooks are trusted and active, treat telemetry as manual evidence. In that case, run:

```powershell
python3 .codex/hooks/post_tool_use_telemetry.py
```

Then run the eval runner directly:

```powershell
python3 .agents/skills/workflow-eval-gate/scripts/run_eval.py
```

Do not report the Eval Gate as automatic, packaged, global, or trusted unless `/hooks`, `.codex/config.toml`, `.codex/hooks.json`, and the active Codex runtime state prove it.

## Validation Commands

Use these commands from the repository root when the Eval Gate surface changes:

```powershell
npm run lint:types
npm run build
npm test
python3 -m unittest evals.tests.test_hooks_config evals.tests.test_policy_hook evals.tests.test_telemetry_hook evals.tests.test_eval_gate evals.tests.test_hook_trust_docs
python3 .agents/skills/workflow-eval-gate/scripts/run_eval.py
git diff --check
```

On Windows, if the full Vitest run fails because of memory or IPC behavior, run focused subsets before treating it as a code regression.

## Passing Criteria

The Eval Gate can only be treated as passing when:

- `evals/outputs/latest_output.md` exists and contains the real latest claim being evaluated.
- `evals/cases/orchestrator_behavior.yaml` exists and contains at least one structured scenario.
- `evals/telemetry/latest_trace.json` exists and is valid JSON.
- `evals/telemetry/changed_files.txt` exists. It may be empty only when telemetry explicitly records `execution_observed: true`, which means a clean execution heartbeat was captured even though Git had no changed files.
- `evals/telemetry/git_diff.patch` exists.
- telemetry contains `execution_observed: true`.
- telemetry contains `execution_identity.hook_event`, so a clean execution heartbeat is distinguishable from stale file evidence.
- telemetry contains a `scope_review` block whose unexpected files match the changed-file inventory and have explicit justifications.
- telemetry contains `validation_evidence.commands` entries for lint, build, tests, Python eval tests, eval runner, and `git diff --check`.
- `python3 .agents/skills/workflow-eval-gate/scripts/run_eval.py` passes.
- prohibited directories such as `node_modules/**`, `.git/**`, `build/**`, and manually edited `dist/**` are not part of the work.
- remaining risks are reported plainly.

## Boundaries

This Eval Gate is intentionally small. It is a deterministic local guardrail, not a new orchestration engine. Runtime behavior remains owned by `skills/pipeline/SKILL.md`, `commands/pipeline.md`, `src/**`, `hooks/**`, `agents/**`, `prompts/**`, and `references/**`.
