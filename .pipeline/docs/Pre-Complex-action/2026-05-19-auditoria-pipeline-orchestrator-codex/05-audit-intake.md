# Phase 2 Batch 1 — Audit Intake

**Agent:** audit-intake
**Status:** COMPLETE
**Tag taxonomy used:** [VERIFIED] / [HYPOTHESIS] / [DESIGN]
**Counts:** 28 [VERIFIED] · 4 [HYPOTHESIS] · 2 [DESIGN]
**Next agent:** audit-domain-analyzer

## Tech stack

Node.js ≥ 20 (ESM), TypeScript 5.9 (tsc), Vitest 3.x, Zod 3.x, `yaml` 2.x. Pure in-process TS with filesystem persistence (atomic JSON writes). Distribution: Codex plugin (`.codex-plugin/plugin.json` v0.4.1) + npm bin alias `pipeline → dist/src/cli/pipeline-cli.js`. AgentRuntimeAdapter pattern bridges to real Codex `spawn_agent`; absent it, falls back to TS heuristic emulation in `single-agent-runner.ts`.

## Repo map

| Dir | Files | Role |
| --- | --- | --- |
| `src/` | 75 | TS runtime (controller, dispatcher, gates, security, state, sentinel, cli, etc.) |
| `hooks/` | 10 | Codex hooks (CJS) + `hooks.json` |
| `agents/` | 45 | Agent role prompts (markdown) |
| `skills/` | 97 (24 dirs) | Codex skill SKILL.md files |
| `prompts/` | 25 | Alternative/legacy prompt sources |
| `references/` | 43 | Gates, checklists, pipelines, KB |
| `tests/` | 105 | Vitest unit / integration / BDD |
| `.codex-plugin/` | 1 | Plugin manifest |

## Entrypoints

- CLI bin: `src/cli/pipeline-cli.ts:116`
- Runtime factory: `src/index.ts:1` (`createPipelineRuntime`)
- Pipeline controller (TS): `src/controller/pipeline-controller.ts:1104` (1885 lines total)
- Skill chain: `skills/pipeline/SKILL.md:54` (delegates to `agents/core/pipeline-controller.md` via `spawn_agent`)
- Hooks: `SessionStart` (line 3), `UserPromptSubmit` (line 18), `Stop` (line 33), `PreToolUse:spawn_agent` (line 50), `PreToolUse:Agent` (line 62), `PreToolUse:Skill` (line 74), `PreToolUse:Edit|Write|NotebookEdit|MultiEdit` (line 85)

## Critical hotspots

### Axis 2 — strictAgents [11 call sites VERIFIED]

| File:line | Excerpt | Note |
| --- | --- | --- |
| `src/cli/pipeline-cli.ts:55` | `options.strictAgents = true;` | CLI default (only here) |
| `src/cli/pipeline-cli.ts:73` | `if (options.strictAgents && !agentRuntime) {` | CLI guard (correct, narrow) |
| `src/domain/pipeline-types.ts:42` | `strictAgents?: boolean;` | **Optional — defaults to undefined = harness mode** |
| `src/index.ts:548` | `requireRealAgent: request.requireRealAgent ?? options.strictAgents ?? isOperationalPipelineDispatch(request),` | **CRITICAL — cascata com fallback** |
| `src/index.ts:691` | `requireRealAgent: options.strictAgents === true,` | **`=== true` — BYPASSA fallback** |
| `src/index.ts:701` | `requireRealAgent: options.strictAgents === true,` | Mesma inconsistência |
| `src/controller/pipeline-controller.ts:1107` | `if (runtime?.strictAgents && !runtime?.executionController) {` | Thin guard (não checa `agentRuntime`) |

### Axis 3 — Hooks coverage

- `SessionStart` (matcher `""`): `session-lock-hook.cjs` + prompt
- `UserPromptSubmit` (matcher `""`): `force-pipeline-agents.cjs` + `session-lock-hook.cjs`
- `Stop` (matcher `""`): `completion-checklist.cjs` + `session-cleanup-hook.cjs`
- `PreToolUse:spawn_agent`: `dispatch-guard.cjs` + `sentinel-hook.cjs`
- `PreToolUse:Agent` (legacy Claude): `dispatch-guard.cjs` + `sentinel-hook.cjs`
- `PreToolUse:Skill`: `dispatch-guard.cjs` **only — NO sentinel-hook** (H2)
- `PreToolUse:Edit|Write|NotebookEdit|MultiEdit`: `edit-guard-hook.cjs`

### Axis 4 — Gates count

- Declared in controller inline invariant: **22 gates**
- Actual in `src/gates/gate-registry.ts` (lines 15-225): **26 gates**
- 4 new gates added since 22-gate spec: `ADVERSARIAL_LOOP_CHECKPOINT`, `SPEC_AC_TRACEABILITY_GAP`, `SPEC_POST_IMPL_FAIL`, `SENTINEL_SEQUENCE_BLOCK`
- **`references/gates.md` does NOT exist** — controller spec Grep-redirects to a non-existent file

### Axis 5 — Sentinel save/load sites in pipeline-controller.ts

Lines 428, 454, 1147, 1176, 1206, 1254, 1318, 1828. SKILL.md frontmatter declares 5 checkpoint names: `post_orchestrator`, `phase_0_to_1`, `phase_1_to_2`, `phase_2_to_3`, `post_final_validator`. **H3**: `phase_2_to_3` label not clearly visible in grep output (may be merged with `post_orchestrator`).

## File-size hotspots

- `src/controller/pipeline-controller.ts` — 1885 lines (HIGH)
- `src/index.ts` — 1002 lines (HIGH)
- `src/dispatcher/single-agent-runner.ts` — 507 lines (MEDIUM — emulation runner)
- `hooks/dispatch-guard.cjs` — 456 lines (MEDIUM)
- `hooks/sentinel-hook.cjs` — 350 lines (MEDIUM)

## Hypotheses for follow-up

- **H1** — `isOperationalPipelineDispatch` fallback at index.ts:548 NOT applied at 691, 701. ReviewOrchestrator and finalAdversarialOrchestrator may silently run in harness on operational invocations. **Domain-analyzer to trace.**
- **H2** — `PreToolUse:Skill` has dispatch-guard but no sentinel-hook. Skill-dispatched pipeline agents bypass sentinel sequence check. **Compliance-checker to verify if `governed-workflows.cjs` deny covers it.**
- **H3** — `phase_2_to_3` checkpoint name unclear in code vs declared in SKILL.md frontmatter. **Domain-analyzer to cross-check `sentinel-integration.md`.**
- **H4** — `pipeline-controller.ts:1107` guard checks only `!executionController`, not `!agentRuntime`. A caller with executionController but no real agentRuntime falls through to harness silently. **Domain-analyzer to confirm bypass scenario.**

## Design decisions flagged

- **D1** — `strictAgents` is `?: boolean` (optional). Intentional for test/diagnostic — but creates production footgun.
- **D2** — `PreToolUse:Skill` omits sentinel-hook intentionally. Skill dispatches are governed differently.

## Handoff

→ audit-domain-analyzer (Axes 1+2 FULL — confirm H1/H3/H4)
→ audit-compliance-checker (Axes 3+4+5+6 — confirm H2, cross-check gate count)
