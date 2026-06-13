# Adversarial Review: Canonical v7 Portability Closeout

## Status

Round 1 was a manual fallback review, not a valid pipeline execution.

The original attempted official `/pipeline-orchestrator-for-codex:pipeline` adversarial run was blocked before the controller could be dispatched. A later retry on 2026-06-12 showed the same operational class of failure in the active installed cache: the repository hook had a narrow stale-bootstrap allow path, but the Codex runtime was executing the installed cache hook, which did not contain that repo-local fix.

Structured status:

```yaml
pipeline_valid: false
status: SUPERSEDED_BY_RETRY
reason: round-1-blocked-by-sentinel-stale-pending-decision
blocked_by: SENTINEL_CHECKPOINT
manual_fallback_allowed: true
manual_fallback_counts_as_pipeline: false
runtime_fix_status: repo-implemented-cache-drift-observed
```

## Runtime Evidence

The first attempt to dispatch `pipeline-orchestrator-for-codex:core:pipeline-controller` was denied by the then-current sentinel hook.

The sentinel diagnostic agent reported that `.codex/pipeline/sentinel-state.json` was not tracking this spec review. It was tracking an older pipeline session:

- `currentPhase: phase-1`
- `currentAgent: pipeline-controller`
- `expectedNext: ["proposal-response"]`
- `pendingDecision: proposal-confirmation`
- older task: `--no-plan:implement complex workflow boundary`

At that time, starting a fresh pipeline controller directly would have violated the current sentinel sequence. This was a real workflow block, not a false positive.

Follow-up runtime correction in the repository:

- `hooks/sentinel-hook.cjs` now allows only the narrow stale bootstrap shape: stale state, `currentPhase: phase-1`, `expectedNext` containing `proposal-response`, and target `pipeline-controller`.
- Fresh active proposal state still blocks `pipeline-controller`.
- Stale later-phase state, such as `expectedNext: ["final-validator"]`, still blocks `pipeline-controller`.
- Non-controller divergence still blocks, even when state is stale.
- The allow path records telemetry but does not mutate `sentinel-state.json`.
- `hooks/session-cleanup-hook.cjs` preserves active `sentinel-state.json`; final sentinel finalization remains owned by `src/validation/final-validator.ts`.

2026-06-12 retry evidence:

- Observed in this session, not valid as official pipeline closeout proof: active `.codex/pipeline/sentinel-state.json` pointed to stale task `full:build new dashboard`, still waiting for `proposal-response`.
- Observed in the sentinel diagnostic output, not attached as standalone proof here: the installed hook used by Codex came from `C:\Users\win\.codex\plugins\cache\fx-studio-ai\pipeline-orchestrator-for-codex\0.5.0`, not directly from the repository source.
- Local artifact created during remediation: `.codex/pipeline/archive/stale-build-new-dashboard-20260611-230440/repair-summary.json` records archival of the stale proposal before retrying the controller.
- Observed through parent-session tool result, not valid as official pipeline closeout proof: after archival, `spawn_agent` accepted `pipeline-orchestrator-for-codex:core:pipeline-controller`, proving only that the immediate sentinel sequence block was cleared for this session.

Focused validation:

- `npm test -- tests/unit/hooks/sentinel-hook.test.ts tests/unit/hooks/session-cleanup-hook.test.ts` passed with 20 tests.

## Review Inputs

Reviewed files:

- `docs/GAP_ANALYSIS_CANONICAL_VS_CODEX.md`
- `.kiro/specs/canonical-v7-portability-closeout/spec.json`
- `.kiro/specs/canonical-v7-portability-closeout/research.md`
- `.kiro/specs/canonical-v7-portability-closeout/requirements.md`
- `.kiro/specs/canonical-v7-portability-closeout/design.md`
- `.kiro/specs/canonical-v7-portability-closeout/tasks.md`
- `skills/pipeline/SKILL.md`
- `commands/pipeline.md`
- `references/openai-codex-kb/INDEX.md`
- `references/openai-codex-kb/plugin-build-guide.md`
- `references/openai-codex-kb/skills.md`
- `references/openai-codex-kb/agents-and-subagents.md`
- `C:\Users\win\.codex\skills\.system\plugin-creator\SKILL.md`
- `C:\Users\win\.codex\skills\.system\skill-creator\SKILL.md`

Independent reviewers:

- Sentinel diagnostic agent: diagnosed pipeline block.
- Adversarial document reviewer: reviewed spec coherence and runtime claims.
- Project standards reviewer: reviewed Codex harness/plugin/skill alignment.

## Round 1 Verdict

NO-GO for direct implementation until the high findings below are corrected.

The spec is useful as a planning map, but it still has enough harness-level ambiguity to allow future false parity claims or implementation against non-public Codex surfaces.

## Round 1 High Findings

Status after remediation: the findings below are historical Round 1 findings. The current `requirements.md`, `design.md`, `tasks.md`, and `research.md` have been updated to address them; final status depends on the fresh independent review round.

### H1: "Block or degrade" conflicts with the fail-closed pipeline contract

Affected lines at Round 1 time:

- `requirements.md`: Requirement 5 AC 5 allows block or honest degradation when real parallel `spawn_agent` is unavailable.
- `design.md`: Execution maturity notes allow honest block/degrade.
- `tasks.md`: Task 5.6 allows unavailable host support to block/degrade.

Why this is a problem:

The public pipeline contract requires `spawn_agent`, `wait_agent`, artifact collection, gate recording, hook/checkpoint recording, and structured final state. If mandatory runtime capability is missing, the official pipeline must return `blocked-no-agent-runtime`. Manual fallback or harness emulation can be useful, but it cannot count as a valid pipeline execution.

Required correction applied:

- Replace operational "block or degrade" language with:
  - operational path: `BLOCKED` with `blocked-no-agent-runtime`;
  - diagnostic/test harness path: allowed only when explicit and must report `pipeline_valid: false`;
  - manual review: must be labeled `manual_fallback_not_pipeline`.

### H2: `commands/**` is treated as a possible public plugin surface

Affected lines at Round 1 time:

- `requirements.md`: Requirement 3 AC 5 mentions public command layer updates.
- `design.md`: Public Skill Surface lists `commands/user-story.md` and `commands/ux-sim.md`.
- `tasks.md`: Task 3.6 says commands may be added if kept thin.

Why this is a problem:

The Codex plugin schema does not treat `commands/foo.md` as public slash commands. New public behavior should ship as plugin skills through `plugin.json:skills`. Existing `commands/pipeline.md` may serve as local compatibility/shim documentation, but new commands should not be a delivery criterion for plugin availability.

Required correction applied:

- Remove new `commands/user-story.md` and `commands/ux-sim.md` as targets.
- State that public user-facing surfaces are `skills/<name>/SKILL.md` plus manifest/cache/smoke proof.
- If command files are retained, label them compatibility/documentation only, not Codex plugin public entrypoints.

### H3: Hook enforcement lacks an active-hook proof gate

Affected areas at Round 1 time:

- Scope Lock and Sentinel enforcement in Requirement 4 and design component 4.4.
- Plan Mode dispatch guard in Requirement 5 and design component 4.5.
- Observability hooks and stop fidelity report in Requirement 6 and design component 4.6.

Why this is a problem:

This repository distinguishes hook files, hook tests, plugin-bundled hooks, repo-local `.codex/**` hooks, and actually trusted/active hooks. The spec requires hook-backed enforcement but does not require every affected wave to prove the hook is registered, trusted/active, compatible with the current Codex hook schema, and capable of denying/logging in a smoke check.

Required correction applied:

- Add wave-level active-hook proof:
  - hook path registered from the correct layer;
  - enforcement hooks use `type: "command"`;
  - hook trust/activation is verified where applicable;
  - smoke proves deny/log behavior;
  - if active hook proof is absent, closeout may claim repo/test only, not runtime enforcement.

### H4: Gate and hardness migration misses schema/protocol compatibility work

Affected lines at Round 1 time:

- `requirements.md`: Requirement 2 ACs for 35 gates and `AUDIT` hardness.
- `design.md`: Foundation Runtime Layer.
- `tasks.md`: Task 2.2 and 2.3.

Why this is a problem:

Current runtime and validation surfaces still include hardness unions with four values and older gate-registry/protocol assumptions. Adding 35 gates and `AUDIT` is not just adding registry entries. It touches schemas, validators, protocol mappings, old fixtures, log compatibility, and final validation.

Required correction applied:

- Add an explicit migration subtask before adding gate entries:
  - update hardness types and schemas;
  - update final validator assumptions;
  - update protocol gate mapping docs/tests;
  - add compatibility handling for older `gate-decisions.jsonl`;
  - test `AUDIT` as non-blocking.

### H5: Internal agent prompts and real Codex custom subagents are not separated clearly enough

Affected lines at Round 1 time:

- `design.md`: `agents/brainstorm/step-01b-alternatives.md`.
- `tasks.md`: 10-agent Plan Mode roster.

Why this is a problem:

Markdown files under `agents/**` are internal role prompts consumed by this plugin runtime. Codex custom subagents are TOML files under `.codex/agents/` or personal agent config. A Markdown role prompt does not prove the Codex host can spawn that role.

Required correction applied:

- Rename Markdown targets as "internal role prompts".
- If real Codex custom subagents are required, add `.codex/agents/*.toml` targets, load/selection tests, and host `spawn_agent` smoke proof.
- Make the Plan Mode roster's layer explicit: internal roster vs Codex custom subagent roster.

## Round 1 Medium Findings

### M1: Task wording still assumes gaps are open

The spec says "verify before porting", which is correct, but many executable tasks still say "Add" or "Implement" directly.

Required correction:

- Make Task 1 a hard gate before every wave.
- Rename wave tasks to `Verify / Adapt / Add if missing`.
- Each wave should be allowed to close items as already implemented with evidence instead of writing duplicate code.

### M2: `spec.json` overstates readiness for a multi-month implementation

Affected fields:

- `status: "tasks-generated"`
- `next_phase: "implementation"`
- `auto_approved_by_user_request: true`
- estimated effort: `10-16 weeks`

Why this is a problem:

Auto-approval of spec artifacts should not be interpreted as approval to execute all six waves. The pipeline contract still requires workflow/method gate and user approval before execution.

Required correction:

- Change status language to `ready-for-wave-gate` or equivalent.
- Add per-wave user approval gates before implementation.
- Keep `auto_approved_by_user_request` scoped to generation of spec artifacts only.

### M3: Closeout omits mandatory front-door package metadata

Affected area:

- `design.md` closeout component and Task 9.

Why this is a problem:

The active plugin front door includes `.codex-plugin/plugin.json`, `package.json`, marketplace metadata, installed cache, and user-facing hook/prompt text. The current plugin manifest still advertises v0.5/v5.2-era messaging, while the spec targets v7.12 portability.

Required correction:

- Add `.codex-plugin/plugin.json`, `package.json`, marketplace entry, installed cache path, and `hooks/hooks.json` user-facing text to closeout checks.
- Require either update or explicit deferral after runtime and cache smoke proof.
- Do not claim plugin v7.12 availability until metadata and cache proof match.

### M4: Validation matrix is too generic for plugin/skill work

Affected areas:

- `tasks.md` wave validation steps.
- `design.md` testing strategy.

Required correction:

Add a mandatory validation matrix:

- plugin manifest schema and referenced path existence;
- new skill folder name equals frontmatter `name`;
- new skill has tight `description`;
- governed workflow skills are validated by repo tests/hooks, not only generic `skill-creator` validation;
- hook enforcement uses `type: "command"`;
- hook deny-path tests exist;
- dispatch/trigger tests prove the public skill surface;
- Eval Gate passes.

## Low Finding

### L1: `plugin-creator` and local KB disagree about plugin manifest hooks

The system `plugin-creator` skill says to omit unsupported manifest fields including `hooks`, while this repository's consolidated `plugin-build-guide.md` says `plugin.json:hooks` is valid and already used by this plugin.

Resolution:

- Treat `references/openai-codex-kb/plugin-build-guide.md` as the local SSOT for this repository unless current official docs prove drift.
- Record this conflict in the spec so future implementation does not "fix" the plugin by removing valid bundled hooks.

## Required Remediation Before Implementation

1. Fix H1-H5 in `requirements.md`, `design.md`, `tasks.md`, and `spec.json`.
2. Add the validation matrix from M4.
3. Update the closeout component to include manifest/package/cache/front-door metadata.
4. Re-run this adversarial review after corrections.
5. Run full validation and Eval Gate after the stale-bootstrap hook fix before attempting a valid official pipeline closeout claim.

## Round 1 Final Decision Superseded

```yaml
final_verdict: SUPERSEDED_BY_REMEDIATION
pipeline_valid: false
manual_review_useful: true
manual_review_counts_as_pipeline: false
implementation_allowed_now: false
next_action: "Use the corrected spec artifacts as input for a fresh independent adversarial review round."
```

## Round 2 Status

```yaml
round: 2
status: SUPERSEDED_BY_ROUND_4
pipeline_controller_dispatch: accepted-after-stale-state-archive
review_mode: real-subagent-review-from-parent-session-not-official-pipeline-run
final_verdict: SUPERSEDED
implementation_allowed_now: false
required_exit_condition: "zero findings from fresh specialized Codex harness architecture, engineering quality, and plugin execution adaptability reviewers"
```

## Round 2 Findings Applied

The first fresh review pass after remediation found remaining gaps in cross-wave review fail-closed behavior, status alignment, Task 10 gate placement, complete-portability proof, canonical-version regression timing, and Codex-native equivalence criteria. A later final-review pass found missing proof detail for real subagent review evidence, final-review fail-closed wording in Task 10.7, inconsistent wave validation commands, and missing skill description trigger-quality checks. These have been patched into `spec.json`, `requirements.md`, `design.md`, `tasks.md`, and this review artifact.

## Round 3 Runtime Evidence

This review used real Codex subagents from the parent session, but it is not represented as an official end-to-end Pipeline Orchestrator run because the controller protocol did not emit a complete `PIPELINE COMPLETE` artifact with canonical `protocol-events.jsonl` and `gate-decisions.jsonl` closeout for this review.

```yaml
pipeline_valid: false
manual_review_useful: true
manual_review_counts_as_pipeline: false
subagent_review_evidence:
  controller_agent_id: "019eb993-3c36-7b10-b0f9-47c9ab0e471e"
  final_architecture_agent_id: "019eb99f-8676-78d2-a445-68575a134177"
  final_standards_agent_id: "019eb9a0-27b9-7d73-813a-68b135b8c304"
  final_document_agent_id: "019eb9a0-6ab1-7590-90b6-43188ebe7dda"
  wait_agent_observed: true
  close_agent_observed_for_prior_agents: true
official_pipeline_closeout_artifacts:
  pipeline_complete_block: missing
  protocol_events_closeout: missing
  gate_decisions_closeout: missing
official_pipeline_status: blocked-for-closeout-evidence
```

## Round 4 Final Specialized Review

```yaml
round: 4
review_mode: real-subagent-review-from-parent-session-not-official-pipeline-run
architecture_agent_id: "019eb9a6-a242-7621-8d96-697413d68011"
project_standards_agent_id: "019eb9a6-f324-7c53-9b47-415446059336"
document_coherence_agent_id: "019eb9a7-495f-72f3-8376-107bb6887ad2"
wait_agent_observed: true
architecture_result: ZERO FINDINGS
project_standards_result: ZERO FINDINGS
document_coherence_result: ZERO FINDINGS
final_verdict: GO_FOR_WAVE_GATE
pipeline_valid: false
manual_review_useful: true
manual_review_counts_as_pipeline: false
implementation_allowed_now: false
next_action: "Open a separate workflow/method gate before executing any implementation wave."
```

This final review clears the Kiro spec artifact for the next wave gate. It does not prove repository implementation, package publication, installed-cache activation, or live plugin smoke behavior.
