# Runtime-First Rewrite for Maximum Operational Parity

## Status

Approved design for the next phase of the Codex port.

## Goal

Reach maximum operational parity with the upstream Pipeline-Orchestrator by moving the center of operational behavior out of controller-owned helper logic and into explicit runtime-dispatched roles, while preserving the controller as the sole authority for:

- phase transitions
- gate decisions
- rollback routing
- session persistence
- checkpoint persistence
- append-only gate log
- confidence scoring

Breaking changes are allowed if they materially improve parity with the upstream runtime model.

## Non-Goals

- preserve backward-compatible behavior at all costs
- keep controller-owned helper logic when a real operational role should exist
- ship marketplace-focused ergonomics before runtime parity is complete

## Current State Summary

The local plugin already has strong governance and a partially agentified runtime:

- persistent state, gate log, confidence score, continue mode, rollback hints
- multi-agent review orchestration for batch and final review
- sentinel state and sequence enforcement
- prompt registry with required-output contracts and startup preload
- prompt artifacts for central roles including sentinel, checkpoint-validator, design-interrogator, plan-architect, sanity-checker, final-validator, executor-fix, and executor-spec-reviewer
- executor-fix and executor-spec-reviewer now participate in real runtime paths

The main gap is no longer documentation or prompt coverage. The main gap is that too much operational behavior still lives in controller-owned functions or helpers instead of role-driven runtime dispatch.

## Target Architecture

### 1. Controller Kernel

The controller remains the sovereign kernel. It owns:

- intake normalization
- mode, type, complexity, variant, and team-shape selection
- phase transition authority
- persistence of session, checkpoints, gate log, confidence, and sentinel state
- rollback and continue semantics
- final authoritative closeout persistence

The controller should not directly perform operational work that belongs to a named runtime role.

### 2. Operational Agent Layer

The runtime should dispatch and consume outputs from these roles as real operational steps:

- `information-gate`
- `design-interrogator`
- `plan-architect`
- `executor-implementer`
- `executor-spec-reviewer`
- `quality-reviewer`
- `checkpoint-validator`
- `executor-fix`
- `review-orchestrator`
- `security-reviewer`
- `architecture-reviewer`
- `final-adversarial-orchestrator`
- `sanity-checker`
- `final-validator`

Each role must have:

- a validated prompt
- a required output contract
- a typed or parseable runtime result
- a downstream consumer

### 3. Sentinel Layer

Sentinel becomes an operational gate actor, not just a store and helper. It should:

- evaluate the current attempted transition against `expectedNext`
- return `PASS`, `CORRECTED`, or `BLOCKED`
- update structural checkpoint progress
- prevent invalid dispatch before other operational roles run

The controller remains responsible for persisting Sentinel authority and reacting to its outcome.

### 4. Dispatcher Layer

The dispatcher becomes the actual runtime execution boundary:

- top-level and child roles always receive registry-validated prompts
- team members always receive explicit `filesInScope`, `authorityLevel`, `freshContext`, and `reviewOnly`
- multi-agent dispatch becomes the normal operational mode for review and team-composed phases
- single-agent remains a technical mechanism, not the dominant product model

### 5. Validation and Closeout Layer

`sanity-checker` and `final-validator` become explicit operational steps in Phase 3. The controller consumes their outputs, persists authoritative state, and decides final closeout and rollback.

## Remaining Gaps

### Roles that still exist more as helpers than operational runtime actors

- `design-interrogator`
- `plan-architect`
- `checkpoint-validator`
- `sanity-checker`
- `final-validator`
- `sentinel`

### Controller-owned flow that should be runtime-driven

- much of Phase 0
- most of Phase 1.5
- parts of Phase 2 checkpoint and rework semantics
- parts of Phase 3 closeout semantics

### Runtime fidelity gaps

- agent outputs are not yet the primary contract in all phases
- `team-registry` is not yet the central operational team-composition source
- some role semantics still depend on controller-local interpretation instead of role-local output

## Chosen Approach

Use a runtime-first rewrite:

- keep controller sovereignty for state, gates, and rollback
- move operational semantics into real runtime-dispatched roles
- accept breaking changes where needed to remove hybrid behavior

This is intentionally more aggressive than a compatibility-first migration.

## Migration Waves

### Wave 1: Dispatcher as Runtime Center

Goal:

- make dispatcher semantics rich enough to support all central roles as real runtime actors

Deliverables:

- typed or parseable outputs by role
- stronger role-specific behavior in the runner path
- complete runtime prompt mapping for all shipped operational roles
- child-agent prompt validation and scope enforcement everywhere

Done when:

- a central role no longer requires hidden controller-owned substitute logic just to “exist”

### Wave 2: Phase 0 and Phase 1.5 Become Role Chains

Goal:

- replace helper-style intake and plan behavior with a real role chain

Target flow:

- controller envelope classification
- `information-gate`
- `design-interrogator`
- `plan-architect`
- controller approval and persistence

Done when:

- planning and design decision capture come from dispatched roles with structured outputs

### Wave 3: Phase 2 Becomes Fully Agent-Driven

Goal:

- make the batch loop faithfully operational

Target flow:

- `quality-gate-router`
- `pre-tester`
- `executor-implementer`
- `executor-spec-reviewer`
- `quality-reviewer`
- `checkpoint-validator`
- `review-orchestrator`
- `executor-fix`
- re-checkpoint
- re-review

Done when:

- the controller observes, persists, and gates
- operational decisions come from role outputs

### Wave 4: Phase 3 Becomes Explicit and Agent-Driven

Goal:

- make final verification and closeout a real role chain

Target flow:

- `sanity-checker`
- `final-adversarial-orchestrator`
- `final-validator`
- closeout helper / finishing branch step

Done when:

- `GO`, `CONDITIONAL`, and `NO-GO` come from an explicit runtime chain with authoritative persistence by the controller

### Wave 5: Productization and Convergence

Goal:

- eliminate the remaining hybrid gap between runtime, tests, and docs

Deliverables:

- docs describe only real runtime behavior
- E2E scenario coverage across all phases
- team-registry participates in real team composition
- startup, hooks, and invariants match the shipped runtime model

Done when:

- docs, runtime, and tests tell exactly the same story

## Architectural Invariants

### Controller Sovereignty

Only the controller may authoritatively:

- transition phases
- append gate decisions
- persist rollback route
- persist closeout verdict

### Prompt Contracts Are Runtime Contracts

If a role is operational, its prompt contract must be:

- validated at startup or before dispatch
- actually required by runtime behavior
- tested by failure and success paths

### Evidence Must Flow Forward

Important roles must emit evidence that the next step consumes, rather than narrative summaries that the controller reinterpret from scratch.

### Multi-Agent Is the Product Default

For review paths and team-composed paths, multi-agent orchestration is the normal model.

### No Aspirational Docs

Documentation may not describe a role as operational unless the runtime actually dispatches it.

## Acceptance Criteria

The rewrite is complete only when:

- Phase 0, Phase 1.5, Phase 2, and Phase 3 each have explicit role chains
- Sentinel is operational, not merely persisted
- checkpoint validation is operational, not merely helper logic
- sanity-checker and final-validator are operational runtime steps
- agent outputs are formal inputs to the next stage
- team-registry influences real team composition
- docs, prompt inventory, and runtime behavior fully align
- integration coverage proves continue, rollback, stop-rule, fix-loop, final review, and closeout behavior

## Main Risks

### 1. Role theater

Prompts and files may exist without real runtime authority. The rewrite must avoid adding more artifacts that do not change execution behavior.

### 2. Controller drift

If the controller retains too much operational logic, parity remains superficial.

### 3. Output ambiguity

If role outputs are not structured enough, the runtime falls back to controller guesswork.

### 4. Verification illusion

If tests assert only dispatch presence and not semantic handoff, parity will be overstated.

## Recommended Next Step

After this design is reviewed, the next artifact should be a detailed implementation plan that breaks the rewrite into concrete batches, files, tests, and acceptance checks.
