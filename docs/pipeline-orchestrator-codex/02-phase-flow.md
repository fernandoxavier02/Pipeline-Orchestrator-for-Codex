# Phase Flow

## Global Flow

The controller defines five operational phases:

- Phase 0: Automatic Triage
- Phase 1: Proposal and Confirmation
- Phase 1.5: Planning
- Phase 2: Batch Execution
- Phase 3: Closure

There is also a non-standard `review-only` path and a `continue` path.

## Phase 0: Automatic Triage

### Goal

Transform the raw user request into an actionable classified task and eliminate factual unknowns before execution.

### Subphases

#### 0a. Task Orchestrator

Responsibilities:

- classify type
- classify complexity
- infer severity
- choose pipeline variant
- identify probable files and domains
- detect SSOT conflicts

Task types:

- Bug Fix
- Feature
- User Story
- Audit
- UX Simulation

Complexity levels:

- SIMPLES
- MEDIA
- COMPLEXA

Primary output:

- `ORCHESTRATOR_DECISION`

Hard block:

- `SSOT_CONFLICT`

#### 0b. Information Gate

Responsibilities:

- read likely affected files first
- load conditional question bank
- detect unresolved factual gaps
- ask one question at a time
- classify gaps as blocker, important, informational

Primary output:

- `INFORMATION_GATE`

Hard block:

- `INFO_GATE_BLOCKED`

#### 0c. Design Interrogator

Runs when:

- complexity is `COMPLEXA`
- or `--grill` is passed

Responsibilities:

- identify design decisions and trade-offs
- self-answer from codebase when possible
- ask one design decision at a time
- recommend one option for each unresolved trade-off

Primary output:

- `DESIGN_INTERROGATION`

Note:

- this phase documents unresolved design decisions but does not hard-block on `PARTIAL`

### Transition 0 -> 1

Controller emits:

- phase transition summary
- gate decisions for Phase 0
- initial confidence state

## Phase 1: Proposal and Confirmation

### Goal

Make the execution plan visible to the user before any code or structured execution begins.

### Proposal Includes

- request summary
- classified type
- complexity
- variant
- info-gate status
- design review status
- plan mode status
- affected files
- batch size

### Allowed User Responses

- `yes`
- `no`
- `adjust`

Effects:

- `yes` continues
- `no` causes reclassification or exit
- `adjust` applies user overrides and re-presents proposal

### Diagnostic Mode

If mode is `diagnostic`, the pipeline stops here and outputs:

- classification
- chosen variant
- affected files
- information-gate status
- doc path
- continuation hint

## Phase 1.5: Planning

### Goal

Create an implementation blueprint before code is written.

### Trigger

- automatic for `COMPLEXA`
- optional for any complexity via `--plan`

### Responsibilities

- enter read-only plan mode
- inspect codebase and patterns
- map files to create and modify
- build dependency-ordered tasks
- identify risks
- present plan for approval

Primary output:

- `IMPLEMENTATION_PLAN`

Possible statuses:

- `APPROVED`
- `ADJUSTED`
- `REJECTED`

Hard gate:

- `PLAN_REJECTED`

### Transition to Phase 2

The approved plan is forwarded to `executor-controller` and shapes task order, file scope, and batch composition.

## Phase 2: Batch Execution

### Goal

Execute approved work incrementally with TDD and per-batch independent review.

### Step 2a: Load Pipeline Reference

Controller reads:

- `references/pipelines/{variant}.md`

That reference provides:

- team composition
- batch expectations
- success criteria
- escalation notes

### Step 2b: TDD Planning

#### Quality Gate Router

Responsibilities:

- produce plain-language test scenarios
- present them one at a time unless user asks otherwise
- block until approved

Primary gate:

- `TDD_APPROVAL`

Primary output:

- `QUALITY_GATE_APPROVED`

#### Pre-Tester

Responsibilities:

- convert approved scenarios to tests
- change test files only
- confirm RED state is valid
- reject invalid RED caused by broken imports or syntax

Primary output:

- `PRE_TESTER_RESULT`

### Step 2c: Implementation Execution

#### Executor Controller

Responsibilities:

- load tasks
- partition tasks into batches
- run each task through:
  - micro-gate
  - implementer
  - spec reviewer
  - quality reviewer
- run checkpoint after each batch
- consolidate executor result

Adaptive batch sizing:

- SIMPLES: all at once
- MEDIA: 2 to 3 tasks
- COMPLEXA: 1 task

#### Per-task Micro-Gate

Checks:

- target file exists or explicit creation requested
- expected behavior is explicit
- numeric values are explicit
- data paths are explicit
- security impact was assessed

Primary gate:

- `MICRO_GATE_GAP`

#### Implementer

Responsibilities:

- work on one task only
- enforce TDD RED -> GREEN -> REFACTOR
- stay within explicit file scope
- stop if requirements are missing
- self-review before returning

Possible statuses:

- `COMPLETE`
- `QUESTIONS`
- `BLOCKED`

#### Spec Reviewer

Responsibilities:

- compare actual implementation to requirement
- do not trust implementer summary
- return binary pass or fail

#### Quality Reviewer

Responsibilities:

- check SRP, OCP, KISS, DRY, YAGNI
- inspect naming, tests, error handling, types
- return approved, needs fixes, or rejected

### Step 2d: Checkpoint Validator

Runs after each batch.

Checks:

- build
- tests
- regression scope according to complexity

Primary gate:

- `CHECKPOINT_FAIL`

Stop behavior:

- two consecutive failures trigger `STOP_RULE`

### Step 2e: Adversarial Gate and Review

After checkpoint pass, controller asks user whether to start independent review.

Primary gate:

- `ADVERSARIAL_GATE`

Mandatory escalation:

- `ADVERSARIAL_GATE_MANDATORY` when batch touches auth, crypto, data-model, or payment

#### Review Orchestrator

Responsibilities:

- receive only batch metadata and file lists
- spawn review agents in parallel
- consolidate findings

Parallel reviewers:

- `adversarial-batch`
- `architecture-reviewer` for MEDIA and COMPLEXA

Primary output:

- `REVIEW_CONSOLIDATED`

#### Fix Loop

If findings exist:

- `executor-fix` is spawned with fresh context
- checkpoint runs again
- full re-review happens again
- maximum of 3 attempts

Gates:

- `ADVERSARIAL_BLOCK`
- `FIX_LOOP_EXHAUSTED`

### Transition 2 -> 3

Controller emits:

- phase transition summary
- updated confidence
- gate log entries
- carry-forward artifacts

## Phase 3: Closure

### Goal

Validate final state, optionally run whole-diff final adversarial review, then issue closeout decision.

### Step 3a: Sanity Checker

Responsibilities:

- run proportional final verification
- reproduce original symptom or acceptance behavior
- detect scope creep
- require command plus output evidence

Possible result:

- `PASS`
- `FAIL`
- `PARTIAL`

### Step 3b: Final Adversarial Gate

User is offered a whole-diff adversarial review before final validation.

Primary gate:

- `FINAL_ADVERSARIAL_GATE`

This is recommended for all work and strongly recommended for complex work.

#### Final Adversarial Orchestrator

Responsibilities:

- review all changed files across the whole run
- use zero implementation context
- spawn reviewers in parallel
- cross-reference consensus, unique, and contradictory findings

Review team:

- security adversarial
- architecture adversarial
- quality adversarial

If critical findings exist, Phase 3 can trigger:

- `FINAL_ADVERSARIAL_REWORK`

with a controlled rollback to a targeted fix batch.

### Step 3c: Final Validator

Responsibilities:

- collect all prior outputs
- parse and validate `gate-decisions.jsonl`
- read confidence score
- apply proportional criteria
- issue `GO`, `CONDITIONAL`, or `NO-GO`

This is the Pa de Cal stage.

### Step 3d: Finishing Branch

Responsibilities:

- present closeout options
- handle merge, PR, keep, discard
- require explicit confirmation for destructive or external actions
- document rollback strategy for bad deployments

## Continue Mode

`/pipeline continue` does not mean "blindly resume".

The controller:

1. finds the latest pipeline doc folder
2. reads the gate log
3. evaluates time since last activity
4. triggers `STALE_CONTEXT` if the run is old
5. escalates stale context to a hard block for sensitive complex domains

## Review-Only Mode

This mode skips execution and performs only whole-diff final adversarial review on uncommitted changes.

Flow:

1. detect changed files via git
2. spawn final adversarial orchestrator
3. return report only
4. do not auto-fix

## Hotfix Mode

This mode forces:

- Bug Fix
- COMPLEXA
- Critical severity

But it still preserves safety with narrower validation instead of no validation.

Hotfix differences:

- info-gate asks only blocker questions
- TDD reduced to one regression proof
- batch size fixed at one
- adversarial limited to auth and injection checklists
- sanity reduced to build plus tests

Hotfix explicitly logs that reduced validation was used.
