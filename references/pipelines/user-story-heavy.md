---
kind: pipeline-profile
variant: user-story-heavy
type: User Story
complexity: COMPLEXA
intensity: heavy
batchSize: 1
summary: A user story with cross-system behavior, state changes, or stricter acceptance risk.
checklists:
  - business-logic
  - data-integrity
  - error-handling
  - input-validation
---
# user-story-heavy
Use this profile when the story touches workflows, persistence, or multiple validation layers.
