# Source Inventory

## Purpose

This inventory lists the repository sources used to build the Codex mapping package and explains what role each source plays in understanding the original plugin.

Inspected local clone:

- `C:\Users\ferna\OneDrive\Documentos\Playground\.tmp\Pipeline-Orchestrator`

Canonical upstream:

- [Pipeline-Orchestrator](https://github.com/fernandoxavier02/Pipeline-Orchestrator)

## Control Files

### `commands/pipeline.md`

Role:

- primary runtime controller definition
- phase order
- mode behavior
- proposal and confirmation flow
- stop rules
- persistence expectations

Authority:

- highest

### `.claude-plugin/plugin.json`

Role:

- plugin metadata
- declared command integration
- packaging information

Authority:

- medium

### `.claude-plugin/marketplace.json`

Role:

- marketplace packaging and distribution metadata

Authority:

- low for runtime behavior, useful for packaging translation

### `hooks/hooks.json`

Role:

- hook declarations
- lifecycle wiring hints

Authority:

- high for startup and post-step behavior, but lower than the command controller for business flow

### `skills/pipeline/SKILL.md`

Role:

- user-facing skill wrapper
- summarized execution story
- positioning and intended usage

Authority:

- medium

## Agent Sources

### Core agents

- `agents/core/adversarial-batch.md`
- `agents/core/checkpoint-validator.md`
- `agents/core/final-validator.md`
- `agents/core/finishing-branch.md`
- `agents/core/information-gate.md`
- `agents/core/sanity-checker.md`
- `agents/core/task-orchestrator.md`
- `prompts/agents/core/checkpoint-validator.md`
- `prompts/agents/core/final-validator.md`
- `prompts/agents/core/information-gate.md`
- `prompts/agents/core/sanity-checker.md`
- `prompts/agents/core/sentinel.md`

Role:

- define orchestrator, gating, validation, closeout, and sanity-check behaviors

Authority:

- very high

### Executor agents

- `agents/executor/executor-controller.md`
- `agents/executor/executor-fix.md`
- `agents/executor/executor-implementer-task.md`
- `agents/executor/executor-quality-reviewer.md`
- `agents/executor/executor-spec-reviewer.md`
- `prompts/agents/executor/executor-fix.md`
- `prompts/agents/executor/executor-implementer.md`
- `prompts/agents/executor/executor-spec-reviewer.md`

Role:

- define batched delivery loop behavior
- implementation, review, and repair within a batch

Authority:

- very high

### Quality agents

- `agents/quality/architecture-reviewer.md`
- `agents/quality/design-interrogator.md`
- `agents/quality/final-adversarial-orchestrator.md`
- `agents/quality/plan-architect.md`
- `agents/quality/pre-tester.md`
- `agents/quality/quality-gate-router.md`
- `agents/quality/review-orchestrator.md`
- `prompts/agents/quality/architecture-reviewer.md`
- `prompts/agents/quality/design-interrogator.md`
- `prompts/agents/quality/final-adversarial-orchestrator.md`
- `prompts/agents/quality/plan-architect.md`
- `prompts/agents/quality/pre-tester.md`
- `prompts/agents/quality/quality-gate-router.md`
- `prompts/agents/quality/quality-reviewer.md`
- `prompts/agents/quality/review-orchestrator.md`
- `prompts/agents/quality/security-reviewer.md`

Role:

- define independent review, design skepticism, planning scrutiny, and final adversarial escalation

Authority:

- very high

## Routing and Reference Sources

### `references/complexity-matrix.md`

Role:

- complexity classification
- intensity routing
- planning/review expansion guidance

Authority:

- high

### `references/pipelines/*.md`

Inspected files:

- `audit-heavy.md`
- `audit-light.md`
- `adversarial-heavy.md`
- `adversarial-light.md`
- `bugfix-heavy.md`
- `bugfix-light.md`
- `implement-heavy.md`
- `implement-light.md`
- `user-story-heavy.md`
- `user-story-light.md`
- `ux-sim-heavy.md`
- `ux-sim-light.md`

Role:

- variant-specific runtime profiles

Authority:

- high

### `references/gates/macro-gate-questions.md`

Role:

- conditional question bank for macro information gate

Authority:

- high

### `references/gates/micro-gate-checklist.md`

Role:

- narrower execution and review checkpoint checks

Authority:

- high

## Checklist Sources

Inspected files:

- `references/checklists/auth.md`
- `references/checklists/business-logic.md`
- `references/checklists/crypto.md`
- `references/checklists/data-integrity.md`
- `references/checklists/error-handling.md`
- `references/checklists/injection.md`
- `references/checklists/input-validation.md`

Role:

- domain-specific adversarial review amplifiers

Authority:

- medium-high

## Supporting Documentation Sources

### `README.md`

Role:

- product positioning
- feature claims
- intended operator value proposition

Authority:

- medium

### `docs/adapter-guide.md`

Role:

- explains adaptation mindset across environments

Authority:

- medium-high

### Example flows

- `docs/examples/simple-bugfix.md`
- `docs/examples/medium-feature.md`
- `docs/examples/complex-audit.md`

Role:

- illustrate intended operator UX and expected flow shape

Authority:

- medium

### Planning rationale

- `docs/plans/2026-03-20-plan-architect-agent.md`

Role:

- captures upstream design reasoning not always visible in the short docs

Authority:

- medium-high

## Authority Order Used in This Mapping

When sources disagreed in emphasis or granularity, this documentation package used the following precedence:

1. `commands/pipeline.md`
2. `agents/**/*.md`
3. `references/complexity-matrix.md`
4. `references/pipelines/*.md`
5. `references/gates/*.md`
6. `references/checklists/*.md`
7. `hooks/hooks.json`
8. `skills/pipeline/SKILL.md`
9. `README.md` and other support docs

## Noted Interpretation Risks

### Documentation stronger than enforcement

Some sources describe desired behavior more strongly than the concrete files enforce it. This package favored explicit controller and prompt behavior over marketing-level claims.

### Orchestration meaning spread across files

No single file explains the entire system cleanly. The mapping therefore synthesizes behavior across controller, prompts, references, and examples.

### Conceptual roles may exceed file granularity

Some runtime descriptions imply composite reviewer combinations or orchestration patterns that are more conceptual than individually materialized as separate prompt files. Those were documented as behaviors where evidence supported them.
The current Codex port now materializes dedicated runtime prompt files for the shipped review orchestrators, final reviewers, and Phase 2/3 runtime roles, reducing this gap in the local implementation.

Current boundary:

- controller-owned ownership remains for phase transitions, gate decisions, rollback routing, and persistence writers
- runtime-dispatched roles now cover checkpoint validation, pre-testing, quality-gate routing, sanity checks, final validation, executor fixes, and review/final-adversarial work

## Coverage Statement

This inventory covers the files required to understand:

- phase order
- gates
- hardness
- prompts
- variants
- checklists
- hook intent
- resume assumptions
- Codex translation strategy

That is sufficient for a first implementation-oriented Codex specification package.
