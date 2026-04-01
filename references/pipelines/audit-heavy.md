---
kind: pipeline-profile
variant: audit-heavy
type: Audit
complexity: COMPLEXA
intensity: heavy
batchSize: 1
summary: A sensitive audit spanning trust boundaries, security, or data-handling concerns.
checklists:
  - auth
  - crypto
  - data-integrity
  - error-handling
  - injection
---
# audit-heavy
Use this profile for deeper audits that need security and data-flow scrutiny.
