# Phase 2 Batch 3 — Audit Compliance Checker (Axes 3,4,5,6 + handoff leads)

**Agent:** audit-compliance-checker
**Status:** COMPLETE
**Severity:** 3 CRITICAL · 2 HIGH · 3 MEDIUM · 5 LOW

## Axis 3 — Hooks

- 10 hook files on disk; 7 bound in hooks.json. 3 unbound are library modules (governed-workflows.cjs, hook-events.cjs, hooks.json itself) — DESIGN.
- `dispatch-guard.cjs` `PIPELINE_AGENT_LEAVES`: 45 entries = matches filesystem (45 .md files excl. README).
- `governed-workflows.cjs` `GOVERNED_SKILLS`: 23 skills covered, comprehensive. Gap: no "diagnostic" entry (LOW, hypothesis).
- **HOOK-001 (MEDIUM)** — `PreToolUse:Skill` binding has only `dispatch-guard.cjs` (no sentinel-hook). dispatch-guard DOES deny pipeline-agent-leaf Skill calls (line 381-402), but sentinel sequence-validation (expectedNext state machine) is NOT applied. Governed Skill orchestrations are sentinel-blind.

## Axis 4 — Gates

- gate-registry.ts: **26 gates** (inline invariant claims 22). 4 gates added: ADVERSARIAL_LOOP_CHECKPOINT, SPEC_AC_TRACEABILITY_GAP, SPEC_POST_IMPL_FAIL, SENTINEL_SEQUENCE_BLOCK.
- **GATE-002 (MEDIUM)** — `hardness-policy.ts` `classifyGateHardness()` utility is UNUSED by gate-registry.ts. Each gate's hardness is a literal string. Two sources can diverge silently — no CI test enforces consistency.
- **GATE-003 (LOW)** — `SENTINEL_CHECKPOINT` classified HARD but `defaultDecision=pass`, `rollback=none` → behaves identically to SOFT. Misleading classification.
- Spot-checks: `SSOT_CONFLICT` (MANDATORY) properly enforced via sentinel + controller. `ADVERSARIAL_GATE` (SOFT, -0.15 on skip) consistent. `STOP_RULE` (CIRCUIT_BREAKER) fires via sentinel-hook at 3 consecutive corrections.

## Axis 5 — Sentinel fidelity

- agent prompt documents 3 modes (ORCHESTRATOR/SEQUENCE/COHERENCE_VALIDATION) + 5 spec checkpoints — all consistent with `src/sentinel/sentinel-state.ts` schema (Zod-validated).
- **SENT-001 (LOW)** — `sentinel-state.ts:15` uses `writeFile()` directly, NOT atomic-write. Partial-write on crash → hook fail-closes (safe degradation), but lacks the atomic-write protection that `gate-log.ts` uses.
- **SENT-002 (MEDIUM)** — Hook discovery priority: PIPELINE_DOC_PATH env → `.codex/pipeline/sentinel-state.json` → mtime scan. The mtime fallback can cross-contaminate concurrent sessions (no session-ID cross-check).

## Axis 6 — Test coverage

- **TEST-001 (CRITICAL)** — No test for `strictAgents=undefined → review-orchestrator emulation → gate-log decided_by` (H1 vector untested).
- **TEST-002 (CRITICAL)** — No test for `strictAgents=undefined → final-adversarial-orchestrator emulation`.
- **TEST-003 (CRITICAL)** — No test verifies `decided_by='system'` is emitted on emulation (the schema HAS that value, but no code writes it).
- **TEST-004 (HIGH)** — No test for resume-pipeline + strictAgents loss.

Existing BDD tests cover `strictAgents=true` (correctly blocks) and `strictAgents=false` (allows fallback) but NOT `strictAgents=undefined` — which is exactly the production default.

## Handoff lead answers

| Lead | Answer | Severity |
| --- | --- | --- |
| 1. `decided_by=system` for emulation? | **NO.** Schema has `system` value but never assigned. `index.ts:45,967` hardcodes `decided_by="controller"`. **Gate-decisions.jsonl CANNOT distinguish emulated from real.** | CRITICAL |
| 2. Confidence penalty for emulation? | **NO.** Model is purely arithmetic. No `decided_by` check. Silent emulation → 0 penalty. | CRITICAL |
| 3. Agent count reconciliation | **Ground truth: 45.** Filesystem + dispatch-guard + manifest all agree. `agents/core/pipeline-controller.md:3` says "37 N2 agents" — STALE (predates spec agents). | LOW |
| 4. resume-pipeline + strictAgents | **NO** persistence/recovery. strictAgents is a RuntimeOptions field, not session-persisted. Resume silently degrades. | HIGH |
| 5. protocol-events.jsonl dispatchMode | **NO.** Schema has no `dispatchMode`. Observability for emulation vs real is TRACE.md only (human-readable, not queryable). | HIGH |

## Severity summary

- **3 CRITICAL** — TEST-001, TEST-002, TEST-003 (H1 emulation traceability fully untested + decided_by never written)
- **2 HIGH** — HOOK-001 (Skill sentinel gap), TEST-004 (resume strictAgents loss); plus Lead-5 (protocol-events no dispatchMode)
- **3 MEDIUM** — GATE-002 (hardness divergence risk), SENT-002 (mtime scan cross-contamination)
- **5 LOW** — HOOK-002, GATE-001, GATE-003, SENT-001, agent-count stale doc

## Handoff to risk-matrix-generator

H1 is now **TRIPLY confirmed and DEEPENED**:
- silent emulation in review/final-adversarial paths (Domain analyzer)
- emulated verdicts are INDISTINGUISHABLE in gate-log (Compliance lead 1)
- no confidence penalty for emulation (Compliance lead 2)
- 3 critical tests missing on this exact path (TEST-001/002/003)

Authority Fragmentation pattern grows to 6 sources (adding gate-registry vs hardness-policy divergence as 6th).
