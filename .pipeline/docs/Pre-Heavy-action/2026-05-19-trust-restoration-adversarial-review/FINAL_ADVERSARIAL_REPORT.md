# FINAL_ADVERSARIAL_REPORT — pipeline-trust-restoration

**Date:** 2026-05-19
**Scope:** commits `cc36aab` → `73436f8` → `2486e92` (3 commits, 44 source/test/hook/script files plus docs)
**Mode:** REVIEW-ONLY (report only, no fixes applied)
**Reviewers (parallel, zero implementation context):**

- `pipeline-orchestrator:executor:type-specific:adversarial-security-scanner`
- `pipeline-orchestrator:executor:type-specific:adversarial-architecture-critic`
- `pipeline-orchestrator:executor:type-specific:adversarial-quality-reviewer`

## Consolidated verdict

**Status: CRITICAL FINDINGS** — 1 critical that effectively reverts the spec's R3 fix at the review surfaces. 1 critical that breaks R2 honesty for intermediate confidence snapshots. 16 important findings spanning hook security, audit-trail integrity, and architectural seams. 9 minor findings.

The work that landed is broadly aligned with the spec's intent. The two critical issues are both inside code I wrote during the implementation (not pre-existing). They need to ship before v0.5.0 can be trusted in production.

## Cross-reviewer consensus (highest priority — multiple reviewers flagged the same root cause)

### **C1 — Probe Request pattern recreates the very R3 bug it was supposed to fix**

**Reviewers:** ARCH-002 (critical), QUAL-009 (minor — quality reviewer scoped it as clarity; architecture saw the real risk)
**Files:** `src/review/review-orchestrator.ts:91-110`, `src/review/final-adversarial-orchestrator.ts:157-169`
**Evidence (verified inline by the consolidator):**

- `resolveRequireRealAgent` (strict-resolution.ts:48-52) returns `request.requireRealAgent ?? options?.strictAgents ?? isOperationalPipelineDispatch(request)`.
- The orchestrators build a synthetic probe DispatchRequest with `requireRealAgent: false`.
- `false ?? options.strictAgents` evaluates to `false` (because `??` only short-circuits on `null`/`undefined`, and `false` is neither).
- Therefore **the cascade is bypassed at the review surfaces**: even when `strictAgents=true` AND `isOperationalPipelineDispatch` returns true, both Review_Orchestrator and Final_Adversarial_Orchestrator resolve `requireRealAgent` to `false` and dispatch through emulation.

This is exactly the "Emulation Theatre" pattern R3 was supposed to eliminate — recreated by the probe.

**Severity: CRITICAL.** R3 (Property P2 Cascade Equivalence) is violated at the two review surfaces in production deployments.

**Fix (3-line change per orchestrator):** Replace `requireRealAgent: false` with `requireRealAgent: undefined` (or remove the field entirely so the optional default kicks in). Then add a regression test that pins `strictAgents=true` + a no-adapter runtime and asserts `reviewBatch` / `reviewFinal` dispatch with `requireRealAgent=true` (currently silently passes because the probe wins).

### **C2 — Confidence snapshots persisted intermediately are computed over a partial gate slice**

**Reviewer:** ARCH-001 (critical)
**Files:** `src/controller/pipeline-controller.ts:1061-1064`, `src/index.ts:854-866` (closeout path is correct; the controller path is wrong)

`persistGateAndConfidence` calls `confidenceModel.apply({ baseScore, gates: entries })` where `entries` is only the batch just appended, not the full run-level gate log. After T2, the emulation-aware cap relies on the in-memory `gates` parameter containing every entry. Intermediate snapshots (saved to `confidence-score.yaml` between phases) therefore exclude prior emulated entries → the R2 cap never fires for those snapshots, and the score can decay then re-inflate as different slices flow through.

The closeout path (`src/index.ts:850-866`) does load `effectiveGateLog` from the union of persisted + appended — so the FINAL score is correct. Only the intermediate writes are wrong.

**Severity: CRITICAL.** R2 honesty guarantee is silently violated for every snapshot the controller saves before closeout. Operators reading `confidence-score.yaml` mid-run see inflated values.

**Fix:** in `persistGateAndConfidence`, read the existing gate log via `runtime.stores.gateLog.list()` (or the stateAdapter equivalent) and pass the UNION (existing + new entries) to `apply`. Alternatively, remove intermediate confidence saves and reserve `apply` for closeout — but that loses observability.

### **C3 — sanitizeDetail leaves NUL bytes and ANSI escapes**

**Reviewers:** SEC-011 (minor — security), QUAL-003 (important — quality)
**File:** `src/state/gate-log.ts:56-58`

The sanitizer only strips `\r` and `\n`. NUL bytes, tabs, vertical tabs, and ANSI escape sequences (`\x1b[...`) pass through and get written verbatim into the JSONL audit trail. Two failure modes converge:

- **JSONL corruption:** a NUL byte mid-line silently breaks C-string log readers.
- **Terminal escape injection:** an operator viewing `gate-decisions.jsonl` in a pager sees ANSI sequences applied (screen clear, color override). Adversarial agents can write detail strings that hide subsequent log entries.

**Severity: IMPORTANT (consensus).**

**Fix:** broaden the regex from `/[\r\n]+/g` to `/[\x00-\x1F\x7F]+/g`. Add a test with a NUL + ANSI escape fixture so future maintainers see the contract.

### **C4 — Windows symlink protection is untested on the development platform**

**Reviewers:** SEC-006 (important), QUAL-007 (minor)
**File:** `tests/integration/exec-window-symlink.test.ts:29-33`, `scripts/exec-window/open.cjs:42-66`

The test skips when `platform() === "win32"` because non-admin symlink creation requires developer-mode on Windows. Junction points (a Windows-specific reparse-point variant) bypass `lstat.isSymbolicLink()` entirely and have no compensating control. Given the dev/CI machine is `win32`, R13 AC 13.1-13.3 is effectively unverified on the primary platform.

**Severity: IMPORTANT.**

**Fix:** add a cross-platform unit test that mocks `fs.lstatSync` to return `{isSymbolicLink: () => true}` and asserts `rejectSymlink` throws `SYMLINK_REFUSED`. Add a junction-detection check (`isJunction` via `reparseTag`) or document the Windows limitation in the threat model.

## Security findings (single-reviewer)

| ID | Severity | File:line | Title |
|---|---|---|---|
| SEC-001 | important | hooks/sentinel-hook.cjs:340-343 | Divergence branch leaks `state_file_path` into user-visible deny reason (contract says "stderr only") |
| SEC-002 | important | hooks/sentinel-hook.cjs:316-325 | Suffix-match bypass — any FQN ending with an expected leaf token passes (cross-namespace bypass) |
| SEC-003 | important | src/state/gate-log.ts:62-94 | `mkdir` is outside `withAppendLock`; mutex is per-process so cross-process CLI runs can interleave JSONL writes |
| SEC-004 | important | src/runtime/strict-resolution.ts:18-26 | `isOperationalPipelineDispatch` returns `false` silently when `request.input.request` is not a string → confused-deputy emulation downgrade |
| SEC-005 | important | src/protocol/protocol-handler.ts:240-252 | `decisionFromSelectedLabel` defaults to `"pass"` for unknown labels → compromised agent can forge `decided_by: user`, `decision: pass` entries |
| SEC-007 | important | hooks/edit-guard-hook.cjs:28-41 | Bash matcher misses `dd of=`, `python -c "open(...,w)"`, `cat > file <<EOF`, `install`, `rsync --delete`, `truncate`, `ln -sf` |
| SEC-008 | important | src/adapters/codex-agent-runtime.ts:147-168 | `globalThis.spawn_agent` is read without integrity check → any earlier in-process code can hijack to exfiltrate dispatch payloads |
| SEC-009 | minor | src/state/session-store.ts:62-71 | `loadPersistedStrictAgents` swallows ALL errors → tampered session.json silently downgrades strictAgents across resumes |
| SEC-010 | minor | src/protocol/protocol-events.ts:131 | `BLOCK_PATTERN` regex on multi-megabyte agent output → ReDoS / event-loop block |

## Architecture findings (single-reviewer)

| ID | Severity | File:line | Title |
|---|---|---|---|
| ARCH-003 | important | src/state/gate-log.ts:44-45 | `Provenance.source="controller"` and `source="dispatch", dispatchMode="real"` both map to `decided_by="controller"` → two semantically distinct events collapse into one audit value (locks the schema before differentiating is cheap) |
| ARCH-004 | important | src/index.ts:486-498 | `createPipelineRuntime` rebinds its `options` parameter inside the body before any store is constructed → factory is no longer pure given its arguments |
| ARCH-005 | important | src/state/session-store.ts:14-16, src/controller/pipeline-controller.ts:933-938 | Persistence layer (session-store) now knows about `strictAgents` runtime concern. Two stores over the same root with different defaults will diverge on save |
| ARCH-006 | important | hooks/sentinel-hook.cjs:362-393 | Outer try/catch wraps `handleInput` which contains `process.exit(2)` for the circuit breaker. Today works by coincidence (exit is non-throwing), but any refactor to throw a CircuitBreaker error will silently get caught and downgraded to `deny+exit(0)` |
| ARCH-007 | minor | src/gates/stale-context.ts:1-3 | Gate module imports `inferDecidedBy` from the persistence writer → cross-layer dependency that erodes the SSOT boundary (gates should not know how to persist) |

## Quality findings (single-reviewer)

| ID | Severity | File:line | Title |
|---|---|---|---|
| QUAL-001 | important | src/adapters/codex-agent-runtime.ts:68-82 | `serializeRequest` manually projects fields → adding a field to `AgentDispatchRequest` silently drops it from the on-wire payload. Already omits `executionIdentity` with no rationale comment |
| QUAL-002 | important | src/review/{review,final-adversarial}-orchestrator.ts | Dual `requireRealAgent` (boolean) + `requireRealAgentForRequest` (callback) with no `@deprecated` and no removal timeline |
| QUAL-004 | important | scripts/exec-window/open.cjs:95-96, 110-112 | Duplicate TTL validation; the second check is dead code that will become live if `emitError` is ever refactored to not call `process.exit` |
| QUAL-005 | important | tests/unit/state/gate-log.test.ts:93-95, 160 | Tests hardcode literal `200` instead of importing `MAX_DETAIL_LENGTH`. `toBeLessThanOrEqual(200)` passes even for an empty string |
| QUAL-006 | minor | src/gates/confidence-model.ts:28, src/protocol/protocol-events.ts:67 | `ConfidenceSource = "unknown"` and `ProtocolDispatchMode = "unknown"` are declared but never produced by runtime — schema-forward variants with no comment explaining the intent |
| QUAL-008 | minor | tests/integration/strict-agents-undefined.test.ts:138-176 | P2 property test only checks idempotency (3 calls equal); it does NOT verify the cascade against a reference. A `() => false` regression would still pass |

## Systemic patterns observed (across reviewers)

1. **Fail-safe default inversion.** SEC-001 leaks paths by default, SEC-005 defaults to "pass" on unknown labels. The trust-restoration work succeeded at making *emulation* explicit but did not audit *other* decision defaults in the same modules for the same invariant.

2. **TypeScript-only safety, JavaScript laxity.** SEC-004 (`isOperationalPipelineDispatch` non-string fallback) and the dual-API in C1/QUAL-002 both rely on callers being well-typed. JS callers (or buggy upstream agents) can produce inputs that TypeScript can't model — these need runtime guards.

3. **Hooks vs `src/` coverage asymmetry.** The lint test (`tests/unit/lint/decided-by-centralization.test.ts`) scans only `src/**/*.ts`. Hooks (`hooks/**/*.cjs`) are exempt — a future CJS hook can hardcode `decided_by` literals and bypass the centralization invariant. The R10 KB consolidation test (R10 AC 10.2) similarly checks only the 4 drift-noted files; the other 5 KB files keep `last_verified: 2026-05-18` and remain out of the uniformity contract.

4. **Probe / synthetic-request anti-pattern.** ARCH-002 + QUAL-009 + ARCH (notes) all converged on this. The resolver was designed for `runtimeRunRole`, which has a real request. Reusing it at the orchestrator construction site — where no real request exists yet — forced the probe workaround. The structural fix is to evaluate `requireRealAgent` at dispatch time (not orchestrator construction time), which the current callback design *could* do but the probe shortcut undermines.

## Recommended remediation order

1. **C1 (probe bug)** — blocks v0.5.0 from delivering R3 in production. ~5 lines + 1 regression test.
2. **C2 (intermediate confidence)** — blocks R2 honesty for mid-run snapshots. Load union of gate entries in `persistGateAndConfidence`.
3. **C3 (sanitizeDetail control chars)** — small, low-risk hardening that covers SEC-011 and QUAL-003 in one diff.
4. **C4 (Windows symlink)** — add cross-platform unit test that mocks lstat, plus a junction-aware check or documented limitation.
5. **SEC-005 (decisionFromSelectedLabel default)** — important and pre-existing; fix-or-document needed before v0.5.0 claims trust restoration.
6. **SEC-002 (sentinel suffix bypass)** + **SEC-001 (path leak)** — both in `sentinel-hook.cjs`; remediate together.
7. **SEC-008 (globalThis hijack)** — capture-and-seal pattern at adapter detection time.
8. The remaining 9 important findings can land in a follow-up hardening PR.

## What is NOT broken (positive findings)

- The `inferDecidedBy` `never` branch is correctly defensive (QUAL notes).
- The R2 cap is implemented honestly in the closeout path (the C2 problem is intermediate-only).
- The hooks fail-closed canonical reason text matches the spec (R11 AC 11.1/11.2).
- The KB consolidation forward-pointers + CHANGELOG.kb.md cleanly preserve editorial history (R10).
- No security finding is "critical" by the reviewer's own classification — all are reachable with realistic effort but require either insider access (SEC-008, SEC-009), an adversarial agent (SEC-005, SEC-007, SEC-011), or a race (SEC-003, SEC-006).
- The Property P3 (Confidence Monotonicity) and P4 (Hook Fail-Closed Universality) tests are sound by structure even though P2 is weak.

---

End of FINAL_ADVERSARIAL_REPORT.
