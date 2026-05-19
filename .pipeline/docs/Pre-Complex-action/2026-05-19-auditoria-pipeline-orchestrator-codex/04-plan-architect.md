# Plan Architect — Phase 1.5
**Pipeline:** Auditoria do Pipeline Orchestrator para Codex
**Date:** 2026-05-19
**Gate Status:** PENDING_USER_APPROVAL
**Agent:** plan-architect (audit mode)

---

## Observability Header

```
+==================================================================+
|  PLAN-ARCHITECT                                                  |
|  Phase: 1.5 (Post-Proposal)                                     |
|  Mode: AUDIT (read-only research → audit plan)                  |
|  Status: PLAN PRODUCED — AWAITING USER GATE                     |
|  Files researched: 22 (source files, hooks, tests, prior docs)  |
|  Axes planned: 6                                                 |
|  Prior findings indexed: 37                                      |
+==================================================================+
```

---

## AUDIT PLAN

### Overview

**Goal:** Produce a verdict + remediation roadmap for the Pipeline Orchestrator for Codex (v0.4.1) runtime by auditing 6 axes at differentiated depth, regression-checking all 37 prior findings, and naming systemic patterns.

**Approach:** Axis 2 executes first because it is the confirmed root cause (spawn_agent/strictAgents contract) — every other axis is a downstream symptom of that failure. Axis 1 executes second (Authority Conflict) because the three-authority SSOT conflict is what enables the root cause to persist undetected. Axis 3 (Hook Enforcement) follows immediately, since hooks are the only runtime defense layer and their coverage gaps compound the dispatch failure. Axes 4, 5, 6 run at medium depth in that order because gate hardness, sentinel fidelity, and test validity are observable symptoms of the upstream failures, verifiable by sampling rather than exhaustive reads.

**Files to audit:** 16 primary files across 6 axes, plus 5 prior-corpus documents for regression checks.

**Estimated audit sub-tasks:** 6 axis reports + 1 regression matrix + 1 systemic patterns synthesis + 2 placeholder outputs (verdict, roadmap) = 10 deliverables.

---

### Axis Execution Order (dependency-sorted)

#### Axis 2 — spawn_agent / strictAgents Contract (FULL depth — FIRST)

**Rationale:** This is the KNOWN ROOT CAUSE (pre-confirmed by info-gate, CONFLICT-2). The default runtime sets `strictAgents ?? false` and never calls real `spawn_agent`. Every other axis finding depends on understanding this failure mode precisely.

**Files and line ranges:**
- `src/index.ts`: lines 474–560 (`createPipelineRuntime`, `strictAgents` propagation), lines 670–710 (`requireRealAgent` plumbing), lines 900–960 (final-validator dispatch)
- `src/domain/pipeline-types.ts`: full file (42 lines — `RuntimeOptions.strictAgents` type)
- `src/controller/pipeline-controller.ts`: lines 1100–1115 (thin wrapper / `blocked-no-agent-runtime` check), lines 1080–1100 (public API `stores` type — omits `stateAdapter`)
- `src/dispatcher/single-agent-runner.ts`: full file (508 lines — the entire emulation harness, `createDefaultReviewFindings` heuristics, synthetic outputs)
- `src/dispatcher/run-role.ts`: full file (148 lines — real-agent branch logic, `requireRealAgent` gate)
- `src/dispatcher/parallel-emulation-runner.ts`: lines 1–60 (`runMultiAgentRole` wrapping single emulator in `Promise.all`)
- `skills/pipeline/SKILL.md`: lines 28–48 (`<MANDATORY-SUBAGENT-RULE>` block, the doc promise)
- `commands/pipeline.md`: full file (Agent Execution Contract section)

**What to verify:**
1. Does `createPipelineRuntime` ever default `strictAgents` to `true`? (Expected: no — defaults to `false` via `options.strictAgents ?? false`)
2. Does `run-role.ts` correctly block when `requireRealAgent=true` but no `agentRuntime`? (Expected: yes — throws `AgentRuntimeUnavailableError`)
3. Does the `parallel-emulation-runner` call `spawn_agent` or `agentRuntime.spawnAgent`? (Expected: no — runs `runSingleAgentRole` in Promise.all)
4. Does any code path reach real `spawn_agent` without an external `agentRuntime` adapter? (Expected: no)
5. Does SKILL.md's "ALWAYS call spawn_agent" constraint have any enforcement path? (Expected: no — markdown only)
6. What is the exact condition at `pipeline-controller.ts:1107`? Is it weaker than documented? (Expected: yes — fires only when `strictAgents && !executionController`, not a real host probe)

---

#### Axis 1 — Authority Conflict Resolution (FULL depth — SECOND)

**Rationale:** Three files claim to be the authoritative orchestration layer. The conflict is what allows the broken default to persist — if there were one clear SSOT, the spawn_agent failure would be impossible to overlook.

**Files and line ranges:**
- `skills/pipeline/SKILL.md`: full file (174 lines) — especially frontmatter (`agent_type: worker`, `allowed-tools`), MANDATORY-SUBAGENT-RULE, "thin delegator" self-description
- `agents/core/pipeline-controller.md`: lines 1–60 (frontmatter, architecture overview, execution protocol) — note: file is 33,482 tokens; use grep/offset to sample key sections
- `src/controller/pipeline-controller.ts`: lines 1098–1200 (`start()` method, mode parsing, classification logic — the TypeScript orchestrator doing work the markdown prompt claims to do)

**What to verify:**
1. What does SKILL.md claim its role is? ("thin delegator") vs what does it actually do when `spawn_agent` is unavailable?
2. Does `agents/core/pipeline-controller.md` (the markdown prompt) contain the same classification logic that `src/controller/pipeline-controller.ts` also implements? (Expected: yes — architectural inversion)
3. Which of the three sources would "win" in a conflict: who does the actual classification in a real Codex session?
4. Do any of the three files explicitly defer to the others as SSOT? Or do they all claim authority?
5. Cross-check: does the TypeScript controller ever read/spawn from `agents/core/pipeline-controller.md`? (Expected: no)

---

#### Axis 3 — Hook Enforcement Coverage (FULL depth — THIRD)

**Rationale:** Hooks are the only runtime defense that operates independently of the TypeScript controller. If hooks fail-open, the security boundary collapses regardless of what the controller does.

**Files and line ranges:**
- `hooks/hooks.json`: full file (95 lines) — matchers, event types, coverage gaps
- `hooks/dispatch-guard.cjs`: lines 403–456 (`handle()` function and crash handler — CRITICAL: prior finding was fail-open on crash; reportedly fixed to fail-closed; verify)
- `hooks/sentinel-hook.cjs`: lines 108–120 (fail-open on corrupted state path), lines 181–190 (state load path)
- `hooks/edit-guard-hook.cjs`: lines 23–35 (`PROTECTED_TOOLS` set — check if `Bash` is now included), lines 72–140 (path extraction logic)
- `hooks/force-pipeline-agents.cjs`: full file (check if it enforces `spawn_agent` mandate or just injects text)

**What to verify:**
1. Does `dispatch-guard.cjs` now fail-CLOSED on crash? (Claimed fix in commit b5e194b; verify lines 440–455)
2. Does `sentinel-hook.cjs` fail-closed on corrupted/missing state? (Prior finding: fail-open on exit 0)
3. Does `edit-guard-hook.cjs` include `Bash` in `PROTECTED_TOOLS`? (Prior finding #1: Bash bypass — critical)
4. Does `hooks.json` register `PreToolUse:Bash`? (Prior finding: unguarded)
5. Is there coverage for `SubagentStop`, `SessionEnd`, `PreCompact`, `PostToolUse` events? (Codex supports these; hooks.json only registers 4 events)
6. Does `force-pipeline-agents.cjs` actually prevent non-spawn_agent execution, or does it only add text to the prompt?

---

#### Axis 4 — Gate Hardness vs Actual Enforcement (MEDIUM depth — FOURTH)

**Files and line ranges:**
- `src/controller/pipeline-controller.ts`: grep for `MANDATORY|HARD|CIRCUIT_BREAKER|SOFT` gate emission patterns; sample lines 1200–1500 (gate decision appendage in `start()`)
- `references/gates/macro-gate-questions.md`: full file (sample — check if gate definitions match what controller implements)
- `references/sentinel-integration.md`: lines 80–160 (checkpoint mandate vs actual wiring at lines 106–111)

**What to verify (sampled):**
1. Do MANDATORY gates actually halt execution, or can they be bypassed in the code?
2. Does the `SENTINEL_CHECKPOINT` gate get written with correct `hardness`?
3. Does the gate log write happen before or after the guarded action?
4. Are any HARD gates emitted without corresponding enforcement code?

---

#### Axis 5 — Sentinel Checkpoint Fidelity (MEDIUM depth — FIFTH)

**Files and line ranges:**
- `agents/core/sentinel.md`: full file (sample — verify spec checkpoints presence vs AUDIT_CODEX_VS_CANONICAL finding that SPEC PIPELINE CHECKPOINTS were removed)
- `src/controller/pipeline-controller.ts`: grep for `saveSentinelState|sentinel` call sites (5 expected checkpoints; verify all 5 wired)
- `references/sentinel-integration.md`: lines 80–160 (checkpoint definitions, wiring notes at lines 106–111)

**What to verify (sampled):**
1. Are all 5 sentinel checkpoints (`post_orchestrator`, `phase_0_to_1`, `phase_1_to_2`, `phase_2_to_3`, `post_final_validator`) actually called in the controller?
2. Does the sentinel write state BEFORE agent spawn, or after? (Spec requires: before)
3. Does the sentinel perform ORCHESTRATOR_VALIDATION mode (active reasoning), or just write JSON?
4. Are SPEC PIPELINE CHECKPOINTS present in `agents/core/sentinel.md`? (GAP-4 from prior audit)

---

#### Axis 6 — Test Coverage Validity (MEDIUM depth — SIXTH)

**Files and line ranges:**
- `tests/bdd/real-agent-pipeline.feature.test.ts`: full file (23 lines — verifies markdown strings, NOT runtime behavior)
- `tests/bdd/state-adapter-integration.feature.test.ts`: full file (checks `blocked-no-agent-runtime` thin wrapper — NOT real agent detection)
- `tests/bdd/dispatch-protection.feature.test.ts`: full file (sample — check if it tests hook behavior or just TypeScript dispatch-guard logic)
- `tests/bdd/sentinel-checkpoints.feature.test.ts`: full file (sample — does it test real sentinel state or emulated?)

**What to verify (sampled):**
1. Do any tests verify that `spawn_agent` is actually called (vs the emulator)?
2. Do BDD tests mock `agentRuntime` or leave it undefined? (If undefined, they validate emulation, not real behavior)
3. Does `real-agent-pipeline.feature.test.ts` test any runtime behavior? (Prior finding: it only checks `readFileSync` string content)
4. Are there contract tests that spin up a fake `spawn_agent` server and verify the adapter bridges correctly?

---

### Regression Check Matrix

Prior corpus documents to regression-check per axis:

| # | Finding ID | Source Document | Axis | Description |
|---|-----------|-----------------|------|-------------|
| 1 | GAP-1 | AUDIT_CODEX_VS_CANONICAL.md | 2 | Controller N1 truncated — 35-line stub vs 1,470-line canonical |
| 2 | GAP-2 | AUDIT_CODEX_VS_CANONICAL.md | 2 | STEP 1.7 absent — no brainstorm-controller routing for MEDIA/COMPLEXA |
| 3 | GAP-3 | AUDIT_CODEX_VS_CANONICAL.md | 2 | Local emulation as default — synthetic outputs from single-agent-runner |
| 4 | GAP-4 | AUDIT_CODEX_VS_CANONICAL.md | 5 | Sentinel missing SPEC PIPELINE CHECKPOINTS (5 removed) |
| 5 | GAP-5 | AUDIT_CODEX_VS_CANONICAL.md | 3 | Edit-guard-hook.cjs absent / Bash unguarded |
| 6 | GAP-6 | AUDIT_CODEX_VS_CANONICAL.md | 3 | Session-lock without heartbeat |
| 7 | GAP-7 | AUDIT_CODEX_VS_CANONICAL.md | 2 | TDD interactive scenario loop lost |
| 8 | GAP-8 | AUDIT_CODEX_VS_CANONICAL.md | 5 | Phase transition summaries absent |
| 9 | GAP-9 | AUDIT_CODEX_VS_CANONICAL.md | 2 | Phase 2 skill delegation absent |
| 10 | GAP-10 | AUDIT_CODEX_VS_CANONICAL.md | 5 | Sentinel reduced to JSON state write |
| 11 | GAP-11 | AUDIT_CODEX_VS_CANONICAL.md | 3 | Skill frontmatter enforcement partial |
| 12 | GAP-12 | AUDIT_CODEX_VS_CANONICAL.md | 2 | Team registry not consumed |
| 13 | HAR-1 | CODEX_HARNESS_ADEQUACY_REPORT.md | 2 | strictAgents defaults false; spawn_agent never probed |
| 14 | HAR-2 | CODEX_HARNESS_ADEQUACY_REPORT.md | 2 | blocked-no-agent-runtime thin wrapper, not real detection |
| 15 | HAR-3 | CODEX_HARNESS_ADEQUACY_REPORT.md | 2 | "Multi-agent" is parallel emulation — no real agents |
| 16 | HAR-4 | CODEX_HARNESS_ADEQUACY_REPORT.md | 4 | Runtime config blind — never reads ~/.codex/config.toml |
| 17 | HAR-5 | CODEX_HARNESS_ADEQUACY_REPORT.md | 6 | Plan mode translation is faithful (LOW — likely still OK) |
| 18 | HAR-6 | CODEX_HARNESS_ADEQUACY_REPORT.md | 3 | Hooks and runtime are parallel universes |
| 19 | HAR-7 | CODEX_HARNESS_ADEQUACY_REPORT.md | 2 | Review independence violated by design |
| 20 | HAR-8 | CODEX_HARNESS_ADEQUACY_REPORT.md | 4 | Confidence scoring hollow — arithmetic over synthetic gate logs |
| 21 | HAR-9 | CODEX_HARNESS_ADEQUACY_REPORT.md | 1 | Architectural inversion — 1,470-line prompt orphaned |
| 22 | CAR-1 | CONSOLIDATED_ADVERSARIAL_REVIEW.md | 3 | Bash tool write bypass — edit-guard only guards Edit/Write |
| 23 | CAR-2 | CONSOLIDATED_ADVERSARIAL_REVIEW.md | 3 | Symlink attack in open.cjs (exec-window) |
| 24 | CAR-3 | CONSOLIDATED_ADVERSARIAL_REVIEW.md | 3 | dispatch-guard fail-open on crash (claimed fixed in commit b5e194b) |
| 25 | CAR-4 | CONSOLIDATED_ADVERSARIAL_REVIEW.md | 3 | sentinel-hook fail-open on corrupted state |
| 26 | CAR-5 | CONSOLIDATED_ADVERSARIAL_REVIEW.md | 1 | Three colliding authorities — no SSOT |
| 27 | CAR-6 | CONSOLIDATED_ADVERSARIAL_REVIEW.md | 1 | "Thin wrapper" is fat state machine (1,879 TS lines) |
| 28 | CAR-7 | CONSOLIDATED_ADVERSARIAL_REVIEW.md | 1 | Canonical drift — not a port |
| 29 | CAR-8 | CONSOLIDATED_ADVERSARIAL_REVIEW.md | 2 | Subagent delegation is documentation theatre |
| 30 | CAR-9 | CONSOLIDATED_ADVERSARIAL_REVIEW.md | 2 | "Multi-agent" is parallel local emulation |
| 31 | CAR-10 | CONSOLIDATED_ADVERSARIAL_REVIEW.md | 2 | Review independence violated by design |
| 32 | CAR-11 | CONSOLIDATED_ADVERSARIAL_REVIEW.md | 2 | Runtime blind to host config |
| 33 | CAR-12 | CONSOLIDATED_ADVERSARIAL_REVIEW.md | 1 | Architectural inversion — prompt never spawned |
| 34 | CAR-13 | CONSOLIDATED_ADVERSARIAL_REVIEW.md | 3 | Non-atomic exec-window writes (Windows) |
| 35 | CAR-14 | CONSOLIDATED_ADVERSARIAL_REVIEW.md | 3 | Gate log appendFile non-atomic (concurrent corruption) |
| 36 | CAR-15 | CONSOLIDATED_ADVERSARIAL_REVIEW.md | 6 | Unknown roles default to approved (claimed fixed — verify) |
| 37 | RND2-1 | ARCHITECTURE_REVIEW_ROUND2.md | 1 | State adapter is dead code / bypass in executeApprovedContinuation |
| 38 | ADVER-C1 | .pipeline/docs/Pre-Medium-action/final-adversarial-report.md | 3 | Ghost hook scripts in hooks.json template |
| 39 | ADVER-C2 | .pipeline/docs/Pre-Medium-action/final-adversarial-report.md | 3 | hook-deny.cjs fail-open default |
| 40 | ADVER-C3 | .pipeline/docs/Pre-Medium-action/final-adversarial-report.md | 1 | Sibling-skill name dead routes (plugin-dev references) |
| 41 | ADVER-C4 | .pipeline/docs/Pre-Medium-action/final-adversarial-report.md | 1 | Drift Notes pattern + KB↔skill duplication erodes SSOT |
| 42 | ADVER-C5 | .pipeline/docs/Pre-Medium-action/final-adversarial-report.md | 6 | Schema/tool-name correctness depends on unverified web claims |

**Regression status options per finding:** STILL_OPEN | CLOSED | REGRESSED | MUTATED

---

### Systemic Patterns to Consolidate (per B4 decision)

The audit agents must test each candidate pattern against the evidence found in their axis and confirm or refute:

| Pattern ID | Working Name | Candidate Evidence | Primary Axis |
|-----------|-------------|-------------------|--------------|
| SP-1 | Doc-Promise / Runtime-Silence Gap | SKILL.md says "ALWAYS spawn_agent"; runtime defaults to emulation | 2 |
| SP-2 | Fix-then-Regress Cycle | dispatch-guard crash reported → "fixed" → verify if truly closed; unknown roles fixed R1 → state adapter bypass introduced | 1, 3 |
| SP-3 | Authority Fragmentation | Three files claim orchestration authority; no SSOT declared | 1 |
| SP-4 | Emulation Theatre | freshContextEmulated: true flag; "multi-agent" Promise.all; synthetic findings | 2, 6 |
| SP-5 | Parallel Universe Enforcement | Hooks and TypeScript runtime share state files but never call each other; compliance depends on both being active | 3, 4 |

---

### Risk Assessment

**High risk — codebase may have changed since 2026-05-11:**
Some prior findings (CAR-3 dispatch-guard crash, CAR-15 unknown roles) were reportedly addressed in commits `b5e194b` and `2d138a3`. The audit must re-read the actual current code at those lines, not trust commit messages. Finding status could be CLOSED, MUTATED, or REGRESSED.

**Medium risk — file size constraints on pipeline-controller.md:**
`agents/core/pipeline-controller.md` is 33,482 tokens — too large to read whole. Axis 1 and 2 auditors must use offset+grep to sample key sections (frontmatter, execution protocol, spawn_agent references). They cannot claim full coverage without flagging this constraint explicitly.

**Medium risk — hooks behavior is host-dependent:**
Whether hooks.json actually fires in the Codex host is unverifiable from static analysis alone. The audit can confirm the hook code is correct and registered, but cannot confirm runtime execution without live environment access. Findings must be tagged `[STATIC-ANALYSIS-ONLY]` where runtime probe is impossible.

**Low risk — prior finding numbering:**
The prior corpus uses inconsistent IDs (GAP-N, HAR-N, CAR-N). The regression matrix above assigns stable IDs for this audit cycle. Auditors should use these IDs when referencing prior work.

---

### Expected Audit Outputs

Per design decision B1 (dual deliverable: verdict front + roadmap back):

| Output | Produced by | Description |
|--------|-------------|-------------|
| `per_axis_findings/axis-2-spawn-agent.md` | Axis 2 auditor | FULL depth: spawn_agent contract failures, strictAgents default, emulation harness scope |
| `per_axis_findings/axis-1-authority-conflict.md` | Axis 1 auditor | FULL depth: three-authority SSOT conflict map, architectural inversion evidence |
| `per_axis_findings/axis-3-hook-enforcement.md` | Axis 3 auditor | FULL depth: Bash bypass status, fail-open patterns, coverage gaps |
| `per_axis_findings/axis-4-gate-hardness.md` | Axis 4 auditor | MEDIUM depth: gate emission vs enforcement gap |
| `per_axis_findings/axis-5-sentinel-fidelity.md` | Axis 5 auditor | MEDIUM depth: checkpoint wiring, SPEC checkpoints, JSON-only sentinel |
| `per_axis_findings/axis-6-test-validity.md` | Axis 6 auditor | MEDIUM depth: test-validates-emulation problem, string-check tests |
| `regression_matrix.md` | Consolidation agent | All 42 prior findings with STILL_OPEN/CLOSED/REGRESSED/MUTATED status |
| `systemic_patterns.md` | Consolidation agent | SP-1 through SP-5 confirmed or refuted, named and described |
| `final_verdict.md` | Final-validator | Placeholder; filled by final-validator with severity rating, confidence, single-sentence finding |
| `roadmap.md` | Final-validator | Placeholder; filled by final-validator using consolidated findings, sequenced by priority |

**All output files written to:** `{PIPELINE_DOC_PATH}/` (= `D:/Pipeline Orchestrator For Codex/.pipeline/docs/Pre-Complex-action/2026-05-19-auditoria-pipeline-orchestrator-codex/`)

---

### Bounded Contexts (COMPLEXA — required)

| Context | Aggregate Root | Key Invariants |
|---------|----------------|----------------|
| Orchestration | PipelineController | One active orchestrator per session; spawn_agent is the only valid agent dispatch; emulation is test-only |
| Hook Enforcement | HookRegistry (hooks.json) | Every guarded tool call must pass through registered hooks; hook crash = deny (fail-closed) |
| Gate Governance | GateLog (gate-decisions.jsonl) | Append-only; controller-only writes; each gate has one hardness level and one decision per lifecycle |
| Sentinel Validation | SentinelState (sentinel-state.json) | State written before every agent spawn; corrupted state = deny (fail-closed); 5 mandatory checkpoints |
| Dispatch Contract | DispatchRequest | requireRealAgent=true requires agentRuntime adapter; emulation outputs flagged as emulated; freshContext is real context isolation, not a boolean flag |
| Test Harness | SingleAgentRunner | Harness outputs are synthetic by construction; harness tests validate contract shape, not agent behavior |

---

```yaml
IMPLEMENTATION_PLAN:
  status: "APPROVED_PENDING_USER_GATE"
  plan_type: "AUDIT_PLAN"
  total_axes: 6
  total_prior_findings: 42
  axis_execution_order:
    - id: "A2"
      name: "spawn_agent / strictAgents Contract"
      depth: "FULL"
      rationale: "Known root cause — every other axis is downstream of this failure"
      files_to_audit:
        - "src/index.ts:474-560,670-710,900-960"
        - "src/domain/pipeline-types.ts:1-44"
        - "src/controller/pipeline-controller.ts:1080-1115"
        - "src/dispatcher/single-agent-runner.ts:1-508"
        - "src/dispatcher/run-role.ts:1-148"
        - "src/dispatcher/parallel-emulation-runner.ts:1-60"
        - "skills/pipeline/SKILL.md:28-48"
        - "commands/pipeline.md:Agent Execution Contract section"
      depends_on: []

    - id: "A1"
      name: "Authority Conflict Resolution"
      depth: "FULL"
      rationale: "Three colliding authorities allow the root cause to persist undetected"
      files_to_audit:
        - "skills/pipeline/SKILL.md:1-174"
        - "agents/core/pipeline-controller.md:1-60 (sampled — 33k token file)"
        - "src/controller/pipeline-controller.ts:1098-1200"
      depends_on: ["A2"]

    - id: "A3"
      name: "Hook Enforcement Coverage"
      depth: "FULL"
      rationale: "Hooks are the only enforcement layer independent of the TypeScript runtime"
      files_to_audit:
        - "hooks/hooks.json:1-95"
        - "hooks/dispatch-guard.cjs:403-456"
        - "hooks/sentinel-hook.cjs:108-120,181-190"
        - "hooks/edit-guard-hook.cjs:23-35,72-140"
        - "hooks/force-pipeline-agents.cjs:full"
      depends_on: ["A1"]

    - id: "A4"
      name: "Gate Hardness vs Actual Enforcement"
      depth: "MEDIUM"
      rationale: "Downstream symptom — verifiable by sampling"
      files_to_audit:
        - "src/controller/pipeline-controller.ts:gate sections (grep MANDATORY|HARD|CIRCUIT_BREAKER)"
        - "references/gates/macro-gate-questions.md:full"
        - "references/sentinel-integration.md:80-160"
      depends_on: ["A3"]

    - id: "A5"
      name: "Sentinel Checkpoint Fidelity"
      depth: "MEDIUM"
      rationale: "Sentinel is the sequencing guardian — verify 5 checkpoints are wired and active"
      files_to_audit:
        - "agents/core/sentinel.md:sampled"
        - "src/controller/pipeline-controller.ts:grep saveSentinelState"
        - "references/sentinel-integration.md:80-160"
      depends_on: ["A4"]

    - id: "A6"
      name: "Test Coverage Validity"
      depth: "MEDIUM"
      rationale: "Tests validate the emulation harness, not real behavior — confirm scope"
      files_to_audit:
        - "tests/bdd/real-agent-pipeline.feature.test.ts:1-23"
        - "tests/bdd/state-adapter-integration.feature.test.ts:1-60"
        - "tests/bdd/dispatch-protection.feature.test.ts:sampled"
        - "tests/bdd/sentinel-checkpoints.feature.test.ts:sampled"
      depends_on: ["A5"]

  regression_check_matrix_size: 42
  expected_audit_outputs:
    - "per_axis_findings/axis-2-spawn-agent.md"
    - "per_axis_findings/axis-1-authority-conflict.md"
    - "per_axis_findings/axis-3-hook-enforcement.md"
    - "per_axis_findings/axis-4-gate-hardness.md"
    - "per_axis_findings/axis-5-sentinel-fidelity.md"
    - "per_axis_findings/axis-6-test-validity.md"
    - "regression_matrix.md"
    - "systemic_patterns.md"
    - "final_verdict.md (placeholder)"
    - "roadmap.md (placeholder)"

  evidence_collection_risks:
    - area: "Codebase drift since 2026-05-11 (14 days)"
      severity: "high"
      mitigation: "Re-read actual code at exact lines; treat prior findings as hypotheses, not confirmed facts"
    - area: "pipeline-controller.md too large to read whole (33k tokens)"
      severity: "medium"
      mitigation: "Use offset+grep sampling; tag Axis 1/2 findings with [SAMPLED] where full read was impossible"
    - area: "Hook runtime behavior unverifiable from static analysis"
      severity: "medium"
      mitigation: "Tag static-analysis-only findings; note that Codex host may not execute hooks.json in all modes"
    - area: "Prior finding IDs inconsistent across corpus"
      severity: "low"
      mitigation: "Use stable regression matrix IDs (GAP-N, HAR-N, CAR-N, RND2-N, ADVER-N) defined above"

  systemic_patterns:
    - id: "SP-1"
      name: "Doc-Promise / Runtime-Silence Gap"
      axes: ["A1", "A2"]
    - id: "SP-2"
      name: "Fix-then-Regress Cycle"
      axes: ["A1", "A3"]
    - id: "SP-3"
      name: "Authority Fragmentation"
      axes: ["A1"]
    - id: "SP-4"
      name: "Emulation Theatre"
      axes: ["A2", "A6"]
    - id: "SP-5"
      name: "Parallel Universe Enforcement"
      axes: ["A3", "A4"]

  bounded_contexts:
    - context_name: "Orchestration"
      aggregate_root: "PipelineController"
      invariants:
        - "spawn_agent is the only valid agent dispatch in production mode"
        - "emulation is test-only (strictAgents = false = test mode)"
        - "one active orchestrator per session"
    - context_name: "Hook Enforcement"
      aggregate_root: "HookRegistry"
      invariants:
        - "every guarded tool call must pass through registered hooks"
        - "hook crash = deny (fail-closed)"
        - "Bash tool is a write-capable tool and must be guarded"
    - context_name: "Gate Governance"
      aggregate_root: "GateLog"
      invariants:
        - "append-only; controller-only writes"
        - "each gate has exactly one hardness level"
        - "MANDATORY gates must halt execution on fail, no bypass"
    - context_name: "Sentinel Validation"
      aggregate_root: "SentinelState"
      invariants:
        - "state written before every agent spawn"
        - "corrupted state = deny (fail-closed)"
        - "5 mandatory checkpoints must all be wired"
    - context_name: "Dispatch Contract"
      aggregate_root: "DispatchRequest"
      invariants:
        - "requireRealAgent=true requires agentRuntime adapter"
        - "emulation outputs must be flagged as emulated"
        - "freshContext is real context isolation, not a boolean flag"
    - context_name: "Test Harness"
      aggregate_root: "SingleAgentRunner"
      invariants:
        - "harness outputs are synthetic by construction"
        - "harness tests validate contract shape, not agent behavior"
        - "harness must not ship as production default"

  CHANGE_CONTRACT:
    allowed_files: []
    allowed_new_files:
      - ".pipeline/docs/Pre-Complex-action/2026-05-19-auditoria-pipeline-orchestrator-codex/per_axis_findings/axis-2-spawn-agent.md"
      - ".pipeline/docs/Pre-Complex-action/2026-05-19-auditoria-pipeline-orchestrator-codex/per_axis_findings/axis-1-authority-conflict.md"
      - ".pipeline/docs/Pre-Complex-action/2026-05-19-auditoria-pipeline-orchestrator-codex/per_axis_findings/axis-3-hook-enforcement.md"
      - ".pipeline/docs/Pre-Complex-action/2026-05-19-auditoria-pipeline-orchestrator-codex/per_axis_findings/axis-4-gate-hardness.md"
      - ".pipeline/docs/Pre-Complex-action/2026-05-19-auditoria-pipeline-orchestrator-codex/per_axis_findings/axis-5-sentinel-fidelity.md"
      - ".pipeline/docs/Pre-Complex-action/2026-05-19-auditoria-pipeline-orchestrator-codex/per_axis_findings/axis-6-test-validity.md"
      - ".pipeline/docs/Pre-Complex-action/2026-05-19-auditoria-pipeline-orchestrator-codex/regression_matrix.md"
      - ".pipeline/docs/Pre-Complex-action/2026-05-19-auditoria-pipeline-orchestrator-codex/systemic_patterns.md"
      - ".pipeline/docs/Pre-Complex-action/2026-05-19-auditoria-pipeline-orchestrator-codex/final_verdict.md"
      - ".pipeline/docs/Pre-Complex-action/2026-05-19-auditoria-pipeline-orchestrator-codex/roadmap.md"
    forbidden_files:
      - "package.json"
      - "package-lock.json"
      - "src/**"
      - "hooks/**"
      - "skills/**"
      - "agents/**"
      - "commands/**"
      - "references/**"
      - "tests/**"
    forbidden_change_types:
      - "unrequested_feature"
      - "unrelated_refactor"
      - "new_dependency_without_approval"
      - "public_api_contract_change_without_approval"
      - "schema_migration_without_approval"
      - "sensitive_config_change_without_approval"
      - "test_weakened_to_fit_implementation"
    diff_budget:
      max_files_expected: 10
      max_lines_expected: 1500
      new_abstractions_allowed: false
      new_modules_allowed: false
    escalation_required_if:
      - "Any auditor proposes to modify source files (src/, hooks/, skills/, agents/) rather than writing findings docs"
      - "Regression check reveals a REGRESSED finding that re-opens a critical security vulnerability"
      - "Axis 2 or 3 auditor finds a new critical finding not in the prior corpus"
    bootstrap:
      active: false
```
