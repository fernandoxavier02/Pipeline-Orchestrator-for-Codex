---
kind: pipeline-profile
variant: audit-light
type: Audit
complexity: MEDIA
intensity: light
batchSize: 2
summary: A targeted audit with a small surface area and a bounded set of review questions.
checklists:
  - business-logic
  - data-integrity
---
# audit-light
Use this profile for short audits that validate a small slice of behavior.
