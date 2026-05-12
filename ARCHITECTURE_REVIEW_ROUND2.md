# Architecture Review Round 2 — `pipeline-orchestrator-for-codex`

**Reviewer:** Architecture Critic (Round 2)  
**Date:** 2026-05-11  
**Scope:** Assess Round 1 fixes for architectural soundness; identify new issues; prioritize deferred findings.  
**Evidence base:** `src/`, `tests/`, canonical reference at `D:\Pipeline Orchestrator Claude\Pipeline-Orchestrator`, runtime test execution.

---

## Executive Summary

The Round 1 fixes fall into three categories:

| Fix | Verdict | Key Issue |
|-----|---------|-----------|
| State Adapter wiring | **Indirection, not architecture** | Created but bypassed in most runtime paths; public API doesn't expose it |
| Complexity extraction | **Behaviorally correct, thin** | Consolidates logic but has zero dedicated tests; still couples to same dependencies |
| Dispatcher unknown roles | **Genuine improvement** | Blocks unknown non-reviewer roles; prevents silent fallthrough |
| Gap analysis caveat | **Well fixed** | Honest about emulation breaking review independence |

**New issues introduced by the fixes:** state adapter creates a type/schema split between public API and internal implementation; the adapter is bypassed in the critical `executeApprovedContinuation` path.

**Deferred findings remain largely untouched.** The controller is still 1,876 lines. The default runtime is still emulation. 515 tests still validate shadows.

---

## 1. Round 1 Fixes — Detailed Assessment

### 1.1 State Adapter Wiring (`src/controller/state-adapter.ts`)

**Severity:** MEDIUM (architectural debt added)  
**Evidence:**

- `state-adapter.ts` is 155 lines, of which ~90 are type declarations and JSDoc. The implementation is a pure pass-through:
  ```ts
  async appendGateDecision(decision) {
    await deps.gateLog.append(decision);
  }
  async saveConfidence(snapshot) {
    await deps.confidence.save(snapshot);
  }
  ```
- It is created in `createRunStores()` (line 928-943) and returned as part of the store bundle.
- **However**, `createPipelineController`'s public `runtime.stores` type signature (lines 1081-1089) does **not** include `stateAdapter`:
  ```ts
  stores?: {
    session?: SessionStore;
    checkpoints?: CheckpointStore;
    gateLog?: GateLogStore;
    confidence?: ConfidenceStore;
    sentinel?: SentinelStore;
  };
  ```
- `persistGateAndConfidence` (line 1043) **does** accept `stateAdapter` in its local `stores` parameter:
  ```ts
  runtime: {
    stores?: {
      gateLog?: GateLogStore;
      confidence?: ConfidenceStore;
      stateAdapter?: StateAdapter;
    };
  }
  ```
- **The critical execution path bypasses it:** In `continue` mode, `executeApprovedContinuation` receives a reconstructed `stores` object that omits `stateAdapter` (lines 1543-1551):
  ```ts
  stores: {
    session: runStores.session,
    checkpoints: runStores.checkpoints,
    gateLog: runStores.gateLog,
    confidence: runStores.confidence,
  },
  ```
- Inside `executeApprovedContinuation`, all `persistGateAndConfidence` calls (lines 387, 431, 466, 487, 637) pass raw stores without `stateAdapter`.
- The fallback logic in `persistGateAndConfidence` (lines 1066-1076) silently uses raw stores when `stateAdapter` is absent, meaning the "preferred abstraction" is a no-op in practice.

**Impact:**
- Adds ~155 lines of code + 150 lines of unit tests with zero runtime effect in the main flow.
- Creates a **type schizophrenia**: public API can't receive `stateAdapter`, but internal code paths check for it.
- Creates false confidence: developers reading `stateAdapter.appendGateDecision()` believe there's a unified persistence abstraction, but gate decisions during phase-2 execution still hit raw stores directly.

**Remediation:**
1. **Option A (commit to the abstraction):** Make `stateAdapter` the *only* persistence interface accepted by `createPipelineController`. Remove the raw-store fallback from `persistGateAndConfidence`. Ensure `createRunStores` returns an adapter that is always passed through.
2. **Option B (remove the indirection):** Delete `state-adapter.ts`. The stores already have a stable interface. If a unified abstraction is needed later, design one that actually encapsulates behavior (e.g., transactional batches, atomic writes) rather than renaming method calls.

**Recommendation:** Option B. The abstraction doesn't abstract anything today. Re-introduce when there's a real need (e.g., SQLite backend, event sourcing).

---

### 1.2 Complexity Resolution Extraction (`src/modes/complexity-resolution.ts`)

**Severity:** LOW (correct but untested)  
**Evidence:**

- Extracted from inline conditionals in `pipeline-controller.ts` and `executor-controller.ts` into a 39-line module.
- Used at two call sites:
  - `pipeline-controller.ts:330` — `executeApprovedContinuation`
  - `executor-controller.ts:729` — `executeApprovedWork`
- Behavior is 1:1 preserved: same precedence (`complexity` arg → mode policy → mode flags → variant suffix → default "MEDIA").
- **Zero dedicated unit tests.** `grep -r "complexity-resolution" tests/` returns nothing.

**Impact:**
- Deduplication is good. The module is a genuine Single Source of Truth.
- Risk is low because the logic is trivial, but untested shared logic is a regression waiting to happen.

**Remediation:**
- Add unit tests for `resolveExecutionComplexity` covering: explicit override, mode policy hit, `--complexa`, `--simples`, `--media`, variant suffix, default fallback.

---

### 1.3 Dispatcher Unknown Roles (`src/dispatcher/single-agent-runner.ts`)

**Severity:** LOW (fix is sound)  
**Evidence:**

- Explicit handlers added for `executor-implementer`, `review-orchestrator`, `executor-spec-reviewer` (lines 430-472).
- Unknown non-reviewer roles now default to `status: "blocked"` with a clear reason (lines 481-486):
  ```ts
  const status = findings.some((f) => f.severity === "critical" || f.severity === "important")
    ? "blocked"
    : isReviewer
      ? "approved"
      : "blocked";
  ```
- `run-role.test.ts` validates `AgentRuntimeUnavailableError` when `requireRealAgent = true` and no adapter is present.

**Impact:**
- Prevents the emulator from silently executing unknown roles. This is a real safety win.
- The emulator surface is now larger (more explicit handlers), but also more honest about what it can and cannot do.

**Remediation:** None required for this fix.

---

### 1.4 Gap Analysis Caveat (`docs/pipeline-orchestrator-codex/09-gap-analysis.md`)

**Severity:** LOW (well fixed)  
**Evidence:**

- Lines 57-59 now contain:
  > **CRITICAL CAVEAT:** The default runtime (`strictAgents = false`) does NOT preserve review independence. [...] The emulation mode is a test/contract harness and must not be presented as production-equivalent.

**Impact:**
- Documentation now accurately reflects the safety boundary. Users and maintainers are properly warned.

**Remediation:** None.

---

## 2. New Issues Introduced by Round 1 Fixes

### 2.1 State Adapter Type Split (NEW)

**Severity:** MEDIUM  
**Root cause:** Round 1 fix added `stateAdapter` to internal `persistGateAndConfidence` but did not update `createPipelineController`'s public contract.

**Evidence:** `createPipelineController(runtime)` accepts `runtime.stores` without `stateAdapter`. `persistGateAndConfidence` expects it. Callers outside the module cannot use the "preferred" path even if they wanted to.

**Impact:** Internal inconsistency. The adapter is neither fully adopted nor fully optional.

### 2.2 State Adapter Bypass in Execution Path (NEW)

**Severity:** MEDIUM  
**Root cause:** `executeApprovedContinuation` manually reconstructs `stores` and omits `stateAdapter`.

**Evidence:** Lines 1543-1551 of `pipeline-controller.ts`. All gate persistence during phase-2 (the most gate-heavy phase) uses raw stores.

**Impact:** The abstraction is theater in the critical path. Any future backend swap (e.g., SQLite, remote state) would fail silently for phase-2 execution.

### 2.3 Test Surface Expansion Without Coverage (NEW)

**Severity:** LOW  
**Root cause:** `state-adapter.test.ts` (150 lines) tests the wrapper in isolation but does not test integration with the controller. No tests assert that `persistGateAndConfidence` actually routes through `stateAdapter`.

**Evidence:** `tests/unit/controller/state-adapter.test.ts` only tests `createStateAdapter` directly. Controller tests do not mock `stateAdapter` or assert its usage.

**Impact:** Regression protection is weaker than it appears.

---

## 3. Deferred Findings — Round 2 Prioritization

### 3.1 Fat Controller (`src/controller/pipeline-controller.ts`, 1,876 lines) — **PRIORITY 1**

**Severity:** HIGH  
**Status:** Unchanged since Round 1.

**Evidence:**
- `start()` method alone spans lines 1098-1874 (~776 lines).
- `executeApprovedContinuation` spans lines 237-536 (~299 lines).
- Inline responsibilities: mode parsing, classification, gating, proposal building, spec lifecycle, workflow switching, session management, sentinel state, checkpoint validation, rollback routing, execution orchestration, gate logging, confidence scoring.

**Impact:**
- Impossible to unit test in isolation. Any change to proposal logic risks breaking rollback routing.
- The controller is a God Object. It knows about TypeScript compiler APIs, git status, sentinel tokens, and spec artifacts.

**Remediation for Round 2:**
1. Extract `executeApprovedContinuation` into a standalone orchestrator module.
2. Extract classification + proposal building into a `RequestClassifier`.
3. Extract spec-phase gating into `SpecPhaseGateEvaluator`.
4. Extract rollback/revalidation logic into `ResumeRouter`.
5. Target: controller reduced to ~400-500 lines (phase routing + store wiring only).

---

### 3.2 Dispatcher is Emulation Harness — **PRIORITY 2**

**Severity:** HIGH  
**Status:** Unchanged since Round 1.

**Evidence:**
- `single-agent-runner.ts` (507 lines) is 100% hardcoded heuristic outputs.
- `multi-agent-runner.ts` (118 lines) aggregates hardcoded outputs.
- No prompt content from `prompts/` or `agents/` is ever loaded or executed in the default runtime.
- The only path to real agents is `requireRealAgent = true` + `agentRuntime.spawnAgent()`, which is never enabled by default.

**Impact:**
- The entire 515-test suite validates an emulation layer that does not exercise real agent behavior.
- Review independence is violated by design in the default configuration.

**Remediation for Round 2:**
1. Make `strictAgents = true` the default in test configurations that claim to validate pipeline safety.
2. Add a `runtimeMode` enum: `"emulation" | "real-agent" | "hybrid"`.
3. In `hybrid` mode, known emulator roles run locally; unknown roles **must** dispatch to real agents (not default to blocked).

---

### 3.3 Tests Validate Fallback Shadows — **PRIORITY 2**

**Severity:** HIGH  
**Status:** Unchanged since Round 1.

**Evidence:**
- 515 tests pass, 0 fail.
- `run-role.test.ts` tests `runRole` with mocked `agentRuntime.spawnAgent` — but the mock just returns a hardcoded object. This is testing the test harness, not real dispatch.
- No end-to-end test verifies that a real agent (or even a subprocess proxy) executes a prompt and returns structured output.

**Impact:**
- False confidence. The test suite cannot catch bugs in real agent dispatch, prompt loading, or context isolation.

**Remediation for Round 2:**
1. Split test suite into `unit/` (fast, no I/O) and `integration/` (real dispatch or subprocess proxy).
2. Mark all emulation-only tests with `describe.skip` when `process.env.REAL_AGENT_RUNTIME` is set.
3. Add at least one integration test that loads a prompt from disk, feeds it to a subprocess runner, and validates the required output blocks appear in the response.

---

### 3.4 Three Colliding Authorities — **PRIORITY 3**

**Severity:** MEDIUM-HIGH  
**Status:** Unchanged since Round 1.

**Evidence:**
- `skills/pipeline/SKILL.md` defines user-facing behavior.
- `agents/` and `prompts/` define markdown prompt contracts.
- `src/` (75 TS files) defines runtime behavior that often diverges from the markdown prompts.
- Example: `agents/core/information-gate.md` says "Ask one question at a time." The runtime `runInformationGate()` in `src/gates/information-gate.ts` does something different (heuristic classification, not question generation).

**Impact:**
- Maintainers must keep three sources of truth in sync. When they drift, users see prompt behavior that doesn't match runtime behavior.

**Remediation for Round 2:**
1. Generate `agents/` stubs from `src/` runtime metadata (or vice versa) in CI.
2. Add a drift-detector test that fails when `agents/core/*.md` and `src/gates/*.ts` describe different behaviors.

---

### 3.5 Prompt Registry Validation Theater — **PRIORITY 3**

**Severity:** MEDIUM  
**Status:** Unchanged since Round 1.

**Evidence:**
- `prompt-registry.ts` (114 lines) validates that prompts contain required output blocks (e.g., `CHECKPOINT_RESULT`, `STATUS`, `EVIDENCE`).
- `single-agent-runner.ts` hardcodes outputs like:
  ```ts
  CHECKPOINT_RESULT: result.checkpointName,
  STATUS: result.status,
  EVIDENCE: evidence,
  ```
- The prompts are loaded in `src/index.ts` for preload, but **never consumed** by the emulation path.

**Impact:**
- Tests validate that markdown files contain strings. They do not validate that the runtime produces those strings.
- The registry is dead code in the default runtime.

**Remediation for Round 2:**
1. Either make the emulator load prompts and execute them (e.g., via a lightweight template engine), OR
2. Remove `REQUIRED_OUTPUT_BLOCKS` validation and replace it with runtime contract tests: assert that `runSingleAgentRole({role: "checkpoint-validator"})` returns an object with `checkpointResult`, `status`, and `evidence` keys.

---

### 3.6 TS Compiler API Coupling — **PRIORITY 4**

**Severity:** MEDIUM  
**Status:** Unchanged since Round 1.

**Evidence:**
- `pipeline-controller.ts` lines 787-896 use `ts.createSourceFile`, `ts.resolveModuleName`, `ts.findConfigFile`, `ts.parseJsonConfigFileContent`.
- This is used only for `resolveApprovedScenarioFiles` — mapping affected files to test scenarios by static import analysis.

**Impact:**
- Heavy dependency for a peripheral feature. `typescript` is a large package.
- The compiler API is not designed for runtime use; version mismatches can break the pipeline.

**Remediation for Round 2:**
1. Replace with a lightweight regex-based import scanner, OR
2. Extract into a standalone `@pipeline/scenario-resolver` package that runs in a separate process.

---

### 3.7 Canonical Drift (~75 TS source files vs 0) — **PRIORITY 5**

**Severity:** LOW-MEDIUM  
**Status:** Structural, not a runtime bug.

**Evidence:**
- Codex port: 75 `.ts` source files, 92 test files.
- Canonical: 0 `.ts` files. Runtime is entirely prompt-driven via Claude's agent system.

**Impact:**
- The Codex port is a *reimplementation*, not a direct port. This is acceptable if behavior is equivalent, but it doubles maintenance burden.
- Any canonical update requires manual translation into TS.

**Remediation for Round 2:**
- Accept as architectural decision. Document the "runtime-first vs prompt-first" split in `AGENTS.md`.
- Do not attempt to eliminate TS files; instead, invest in automated parity tests (see 3.3).

---

## 4. Recommendations Summary

### Immediate (before next feature work)
1. **Fix State Adapter plumbing** — either fully adopt it in the public API or delete it. Partial adoption is worse than no abstraction.
2. **Add unit tests for `complexity-resolution.ts`** — 6 test cases, trivial effort.

### Round 2 Corrections (this sprint)
3. **Slim the controller** — extract `executeApprovedContinuation`, `SpecPhaseGateEvaluator`, `ResumeRouter`. Target < 600 lines.
4. **Add real-agent integration tests** — at minimum, a subprocess-based test that validates prompt loading + structured output parsing.

### Round 3 (next sprint)
5. **Resolve colliding authorities** — build a drift detector or generate one artifact from the other.
6. **Replace or isolate TS Compiler API** — decouple scenario resolution from the main controller.

### Accept / Monitor
7. **Canonical drift** — document as intentional architectural difference.
8. **Dispatcher emulation** — acceptable for test/contract harness; keep `strictAgents` gate and improve documentation.

---

## Appendix: Evidence Metrics

| Metric | Codex Port | Canonical | Delta |
|--------|-----------|-----------|-------|
| `.ts` source files | 75 | 0 | +75 |
| `.ts` test files | 92 | 0 | +92 |
| Total lines in `pipeline-controller.ts` | 1,876 | N/A (markdown agent) | — |
| Total lines in `single-agent-runner.ts` | 507 | N/A | — |
| Total lines in `executor-controller.ts` | 1,226 | N/A | — |
| Tests passing | 515 | ~30 (hook tests in `.cjs`) | — |
| Prompts validated by registry | 19 | N/A | — |
| Prompts consumed by emulation | 0 | N/A | — |
