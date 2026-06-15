# Eval Gate Final Report

## What was inspected

- Canonical repository: `D:\Pipeline Orchestrator for Codex`.
- Runtime enforcement paths: `src/governance/pipeline-contract.ts`, `src/governance/workflow-enforcement.ts`, `src/index.ts`, and `src/adapters/codex-agent-runtime.ts`.
- Hook surfaces: `hooks/completion-checklist.cjs`, `hooks/force-pipeline-agents.cjs`, `hooks/dispatch-guard.cjs`, `hooks/sentinel-hook.cjs`, and `hooks/edit-guard-hook.cjs`.
- Public plugin and skill surfaces: `.codex-plugin/plugin.json`, `skills/pipeline/SKILL.md`, `.agents/skills/pipeline/SKILL.md`, and plugin package surface tests.
- Adversarial review evidence from a real spawned Codex subagent for the main P0 risks.
- Final adversarial follow-up from real subagent Noether returned `FINAL_REVIEW: GO`; no P0/P1/P2 material remained after the hook-event, wait-agent, and runtime-mode fixes.
- behavior_cases: 5.

## What was changed

- Added the TypeScript workflow enforcement spine in `src/governance/workflow-enforcement.ts`.
- Wired `validatePipelineArtifact` and runtime completion checks so textual `PIPELINE COMPLETE` and forged `pipeline_valid: true` artifacts are blocked unless gates, hooks, independent agents, and final verdict are complete.
- Hardened `src/adapters/codex-agent-runtime.ts` so `wait_agent` is not treated as present unless the host provides a real wait callable; a local echo does not count as production capability.
- Fixed the runtime detector so direct `globalThis.wait_agent` and nested `globalThis.codex.wait_agent` are actually wired into the adapter instead of leaving the capability gate unreachable.
- Added ledger-backed completion validation in `src/governance/ledger-evidence.ts`, `src/index.ts`, and `hooks/completion-checklist.cjs`; a complete-looking payload artifact now fails unless protocol events, gate decisions, hook/checkpoint evidence, dispatch, and wait evidence corroborate it.
- After the final adversarial review returned `FINAL_REVIEW: NO-GO`, hardened the ledger again: checkpoint files no longer count as hook proof without matching `hook-events.jsonl`, and `DISPATCH_REQUEST completed` no longer counts as `wait_agent` proof without a separate `WAIT_AGENT_COMPLETED` event.
- Corrected protocol dispatch provenance so an adapter records `dispatchMode: "real"` only when the active runtime reports `runtimeMode: "real-agent"`; dev-bypass, harness, or missing runtime mode are persisted as emulated and cannot validate completion.
- A later marketplace-readiness adversarial review returned `FINAL_REVIEW: NO-GO` with three P1s and one P2. The follow-up fixes unified runtime/Stop completion detection, protected governed shortcut commands such as `:audit`, required a distinct wait-agent event id/payload proof, and expanded package-surface coverage for the new governance modules.
- Added TDD, ATDD, BDD, and DDD regression tests for workflow order, mandatory gates/hooks, forged artifacts, capability truth, and Stop hook blocking.
- Updated `hooks/completion-checklist.cjs` so explicit pipeline completion attempts return `continue:false` when no validated governance artifact exists.
- Aligned `.agents/skills/pipeline/SKILL.md` and `.codex-plugin/plugin.json` with the runtime truth: valid execution requires `spawn_agent`, `wait_agent`, artifact collection, gate/checkpoint recording, and structured final state.
- Rebuilt generated `dist/**` with `npm run build`; `dist/**` was not edited manually.

## What was not changed

- I did not create a new plugin, Java implementation, or parallel orchestration engine.
- I did not remove the existing advisory prompt-submit hook; it remains advisory and does not count as blocking evidence.
- I did not claim harness or local emulation can produce a valid production pipeline.
- I did not treat hooks as globally trusted or active without proof from the Codex `/hooks` trust flow.
- I did not revert unrelated pre-existing dirty work in this repository.

## Validation evidence collected

- `npm run lint:types`
  - PASS.
- `npm run build`
  - PASS.
- `npm test`
  - Initial default run exposed one timeout and stale test-helper capability gaps.
  - PASS after correcting the helper, fixing the post-review P1 gaps, and rerunning as `npm test -- --testTimeout 30000`.
- Focused regression packs:
  - `npx vitest run tests/unit/governance/workflow-enforcement.test.ts tests/unit/governance/pipeline-contract.test.ts tests/integration/adapter-detection.test.ts tests/unit/runtime/pipeline-completion-enforcement.test.ts --testTimeout 30000`
  - `npx vitest run tests/unit/hooks/completion-checklist.test.ts tests/integration/hooks/hook-fail-closed.test.ts tests/unit/hooks/force-pipeline-agents.test.ts tests/bdd/dispatch-protection.feature.test.ts tests/unit/hooks/edit-guard-hook.test.ts --testTimeout 30000`
  - `npx vitest run tests/integration/plugin/command-surface.test.ts tests/integration/plugin/codex-workflow-surface.test.ts tests/integration/plugin/package-surface.test.ts tests/integration/plugin/local-agents-skill-surface.test.ts tests/unit/plugin/spawn-agent-contract.test.ts tests/unit/version-consistency.test.ts --testTimeout 30000`
- Post-review P1 regression pack:
  - `npx vitest run tests/integration/adapter-detection.test.ts tests/unit/runtime/pipeline-completion-enforcement.test.ts tests/unit/hooks/completion-checklist.test.ts tests/unit/governance/pipeline-contract.test.ts tests/unit/governance/workflow-enforcement.test.ts --testTimeout 30000`
  - PASS: 40 tests verify host wait detection, hook-events requirement, separate wait-agent ledger, dev-bypass rejection, and ledger-backed artifact rejection.
- Marketplace-readiness P1/P2 regression pack:
  - `npx vitest run tests/unit/runtime/pipeline-completion-enforcement.test.ts tests/unit/hooks/completion-checklist.test.ts tests/integration/plugin/package-surface.test.ts tests/integration/v52-parity/protocol-hoisting-runtime.test.ts --testTimeout 30000`
  - PASS: 25 tests verify Final decision GO blocking, governed shortcut completion blocking, wait-agent line separation, Stop hook parity, and package inclusion for new governance modules.
- Hook/surface regression pack:
  - `npx vitest run tests/unit/hooks/completion-checklist.test.ts tests/integration/hooks/hook-fail-closed.test.ts tests/unit/hooks/force-pipeline-agents.test.ts tests/bdd/dispatch-protection.feature.test.ts tests/unit/hooks/edit-guard-hook.test.ts tests/integration/plugin/command-surface.test.ts tests/integration/plugin/codex-workflow-surface.test.ts tests/integration/plugin/package-surface.test.ts tests/integration/plugin/local-agents-skill-surface.test.ts tests/unit/plugin/spawn-agent-contract.test.ts tests/unit/version-consistency.test.ts --testTimeout 30000`
  - PASS: 97 tests.
- `python3 -m unittest evals.tests.test_hooks_config evals.tests.test_policy_hook evals.tests.test_telemetry_hook evals.tests.test_eval_gate evals.tests.test_hook_trust_docs`
  - PASS: 61 tests.
- `python3 .agents/skills/workflow-eval-gate/scripts/run_eval.py`
  - Eval runner passed after this report and telemetry were refreshed.
- `git diff --check`
  - PASS; Git may print Windows LF/CRLF warnings, but no diff-check error.

## Eval result

Eval result: PASS.

## Remaining risks

- This proves the local repository implementation and test suite, not that a currently running Codex process has reloaded an installed plugin cache.
- Stop hook blocking depends on the host honoring Stop hook `continue:false`; prompt-submit enforcement remains advisory by design.
- Final adversarial reviewer left only P3 adoption risk: a fresh Codex session or reinstalled plugin cache still needs a real smoke test to prove the loaded runtime is this build.
- The repository started dirty with many pre-existing changes, so this work deliberately avoided reverting unrelated files.

## Next safest step

Reload or reinstall the plugin runtime, then run one real user-facing `/pipeline-orchestrator-for-codex:pipeline --complexa` smoke test in a fresh Codex session to prove the installed cache uses this enforcement spine.
