---
kind: pipeline-profile
variant: bugfix-light
type: Bug Fix
complexity: MEDIA
intensity: light
batchSize: 2
summary: A focused bug fix with a narrow reproduction path and limited blast radius.
checklists:
  - error-handling
  - input-validation
  - data-integrity
---
# bugfix-light
Use this profile when the failure is easy to reproduce and the fix stays local.
