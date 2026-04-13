# Runtime-First Rewrite Execution Plan

## Goal

Reach maximum operational parity with the upstream Pipeline-Orchestrator by rewriting the local Codex port around real runtime-dispatched roles, while preserving the controller as the sole authority for:

- phase transitions
- gate decisions
- rollback routing
- session, checkpoint, gate-log, confidence, and sentinel persistence
- final closeout authority

## Scope Boundaries

### In scope

- converting controller-owned operational behavior into real runtime-dispatched roles
- making dispatcher outputs role-shaped and consumable
- using team-registry as a real operational team source
- making Phase 0, Phase 1.5, Phase 2, and Phase 3 explicit role chains
- closing remaining drift between runtime, prompts, tests, and docs

### Out of scope

- preserving backward compatibility when it conflicts with upstream parity
- marketplace packaging improvements
- unrelated cleanup or refactors that do not serve runtime-first rewrite

## Global Execution Contract

Every implementation task below must use this loop.

### Execution loop

For any task with a meaningful code seam:

1. write or extend a failing automated test first
2. run the focused test and confirm RED
3. implement the smallest change that can turn it GREEN
4. run the focused verification
5. run adversarial review on the task outcome
6. if review finds `critical` or `important` issues:
   - fix them in scope
   - rerun focused verification
   - rerun adversarial review
7. stop after 3 failed correction cycles
8. the 3rd correction cycle must use a materially different strategy

### When TDD is mandatory

Mandatory:

- behavior changes
- role dispatch changes
- state-machine changes
- gate or rollback logic
- parsing or output-contract changes
- continue or closeout behavior
- any new runtime seam with observable behavior

Reduced to verification-first only when no realistic isolated seam exists:

- documentation
- inventory updates
- prompt text updates without runtime behavior change

### Exit gate for every task

A task is complete only when:

- focused verification is fresh and green
- adversarial review has passed or only minor findings remain
- no unresolved `critical` or `important` issue remains

## Key Changes

- Dispatcher becomes the runtime center, not just transport.
- Sentinel becomes an operational gate actor.
- Phase 0 and Phase 1.5 become runtime role chains.
- Phase 2 becomes fully agent-driven, including checkpoint and fix semantics.
- Phase 3 becomes an explicit operational chain ending in authoritative closeout.
- Team composition moves from reference-only to runtime-enforced behavior.
- Docs and tests converge with the shipped runtime.

## Task List

### Task 1 — Make dispatcher outputs role-shaped and runtime-authoritative

Intent:

- turn dispatcher results into formal contracts that downstream steps can consume without controller guesswork

Files:

- modify [src/dispatcher/dispatcher-types.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/src/dispatcher/dispatcher-types.ts)
- modify [src/dispatcher/single-agent-runner.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/src/dispatcher/single-agent-runner.ts)
- modify [src/dispatcher/multi-agent-runner.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/src/dispatcher/multi-agent-runner.ts)
- modify [src/dispatcher/run-role.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/src/dispatcher/run-role.ts)
- modify [src/index.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/src/index.ts)
- modify [tests/unit/dispatcher/run-role.test.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/tests/unit/dispatcher/run-role.test.ts)
- modify [tests/integration/execution/pipeline-runner.test.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/tests/integration/execution/pipeline-runner.test.ts)

Interface or behavior to change:

- define role-aware output shapes for central roles instead of generic `status/findings` blobs
- ensure child-team dispatch always receives validated prompt content and preserved scope metadata
- make multi-agent aggregation preserve role outputs in a way downstream orchestrators can trust

Failure-path coverage:

- broken prompt contract at top-level role
- broken prompt contract at child-team role
- missing role mapping
- child-team scope mismatch

Verification:

- `npm test -- tests/unit/dispatcher/run-role.test.ts tests/integration/execution/pipeline-runner.test.ts`

Acceptance:

- central runtime roles return parseable shapes
- no team child bypasses prompt validation or scope metadata

### Task 2 — Turn Sentinel into an operational dispatch step

Intent:

- make Sentinel a real runtime gate actor while keeping controller sovereignty over persisted authority

Files:

- modify [src/sentinel/sentinel-state.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/src/sentinel/sentinel-state.ts)
- add or modify `src/sentinel/*` runtime decision module
- modify [src/controller/pipeline-controller.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/src/controller/pipeline-controller.ts)
- modify [src/index.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/src/index.ts)
- modify [tests/unit/sentinel/sentinel-state.test.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/tests/unit/sentinel/sentinel-state.test.ts)
- modify [tests/integration/sentinel/sentinel-controller.test.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/tests/integration/sentinel/sentinel-controller.test.ts)

Interface or behavior to change:

- Sentinel must evaluate attempted transition tokens and return `PASS`, `CORRECTED`, or `BLOCKED`
- controller must consume Sentinel result before dispatching phase roles
- Sentinel checkpoint progression becomes an explicit runtime seam, not hidden helper logic

Failure-path coverage:

- unexpected input
- stale expected-next state
- corrected route instead of blocked route
- invalid dispatch attempted after a blocked Sentinel result

Verification:

- `npm test -- tests/unit/sentinel/sentinel-state.test.ts tests/integration/sentinel/sentinel-controller.test.ts`

Acceptance:

- no structural dispatch occurs before Sentinel approval
- blocked and corrected routes are explicit and persisted

### Task 3 — Rewrite Phase 0 into dispatched intake roles

Intent:

- remove helper-style intake semantics from the controller and replace them with runtime roles

Files:

- modify [src/gates/information-gate.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/src/gates/information-gate.ts)
- modify [src/controller/design-interrogator.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/src/controller/design-interrogator.ts)
- modify [src/controller/pipeline-controller.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/src/controller/pipeline-controller.ts)
- modify [src/index.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/src/index.ts)
- modify [tests/unit/gates/information-gate.test.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/tests/unit/gates/information-gate.test.ts)
- modify [tests/integration/execution/pipeline-runner.test.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/tests/integration/execution/pipeline-runner.test.ts)

Interface or behavior to change:

- `information-gate` becomes a runtime role output, not just a local decision helper
- `design-interrogator` becomes a runtime role output, not just a function
- controller reads their structured results and persists proposal state

Failure-path coverage:

- info gate blocks
- design interrogation skipped
- design interrogation partial
- broken role output contract blocks intake

Verification:

- `npm test -- tests/unit/gates/information-gate.test.ts tests/integration/execution/pipeline-runner.test.ts`

Acceptance:

- proposal state is derived from dispatched role outputs, not helper-local defaults

### Task 4 — Rewrite Phase 1.5 planning into a real plan-architect path

Intent:

- replace local plan construction with a dispatched, read-only planner role

Files:

- modify [src/controller/plan-mode.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/src/controller/plan-mode.ts)
- modify [src/controller/pipeline-controller.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/src/controller/pipeline-controller.ts)
- modify [src/domain/pipeline-schemas.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/src/domain/pipeline-schemas.ts)
- modify [src/index.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/src/index.ts)
- modify [tests/unit/controller/plan-mode.test.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/tests/unit/controller/plan-mode.test.ts)
- add or modify integration coverage around phase-1.5 approval

Interface or behavior to change:

- `plan-architect` must emit `IMPLEMENTATION_PLAN` as the authoritative planning payload
- controller only validates, persists, and gates approval/reapproval

Failure-path coverage:

- planner contract broken
- rejected planning output
- approval pending or reapproval required
- continue path with missing plan proof

Verification:

- `npm test -- tests/unit/controller/plan-mode.test.ts tests/integration/planning/phase-1_5-approval.test.ts`

Acceptance:

- plan-mode no longer manufactures the plan locally as primary behavior

### Task 5 — Make team-registry the operational source of team composition

Intent:

- stop hardcoding team shapes in orchestrators wherever the reference bundle should decide composition

Files:

- modify [src/references/load-reference-bundle.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/src/references/load-reference-bundle.ts)
- modify [src/references/reference-profiles.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/src/references/reference-profiles.ts)
- modify [src/index.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/src/index.ts)
- modify [src/review/review-orchestrator.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/src/review/review-orchestrator.ts)
- modify [src/review/final-adversarial-orchestrator.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/src/review/final-adversarial-orchestrator.ts)
- modify [tests/integration/references/reference-bundle.test.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/tests/integration/references/reference-bundle.test.ts)
- modify [tests/integration/review/review-independence.test.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/tests/integration/review/review-independence.test.ts)

Interface or behavior to change:

- team shapes for review and later execution paths are resolved from `team-registry`
- variant/profile can change the operational team without editing orchestrator code

Failure-path coverage:

- missing route in team-registry
- inconsistent team definition
- variant mismatch

Verification:

- `npm test -- tests/integration/references/reference-bundle.test.ts tests/integration/review/review-independence.test.ts`

Acceptance:

- team composition is reference-driven for the affected runtime paths

### Task 6 — Rewrite Phase 2 into a fully role-driven batch loop

Intent:

- make the execution loop match the approved runtime-first chain instead of a hybrid helper/controller flow

Files:

- modify [src/execution/quality-gate-router.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/src/execution/quality-gate-router.ts)
- modify [src/execution/pre-tester.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/src/execution/pre-tester.ts)
- modify [src/execution/checkpoint-validator.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/src/execution/checkpoint-validator.ts)
- modify [src/execution/executor-controller.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/src/execution/executor-controller.ts)
- modify [src/review/review-orchestrator.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/src/review/review-orchestrator.ts)
- add prompts and runtime mapping for any still-missing Phase 2 roles
- modify [tests/integration/execution/controller-routing.test.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/tests/integration/execution/controller-routing.test.ts)
- modify [tests/integration/execution/fix-loop-cap.test.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/tests/integration/execution/fix-loop-cap.test.ts)

Interface or behavior to change:

- `quality-gate-router` becomes an explicit runtime step
- `pre-tester` becomes an explicit runtime step
- `checkpoint-validator` becomes a role-driven validation step
- `executor-fix` output is interpreted, not merely dispatched
- `executor-spec-reviewer` and `quality-reviewer` outputs become direct inputs into rework decisions

Failure-path coverage:

- TDD approval blocked
- RED validation blocked
- checkpoint failure
- stop rule
- blocked batch review
- fix loop exhaustion
- third-strategy correction path

Verification:

- `npm test -- tests/integration/execution/controller-routing.test.ts tests/integration/execution/fix-loop-cap.test.ts`

Acceptance:

- the controller is no longer the main place where Phase 2 operational semantics live

### Task 7 — Rewrite Phase 3 into an explicit final operational chain

Intent:

- turn final validation and closeout into real dispatched operational steps

Files:

- modify [src/validation/final-validator.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/src/validation/final-validator.ts)
- modify [src/closeout/render-closeout.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/src/closeout/render-closeout.ts)
- modify [src/index.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/src/index.ts)
- modify [src/controller/pipeline-controller.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/src/controller/pipeline-controller.ts)
- modify [tests/integration/closeout/closeout-confirm.test.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/tests/integration/closeout/closeout-confirm.test.ts)
- modify [tests/integration/validation/final-validator-gate-log.test.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/tests/integration/validation/final-validator-gate-log.test.ts)

Interface or behavior to change:

- `sanity-checker` becomes an explicit runtime step before final decision
- `final-validator` emits a formal operational result consumed by the controller
- closeout rendering becomes a presentation layer over controller-persisted authoritative final result

Failure-path coverage:

- missing evidence
- blocked final review
- sticky rollback
- recoverable rollback
- reduced validation
- stale history isolation

Verification:

- `npm test -- tests/integration/closeout/closeout-confirm.test.ts tests/integration/validation/final-validator-gate-log.test.ts`

Acceptance:

- Phase 3 is a real operational chain, not mostly a helper path

### Task 8 — Slim the controller until it is orchestration-only

Intent:

- remove hybrid duplicate operational logic once runtime chains exist

Files:

- modify [src/controller/pipeline-controller.ts](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/src/controller/pipeline-controller.ts)
- modify any now-redundant helper modules in `src/controller/*`, `src/execution/*`, `src/validation/*`
- update controller-focused tests

Interface or behavior to change:

- controller must only orchestrate, persist, gate, and route
- operational logic that still duplicates runtime behavior must be deleted or downgraded to adapters

Failure-path coverage:

- continue with missing proof
- rollback route mismatch
- proposal confirmation pending
- phase mismatch

Verification:

- `npm test -- tests/unit/controller/pipeline-controller.test.ts tests/unit/continue/resume-pipeline.test.ts tests/integration/execution/controller-routing.test.ts`

Acceptance:

- no central role has both a real runtime path and a hidden controller-owned substitute path

### Task 9 — Converge docs and inventories with the shipped runtime

Intent:

- make documentation fully truthful after the runtime rewrite

Files:

- modify [README.md](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/README.md)
- modify [docs/pipeline-orchestrator-codex/09-gap-analysis.md](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/docs/pipeline-orchestrator-codex/09-gap-analysis.md)
- modify [docs/pipeline-orchestrator-codex/10-source-inventory.md](/Users/fernandocostaxavier/plugins/pipeline-orchestrator-for-codex/docs/pipeline-orchestrator-codex/10-source-inventory.md)
- modify any additional docs that still describe hybrid behavior

Interface or behavior to change:

- docs must describe only runtime behavior that really ships
- no aspirational agent references remain undocumented as such

Failure-path coverage:

- inventory missing artifact
- doc says operational when runtime is still controller-owned

Verification:

- manual diff review plus focused tests if any runtime-facing doc-driven metadata changes

Acceptance:

- docs, runtime, and prompt inventory tell the same story

### Task 10 — Full acceptance pass

Intent:

- prove the rewrite is complete enough to claim maximum operational parity

Files:

- no new production files required by default
- test suites across `tests/integration/**` and `tests/unit/**`
- final docs sanity review

Interface or behavior to change:

- none, unless acceptance exposes a real defect

Failure-path coverage:

- continue
- rollback
- stop rule
- fix loop
- final review
- closeout
- startup prompt preload
- sentinel block/correct

Verification:

- `npm test`
- `npm run lint:types`

Acceptance:

- all phases are explicit role chains
- team-registry affects real runtime composition
- controller remains sovereign only where intended
- docs and runtime are aligned

**Verification**
- Every code-changing task above must use TDD where applicable.
- Every task must run adversarial review in loop before completion.
- Stop after 2 repeated verification failures without root-cause progress and analyze before continuing.
- Final global acceptance requires fresh `npm test` and `npm run lint:types` after the last functional wave.

**Next skill**
`$superpower-executing-plans` 񟿽
