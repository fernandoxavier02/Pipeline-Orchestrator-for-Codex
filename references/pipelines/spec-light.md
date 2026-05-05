---
kind: pipeline-profile
variant: spec-light
type: Spec
complexity: MEDIA
intensity: light
batchSize: 2
summary: Spec lifecycle flow for medium-scope requirements, design, tasks, and traceability.
checklists:
  - business-logic
  - error-handling
  - input-validation
---
# Spec Lifecycle Pipeline - Light

## When Selected
- Type: Spec
- Complexity: MEDIA

## Required Gates
- Phase 1: `SPEC_ARTIFACT_MISSING`, `SPEC_FORMAT_GATE_FAIL`
- Phase 2: `SPEC_CONTENT_REVIEW_NOGO`, `SPEC_AC_TRACEABILITY_GAP`
- Phase 3: `SPEC_POST_IMPL_FAIL`

## Discipline
- Keep `.kiro/specs/<feature>/requirements.md`, `design.md`, and `tasks.md` as the target artifact set.
- Acceptance criteria must map to verifiable task, test, code, or document evidence.
- Post-implementation closure requires explicit validator evidence.
