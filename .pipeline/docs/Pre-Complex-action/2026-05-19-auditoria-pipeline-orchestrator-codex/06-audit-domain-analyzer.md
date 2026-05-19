# Phase 2 Batch 2 — Audit Domain Analyzer (Axes 1+2 FULL)

**Agent:** audit-domain-analyzer
**Status:** COMPLETE
**Severity verdict:** Axis 1 HIGH · Axis 2 **CRITICAL** · Axis 5 partial REFUTED-with-nuance

## Axis 1 — Authority

Three artifacts compete for the orchestrator role:

| File | Line | Claim |
| --- | --- | --- |
| `skills/pipeline/SKILL.md` | 10 / 50 | "thin delegator" — only loads markdown via spawn_agent |
| `agents/core/pipeline-controller.md` | 11 | "You are the sole orchestrator" (1471 lines) |
| `src/controller/pipeline-controller.ts` | 1086 | `createPipelineController` — invoked at `src/index.ts:707`, called from `src/cli/pipeline-cli.ts:94`, returns the controller |

**Verified actual orchestrator:** `src/controller/pipeline-controller.ts` (1885 lines). **`agents/core/pipeline-controller.md` is dead documentation** — only loaded if SKILL.md path runs AND spawn_agent is available; in CLI/programmatic paths it never executes.

**Severity HIGH.** Three claims, only one path executes. The dead 1471-line markdown is what the user reads when looking for "what the controller does" — and it lies, because the TS is the real thing.

## Axis 2 — strictAgents (ROOT CAUSE — CRITICAL)

### H1 CONFIRMED — silent emulation in review paths

- `src/index.ts:691` — `createReviewOrchestrator({ requireRealAgent: options.strictAgents === true })`
- `src/index.ts:699-701` — `createFinalAdversarialOrchestrator({ requireRealAgent: options.strictAgents === true })`
- `src/index.ts:548` — `runtimeRunRole`: `request.requireRealAgent ?? options.strictAgents ?? isOperationalPipelineDispatch(request)` — cascata WITH operational fallback
- `src/review/review-orchestrator.ts:75` — `requireRealAgent: dependencies.requireRealAgent === true`
- `src/review/final-adversarial-orchestrator.ts:147` — same `=== true`

**Consequence:** review-orchestrator and final-adversarial-orchestrator are constructed ONCE at runtime time (src/index.ts:689-706) with strict equality. When `options.strictAgents` is undefined (the default when callers omit it — `RuntimeOptions.strictAgents?: boolean`), these orchestrators are wired with `requireRealAgent=false`. They silently call `runRole` with no real-agent requirement → `single-agent-runner.ts:450-506` fabricates "approved" verdicts.

**The user sees an adversarial review that NEVER HAPPENED.** Subsequent gate decisions (FINAL_ADVERSARIAL_GATE, CLOSEOUT_CONFIRM) are taken on top of fabricated evidence.

### H4 CONFIRMED — guard at line 1107 is dead

- `src/controller/pipeline-controller.ts:1107` — `if (runtime?.strictAgents && !runtime?.executionController) { blocked-no-agent-runtime }`
- `src/index.ts:707-713` — `createPipelineController({..., executionController: runtimeExecutionController, reviewOrchestrator: runtimeReviewOrchestrator})` — both ALWAYS injected.

**Consequence:** the 1107 guard never fires in production. It's structural theater. Even when injected, the executionController is built on `runtimeRunRole` which, per H1, silently falls back for non-top-level dispatches. The guard does not inspect `agentRuntime` presence, does not inspect bridge reality, does not recheck per-dispatch.

### Contract violations (SKILL.md / README.md vs runtime)

| Contract claim | Source | Runtime violation | File:line |
| --- | --- | --- | --- |
| "blocks with blocked-no-agent-runtime when unavailable" | SKILL.md:3 | Only top-level dispatch blocks. Internal review dispatches don't. | index.ts:691,701 |
| "ALWAYS call spawn_agent for every phase" | SKILL.md:34 | review/final-adversarial default to inline emulation | single-agent-runner.ts:450-506 |
| "Do not present emulation mode as real multi-agent execution" | SKILL.md:47 | `dispatchMode` is stamped AFTER silent emulation produces fabricated review verdicts. TRACE.md says "harness" while gates were already decided assuming real review. | index.ts:920,951 |
| "production-grade use requires strictAgents = true" | SKILL.md:45 | createPipelineRuntime does NOT default it to true. CLI sets it only via --strict-agents flag. | index.ts:474, pipeline-types.ts:42 |
| "Without that adapter, operational pipeline execution blocks as blocked-no-agent-runtime rather than simulating multi-agent parity" | README.md:14 | README contradicts implementation. | n/a |

**This is the root cause of the user-reported "many failures and contract non-compliance".**

## Axis 5 — sentinel (H3 partial)

**H3 REFUTED with nuance.** `phase_2_to_3` IS written at `src/controller/pipeline-controller.ts:466`, plus other checkpoints at 1188, 1266, 1332, 1840, and `final-validator.ts:197`. All 5 declared in `references/sentinel-integration.md:101-104` exist as labeled saves.

**BUT:** the `phase_2_to_3` write is conditional on `status=approved` from the executor AND `finalDecision=approved` from final review. When H1 fabricates the "approved" verdict, the phase_2_to_3 label is written based on a lie. Checkpoint LABEL exists; checkpoint TRUST is compromised by upstream H1 leak.

## Systemic patterns confirmed

**Pattern A — Doc-Promise / Runtime-Silence Gap.** 5 concrete instances above. The skill/README promises operational guarantees; the runtime defaults to emulation; the user has no way to tell from observable behavior.

**Pattern B — Authority Fragmentation.** 5 sources compete: SKILL.md, agents/core/pipeline-controller.md (DEAD), src/controller/pipeline-controller.ts (1885 lines), src/index.ts (1000+ lines with 3 INCONSISTENT requireRealAgent resolution sites), src/dispatcher/run-role.ts (the single real enforcement point).

## Handoff to audit-compliance-checker

Leads to follow:

1. `src/state/gate-log.ts` — does gate-decisions.jsonl distinguish `decided_by=system` for emulated review verdicts from `decided_by=controller` for real ones? If both look identical, post-mortem trace is broken.
2. `src/gates/confidence-model.ts` — does scoring penalize emulated dispatches? If not, fabricated "approved" feeds confidence as if real adversarial evidence.
3. Agent count consistency — 37 (controller md) vs 44 (README) vs 45 (manifest) — three different counts in three authority files.
4. **H2** — `src/continue/resume-pipeline.ts` — does resume re-apply strictAgents from persisted session or re-resolve from new RuntimeOptions? If the latter, `/pipeline continue` silently downgrades to emulation across resume boundaries.
5. `.codex/pipeline/protocol-events.jsonl` — does it distinguish emulated vs real spawn_agent calls? Audit-after-the-fact depends on this.

Recommended severity sort:
- CRITICAL — strictAgents silent-degradation chain (H1)
- HIGH — dead-documentation authority leak (markdown agent vs TS)
- HIGH — README/SKILL claims unhonored without --strict-agents
- MEDIUM — agent counts inconsistent across authority files
- LOW — guard at 1107 is dead code in prod
