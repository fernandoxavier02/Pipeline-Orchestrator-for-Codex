---
kind: pipeline-profile
variant: spec-heavy
type: Spec
complexity: COMPLEXA
intensity: heavy
batchSize: 1
summary: Spec lifecycle flow for complex requirements, design, tasks, adversarial review, and closure.
checklists:
  - auth
  - business-logic
  - data-integrity
  - error-handling
  - input-validation
---
# Spec Lifecycle Pipeline - Heavy

## When Selected
- Type: Spec
- Complexity: COMPLEXA

## Required Gates
- Phase 1: `SPEC_ARTIFACT_MISSING`, `SPEC_FORMAT_GATE_FAIL`
- Phase 2: `SPEC_CONTENT_REVIEW_NOGO`, `SPEC_AC_TRACEABILITY_GAP`
- Phase 3: `SPEC_POST_IMPL_FAIL`

## Discipline
- Execute in single-task batches with adversarial review after each batch.
- Keep requirements, design, tasks, runtime, tests, and docs aligned.
- Closure requires explicit post-implementation validator evidence.
