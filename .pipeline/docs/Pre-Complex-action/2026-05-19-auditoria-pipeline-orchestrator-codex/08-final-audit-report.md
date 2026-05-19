# AUDIT_REPORT — Pipeline Orchestrator for Codex v0.4.1

**Date:** 2026-05-19
**Corpus:** 5 prior reports, 6 audit axes, 42 prior findings regression-checked
**Total findings:** 42 (9 CRITICAL, 14 HIGH, 12 MEDIUM, 7 LOW)
**Tagged:** 35 [VERIFIED], 5 [HYPOTHESIS], 2 [DESIGN]

---

## 1. VERDICT

**Overall Severity: CRITICAL**
**Confidence: HIGH** (35 VERIFIED findings with file:line evidence across 5 independent audit passes)

**Single-sentence finding:** The plugin's core quality guarantee — independent adversarial multi-agent review — is silently replaced by deterministic local heuristics on every default invocation, and the fabricated verdicts are indistinguishable from real ones in every persisted audit log.

**Safe to run as-is:** **NO** (unconditional)
**Recommended user posture:** fix-then-use — specifically, the `requireRealAgent` default and `decided_by` audit trail must be corrected before any pipeline output can be trusted as evidence of real review.

**What works:** State management, gate registry, hook wiring infrastructure, plan-mode translation, and structural scaffolding are sound. The plugin is **not broken** — it is structurally complete but semantically hollow on its most important contract.

---

## 2. REGRESSION_MATRIX (sample by pattern; 42 prior findings)

### Pattern C — Emulation Theatre (STILL_OPEN / DEEPENED)

| Finding | Source | Sev | Status | Evidence |
| --- | --- | --- | --- | --- |
| CAR-08 | CONSOLIDATED_ADV_REVIEW | CRITICAL | STILL_OPEN + DEEPENED | `src/index.ts:691,701` — `=== true` drops cascade fallback |
| CAR-09 | CONSOLIDATED_ADV_REVIEW | CRITICAL | STILL_OPEN | `src/dispatcher/multi-agent-runner.ts:62-118` — Promise.all over local fns |
| CAR-10 | CONSOLIDATED_ADV_REVIEW | CRITICAL | STILL_OPEN | `src/dispatcher/single-agent-runner.ts:43-114` — heuristic review |
| CAR-12 | CONSOLIDATED_ADV_REVIEW | CRITICAL | STILL_OPEN | `agents/core/pipeline-controller.md` never spawned |
| CHAR-03 | CODEX_HARNESS_ADEQUACY | CRITICAL | STILL_OPEN | "multi-agent" = parallel local emulation |
| CHAR-07 | CODEX_HARNESS_ADEQUACY | CRITICAL | STILL_OPEN + NEW DEPTH | `decided_by` hardcoded `controller` — `src/index.ts:45,967` |

### Pattern A — Doc-Promise / Runtime-Silence Gap (STILL_OPEN)

| Finding | Source | Sev | Status | Evidence |
| --- | --- | --- | --- | --- |
| CAR-06 | CONSOLIDATED_ADV_REVIEW | CRITICAL | STILL_OPEN | SKILL.md:34 "ALWAYS call spawn_agent" — runtime ignores when strictAgents undefined |
| CANON-GAP3 | AUDIT_CODEX_VS_CANONICAL | HIGH | STILL_OPEN | `src/index.ts:445` `strictAgents ?? false` |
| CHAR-04 | CODEX_HARNESS_ADEQUACY | HIGH | STILL_OPEN | Error msg references config.toml that plugin never reads |

### Pattern B — Authority Fragmentation (STILL_OPEN, grew from 3 → 6 sources)

| Finding | Source | Sev | Status | Evidence |
| --- | --- | --- | --- | --- |
| CAR-06-auth | CONSOLIDATED_ADV_REVIEW | CRITICAL | STILL_OPEN | 6 competing SSOT sources (was 3) |
| CANON-GAP1 | AUDIT_CODEX_VS_CANONICAL | HIGH | STILL_OPEN | `agents/core/pipeline-controller.md` (1470 lines) dead |
| CANON-GAP4 | AUDIT_CODEX_VS_CANONICAL | HIGH | STILL_OPEN | `sentinel.md` 193 vs canonical 239 lines |

### Security cluster (STILL_OPEN)

| Finding | Sev | Status | Evidence |
| --- | --- | --- | --- |
| CAR-01 (Bash bypass) | CRITICAL | STILL_OPEN | `hooks/edit-guard-hook.cjs:24` — only guards Edit/Write |
| CAR-02 (symlink) | CRITICAL | STILL_OPEN | `scripts/exec-window/open.cjs:81,95` — no lstat |
| CAR-03 (dispatch fail-open) | CRITICAL | STILL_OPEN | `hooks/dispatch-guard.cjs:391-402` — silent allow on exception |
| CAR-04 (sentinel fail-open) | CRITICAL | STILL_OPEN | `hooks/sentinel-hook.cjs:108-112,181-184` — corrupted = exit 0 |

### Closed / Refuted

| Finding | Status | Evidence |
| --- | --- | --- |
| H3 (phase_2_to_3 label missing) | CLOSED (refuted with nuance) | Label EXISTS at `pipeline-controller.ts:466` — but trust compromised by upstream H1 |
| GAP-15 (EnterPlanMode) | CLOSED (justified) | Codex has no native EnterPlanMode; PLAN_MODE_REQUEST is correct adaptation |
| CHAR-05 (plan mode) | CLOSED | `src/controller/plan-mode.ts` correctly implements |

---

## 3. NEW FINDINGS BY AXIS

### Axis 1 — Authority / SSOT

| ID | Description | Sev |
| --- | --- | --- |
| AUDIT-001 | `agents/core/pipeline-controller.md` is dead documentation — 1470 lines never spawned by default runtime | HIGH |
| AUDIT-002 | 6 competing authority sources: SKILL/agent-md/TS-controller/index.ts (3 inconsistent sites)/gate-registry/hardness-policy | HIGH |
| AUDIT-003 | `references/gates.md` does not exist — controller spec redirects to non-existent file | MEDIUM |
| AUDIT-004 | Agent count: pipeline-controller.md frontmatter says 37; actual = 45 | LOW |

### Axis 2 — strictAgents / Dispatch Integrity

| ID | Description | Sev |
| --- | --- | --- |
| AUDIT-005 | H1 CONFIRMED: review/final-adversarial orchestrators built with `=== true` strict equality | CRITICAL |
| AUDIT-006 | H4 CONFIRMED: Guard at `pipeline-controller.ts:1107` never fires | HIGH |
| AUDIT-007 | 3 inconsistent `requireRealAgent` sites in `src/index.ts:548,691,701` | CRITICAL |
| AUDIT-008 | `strictAgents?: boolean` optional in `pipeline-types.ts:42` — production footgun | HIGH |

### Axis 3 — Hooks

| ID | Description | Sev |
| --- | --- | --- |
| AUDIT-009 | H2: `PreToolUse:Skill` has only dispatch-guard — sentinel sequence bypassed | MEDIUM |
| AUDIT-010 | `assets/templates/hooks.json` references 5 non-shipping .cjs files | HIGH |
| AUDIT-011 | `assets/templates/hook-deny.cjs:51-54` — parse catch calls `allow()` | HIGH |
| AUDIT-012 | governed-workflows.cjs has no "diagnostic" entry | LOW |

### Axis 4 — Gates

| ID | Description | Sev |
| --- | --- | --- |
| AUDIT-013 | 26 gates in registry vs 22 in inline invariant — 4 added silently | MEDIUM |
| AUDIT-014 | hardness-policy.ts classifyGateHardness() unused — 2 hardness sources can diverge | MEDIUM |
| AUDIT-015 | SENTINEL_CHECKPOINT classified HARD but behaves as SOFT | LOW |

### Axis 5 — Sentinel

| ID | Description | Sev |
| --- | --- | --- |
| AUDIT-016 | phase_2_to_3 checkpoint trusts H1's fabricated "approved" verdict | HIGH |
| AUDIT-017 | sentinel-state.ts uses writeFile() not atomic-write | LOW |
| AUDIT-018 | mtime fallback can cross-contaminate concurrent sessions | MEDIUM |
| AUDIT-019 | Resume-pipeline silently loses strictAgents | HIGH |

### Axis 6 — Test Coverage / Observability

| ID | Description | Sev |
| --- | --- | --- |
| AUDIT-020 | Zero test for `strictAgents=undefined → review emulation → gate-log` | CRITICAL |
| AUDIT-021 | Zero test for `strictAgents=undefined → final-adversarial emulation` | CRITICAL |
| AUDIT-022 | Schema has `decided_by='system'` but no code ever writes it | CRITICAL |
| AUDIT-023 | protocol-events.jsonl has no dispatchMode field | HIGH |
| AUDIT-024 | Confidence model applies no penalty for emulated dispatches | CRITICAL |

---

## 4. SYSTEMIC PATTERNS

### Pattern A — Doc-Promise / Runtime-Silence Gap
**Definition:** Documented contract is stated as guarantee; runtime default silently violates it with no observable difference to the user.
**Findings grouped:** AUDIT-005, AUDIT-007, AUDIT-008, CAR-06, CANON-GAP3, CHAR-04, CAR-22 (7 instances)
**Pattern-level remediation:** Single canonical `RuntimeOptions` default of `strictAgents: true` with explicit opt-out requiring a code change (not omission). Pre-flight check that verifies actual agentRuntime availability before accepting pipeline invocation.
**Expected impact:** Eliminates entire emulation-by-default footgun. AUDIT-020..024 become unreachable.

### Pattern B — Authority Fragmentation
**Definition:** Multiple files each claim SSOT for same concept; they disagree; no mechanical sync.
**Findings grouped:** AUDIT-001..004, AUDIT-013, AUDIT-014, ADV-C4, CAR-06
**Competing sources:** SKILL.md, pipeline-controller.md (DEAD 1470 lines), pipeline-controller.ts (1885 lines), index.ts (3 inconsistent resolution sites), gate-registry.ts, hardness-policy.ts
**Pattern-level remediation:** One authoritative file per concept; archive/tombstone duplicates; CI test enforcement of consistency.
**Expected impact:** Closes AUDIT-001..004; reduces fix-then-regress cycle.

### Pattern C — Emulation Theatre (MOST SEVERE)
**Definition:** System fabricates multi-agent review verdicts locally, stamps them identically to real outputs, emits indistinguishable into gate logs. Downstream decisions treat fabrications as authoritative.
**Findings grouped:** AUDIT-005, AUDIT-007, AUDIT-020, AUDIT-021, AUDIT-022, AUDIT-024, CAR-08, CAR-09, CAR-10, CAR-12, CHAR-03, CHAR-07 (12 findings)
**Pattern-level remediation (3 concurrent):**
1. Write `decided_by='system'` for all emulated dispatches in gate-decisions.jsonl
2. Cap confidence score to ≤0.5 when `decided_by='system'` entries exist
3. Make `createReviewOrchestrator` and `createFinalAdversarialOrchestrator` inherit the cascade fallback at `src/index.ts:548` instead of `=== true` strict equality
**Expected impact:** Even if emulation remains, outputs become distinguishable, auditable, penalized.

### Pattern D — Fix-then-Regress Cycle
**Definition:** Fixes committed but underlying structural cause not addressed → same class reappears.
**Findings grouped:** CAR-18, CAR-24, AUDIT-006, AUDIT-014
**Evidence:** Git log shows "Harden", "Enforce", "Streamline" on same files containing open critical findings.
**Pattern-level remediation:** Requires Pattern A fix as prerequisite.

---

## 5. REMEDIATION_ROADMAP

### P0 — Immediate (before any pipeline output is trusted)

1. **P0-1 — Write `decided_by='system'` for emulated dispatches** (small / hours-1d). Files: `src/index.ts:920-951`, `src/state/gate-log.ts`. Closes AUDIT-022, CHAR-07, CAR-10.
2. **P0-2 — Cap confidence score when emulation entries exist** (small / hours). File: `src/gates/confidence-model.ts`. Closes AUDIT-024, CAR-23.
3. **P0-3 — Fix fail-open hooks** (small / hours each). Files: `hooks/dispatch-guard.cjs:391-402`, `hooks/sentinel-hook.cjs:108-112,181-184`. Wrap in try/catch → `deny("internal-error")`. Closes CAR-03, CAR-04.

### P1 — Current sprint

1. **P1-1 — Fix `requireRealAgent` cascade for review/adversarial orchestrators** (hours). File: `src/index.ts:691,699-701`. Replace `=== true` with `?? options.strictAgents ?? isOperationalPipelineDispatch(request)`. Closes AUDIT-005, AUDIT-007, CAR-08.
2. **P1-2 — Write 3 missing critical tests for H1 emulation path** (2-3 days). Closes AUDIT-020/021, TEST-001/002/003.
3. **P1-3 — Add `dispatchMode` to protocol-events.jsonl schema** (hours). File: `src/state/protocol-events.ts`. Closes AUDIT-023, CAR-22.
4. **P1-4 — Fix Bash tool write bypass in edit-guard** (hours). File: `hooks/edit-guard-hook.cjs`. Closes CAR-01.
5. **P1-5 — Fix symlink attack in exec-window** (hours). File: `scripts/exec-window/open.cjs:81,95`. Closes CAR-02.
6. **P1-6 — Fix ghost hooks in template + flip hook-deny.cjs default** (hours). Files: `assets/templates/hooks.json`, `assets/templates/hook-deny.cjs:51-54`. Closes ADV-C1, ADV-C2, AUDIT-010, AUDIT-011.
7. **P1-7 — Persist strictAgents to session.json + test resume** (1 day). File: `src/continue/resume-pipeline.ts`. Closes AUDIT-019, TEST-004.

### P2 — Next cycle (structural)

1. **P2-1 — Resolve `pipeline-controller.md` authority** (weeks; requires real spawn_agent adapter). Either restore as primary N1 path OR officially tombstone with AUTHORITY_NOTE header. Closes AUDIT-001, CANON-GAP1, CAR-12, CAR-07.
2. **P2-2 — Ship native agentRuntime adapter** (weeks). New `src/adapters/codex-agent-runtime.ts`. Set `strictAgents: true` as default in `createPipelineRuntime`. Closes AUDIT-005..008, CAR-08, CAR-09, CANON-GAP3, CHAR-02.
3. **P2-3 — Unify gate hardness authority** (1 day). Files: `gate-registry.ts`, `hardness-policy.ts`. Pick one; enforce in CI. Closes AUDIT-013, AUDIT-014.
4. **P2-4 — KB/documentation SSOT consolidation** (1 week). Designate one authoritative corpus; tombstone others. Closes ADV-C4, AUDIT-003, AUDIT-004, CAR-22.

### Do NOT change

- `src/state/gate-log.ts` atomic write — already correct; refactor risk
- `hooks/dispatch-guard.cjs` PIPELINE_AGENT_LEAVES — ground truth
- `src/gates/gate-registry.ts` gate name strings — persisted in JSONL
- `src/sentinel/sentinel-state.ts` Zod schema — stable, hook depends on it
- `src/dispatcher/single-agent-runner.ts` — CI foundation; remove only after P2-2 ships

---

## APPENDIX — Top 24 risks ordered by score

| Rank | ID | Description | Imp | Prob | Score | Class |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | AUDIT-022 | Emulated/real verdicts indistinguishable in gate-log | 5 | 5 | 25 | CRITICAL |
| 1 | AUDIT-024 | Confidence no penalty for fabrications | 5 | 5 | 25 | CRITICAL |
| 1 | AUDIT-005 | Review/adversarial silently emulate by default | 5 | 5 | 25 | CRITICAL |
| 1 | AUDIT-020 | Zero test for strictAgents=undefined emulation | 5 | 5 | 25 | CRITICAL |
| 5 | AUDIT-007 | 3 inconsistent requireRealAgent sites | 4 | 5 | 20 | CRITICAL |
| 5 | AUDIT-010 | Ghost hooks template — runtime file-not-found | 4 | 5 | 20 | CRITICAL |
| 5 | AUDIT-001 | Dead 1470-line pipeline-controller.md | 4 | 5 | 20 | CRITICAL |
| 5 | CAR-01 | Bash bypasses edit-guard entirely | 5 | 4 | 20 | CRITICAL |
| 5 | CAR-03 | dispatch-guard fail-open on exception | 5 | 4 | 20 | CRITICAL |
| 5 | CAR-04 | sentinel-hook fail-open on corrupted state | 5 | 4 | 20 | CRITICAL |
| 11 | AUDIT-019 | Resume silently loses strictAgents | 4 | 4 | 16 | HIGH |
| 11 | AUDIT-011 | hook-deny.cjs template fail-open default | 4 | 4 | 16 | HIGH |
| 13 | CAR-02 | Symlink attack in exec-window | 5 | 3 | 15 | HIGH |
| 13 | AUDIT-023 | protocol-events no dispatchMode | 3 | 5 | 15 | HIGH |
| 15 | AUDIT-013 | 4 undocumented gates in registry | 3 | 4 | 12 | HIGH |
| 15 | CAR-15 | Unknown roles default to approved | 4 | 3 | 12 | HIGH |
| 17 | AUDIT-003 | references/gates.md does not exist | 2 | 5 | 10 | MEDIUM |
| 18 | AUDIT-014 | hardness-policy unused — divergence possible | 3 | 3 | 9 | MEDIUM |
| 18 | AUDIT-009 | Skill bypasses sentinel sequence | 3 | 3 | 9 | MEDIUM |
| 20 | AUDIT-018 | mtime fallback cross-contaminates sessions | 3 | 2 | 6 | MEDIUM |
| 21 | AUDIT-015 | SENTINEL_CHECKPOINT mislabeled hardness | 1 | 5 | 5 | LOW |
| 21 | AUDIT-004 | Agent count stale (37 vs 45) | 1 | 5 | 5 | LOW |
| 23 | AUDIT-017 | sentinel-state non-atomic | 2 | 2 | 4 | LOW |
| 24 | AUDIT-012 | diagnostic skill ungoverned | 1 | 3 | 3 | LOW |
