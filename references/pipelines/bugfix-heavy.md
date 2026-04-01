---
kind: pipeline-profile
variant: bugfix-heavy
type: Bug Fix
complexity: COMPLEXA
intensity: heavy
batchSize: 1
summary: A bug fix that alters persistence, state transitions, or several dependent behaviors.
checklists:
  - data-integrity
  - error-handling
  - input-validation
---
# bugfix-heavy
Use this profile when the bug crosses state, persistence, or workflow boundaries.
