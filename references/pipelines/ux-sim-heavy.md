---
kind: pipeline-profile
variant: ux-sim-heavy
type: UX Simulation
complexity: COMPLEXA
intensity: heavy
batchSize: 1
summary: A full journey simulation that touches business logic, validation, and recovery paths.
checklists:
  - business-logic
  - error-handling
  - input-validation
---
# ux-sim-heavy
Use this profile when the journey spans multiple decision points or fallback paths.
