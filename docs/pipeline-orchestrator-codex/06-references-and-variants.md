# References and Variants

## Overview

The repository does not implement a single monolithic pipeline.

It implements a routing system that chooses among pipeline variants according to work type, complexity, and severity. The references folder is therefore operational, not decorative. A Codex port should treat these documents as control inputs.

## Complexity Matrix

Primary file:

- `references/complexity-matrix.md`

This is the central classification reference used during phase 0 and proposal generation.

It maps work into a three-level complexity model:

- simple
- medium
- complex

The matrix considers at least these dimensions:

- task type
- file count or likely scope
- architectural impact
- uncertainty
- risk level
- need for review depth

### Functional Role

The complexity matrix drives:

- proposal shape
- whether planning is compressed or expanded
- batch sizing
- review intensity
- gate strictness
- likelihood of final adversarial escalation

In Codex, this should become structured controller logic rather than remaining free-text guidance.

## Pipeline Variants

Primary directory:

- `references/pipelines/`

The repository defines ten variant documents.

### Implement Family

- `implement-light.md`
- `implement-heavy.md`

Used when the main task is adding or changing product behavior.

`light` is optimized for low-risk implementation with reduced ceremony.  
`heavy` increases planning, review, and validation depth.

### Bugfix Family

- `bugfix-light.md`
- `bugfix-heavy.md`

Used when the main task is correcting broken behavior.

The heavier variant emphasizes root-cause validation, regression prevention, and stronger verification expectations.

### Audit Family

- `audit-light.md`
- `audit-heavy.md`

Used for review-only or analysis-first requests.

The heavy variant tends to emphasize stronger adversarial review, broader surface inspection, and more explicit risk reporting.

### User Story Family

- `user-story-light.md`
- `user-story-heavy.md`

Used when a request is framed as a user-facing requirement rather than a narrow code diff.

These variants bias toward requirements clarity, acceptance criteria coverage, and end-to-end coherence.

### UX Simulation Family

- `ux-sim-light.md`
- `ux-sim-heavy.md`

Used when experience validation or flow simulation is the main focus.

These variants amplify design interrogation, usability skepticism, and scenario-level review.

## What the Variant Files Contribute

The variant documents contribute more than naming. They effectively tune:

- which phases are emphasized
- how much planning is needed
- how many review layers are required
- what kinds of gates are expected
- how aggressive the adversarial passes should be

For a Codex implementation, the ideal port is not "load a markdown file and improvise." The ideal port is:

1. encode each variant as a runtime profile
2. expose the profile in the proposal
3. persist the chosen profile in state
4. use it to configure agent dispatch, gate thresholds, and loop caps

## Gate Reference Files

Primary directory:

- `references/gates/`

Files inspected:

- `macro-gate-questions.md`
- `micro-gate-checklist.md`

### Macro Gate Questions

`macro-gate-questions.md` provides conditional question banks for the information gate.

Its purpose is to determine whether the pipeline can proceed without dangerous ambiguity. The key behavior is selective questioning:

- do not ask everything
- ask only what the current request actually requires
- prioritize blockers and important ambiguities

### Micro Gate Checklist

`micro-gate-checklist.md` provides implementation-time and review-time checks.

It is used to inspect narrower correctness dimensions such as:

- edge cases
- failure modes
- consistency with plan
- test sufficiency
- data or contract safety

The macro gate protects entry. The micro gate protects transitions within execution and review.

## Security and Robustness Checklists

Primary directory:

- `references/checklists/`

Files inspected:

- `auth.md`
- `business-logic.md`
- `crypto.md`
- `data-integrity.md`
- `error-handling.md`
- `injection.md`
- `input-validation.md`

These are review augmenters. They deepen adversarial review according to the domains touched by the current batch or change.

### `auth.md`

Focuses on authentication and authorization correctness.

Typical concerns:

- privilege boundaries
- role enforcement
- session assumptions
- token misuse

### `business-logic.md`

Focuses on domain-rule correctness.

Typical concerns:

- policy drift
- invalid state transitions
- missing invariants
- mismatch between business intent and implementation behavior

### `crypto.md`

Focuses on cryptographic misuse.

Typical concerns:

- unsafe primitives
- incorrect key handling
- weak randomness
- insecure storage or transmission assumptions

### `data-integrity.md`

Focuses on persistence and consistency risks.

Typical concerns:

- transaction boundaries
- race conditions
- referential integrity
- destructive update behavior

### `error-handling.md`

Focuses on how failure propagates.

Typical concerns:

- swallowed exceptions
- missing recovery
- misleading success paths
- poor operator visibility

### `injection.md`

Focuses on code and command injection classes.

Typical concerns:

- SQL injection
- command injection
- template injection
- unsafe interpolation

### `input-validation.md`

Focuses on input trust boundaries.

Typical concerns:

- unchecked inputs
- normalization gaps
- unexpected types or formats
- dangerous defaults

## Glossary

Primary file:

- `references/glossary.md`

The glossary is important because the repository uses pipeline-specific language such as:

- gate
- hardness
- blocker
- important gap
- proposal
- batch
- checkpoint
- adversarial review
- confidence score

A Codex port should preserve terminology where it improves operator clarity, but should avoid terms whose mechanism no longer exists exactly.

## Supporting Documentation

Additional documents improve interpretation of the runtime:

- `README.md`
- `docs/adapter-guide.md`
- `docs/examples/simple-bugfix.md`
- `docs/examples/medium-feature.md`
- `docs/examples/complex-audit.md`
- `docs/plans/2026-03-20-plan-architect-agent.md`

### Why These Matter

- `README.md` expresses the intended product positioning and claims.
- `adapter-guide.md` explains how to adapt the pipeline to different environments.
- the examples show intended operator experience, not just internal mechanics
- the plan document captures design reasoning that is sometimes stronger than the final implementation artifact

## Authority Order

For future Codex implementation work, the most useful reference precedence is:

1. `commands/pipeline.md`
2. agent prompts in `agents/`
3. routing references in `references/complexity-matrix.md` and `references/pipelines/`
4. gate references in `references/gates/` and `references/checklists/`
5. plugin manifest and hooks
6. README and example docs

This order matters because the repository mixes product description and operational definition. The controller and prompts define behavior; the README mainly describes intent.
