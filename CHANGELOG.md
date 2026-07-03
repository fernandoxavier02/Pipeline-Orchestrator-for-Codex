# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.2] — 2026-07-03

### Codex hook-channel bugfix (bugfix-heavy)

Fixes the three root causes behind "the Codex agent does not obey the pipeline",
plus a deterministic recovery route from a governed-run deadlock.

- **completion-checklist.cjs (Stop):** short-circuit to `{continue:true}` when
  `stop_hook_active === true` (anti-loop, per the Codex Stop contract); blocking Stop
  output now also carries the Codex-native `{decision:"block", reason}` so the redirect
  instruction reaches the model instead of dying in a UI-only field.
- **force-pipeline-agents.cjs (UserPromptSubmit):** pipeline-worthy prompts are now
  advisory (`continue:true` + `hookSpecificOutput.additionalContext`) instead of a hard
  turn-kill; bootstrap state is armed only for an explicit
  `/pipeline-orchestrator-for-codex:` invocation.
- **edit-guard-hook.cjs:** single stateful POSIX-aware command scanner (NONE/SINGLE/DOUBLE
  + ANSI-C `$'…'` + backslash) replacing the backslash-blind regexes; read/write split
  (read-only Bash touching `.codex/pipeline` allowed, only writes to protected state denied);
  shared anti-chaining tokenizer; exact realpath+lstat allowlist for the escape scripts.
- **scripts/pipeline-reset.cjs (new):** deterministic escape route — removes exactly the
  five run-state files + `sessions/*.exec-window` under `.codex/pipeline`, never the ledgers;
  anti-symlink + path-traversal guards; emits the `pipeline_reset` audit event.
- **hooks/path-safety.cjs (new):** shared realpath-of-existing-ancestor helper.
- **src/hooks/pipeline-harness.ts:** removed the generic-slash-command branch (SSOT alignment
  with the CJS D4 behavior).
- **scripts/sync-codex-plugin-surfaces.ps1:** derives the cache version dir from the plugin
  manifest instead of a hard-coded path, so a version bump no longer desyncs the cache target.

## [0.5.1] — 2026-06-18

### Governance integrity release

Closes the runtime/Stop-hook parity gap found in adversarial review after the pipeline invocation enforcement work.

### Changed

- Sentinel HMAC verification now uses one canonical policy across TypeScript runtime, CLI, Stop hook, PreToolUse sentinel hook, and sentinel state writer.
- `PIPELINE_SENTINEL_HMAC_KEY` remains the sentinel-specific key when configured; otherwise sentinel signing and verification fall back to `PIPELINE_INTEGRITY_HMAC_KEY`, matching ledger integrity.
- README, manifest metadata, SessionStart banner, version consistency tests, and local project context now describe the HMAC-backed sentinel/ledger integrity chain.

### Tests

- Added focused runtime, CLI, Stop hook, sentinel hook, and sentinel writer coverage for shared-key sentinel integrity and unsigned/malformed sentinel rejection.

## [0.5.0] — 2026-05-19

### Trust restoration release

Implements `.kiro/specs/pipeline-trust-restoration/` (14 requirements, 4 checkpoints) to eliminate the "Emulation Theatre" — where `Review_Orchestrator` and `Final_Adversarial_Orchestrator` silently ran in local emulation when `strictAgents` was undefined and the fabricated verdicts were indistinguishable from real-agent reviews in `gate-decisions.jsonl`.

### Added

- **R1** — Central `recordGateDecision()` / `inferDecidedBy()` API in `src/state/gate-log.ts`. The writer is now the single authority for `decided_by` provenance. CI lint (`tests/unit/lint/decided-by-centralization.test.ts`) forbids new hardcoded literals outside the writer (Theme D defense).
- **R2** — `Confidence_Model` scans gate entries for `decided_by="system"` and caps `final_score` at `0.5` when any emulation is present. `confidence-score.yaml` now persists `confidenceSource: real | emulated | unknown` and `emulated_entry_count` so Pa de Cal output is post-mortem auditable.
- **R3** — Shared `resolveRequireRealAgent` in new `src/runtime/strict-resolution.ts` (DI-3 cascade SSOT). `Review_Orchestrator` and `Final_Adversarial_Orchestrator` now use the lazy `requireRealAgentForRequest` resolver — operational pipeline dispatches honour the safe cascade even when `strictAgents` is undefined.
- **R4** — `tests/integration/strict-agents-undefined.test.ts` with deterministic property loop (P2 Cascade Equivalence, 200 iterations).
- **R5** — `protocolEventSchema` accepts optional `dispatchMode: real | emulated | unknown`. `persistProtocolBlocksFromDispatch` and `processProtocolBlocksForParent` tag every `DISPATCH_REQUEST` event. Backward-compatible with legacy logs.
- **R6** — `sessionStateSchema` persists optional `strictAgents`. `createSessionStore(root, { strictAgents })` auto-injects defaults on every save. New `loadPersistedStrictAgents` helper; CLI `--continue` peeks the latest session before constructing the runtime so the flag survives resume.
- **R7** — New `src/adapters/codex-agent-runtime.ts`. `createCodexAgentRuntimeAdapter` bridges injected `spawn_agent` callables to the `AgentRuntimeAdapter` contract; `detectCodexAgentRuntime` probes `globalThis.spawn_agent`. `createPipelineRuntime` auto-detects and defaults `strictAgents = true` (R7 AC 7.2) with a console warning if the caller opts out (R7 AC 7.5).
- **R11** — `dispatch-guard.cjs` and `sentinel-hook.cjs` now emit canonical sanitized deny reasons (`hook internal error — failing closed` / `sentinel internal error — failing closed`). Raw exception messages, paths, and payloads stay in `stderr` only (AC 11.4). New outer try/catch in `sentinel-hook` covers non-object stdin. Integration suite covers 8 deterministic malformed inputs (Property P4 Hook Fail-Closed Universality).
- **R12** — `hooks.json` matcher now includes `Bash`. Hook logic was already Bash-aware; this PR wires the matcher and adds the end-to-end integration test.
- **R13** — `rejectSymlink` in `scripts/exec-window/open.cjs` throws `SymlinkRefusedError` with structured `err.code` and audited stderr line.

### Changed

- `agents/core/pipeline-controller.md` gains an `AUTHORITY_NOTE` header declaring `src/controller/pipeline-controller.ts` as operational SSOT and removes the stale "37 N2 agents" claim from frontmatter (R8).
- `src/gates/hardness-policy.ts` is documented as DEMOTED — `gate-registry.ts` is the static SSOT, hardness-policy is a dynamic classifier for `information-gate.ts` plus CI cross-check (R9).
- `references/openai-codex-kb/*` drift consolidated: `plugins.md`, `skills.md`, `agents-and-subagents.md`, `rules-hooks-agents-md.md` lose their bottom-appended Drift Notes (moved to new `CHANGELOG.kb.md`). Uniform `last_verified=2026-05-19` across the 4 drift-noted files and the SSOT (R10).

### Tests

- 56 new tests across 8 new files plus 4 extended files (gate-log centralization, confidence cap + P3 monotonicity, hook fail-closed + P4, strict-agents-undefined + P2 cascade, resume-strict-agents + P5 idempotence, protocol-events dispatchMode, gate-hardness consistency, adapter detection + AgentRuntimeUnavailable propagation, openai-codex-kb consolidation, agents-inventory AUTHORITY_NOTE).
- `npm run build`, `npm run lint:types`, full unit (509) and integration closeout/validation/review/execution/sentinel/hooks (88) pass.

### Out of scope (tracked separately)

- Refactor of `src/controller/pipeline-controller.ts` (1885 lines, works).
- Rewrite of `src/dispatcher/single-agent-runner.ts` (emulation runner is still the test foundation; remove after R7 adapter stabilises).

## [0.4.1] — 2026-05-07

### Added

- Spec lifecycle closure for `codex-harness-claude-absorption`: `spec-*` variants now block on required Kiro artifacts, AC traceability gaps, and registered `SPEC_*` gate decisions instead of relying on documentation-only promises.
- Four Spec lifecycle agents and runtime prompts: `spec-format-gate`, `spec-content-reviewer`, `spec-post-impl-validator`, and `spec-closer`.
- Hook frontmatter enforcement for governed pipeline skills, with deny decisions and audit events in `.codex/pipeline/hook-events.jsonl`.
- Execution identity tracing for Codex portability: `gate-decisions.jsonl`, `session.json`, `hook-events.jsonl`, real-agent dispatch requests, multi-agent child results, and dispatcher results now carry an `execution_identity` / `executionIdentity` payload with workflow-stable `trace_id`, per-surface `event_id`, plugin name/version, runtime, surface, cwd, pid, Node version, timestamp, and session/state context when available.

### Changed

- `/pipeline` skill parity now documents all gate-registry entries, including the Spec gates and adversarial-loop checkpoint.
- `exec-window` session files now use stable encoded filenames so Windows-safe logical session ids can contain `:` while path traversal remains blocked.
- The SessionStart banner and plugin manifest now advertise execution tracing so installed Codex copies can be distinguished from older `v0.4.0` builds.

## [0.4.0] — 2026-04-25

### CC v4.1.0-rc.1 parity upgrade — security middleware, sentinel wiring, atomic stores

This release lands the 11-batch upgrade described in
`docs/superpowers/specs/2026-04-24-codex-cc-parity-upgrade-design.md`.
The runtime now exposes governance behavior previously documented but
not enforced: a single-session lock, dispatch-namespace enforcement, an
exec-window edit-guard, all five sentinel checkpoints wired end to
end, and Stop-time cleanup.

### Added — security middleware (B1, B2, B3, B10)

- **B1 — session-lock** — `hooks/session-lock-hook.cjs` enforces a
  single active pipeline session per workspace via
  `.codex/pipeline/session-lock.json`. Honors SessionStart `source`
  semantics (startup / resume / clear). Atomic Windows-safe writes.
  Implementation: `src/security/session-lock.ts` (DDD value object).
- **B2 — edit-guard middleware** — `src/security/edit-guard.ts` is
  invoked from `runRole` and throws `EditGuardBlockedError` when a
  write-capable role (executor-implementer, executor-fix, …) is
  dispatched without an OPEN exec-window. Exec-window value object in
  `src/security/exec-window.ts` with OPEN / CLOSED / EXPIRED state
  classification, default 5 min TTL capped at 60 min. Path-traversal
  guard on `sessionId`. Disabled by default for legacy callers that do
  not provide `sessionRoot`/`sessionId` on `DispatchRequest`.
- **B3 — dispatch-guard** — `hooks/dispatch-guard.cjs` denies bare-leaf
  Agent dispatches and Skill calls that map to a pipeline agent leaf,
  pointing the caller at the codex-namespaced FQN. Backed by
  `src/security/dispatch-contract.ts` (`AGENT_LEAF_TO_FQN`).
- **B10 — session-cleanup** — `hooks/session-cleanup-hook.cjs`
  (Stop hook) sweeps expired session-lock and exec-window files.
  `src/state/atomic-write.ts` provides a Windows-safe whole-file
  helper used by `session-store.ts` and `confidence-score.ts`. The
  JSONL gate log now tolerates a syntactically truncated last line
  (crash recovery) while still rejecting Zod-invalid rows.

### Changed — sentinel + reduction policy wiring (B4, B5)

- **B4 — sentinel checkpoints 4 and 5** —
  `src/controller/pipeline-controller.ts` now writes `phase_2_to_3`
  when the executor returns an authoritative final-review marked
  approved/approved. `src/validation/final-validator.ts` exports
  `recordPostFinalValidatorCheckpoint(...)`, called from `closeout.finalize`
  in `src/index.ts` after the final-validator dispatch returns. Pairs
  with `SENTINEL_CHECKPOINT` gate-log entries for each transition.
  `markAuthoritativeFinalReviewResult` is now exported so tests can
  exercise the success branch.
- **B5 — HOTFIX policy is read at runtime** —
  `src/modes/mode-policy.ts` exposes `reductionPolicyForMode(mode)` and
  `isReducedValidation({mode, validationIntent})`. Eight call sites
  (information-gate, domain-checklists, adversarial-review,
  quality-gate-router, executor-controller [×2], single-agent-runner,
  pipeline-controller) now read `infoGate`, `tdd.minimumTests`,
  `batchSize`, `adversarialChecklists`, `forcedClassification` and
  `sanity.runFullRegression` from the policy instead of hard-coding
  literal `mode === "--hotfix"` checks. Behavior is byte-equivalent;
  the existing 8 BDD scenarios still pass.

### Added — controller / askUserQuestion / prompts (B6, B7, B8, B9)

- **B6 — askUserQuestion wired into proposal confirmation** —
  `src/controller/confirm-proposal.ts` exports
  `confirmProposalViaAsk({proposal, transport})` that builds a
  confirmation Question (yes/adjust/no), routes through
  `askUserQuestion`, and reduces the validated reply into a
  `ProposalConfirmation`. The legacy `confirmProposal(rawResponse)`
  remains for back-compat.
- **B7 — plan-mode rename** — `src/primitives/plan-mode.ts` →
  `src/primitives/plan-session.ts` (and matching test). Resolves the
  name collision with `src/controller/plan-mode.ts`
  (IMPLEMENTATION_PLAN artifact builder), which is unchanged.
- **B8 — pipeline-controller prompt** —
  `prompts/controller/pipeline-controller.md` rewritten from an
  11-line stub to a contract covering identity / FQN, tool allowlist,
  governance hook integration, exec-window protocol, sentinel
  checkpoints, phase routing, askUserQuestion wiring, the --hotfix
  policy, and the persisted-state contract. Preserves the
  `MODE / TYPE / COMPLEXITY / VARIANT / PROPOSAL` required output
  block validated by the prompt registry.
- **B9 — adversarial-quality-reviewer** — `agents/quality/adversarial-quality-reviewer.md`
  (rich reference doc) and `prompts/agents/quality/adversarial-quality-reviewer.md`
  (runtime stub). Six review dimensions (regression coverage, hidden
  side-effects, silent fallbacks, governance bypass, proposal drift,
  domain-specific risk). Registered in `src/prompts/prompt-registry.ts`
  REQUIRED_OUTPUT_BLOCKS.

### Added — JSONL sanitization (B11)

- **hooks/hook-events.cjs** — every free-text field that flows into
  `.codex/pipeline/hook-events.jsonl` is clamped at 200 chars
  (`HOOK_EVENT_DETAIL_MAX_CHARS`). Sanitization is applied at the hook
  layer; `gateDecisionSchema.detail` keeps `z.string()` without a
  `.max()` so historical entries still parse.

### Added

- Strict real-agent dispatch contract for pipeline roles. `runRole` can now require a real Codex agent adapter and fails with `AgentRuntimeUnavailableError` instead of silently using local emulation.
- Runtime option `strictAgents` plus `agentRuntime` adapter plumbing for hosts that can bridge to `spawn_agent`.
- Hook observability log at `.codex/pipeline/hook-events.jsonl` for `UserPromptSubmit`, `PreToolUse`, and `Stop` hook decisions.

### Changed

- `/pipeline` command and skill docs now state that `spawn_agent` is mandatory and that missing agent support must block as `blocked-no-agent-runtime`.
- `sentinel-hook.cjs` now understands the runtime camelCase `sentinel-state.json` schema (`pipelineActive`, `expectedNext`, `updatedAt`) while retaining legacy snake_case compatibility.
- README installation examples now reference version `0.3.0` and document strict real-agent enforcement plus hook audit logs.

## [0.3.0] — 2026-04-17

### Parity contracts release — CC v3.8.0 parity ships as types, documentation, and one runtime behavior change. Runtime consolidation is deferred (see Known Limitations).

### Changed — runtime behavior

- **GAP-05** — `commands/pipeline.md` frontmatter restored to include `Write, Glob, Grep, TodoWrite` in `allowed-tools` (previously `Skill, Read, Bash, Task` only). This is the **single user-observable runtime change** between `0.2.1` and `0.3.0`: Codex will now grant these tools without prompting when `/pipeline` is invoked.

### Added — parity contracts & documentation (no runtime behavior change)

These additions document what the Codex runtime SHOULD do to match CC v3.8.0. They ship as typed contracts, reference implementations, and tests. **They are not yet wired into the runtime execution path** — HOTFIX behavior, user confirmation, and plan mode continue to use the pre-existing scattered branches in `src/controller/*`, `src/gates/*`, `src/review/*`, and `src/execution/*`. See Known Limitations below.

- **GAP-02** — Controller semantics consolidated in `skills/pipeline/SKILL.md`: ANTI-PROMPT-INJECTION invariants, GATE REGISTRY (aligned with `src/gates/gate-registry.ts`), PHASE ROLLBACK PATHS (mirrors CC v3.8.0's 4-row table), GATE_DECISION_LOG format (aligned with `gateDecisionSchema` in `src/domain/pipeline-schemas.ts`). Skill is now a textual SSOT for documentation — runtime enforcement remains distributed.
- **GAP-03** — Typed `ReductionPolicy` + `hotfixReductionPolicy()` reference implementation in `src/modes/hotfix-mode.ts`, plus the HOTFIX reduction table in `skills/pipeline/SKILL.md`. **Note:** runtime HOTFIX behavior still lives in scattered `input.mode === "--hotfix"` branches across `src/controller/classification-overrides.ts`, `src/gates/information-gate.ts`, `src/review/domain-checklists.ts`, `src/review/adversarial-review.ts`, `src/execution/executor-controller.ts`, `src/execution/quality-gate-router.ts`, `src/dispatcher/single-agent-runner.ts`, `src/controller/pipeline-controller.ts`, and `src/index.ts`. These branches are byte-identical to `0.2.1`; `hotfixReductionPolicy()` is not yet consulted by the controller. Consolidation is a follow-up (issue #TBD-1).
- **GAP-06** — `src/primitives/ask-user-question.ts` — blocking question serializer with gate traceability + option validation. DDD value object contract. **Not yet wired:** `src/controller/confirm-proposal.ts` continues to parse responses inline. Follow-up (issue #TBD-2).
- **GAP-07** — `src/primitives/plan-mode.ts` — session-scoped write-attempt telemetry. Caller-voluntary by design because Codex cannot intercept tool calls the way CC does. **Not yet wired.** Note: this file does NOT replace `src/controller/plan-mode.ts` (different concern: ImplementationPlan artifact); name collision is tracked as issue #TBD-4.
- **GAP-07 (shared types)** — `src/primitives/primitive-types.ts` — zod-validated Question/Response/Interaction/PlanSession value objects exported as `Readonly<>` for compile-time immutability.
- **GAP-08** — Re-scoped: the `agents/` vs `prompts/agents/` split is intentional (`agents/` = CC-style rich reference docs, `prompts/agents/` = runtime stubs loaded by `src/prompts/prompt-registry.ts`). Added READMEs to both directories and `tests/unit/agents-inventory.test.ts` to prevent future naive consolidations that would break runtime dispatch.
- **BDD scenarios** — `tests/bdd/hotfix.feature.test.ts` covers 8 Given/When/Then scenarios asserting the shape of `hotfixReductionPolicy()`. These are data-shape tests; they verify the contract, not the runtime behavior.
- **Parity integration test** — `tests/integration/controller-parity.test.ts` verifies every gate name from `src/gates/gate-registry.ts` appears in `skills/pipeline/SKILL.md` (lint-style coupling guard).
- **Frontmatter parity test** — `tests/unit/frontmatter-parity.test.ts` guards the 8-tool `allowed-tools` contract against regressions.
- **Version consistency test** — `tests/unit/version-consistency.test.ts` pins `plugin.json`, `package.json`, `hooks.json` banner, and CHANGELOG entries to the same version string.

### Changed — metadata

- **GAP-01 (demoted)** — Version bumped `0.2.1 → 0.3.0` (MINOR). The initial plan targeted `1.0.0` for "parity release", but the 3-parallel adversarial review plus a follow-up Codex-specialist audit confirmed: no public API change in `src/index.ts` exports justifies SemVer MAJOR. `0.3.0` is additive-only (new modules, new tests, new docs, one tool-allowlist widening).
- SessionStart banner now mentions `v0.3.0` and explicitly discloses "runtime wiring deferred".

### Known Limitations (scheduled for follow-up)

These are documented gaps between what the SKILL/CHANGELOG text promises and what the runtime actually does. The distance is deliberate for `0.3.0` — the parity contracts are in place, but wiring them is a separate sprint to avoid regression risk in the 26 execution-routing integration tests.

- **JSONL `detail` sanitization is not code-enforced.** `skills/pipeline/SKILL.md` describes a "truncate to 200 chars, strip `\n`/`\r`" invariant. Today `gateDecisionSchema.detail = z.string()` with no `.max()` and no transform. This is mitigated by `JSON.stringify` already escaping control chars (so the one-object-per-line JSONL structural invariant holds via the serializer), and by the fact that `detail` only receives controller-owned deterministic strings today. Follow-up: #TBD-3 tightens the schema with a 2-line zod `.transform()`.
- **HOTFIX runtime behavior does not consult `hotfixReductionPolicy()`.** The policy and the runtime branches happen to agree on 7 of 11 fields today, but silent drift is possible. Follow-up: #TBD-1 consolidates call-sites through the typed policy.
- **`askUserQuestion` and `createPlanMode` are exported but not invoked from any runtime call-site.** The controller's real confirmation and plan-mode paths pre-date these primitives. Follow-ups: #TBD-2 (wire confirmation) and #TBD-4 (resolve plan-mode naming collision).

### Audit trail

- Initial audit: `docs/superpowers/plans/2026-04-17-pipeline-codex-parity.md` (plan) + `docs/audits/2026-04-17-v1.0.0-parity-findings/` (3-parallel + Codex-specialist audits).
- Specialist audit conclusion: SemVer MAJOR not justified; behavioral parity achievable via the SKILL/`spawn_agent` path; orphan `src/` modules are reference implementations pending integration.

## [0.2.1] — previous release

Legacy version. See git history for pre-parity changes.
