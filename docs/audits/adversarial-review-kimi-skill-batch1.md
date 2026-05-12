# Adversarial Review — Kimi Skill Port (Pós-Batch 1)

**Reviewer:** Kimi (self-review, adversarial mode)  
**Scope:** Changes applied in Batch 1 (C2, H6, L1, L4)  
**Date:** 2026-05-11  
**Method:** Static analysis + test validation

---

## Batch 1 Changes Applied

| Finding | Severity | Action | Status |
|---|---|---|---|
| C2 — Tool names mismatch | CRITICAL | Replaced `Read`→`ReadFile`, `Write`→`WriteFile`, `Bash`→`Shell` in controller | ✅ RESOLVED |
| C2 — Claude frontmatter fields | CRITICAL | Removed `tools:`, `model:`, `color:` from controller frontmatter | ✅ RESOLVED |
| H6 — `target_kind` vs `target_type` | HIGH | Removed `target_kind: agent`, kept `target_type: coder \| explore` | ✅ RESOLVED |
| L1 — Extra frontmatter fields | LOW | Stripped folded YAML (`>`) from pipeline description; verified all 6 skills have only `name` + `description` | ✅ RESOLVED |
| L4 — Slash-command mentions | LOW | Removed `/pipeline`, `/bugfix`, `/feature`, `/audit` from descriptions | ✅ RESOLVED |

---

## Test Results

```
Test Files  96 passed (96)
Tests       555 passed (555)
Duration    18.07s
```

New tests added: `tests/unit/kimi-skill/tool-names.test.ts` (16 tests, all passing).  
No regressions in existing 539 tests.

---

## Remaining Open Findings

| ID | Severity | Finding | Batch Target |
|---|---|---|---|
| C1 | CRITICAL | Agent prompts are empty templates (5-line generic vs 200-line canonical) | Batch 2 |
| C3 | CRITICAL | No deterministic exec-window (manual JSON write vs tested Node wrappers) | Batch 3 |
| C4 | CRITICAL | No hooks → subagent has unrestricted write access | Batch 3 |
| H1 | HIGH | `{{arguments}}` substitution unverified in Kimi | Batch 4 |
| H2 | HIGH | Reference paths hardcoded and potentially inaccessible | Batch 4 |
| H3 | HIGH | Review-orchestrator context isolation fragile | Batch 4 |
| H4 | HIGH | No controller failure handling | Batch 4 |
| H5 | HIGH | REVIEW-ONLY mode unimplemented | Batch 4 |
| M1 | MEDIUM | Controller prompt ~24KB (context pressure) | Batch 5 |
| M2 | MEDIUM | SetTodoList timing undefined | Batch 4 |
| M3 | MEDIUM | Zero tests for Kimi skill | Partially addressed (16 tests added) |
| M4 | MEDIUM | Protocol handler duplicated ×6 | Batch 4 |
| M5 | MEDIUM | `model: inherit` behavior unverified | Batch 5 |
| L2 | LOW | README.md inside skills directory | Batch 5 |
| L3 | LOW | Version inconsistency v1.0 vs v5.0.0 | Batch 5 |

**Open count:** 15 findings (4 CRITICAL, 5 HIGH, 4 MEDIUM, 2 LOW)

---

## New Concerns Introduced by Batch 1 Fixes

### NC1 — Controller frontmatter lost informative metadata

**Finding:** Removed `model: inherit` and `color: red` from controller frontmatter. While these are Claude-specific and non-functional in Kimi, they served as **human-readable documentation** about the intended model tier and visual identity. Their removal makes the controller file slightly less self-documenting.

**Severity:** LOW (cosmetic)
**Mitigation:** Add a comment in the controller body noting "This agent runs as a Kimi `coder` subagent."

### NC2 — Description length may hurt semantic triggering

**Finding:** After removing slash-command mentions and folded YAML, the `pipeline` description is now a single 280-character line. Kimi uses `description` for semantic skill matching. Very long descriptions may dilute trigger keywords.

**Severity:** LOW
**Mitigation:** Monitor triggering accuracy in real usage. If needed, split into shorter, keyword-dense description.

---

## Verdict

**Batch 1: PASS.** All 5 targeted findings resolved. 16 new tests green. Zero regressions. 15 findings remain open for subsequent batches.

**Overall skill status: Still NO-GO for production** (4 CRITICAL findings remain, including the behavioral collapse C1).

---

*Next: Batch 2 — Agent Prompts (C1).*
