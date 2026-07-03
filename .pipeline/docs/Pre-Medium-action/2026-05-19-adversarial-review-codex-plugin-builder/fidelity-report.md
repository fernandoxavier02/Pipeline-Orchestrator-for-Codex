# Fidelity Report — 2026-05-19-adversarial-review-codex-plugin-builder

> Per-run fidelity snapshot. Higher is better. `null` means "no gate data was found, so the score is not defined" (NOT zero).

## Summary

- **Run ID:** 2026-05-19-adversarial-review-codex-plugin-builder
- **Pipeline doc:** D:\Pipeline Orchestrator for Codex\.pipeline\docs\Pre-Medium-action\2026-05-19-adversarial-review-codex-plugin-builder
- **Type / Complexity / Variant:** Audit / MEDIA / review-only
- **Mandatory gates triggered:** 0 / 13
- **Fidelity score:** 0.0000
- **Global fidelity (cross-run, last 30 days):** 0.00% — sourced from `.pipeline/run-log.jsonl`

## Mandatory Gates Coverage

| Gate | Hardness | Expected? | Triggered? | Decision |
|------|----------|-----------|------------|----------|
| STATE_FILE_INIT_FAIL | — | yes | NO | — |
| INFO_GATE_BLOCKED | — | yes | NO | — |
| TDD_APPROVAL | — | yes | NO | — |
| CHECKPOINT_FAIL | — | yes | NO | — |
| COMPLEXITY_GATE | — | yes | NO | — |
| CLOSEOUT_CONFIRM | — | yes | NO | — |
| PLAN_REJECTED | — | yes | NO | — |
| ADVERSARIAL_GATE | — | yes | NO | — |
| ADVERSARIAL_BLOCK | — | yes | NO | — |
| FIX_LOOP_EXHAUSTED | — | yes | NO | — |
| ADVERSARIAL_LOOP_BREAKER | — | yes | NO | — |
| MICRO_GATE_GAP | — | yes | NO | — |
| STOP_RULE | — | yes | NO | — |

## Non-Mandatory Gates Observed

| Gate | Hardness | Decision | Detail (truncated) |
|------|----------|----------|--------------------|
| FINAL_ADVERSARIAL_GATE | SOFT | (invalid) | 3 scanners ran serially (security/architecture/quality); 27 findings, no Critical, 6 High consolidated as 5 actionable recs |

## Warnings

- decision "PROCEEDED" not in canonical set for gate FINAL_ADVERSARIAL_GATE — normalized to (invalid)
- decision "COMPLETED" not in canonical set for gate FINAL_ADVERSARIAL_GATE — normalized to (invalid)
- brainstorm evidence missing: no STEP_1_7_ROUTING entry for MEDIA/Audit run

## See Also

- `gate-decisions.jsonl` — raw per-run gate log
- `.pipeline/run-log.jsonl` — cross-run accumulated log
- `references/gates.md` — gates registry + mandatory-by-complexity table
