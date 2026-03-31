# Agents Catalog

## Overview

The repository currently contains 19 specialized agents across three folders.

## Core Agents

### `task-orchestrator`

- Folder: `agents/core/task-orchestrator.md`
- Model hint: sonnet
- Role: mandatory entrypoint for structured work
- Inputs: raw request, project context, complexity matrix
- Outputs: `ORCHESTRATOR_DECISION`
- Key behaviors:
  - classifies type, complexity, severity
  - detects probable files and domains
  - always invokes information-gate
  - always presents proposal to user

### `information-gate`

- Folder: `agents/core/information-gate.md`
- Model hint: sonnet
- Role: macro-gate
- Inputs: `ORCHESTRATOR_DECISION`
- Outputs: `INFORMATION_GATE`
- Key behaviors:
  - reads files before asking questions
  - selects questions from conditional bank
  - asks one question at a time
  - blocks on blocker and important gaps until resolved

### `adversarial-batch`

- Folder: `agents/core/adversarial-batch.md`
- Model hint: sonnet
- Role: per-batch security and robustness review
- Inputs: batch files, domains, intensity
- Outputs: `ADVERSARIAL_BATCH_REVIEW`
- Key behaviors:
  - loads relevant checklists only
  - reports critical, important, minor findings
  - supports 3-attempt fix loop with full re-review

### `checkpoint-validator`

- Folder: `agents/core/checkpoint-validator.md`
- Model hint: haiku
- Role: per-batch build/test/regression proof
- Inputs: batch number, complexity, project config, previous failure count
- Outputs: `CHECKPOINT_RESULT`
- Key behaviors:
  - runs proportional validation
  - enforces stop rule
  - tracks regression promotion
  - requires evidence before claim

### `sanity-checker`

- Folder: `agents/core/sanity-checker.md`
- Model hint: haiku
- Role: final proportional verification before final decision
- Inputs: final changed state, project config, original request
- Outputs: `SANITY_CHECK`
- Key behaviors:
  - runs build and tests proportionally
  - reproduces symptom or acceptance behavior
  - checks scope creep

### `final-validator`

- Folder: `agents/core/final-validator.md`
- Model hint: sonnet
- Role: Pa de Cal final decision
- Inputs:
  - all prior stage outputs
  - gate log
  - confidence file
- Outputs: `PA_DE_CAL`
- Key behaviors:
  - validates gate log schema and hardness
  - applies proportional final criteria
  - issues `GO`, `CONDITIONAL`, or `NO-GO`

### `finishing-branch`

- Folder: `agents/core/finishing-branch.md`
- Model hint: sonnet
- Role: closeout helper for branch lifecycle
- Inputs: final decision and branch context
- Outputs: closeout action
- Key behaviors:
  - presents merge, PR, keep, discard
  - requires confirmation for destructive or external actions
  - documents rollback strategies

## Executor Agents

### `executor-controller`

- Folder: `agents/executor/executor-controller.md`
- Model hint: opus
- Role: execution orchestrator
- Inputs: orchestrator decision, plan, project config
- Outputs: `EXECUTOR_RESULT`
- Key behaviors:
  - partitions tasks into adaptive batches
  - enforces micro-gate before work
  - dispatches implementer, spec review, quality review
  - delegates checkpoint validation
  - does not own adversarial review in v3

### `executor-implementer-task`

- Folder: `agents/executor/executor-implementer-task.md`
- Model hint: opus
- Role: one-task code implementer
- Inputs: `TASK_CONTEXT`
- Outputs: `IMPLEMENTER_RESULT` or `MICRO_GATE_BLOCK`
- Key behaviors:
  - micro-gate first
  - TDD RED -> GREEN -> REFACTOR
  - strict write-scope
  - returns questions instead of guessing

### `executor-fix`

- Folder: `agents/executor/executor-fix.md`
- Model hint: opus
- Role: fresh-context fix agent for findings
- Inputs: `FIX_CONTEXT`
- Outputs: `FIX_RESULT`
- Key behaviors:
  - not the original implementer
  - same write-scope as original task
  - third attempt must differ
  - checkpoint must rerun after fix

### `executor-spec-reviewer`

- Folder: `agents/executor/executor-spec-reviewer.md`
- Model hint: sonnet
- Role: requirement compliance check
- Inputs: requirement plus changed files
- Outputs: `SPEC_REVIEW_RESULT`
- Key behaviors:
  - binary pass/fail
  - reads code directly
  - does not trust implementer summary

### `executor-quality-reviewer`

- Folder: `agents/executor/executor-quality-reviewer.md`
- Model hint: sonnet
- Role: per-task quality reviewer
- Inputs: changed files after spec pass
- Outputs: `QUALITY_REVIEW_RESULT`
- Key behaviors:
  - checks SRP, OCP, KISS, DRY, YAGNI
  - inspects naming, tests, and error handling
  - returns approved, needs fixes, or rejected

## Quality Agents

### `design-interrogator`

- Folder: `agents/quality/design-interrogator.md`
- Model hint: sonnet
- Role: resolve design trade-offs before implementation
- Inputs: classification, information gate result, project context
- Outputs: `DESIGN_INTERROGATION`
- Key behaviors:
  - builds decision tree
  - self-answers from code when possible
  - asks one design decision at a time

### `plan-architect`

- Folder: `agents/quality/plan-architect.md`
- Model hint: sonnet
- Role: read-only implementation planner
- Inputs: classification, info gate, design decisions, project context
- Outputs: `IMPLEMENTATION_PLAN`
- Key behaviors:
  - enters plan mode
  - researches file map and dependency order
  - presents plan for user approval

### `quality-gate-router`

- Folder: `agents/quality/quality-gate-router.md`
- Model hint: sonnet
- Role: plain-language TDD scenario designer
- Inputs: request and expected behavior context
- Outputs: `QUALITY_GATE_APPROVED`
- Key behaviors:
  - generates user-understandable scenarios
  - blocks until user approves
  - scales test minimums by complexity

### `pre-tester`

- Folder: `agents/quality/pre-tester.md`
- Model hint: opus
- Role: RED-phase test writer
- Inputs: approved scenarios and project config
- Outputs: `PRE_TESTER_RESULT`
- Key behaviors:
  - writes test files only
  - verifies failure reason is legitimate
  - documents behavior contracts

### `review-orchestrator`

- Folder: `agents/quality/review-orchestrator.md`
- Model hint: opus
- Role: independent per-batch review coordinator
- Inputs: batch metadata and files only
- Outputs: `REVIEW_CONSOLIDATED`
- Key behaviors:
  - spawns reviewers in parallel
  - has zero implementation context
  - consolidates findings without filtering

### `architecture-reviewer`

- Folder: `agents/quality/architecture-reviewer.md`
- Model hint: sonnet
- Role: per-batch architecture conformance reviewer
- Inputs: changed files and pattern sources
- Outputs: `ARCHITECTURE_REVIEW`
- Key behaviors:
  - checks duplication, pattern reuse, layer integrity
  - references existing code as evidence
  - usually skipped for SIMPLES

### `final-adversarial-orchestrator`

- Folder: `agents/quality/final-adversarial-orchestrator.md`
- Model hint: opus
- Role: whole-diff independent review coordinator
- Inputs: all files across all batches
- Outputs: `FINAL_ADVERSARIAL_REPORT`
- Key behaviors:
  - spawns security, architecture, and quality reviewers in parallel
  - cross-references consensus and contradictions
  - exposes cross-batch issues

## Agent Families and Responsibilities

The simplest way to understand the system:

- Core agents control trust, validation, and closeout.
- Executor agents control scoped implementation.
- Quality agents control test planning, design planning, and independent review.

## Important Architectural Observation

There is a naming mismatch between conceptual reviewer roles in the controller and concrete files present in the repository.

Examples:

- final adversarial orchestrator refers to quality and security adversarial reviewers that are not present as standalone markdown files in the repository tree
- some responsibilities are therefore conceptual subroles rather than concrete repository files

This matters for Codex porting:

- some original "agents" are actually prompt concepts
- the Codex port should implement the behavior, not assume every conceptual reviewer already exists as an individual source file

## Codex Porting Priority

Highest-priority agents to port first:

1. `task-orchestrator`
2. `information-gate`
3. `quality-gate-router`
4. `pre-tester`
5. `executor-controller`
6. `executor-implementer-task`
7. `checkpoint-validator`
8. `review-orchestrator`
9. `adversarial-batch`
10. `final-validator`

Second wave:

- `design-interrogator`
- `plan-architect`
- `architecture-reviewer`
- `executor-fix`
- `finishing-branch`
- `final-adversarial-orchestrator`
