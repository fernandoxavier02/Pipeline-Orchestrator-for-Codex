# 06 — Final Validation (Pa de Cal) — Batch 3 closure

- **Run:** 2026-07-02-codex-hook-channel-bugfix
- **Scope validated:** Batch 3 only (edit-guard read/write split + script allowlist + anti-chaining + `scripts/pipeline-reset.cjs`). Batches 1+2 already committed/pushed in `41d0286`.
- **Date:** 2026-07-03

## Decision: CONDITIONAL

Code-level criteria for Batch 3 are all green. Decision is CONDITIONAL rather
than GO solely because of pre-existing gate-ledger anomalies in
`gate-decisions.jsonl` (predate Batch 3, already partially self-disclosed in
`CONTINUE-HERE.md`, no code impact). These do not block commit/push — same
precedent already applied to the Batch 1+2 Pa de Cal in this run
(sentinel_log `2026-07-03T06:20:00Z`).

## Evidence (commands run, this session)

| Check | Command | Result |
|---|---|---|
| Build | `npm run build` | PASS (tsc clean, no output) |
| Types | `npm run lint:types` | PASS (tsc --noEmit clean, no output) |
| Tests | `npx vitest run tests/unit/hooks/ tests/unit/security/` | PASS — 19 files, **472/472 tests**, incl. `edit-guard-hook.test.ts` (67) and `pipeline-reset.test.ts` (4) |
| Scope | `git status --short` / `git diff --stat` | Exactly 5 files: `hooks/edit-guard-hook.cjs` (M), `hooks/path-safety.cjs` (A), `scripts/pipeline-reset.cjs` (A), `tests/unit/hooks/edit-guard-hook.test.ts` (M), `tests/unit/security/pipeline-reset.test.ts` (A). `dist/` untouched. +1173/-57 lines. |
| Adversarial | `04-review-batch-3.md` | PASS_WITH_WARNINGS, action_required=NONE. 0 Critical/Important, F1-F7 findings from prior attempts all CLOSED and test-proven; remaining items are Minor/Accepted-Ceiling (documented static-analysis limits) + non-blocking architecture backlog ARCH-R1..R4. |
| Regression | anti-regression assertions in test suite + review doc | PASS — `echo "mv a b"`, `npm install`/`pip3 install`, arrow strings (`->`/`=>`), read-only `.codex/pipeline` reads all still ALLOWED; no false positives found. |

## Gate ledger audit (`gate-decisions.jsonl`, 16 entries, whole run)

- All gate **names present in the registry** (`references/gates.md`,
  `src/gates/gate-registry.ts`) have **hardness matching the registry exactly**:
  `COMPLEXITY_GATE` SOFT, `SENTINEL_CHECKPOINT` HARD, `INFO_GATE_OK` SOFT,
  `DESIGN_INTERROGATION` SOFT, `PLAN_REJECTED` HARD, `TDD_APPROVAL` HARD,
  `CHECKPOINT_FAIL` HARD, `ADVERSARIAL_GATE_MANDATORY` MANDATORY,
  `ADVERSARIAL_GATE` SOFT, `FIX_LOOP_EXHAUSTED` CIRCUIT_BREAKER,
  `STEP_1_7_ROUTING` HARD — no tampering signal on any of these.
- **Anomaly A (pre-existing, predates Batch 1):** the `STEP_1_7_ROUTING` line
  (hardness HARD) carries `decision: "SKIPPED"`, `decided_by:
  "step-ledger-stamp"`, `detail: branch="no-prep-override"`. None of these
  values are producible by the real writer
  (`createStep17RoutingGate` in `src/controller/pipeline-controller.ts` only
  ever emits `decision:"pass"`; `inferDecidedBy` only ever returns
  `user|controller|resume-router|system`). This is a hand-authored
  state-recovery narrative artifact (see `CONTINUE-HERE.md` and
  `sentinel_log[0]`: "controller recovery: state re-created after signature
  invalidated by manual Edit"), not evidence that Step 1.7 routing was
  actually bypassed — the equivalent real checkpoints (phase-1 proposal,
  design-interrogation, TDD approval) are all present and user-confirmed
  (lines 6-8). Under strict ledger rules a HARD gate showing `SKIPPED` is a
  hard NO-GO trigger in isolation; applying that literally here would
  misrepresent Batch 3, which this artifact has nothing to do with. Flagged,
  not treated as a code defect.
- **Anomaly B (new finding this session):** 3 `HUMAN_GATE` entries (lines 6,
  15, 16; hardness `AUDIT`) use a gate name that does not appear anywhere in
  the 42-row registry (`references/gates.md`) or in any writer in
  `src/`/`hooks/` — hardness cannot be cross-validated against a
  nonexistent registry row. Likely an ad hoc label the controller-agent used
  to log `AskUserQuestion` confirmations outside the formal gate set.
- **Informational, systemic, unrelated to Batch 3:** the repo's own
  auto-generated `fidelity-report.md` flags every lowercase decision value
  (`pass`/`partial`/`block`) emitted by
  `pipeline-controller.ts#toGateLogEntry` as `(invalid)` against its
  canonical decision vocabulary. This is a pre-existing SSOT drift between
  the controller's decision enum and the canonical `GateDecisionEntry`
  schema, worth its own hygiene ticket — not something this batch touches.
- No MANDATORY/SOFT gate shows an undisclosed skip; no HUMAN_GATE was itself
  contradicted by a later reversal.

## Confidence / Fidelity (advisory)

- `confidence_score` (sentinel-state.json): 0.85 → HIGH zone (>= 0.80).
- Recomputed gate penalty from `confidence_impact` sum across all 16 entries:
  **-0.30**, entirely from the single `FIX_LOOP_EXHAUSTED` circuit-breaker
  entry (the exhausted first Batch-3 attempt cycle, superseded by the
  successful redo). Consistent with the narrative; no discrepancy beyond
  0.01 worth flagging as a separate cross-check issue.
- Fidelity score: 0.3889 (7/18 mandatory gates triggered) — informational,
  does not override the binary checks above.

## Pending items (non-blocking)

1. Gate-ledger hygiene: stop hand-authoring `gate-decisions.jsonl` lines
   outside the real writer during state recovery (Anomaly A); either register
   `HUMAN_GATE` formally in `references/gates.md` or rename it to an existing
   registered gate (Anomaly B).
2. Align `pipeline-controller.ts#toGateLogEntry`'s decision enum
   (`pass|block|skip|partial`) with the canonical `GateDecisionEntry`
   vocabulary the fidelity reporter enforces, or update the reporter — pick
   one SSOT.
3. Already-logged, out of this run's scope: `src/hooks/pipeline-harness.ts`
   generic-slash bootstrap divergence (D4); architecture backlog ARCH-R1..R4
   from `04-review-batch-3.md`; `.codex-plugin/plugin.json` version bump
   (cache path hard-coded at 0.5.1, sync script out of scope).

## Files modified (this batch)

- `hooks/edit-guard-hook.cjs`
- `hooks/path-safety.cjs` (new)
- `scripts/pipeline-reset.cjs` (new)
- `tests/unit/hooks/edit-guard-hook.test.ts`
- `tests/unit/security/pipeline-reset.test.ts` (new)
