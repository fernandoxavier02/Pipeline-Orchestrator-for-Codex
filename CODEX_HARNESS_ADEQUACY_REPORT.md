# Codex Harness Adequacy Report
## Pipeline Orchestrator for Codex v0.4.1 vs. Claude Code Pipeline Orchestrator v5.2.0

**Reviewer:** Codex Harness Adequacy Reviewer (adversarial mode)  
**Date:** 2026-05-11  
**Verdict:** The plugin claims parity. The reality is **structural parity with semantic betrayal**. The TypeScript runtime emulates multi-agent behavior locally, bypassing the very `spawn_agent` primitive it claims to translate faithfully.

---

## 1. Tool Mapping Accuracy

| | Claim (docs/pipeline-orchestrator-codex/07-codex-translation-matrix.md) | Reality (runtime code) |
|---|---|---|
| **`Task` → `spawn_agent`** | Classified as **Adapted**. "Very strong match, but Codex requires explicit user permission for subagent use." | The default TypeScript runtime **never calls `spawn_agent`**. `src/dispatcher/run-role.ts` branches on `requireRealAgent`, but `createPipelineRuntime` defaults `strictAgents` to `false` (`options.strictAgents ?? false`). Without an externally injected `agentRuntime` adapter, the dispatcher falls through to `single-agent-runner.ts`, which returns synthetic JSON outputs. |
| **`TodoWrite` → `update_plan`** | Classified as **Direct**. | ✅ Correct. The skill and hooks reference `update_plan`. |
| **`AskUserQuestion` → assistant question** | Classified as **Adapted**. | ✅ Correctly documented. The runtime serializes questions via `build-proposal.ts` and `confirm-proposal.ts`. |
| **`EnterPlanMode` → controller-enforced planning** | Classified as **Emulated**. | ✅ Correct. `src/controller/plan-mode.ts` emits `PLAN_MODE_REQUEST v1` blocks. |
| **Hook-based trigger wiring** | Classified as **Adapted**. | Partial. `hooks/hooks.json` maps events, but the Codex host may ignore hooks; the runtime has no fallback validation that hooks actually fired. |

**Gap Severity:** HIGH  
**Evidence:** `src/index.ts:445` (`strictAgents ?? false`); `src/dispatcher/run-role.ts:80-83` (real-agent branch requires injected `agentRuntime`); `src/dispatcher/single-agent-runner.ts` (entire default execution path).  
**Recommendation:** Reclassify `Task`→`spawn_agent` as **Emulated** for the default runtime path. The "Adapted" label only applies if the host provides a custom `agentRuntime` adapter, which the plugin does not ship.

---

## 2. Subagent Delegation

| | Claim | Reality |
|---|---|---|
| **Failure mode** | "The pipeline requires real Codex agent support. Check that `multi_agent = true` in `~/.codex/config.toml`." | The `blocked-no-agent-runtime` error is a **thin wrapper check** at `src/controller/pipeline-controller.ts:1104`. It fires ONLY when `runtime?.strictAgents && !runtime?.executionController`. It does NOT detect whether `spawn_agent` is actually available in the host. It does NOT read `~/.codex/config.toml`. It is a constructor-parameter gate, not a runtime probe. |
| ** SKILL contract** | `skills/pipeline/SKILL.md` states: "ALWAYS call `spawn_agent` for every phase. No exceptions." | The skill is a markdown document consumed by the LLM host. It has **no enforcement mechanism** over the TypeScript runtime. The runtime ignores this contract by default. |

**Gap Severity:** CRITICAL  
**Evidence:** `src/controller/pipeline-controller.ts:1100-1109`; `tests/bdd/state-adapter-integration.feature.test.ts:6-19` (test only validates the thin wrapper, not real agent detection); `tests/bdd/real-agent-pipeline.feature.test.ts` (only checks that strings exist in markdown, not that runtime enforces them).  
**Recommendation:** Either (a) make `strictAgents` default to `true` and ship a native `agentRuntime` adapter that calls `spawn_agent`, or (b) stop claiming the runtime enforces real-agent execution. The current state is a documentation promise with an unenforced code path.

---

## 3. Multi-Agent Mode vs. Single-Agent Emulation

| | Claim | Reality |
|---|---|---|
| **Full multi-agent mode** | "Activated when the environment and user permission allow agent delegation." | No code in the repo detects Codex environment capabilities. There is no probe for `spawn_agent` availability. Multi-agent mode is just `runMultiAgentRole` calling `runSingleAgentRole` in a `Promise.all()` — still local emulation. |
| **Single-agent emulation mode** | "Activated when delegation is unavailable or disallowed." | ✅ Implemented in `src/dispatcher/single-agent-runner.ts`. The emulation returns synthetic outputs: `createDefaultReviewFindings` generates findings based on regex/domain checklists, not actual reasoning. `freshContextEmulated: true` is a boolean flag on a JSON object, not real context isolation. |

**Gap Severity:** CRITICAL  
**Evidence:** `src/dispatcher/multi-agent-runner.ts:62-118` (calls `runSingleAgentRole` for each team member — no `spawn_agent`); `src/dispatcher/single-agent-runner.ts:429-451` (default path returns `freshContextEmulated: true` as a property); `src/review/review-orchestrator.ts:65-161` (defines a "multi-agent" review team that never leaves the local process).  
**Recommendation:** The `multi-agent-runner.ts` name is misleading. Rename it to `parallel-emulation-runner.ts` or implement actual `spawn_agent` bridging. The current code gives the illusion of parallel independent review while running purely local heuristics.

---

## 4. Runtime Configuration Detection

| | Claim | Reality |
|---|---|---|
| **`multi_agent = true`** | Error message tells users to "Check that `multi_agent = true` in `~/.codex/config.toml`." | The plugin **never reads `~/.codex/config.toml`**. There is no `fs.readFileSync` or `toml.parse` of the Codex config anywhere in `src/`. The plugin is completely blind to the host's feature flags. It relies entirely on the caller (the LLM host or a wrapper) to inject `agentRuntime`. |

**Gap Severity:** HIGH  
**Evidence:** `src/controller/pipeline-controller.ts:1107` (mentions config.toml in error string); `grep -r "config.toml\|multi_agent" src/` returns only the error-message string.  
**Recommendation:** Remove the misleading error message or implement actual config detection. The current message implies the runtime diagnoses the host, but it only checks a local boolean flag (`strictAgents`).

---

## 5. Plan Mode Translation

| | Claim | Reality |
|---|---|---|
| **Plan mode** | "Emulated via controller-enforced planning phase plus `update_plan`." | ✅ **This is implemented faithfully.** `src/controller/plan-mode.ts` creates `PlanModeRequest` and `ImplementationPlan` objects. `src/primitives/plan-session.ts` tracks read-only state and write attempts. The skill mandates `update_plan` before execution. |

**Gap Severity:** LOW  
**Evidence:** `src/controller/plan-mode.ts:46-67`; `src/primitives/plan-session.ts:11-48`.  
**Recommendation:** No action required. This is a rare area where documentation and runtime match.

---

## 6. Hook Translation

| | Claim | Reality |
|---|---|---|
| **Hook mapping** | "Claude hooks appear in `hooks/hooks.json`. In Codex, equivalent behavior may be split across plugin command wrappers, controller startup logic, pre-dispatch validation, post-step persistence, and final closeout logic." | `hooks/hooks.json` exists and maps `SessionStart`, `UserPromptSubmit`, `Stop`, and `PreToolUse`. The hooks are real Node scripts (`edit-guard-hook.cjs`, `dispatch-guard.cjs`, `force-pipeline-agents.cjs`, `sentinel-hook.cjs`, `session-lock-hook.cjs`, `session-cleanup-hook.cjs`, `completion-checklist.cjs`). `edit-guard-hook.cjs` (225 lines) is a complete fail-closed implementation with exec-window validation. |
| **Controller startup** | Hooks map to controller startup logic. | The hooks run as external processes; they do not invoke the TypeScript controller. There is no code path where a hook calls `createPipelineController()`. The hooks and the runtime are **parallel universes** — they share state files (e.g., `session-lock.json`, `gate-decisions.jsonl`) but never call each other. |

**Gap Severity:** MEDIUM  
**Evidence:** `hooks/hooks.json` (all events mapped); `hooks/edit-guard-hook.cjs` (functional implementation); `hooks/force-pipeline-agents.cjs:234-253` (injects `spawn_agent` mandate messages).  
**Recommendation:** Document that hooks are host-dependent. If the Codex host does not execute `hooks.json` (e.g., certain CLI modes), the edit guard and sentinel checks are silently bypassed. The runtime should perform defensive checks rather than assuming hooks fired.

---

## 7. Review Independence

| | Claim | Reality |
|---|---|---|
| **Independent adversarial review** | "Codex should preserve the same effect by choosing one of two patterns: distinct review agents with narrow prompts (subagents allowed) OR summarize implementation neutrally, re-open relevant files, run a review prompt that explicitly distrusts prior conclusions (subagents not allowed)." | The runtime takes **neither approach** when in default emulation mode. `review-orchestrator.ts` dispatches `batch-reviewer`, `executor-spec-reviewer`, and `quality-reviewer` with `freshContext: true`, but `runSingleAgentRole` returns `createDefaultReviewFindings` — a heuristic function that checks `changedDomains` against hardcoded lists (`auth`, `crypto`, `payment`, `injection`) and returns pre-canned severity labels. There is NO summarization of implementation, NO re-opening of files, and NO distrust prompt. The "review" is a lookup table. |

**Gap Severity:** CRITICAL  
**Evidence:** `src/review/review-orchestrator.ts:89-157` (defines review team); `src/dispatcher/single-agent-runner.ts:43-114` (`createDefaultReviewFindings` — the entire review logic is a series of `if (role === "batch-reviewer")` heuristics); `src/dispatcher/single-agent-runner.ts:443` (`freshContextEmulated: true` is just a boolean on the output object).  
**Recommendation:** The core value proposition of the canonical pipeline is **zero-context adversarial review by reasoning agents**. The Codex port replaces this with a rules engine. Either restore real agent dispatch for reviews or drastically downgrade the "independent review" claim in README and docs.

---

## 8. Confidence Scoring

| | Claim | Reality |
|---|---|---|
| **Non-invention rules** | The canonical pipeline mandates: "Do NOT invent missing requirements. If critical information is absent, STOP and report the gap." | `src/gates/confidence-model.ts` implements algorithmic scoring (`baseScore + gate_penalties`, thresholds at 0.6 and 0.8). However, the model is **purely arithmetic**. It has no concept of "invention." The `createDefaultReviewFindings` heuristic in `single-agent-runner.ts` generates synthetic `important` findings for mandatory domains — this is literally inventing review findings without evidence. The confidence score is then computed from these invented findings. |
| **Score integrity** | The canonical ties confidence to actual gate outcomes reviewed by agents. | The runtime computes confidence from `gateLog` entries that may themselves be synthetic (e.g., `SENTINEL_CHECKPOINT` auto-passed by the controller, `DESIGN_INTERROGATION` auto-skipped). The score is structurally valid but semantically hollow. |

**Gap Severity:** HIGH  
**Evidence:** `src/gates/confidence-model.ts:39-65` (arithmetic model); `src/dispatcher/single-agent-runner.ts:43-114` (synthetic findings generation); `src/controller/pipeline-controller.ts:1617-1627` (auto-emits `DESIGN_INTERROGATION` gate with `decision: "skip"` without agent involvement).  
**Recommendation:** Document that confidence scores in emulation mode are "structural estimates" rather than "agent-reviewed confidence." If real agents are not reviewing, the score should be capped or flagged as `confidenceSource: "emulated"`.

---

## 9. Architectural Inversion (Cross-Cutting Finding)

| | Canonical (Claude) | Codex Port |
|---|---|---|
| **Orchestration intelligence** | `agents/core/pipeline-controller.md` (1,470 lines) — a real N1 agent with reasoning, protocol emission, and phase management. | `src/controller/pipeline-controller.ts` (1,879 lines) — a TypeScript state machine that **bypasses the agent prompt entirely**. The 1,470-line `pipeline-controller.md` exists in the repo but is **never spawned** by the default runtime. |
| **Execution model** | Agent prompts do the work; controller coordinates. | TypeScript functions do the work; agent prompts are decorative. |

**Gap Severity:** CRITICAL  
**Evidence:** `agents/core/pipeline-controller.md` (full 1,470-line prompt with `DISPATCH_REQUEST` protocol, STEP 1.7, exec-window rituals); `src/controller/pipeline-controller.ts` (reimplements classification, proposal, plan mode, continuation, and gate logic in TypeScript).  
**Recommendation:** The port is not a harness — it is a **rewrite**. The TypeScript runtime should be repositioned as a "reference implementation / test harness" and the `pipeline-controller.md` agent should be restored as the primary orchestration path, dispatched via `spawn_agent` as the SKILL.md contract demands.

---

## Summary Matrix

| # | Focus Area | Claim | Reality | Gap Severity |
|---|-----------|-------|---------|--------------|
| 1 | Tool Mapping | `Task`→`spawn_agent` is Adapted | Default path is local emulation; `spawn_agent` never called without external adapter | HIGH |
| 2 | Subagent Delegation | `blocked-no-agent-runtime` when `spawn_agent` unavailable | Only fires when `strictAgents=true` (defaults false); no runtime probe | CRITICAL |
| 3 | Multi-Agent vs Single-Agent | Two modes implemented | Single-agent emulation exists; "multi-agent" is parallel emulation; no real agents | CRITICAL |
| 4 | Runtime Config | Detects `multi_agent=true` | Never reads `~/.codex/config.toml`; blind to host config | HIGH |
| 5 | Plan Mode | Emulated via `update_plan` | ✅ Correctly implemented | LOW |
| 6 | Hook Translation | Maps to controller startup | Hooks exist but run externally; runtime assumes they fired | MEDIUM |
| 7 | Review Independence | Independent adversarial review | Synthetic heuristic findings; zero real context isolation | CRITICAL |
| 8 | Confidence Scoring | Non-invention rules preserved | Algorithmic scoring over synthetic findings; no invention guard | HIGH |
| 9 | Architecture | Preserves canonical N1 agent | TypeScript state machine replaces the agent; 1,470-line prompt is orphaned | CRITICAL |

---

## Final Recommendation

**Do not claim parity with Claude Code Pipeline Orchestrator v5.2.0.** The Codex port preserves the *file structure*, *state schema*, and *gate names* of the canonical, but it replaces the *agent reasoning layer* with a TypeScript rules engine. It is a structurally faithful emulation with semantically hollow execution.

**Minimum viable honesty fixes:**
1. Change `strictAgents` default to `true` in `createPipelineRuntime`.
2. Ship a native `agentRuntime` adapter that bridges `runRole` to actual `spawn_agent` calls.
3. Rename "multi-agent" dispatch to "parallel emulation" everywhere the local runner is used.
4. Add `confidenceSource: "emulated"` to scores produced without real agent review.
5. Update README to state: "TypeScript runtime provides structural parity and state management; real agent reasoning requires `spawn_agent` adapter."

Until then, the claim of parity is **documentation theatre**.
