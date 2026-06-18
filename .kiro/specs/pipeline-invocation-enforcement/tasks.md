# Implementation Plan: Pipeline Invocation Enforcement

## Task Summary

- 10 major task groups.
- 36 executable subtasks.
- Requirements covered: 1.1-10.5.
- Scope: implementation plan only; no runtime patch is part of this spec generation step.

## Tasks

### 1. Establish Baseline And Failing Coverage

- [ ] 1.1 Add a hook config static test for `SessionStart`
  _Requirements: 2.1, 2.3, 9.1_
  _Boundary: HookConfigValidation_
  - Done when the test fails against `hooks/hooks.json` if `SessionStart` executable context uses `type: "prompt"`.
  - Done when the failure message points to `type: "command"` as expected remediation.

- [ ] 1.2 Add front-door classification tests for trivial, explicit and pipeline-worthy prompts
  _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 3.1, 9.2_
  _Boundary: FrontDoorPromptEnforcement_
  - Done when trivial chat is allowed.
  - Done when explicit governed workflow is not blocked.
  - Done when non-canonical pipeline-worthy prompt is blocked before inline work.

- [ ] 1.3 Add Stop hook regression tests for missing artifact and blocked artifact
  _Requirements: 6.1, 6.2, 6.3, 6.4, 9.4_
  _Boundary: StopEvidenceEnforcement_
  - Done when a completion claim without artifact is denied.
  - Done when structured `BLOCKED` with `manual_fallback_counts_as_pipeline=false` is allowed.

- [ ] 1.4 Add gate taxonomy parity test
  _Requirements: 7.1, 7.2, 7.3, 7.4, 9.5_
  _Boundary: GateTaxonomy_
  - Done when every final artifact required gate either exists in `gate-registry.ts` or maps to registered runtime gates.

### 2. Replace SessionStart Prompt With Executable Context

- [ ] 2.1 Create `hooks/session-start-context.cjs`
  _Requirements: 2.1, 2.2, 2.4_
  _Boundary: SessionStartContext_
  - Done when the script emits structured context describing real-agent requirement, blocked runtime behavior and hook trust boundary.
  - Done when it uses only Node.js builtins.

- [ ] 2.2 Update `hooks/hooks.json` to use the SessionStart command handler
  _Requirements: 2.1, 2.3_
  _Boundary: HookConfigValidation_
  _Depends: 2.1_
  - Done when `SessionStart` points to `node "${PLUGIN_ROOT}/hooks/session-start-context.cjs"`.
  - Done when the static hook config test passes.

- [ ] 2.3 Add a focused test for SessionStart context output
  _Requirements: 2.2, 2.4, 2.5_
  _Boundary: SessionStartContext_
  _Depends: 2.1_
  - Done when the command output includes the blocked-no-agent-runtime contract without claiming hooks are trusted.

### 3. Harden Front-Door Prompt Enforcement

- [ ] 3.1 Refactor `force-pipeline-agents.cjs` output helpers into advisory and blocking paths
  _Requirements: 3.1, 3.5_
  _Boundary: FrontDoorPromptEnforcement_
  - Done when pipeline-worthy non-canonical requests return `continue:false`.
  - Done when explicit workflow requests continue but carry enforcement context.

- [ ] 3.2 Preserve explicit governed workflow pass-through with required-first-action marker
  _Requirements: 1.2, 3.3, 4.3_
  _Boundary: FrontDoorPromptEnforcement_
  _Depends: 3.1_
  - Done when `/pipeline-orchestrator-for-codex:spec`, `pipeline`, `bugfix`, `feature`, `audit`, and `review` are recognized as governed workflows.

- [ ] 3.3 Add fail-closed handling for malformed governed prompt payloads
  _Requirements: 3.4_
  _Boundary: FrontDoorPromptEnforcement_
  _Depends: 3.1_
  - Done when malformed input on a pipeline-worthy path blocks with sanitized reason.

- [ ] 3.4 Tune detection to avoid blocking trivial conversational prompts
  _Requirements: 1.4, 1.5_
  _Boundary: FrontDoorPromptEnforcement_
  _Depends: 3.1_
  - Done when tests cover short greetings, acknowledgements and ambiguous prompts.

### 4. Implement Early Governance Bootstrap

- [ ] 4.1 Define required-first-actions state shape
  _Requirements: 4.3, 9.3_
  _Boundary: GovernanceState_
  - Done when the shape is typed or schema-validated and includes visible plan, workflow gate, capability gate and controller dispatch or blocked artifact.

- [ ] 4.2 Persist required-first-actions for explicit pipeline requests
  _Requirements: 4.1, 4.2, 4.3_
  _Boundary: GovernanceState_
  _Depends: 4.1_
  - Done when `.codex/pipeline/required-first-actions.json` or equivalent state is written before proposal.

- [ ] 4.3 Ensure explicit bootstrap writes lock, session and sentinel before proposal
  _Requirements: 4.1, 4.2, 4.4, 9.3_
  _Boundary: ControllerBootstrap_
  - Done when tests prove lock/session/sentinel are present before the controller returns proposal output.

- [ ] 4.4 Reconcile hook-created and controller-created state
  _Requirements: 4.5_
  _Boundary: ControllerBootstrap_
  _Depends: 4.2, 4.3_
  - Done when session identifiers remain consistent and no competing state roots are created.

### 5. Make Capability Gate And Blocked Artifact Authoritative

- [ ] 5.1 Extend capability evaluation tests for missing and unknown multi-agent runtime
  _Requirements: 5.1, 5.2, 5.5_
  _Boundary: CapabilityGate_
  - Done when missing `spawn_agent` or `wait_agent` produces `runtime_mode=blocked-no-agent-runtime`.

- [ ] 5.2 Ensure harness/dev-bypass cannot produce operational pipeline PASS
  _Requirements: 5.3_
  _Boundary: CapabilityGate_
  - Done when `strictAgents=false` returns blocked or harness-labeled artifact with `pipeline_valid=false`.

- [ ] 5.3 Persist capability gate evidence to the ledger
  _Requirements: 5.4_
  _Boundary: CapabilityGate_
  - Done when `CAPABILITY_GATE` PASS or BLOCKED is available to final validation.

- [ ] 5.4 Normalize blocked artifact shape
  _Requirements: 5.2, 6.4_
  _Boundary: GovernanceArtifact_
  _Depends: 5.1_
  - Done when blocked artifact consistently includes `pipeline_requested`, `pipeline_valid`, `status`, `runtime_mode`, missing capabilities and manual fallback flags.

### 6. Strengthen Stop Evidence Enforcement

- [ ] 6.1 Improve explicit request detection in `completion-checklist.cjs`
  _Requirements: 6.1, 6.2, 6.3_
  _Boundary: StopEvidenceEnforcement_
  - Done when explicit command text, sentinel/session state and required-first-actions state all mark a run as explicit.

- [ ] 6.2 Allow structured blocked artifact as terminal non-PASS state
  _Requirements: 6.4_
  _Boundary: StopEvidenceEnforcement_
  _Depends: 5.4, 6.1_
  - Done when `BLOCKED` artifact with false pipeline validity passes stop enforcement without being treated as success.

- [ ] 6.3 Keep PASS validation ledger-backed
  _Requirements: 6.2, 6.5_
  _Boundary: StopEvidenceEnforcement_
  - Done when gates, hooks, dispatch and wait-agent evidence are checked against JSON/JSONL ledgers before PASS.

- [ ] 6.4 Add sanitized missing-evidence reporting
  _Requirements: 6.5_
  _Boundary: StopEvidenceEnforcement_
  - Done when denial reasons list missing evidence tokens without exposing secrets or raw local payloads.

### 7. Align Gate Taxonomy

- [ ] 7.1 Add canonical gate mapping helper
  _Requirements: 7.1, 7.2, 7.5_
  _Boundary: GateTaxonomy_
  - Done when artifact-required gates map deterministically to runtime gate names or direct registry entries.

- [ ] 7.2 Wire artifact validation to the mapping helper
  _Requirements: 7.2, 7.5_
  _Boundary: GateTaxonomy_
  _Depends: 7.1_
  - Done when final validation no longer requires fake gates if equivalent runtime gates have ledger proof.

- [ ] 7.3 Add drift tests for prompt-facing gate names
  _Requirements: 7.3, 7.4, 9.5_
  _Boundary: GateTaxonomy_
  - Done when `PLAN_GATE_ACTIVE` and required canonical gates are checked across TypeScript and relevant docs/prompts.

### 8. Integrate Edit And Dispatch Guard Boundaries

- [ ] 8.1 Verify dispatch guard rejects invalid pipeline identity paths
  _Requirements: 8.2, 8.3_
  _Boundary: DispatchGuard_
  - Done when tests cover bare leaf, legacy namespace, direct identity field without marker and Skill misuse.

- [ ] 8.2 Verify sentinel guard denies unexpected next agent under active state
  _Requirements: 8.4_
  _Boundary: SentinelGuard_
  - Done when active sentinel state with mismatched `expectedNext` denies dispatch.

- [ ] 8.3 Verify edit guard denies production edits under active lock without exec window
  _Requirements: 8.1, 8.5_
  _Boundary: EditGuard_
  - Done when lock-active/no-window edit attempts are denied and missing lock in explicit pipeline is not treated as safe.

### 9. Run Validation And Eval Gate

- [ ] 9.1 Run focused TypeScript tests for changed areas
  _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_
  _Boundary: Validation_
  - Done when focused hook/controller/gate tests pass.

- [ ] 9.2 Run typecheck and build
  _Requirements: 10.2_
  _Boundary: Validation_
  _Depends: 9.1_
  - Done when `npm run lint:types` and `npm run build` complete or failures are diagnosed.

- [ ] 9.3 Run broader tests or justified focused subsets
  _Requirements: 9.6_
  _Boundary: Validation_
  _Depends: 9.2_
  - Done when `npm test` passes, or Windows memory/IPC limitations are documented with passing focused subsets.

- [ ] 9.4 Capture telemetry and run Eval Gate
  _Requirements: 9.6, 10.1_
  _Boundary: EvalGate_
  _Depends: 9.1, 9.2_
  - Done when telemetry is captured manually or by trusted hooks and `.agents/skills/workflow-eval-gate/scripts/run_eval.py` passes.

### 10. Close Out Without Overclaiming Runtime Adoption

- [ ] 10.1 Update final report with inspected, changed and unchanged surfaces
  _Requirements: 10.1, 10.5_
  _Boundary: Closeout_
  - Done when the report separates repo code, generated build, hooks, Eval Gate and out-of-scope deployment.

- [ ] 10.2 Report installed cache/global/VPS adoption only with proof
  _Requirements: 10.1, 10.3, 10.4, 10.5_
  _Boundary: Closeout_
  - Done when any claim about cache/global/VPS includes separate evidence, or is explicitly marked not done.

- [ ] 10.3 Preserve unrelated worktree changes
  _Requirements: 10.1_
  _Boundary: Closeout_
  - Done when final diff review identifies unrelated pre-existing changes and does not revert them.

## Task Plan Review Gate

- Every requirement ID appears in at least one task: PASS.
- Runtime prerequisites are explicit: PASS.
- Dependencies are declared for cross-boundary work: PASS.
- Tasks are scoped to existing architecture and 1-3 hour units: PASS.
- Observable done states are present: PASS.
- No task requires new dependencies or manual `dist/**` edits: PASS.

## Independent Task-Graph Sanity Review

Verdict: PASS.

Rationale: The task graph starts with failing tests, then implements hook/config/front-door/bootstrap/stop/gate changes, then validates with focused tests, build and Eval Gate. Hidden prerequisites are represented explicitly: hook trust, capability gate, generated build, telemetry and separate runtime adoption proof.
