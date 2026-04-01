---
kind: pipeline-profile
variant: implement-heavy
type: Feature
complexity: COMPLEXA
intensity: heavy
batchSize: 1
summary: Feature work that touches state, workflow, or multiple review domains.
checklists:
  - business-logic
  - data-integrity
  - error-handling
  - input-validation
---
# implement-heavy
Use this profile when the feature changes behavior across multiple components or trust boundaries.
