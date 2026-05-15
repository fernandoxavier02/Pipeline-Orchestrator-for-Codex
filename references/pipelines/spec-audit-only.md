---
kind: pipeline-profile
variant: spec-audit-only
type: Spec
complexity: MEDIA
intensity: light
batchSize: 1
summary: Read-only spec lifecycle audit that validates existing spec artifacts without implementation.
checklists:
  - business-logic
  - error-handling
  - input-validation
---
# Spec Audit-Only Pipeline

## When Selected
- Type: Spec
- Mode: audit-only
- Effect: report-only validation of existing spec artifacts.

## Team Composition
- spec-format-gate
- spec-content-reviewer

## Runtime Contract
- Requires `requirements.md`, `design.md`, and `tasks.md` in the selected spec path.
- Does not enter implementation.
- Emits blocking gates for missing artifacts, malformed spec content, or missing review evidence.
