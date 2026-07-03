# Fidelity Report — 2026-07-02-codex-hook-channel-bugfix

> Per-run fidelity snapshot. Higher is better. `null` means "no gate data was found, so the score is not defined" (NOT zero).

## Summary

- **Run ID:** 2026-07-02-codex-hook-channel-bugfix
- **Pipeline doc:** D:\Pipeline Orchestrator for Codex\.pipeline\docs\Pre-Medium-action\2026-07-02-codex-hook-channel-bugfix
- **Type / Complexity / Variant:** Bug Fix / COMPLEXA / bugfix-heavy
- **Mandatory gates triggered:** 8 / 18
- **Fidelity score:** 0.4444
- **Global fidelity (cross-run, last 30 days):** 20.83% — sourced from `.pipeline/run-log.jsonl`

## Mandatory Gates Coverage

| Gate | Hardness | Expected? | Triggered? | Decision |
|------|----------|-----------|------------|----------|
| STATE_FILE_INIT_FAIL | — | yes | NO | — |
| INFO_GATE_BLOCKED | — | yes | NO | — |
| TDD_APPROVAL | HARD | yes | yes | (invalid) |
| CHECKPOINT_FAIL | HARD | yes | yes | (invalid) |
| COMPLEXITY_GATE | SOFT | yes | yes | (invalid) |
| CLOSEOUT_CONFIRM | SOFT | yes | yes | (invalid) |
| PLAN_REJECTED | HARD | yes | yes | (invalid) |
| ADVERSARIAL_GATE | SOFT | yes | yes | (invalid) |
| ADVERSARIAL_BLOCK | — | yes | NO | — |
| MICRO_GATE_GAP | — | yes | NO | — |
| STOP_RULE | — | yes | NO | — |
| ADVERSARIAL_LOOP_BREAKER | — | yes | NO | — |
| FINAL_ADVERSARIAL_GATE | — | yes | NO | — |
| FINAL_ADVERSARIAL_REWORK | — | yes | NO | — |
| FIX_LOOP_EXHAUSTED | CIRCUIT_BREAKER | yes | yes | (invalid) |
| ADVERSARIAL_GATE_MANDATORY | MANDATORY | yes | yes | (invalid) |
| SSOT_CONFLICT | — | yes | NO | — |
| STALE_CONTEXT | — | yes | NO | — |

## Non-Mandatory Gates Observed

| Gate | Hardness | Decision | Detail (truncated) |
|------|----------|----------|--------------------|
| STEP_1_7_ROUTING | HARD | SKIPPED | branch="no-prep-override"; prep_run_id=null |
| SENTINEL_CHECKPOINT | HARD | (invalid) | ORCHESTRATOR_VALIDATION PASS 6/6 checks (agent ab18a14c43549bd57) after one state-recovery correction. |
| INFO_GATE_OK | SOFT | (invalid) | INFORMATION_GATE RESOLVED: 3/3 gaps resolved from repo evidence, 0 blockers (02-information-gate.md). |
| DESIGN_INTERROGATION | SOFT | (invalid) | 9 decisions: 2 self-answered, 7 recommended pending Phase 1 confirmation (03-design-interrogation.md). Non-blocking. |
| HUMAN_GATE | AUDIT | CONFIRMED | tool_use_id=toolu_013srohNfs8HgSsLHFCKVEQq answer={"questions":[{"question":"O dev-harness (plugin 8.20.0 que governa ESTA sessão) entrou em deadlock no modo CONTINUE: nenhuma ferramenta de escrita... |

## Warnings

- decision "pass" not in canonical set for gate COMPLEXITY_GATE — normalized to (invalid)
- decision "pass" not in canonical set for gate SENTINEL_CHECKPOINT — normalized to (invalid)
- decision "pass" not in canonical set for gate INFO_GATE_OK — normalized to (invalid)
- decision "partial" not in canonical set for gate DESIGN_INTERROGATION — normalized to (invalid)
- decision "pass" not in canonical set for gate PLAN_REJECTED — normalized to (invalid)
- decision "pass" not in canonical set for gate TDD_APPROVAL — normalized to (invalid)
- decision "pass" not in canonical set for gate CHECKPOINT_FAIL — normalized to (invalid)
- decision "pass" not in canonical set for gate ADVERSARIAL_GATE_MANDATORY — normalized to (invalid)
- decision "pass" not in canonical set for gate ADVERSARIAL_GATE — normalized to (invalid)
- decision "pass" not in canonical set for gate ADVERSARIAL_GATE_MANDATORY — normalized to (invalid)
- decision "pass" not in canonical set for gate ADVERSARIAL_GATE — normalized to (invalid)
- decision "block" not in canonical set for gate FIX_LOOP_EXHAUSTED — normalized to (invalid)
- decision "pass" not in canonical set for gate ADVERSARIAL_GATE — normalized to (invalid)
- decision "pass" not in canonical set for gate CLOSEOUT_CONFIRM — normalized to (invalid)

## See Also

- `gate-decisions.jsonl` — raw per-run gate log
- `.pipeline/run-log.jsonl` — cross-run accumulated log
- `references/gates.md` — gates registry + mandatory-by-complexity table
