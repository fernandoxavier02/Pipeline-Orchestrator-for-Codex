---
kind: team-registry
routes:
  - profile: bugfix-heavy
    type: Bug Fix
    intensity: heavy
    mode: code-changing
    agents:
      - bugfix-diagnostic-agent
      - bugfix-root-cause-analyzer
      - executor-implementer-task
      - bugfix-regression-tester
    parallelGroups: []
    skipInLight: []
  - profile: bugfix-light
    type: Bug Fix
    intensity: light
    mode: code-changing
    agents:
      - bugfix-diagnostic-agent
      - bugfix-root-cause-analyzer
      - executor-implementer-task
      - bugfix-regression-tester
    parallelGroups: []
    skipInLight:
      - bugfix-root-cause-analyzer
  - profile: feature-heavy
    type: Feature
    intensity: heavy
    mode: code-changing
    agents:
      - feature-vertical-slice-planner
      - feature-implementer
      - feature-integration-validator
    parallelGroups: []
    skipInLight: []
  - profile: feature-light
    type: Feature
    intensity: light
    mode: code-changing
    agents:
      - feature-vertical-slice-planner
      - feature-implementer
      - feature-integration-validator
    parallelGroups: []
    skipInLight:
      - feature-integration-validator
  - profile: user-story-heavy
    type: User Story
    intensity: heavy
    mode: code-changing
    agents:
      - feature-vertical-slice-planner
      - feature-implementer
      - feature-integration-validator
    parallelGroups: []
    skipInLight: []
  - profile: user-story-light
    type: User Story
    intensity: light
    mode: code-changing
    agents:
      - feature-vertical-slice-planner
      - feature-implementer
      - feature-integration-validator
    parallelGroups: []
    skipInLight:
      - feature-integration-validator
  - profile: ux-sim-heavy
    type: UX Simulation
    intensity: heavy
    mode: report-only
    agents:
      - ux-simulator
      - ux-accessibility-auditor
      - ux-qa-validator
    parallelGroups:
      - 
        - ux-simulator
        - ux-accessibility-auditor
    skipInLight: []
  - profile: ux-sim-light
    type: UX Simulation
    intensity: light
    mode: report-only
    agents:
      - ux-simulator
      - ux-accessibility-auditor
      - ux-qa-validator
    parallelGroups: []
    skipInLight:
      - ux-accessibility-auditor
  - profile: spec-heavy
    type: Spec
    intensity: heavy
    mode: code-changing
    agents:
      - spec-format-gate
      - spec-content-reviewer
      - spec-post-impl-validator
      - spec-closer
    parallelGroups: []
    skipInLight: []
  - profile: spec-light
    type: Spec
    intensity: light
    mode: code-changing
    agents:
      - spec-format-gate
      - spec-content-reviewer
      - spec-post-impl-validator
      - spec-closer
    parallelGroups: []
    skipInLight: []
  - profile: spec-audit-only
    type: Spec
    intensity: light
    mode: report-only
    agents:
      - spec-format-gate
      - spec-content-reviewer
    parallelGroups: []
    skipInLight: []
    subRouteCondition: explicit spec audit-only invocation
  - profile: audit-heavy
    type: Audit
    intensity: heavy
    mode: report-only
    agents:
      - audit-intake
      - audit-domain-analyzer
      - audit-compliance-checker
      - audit-risk-matrix-generator
    parallelGroups: []
    skipInLight: []
  - profile: audit-light
    type: Audit
    intensity: light
    mode: report-only
    agents:
      - audit-intake
      - audit-domain-analyzer
      - audit-compliance-checker
      - audit-risk-matrix-generator
    parallelGroups: []
    skipInLight:
      - audit-domain-analyzer
  - profile: adversarial-heavy
    type: Audit
    intensity: heavy
    mode: review-fix
    agents:
      - adversarial-review-coordinator
      - adversarial-security-scanner
      - adversarial-architecture-critic
      - executor-implementer-task
    parallelGroups:
      - 
        - adversarial-security-scanner
        - adversarial-architecture-critic
    skipInLight: []
    subRouteCondition: adversarial keywords + user confirms
  - profile: adversarial-light
    type: Audit
    intensity: light
    mode: review-fix
    agents:
      - adversarial-review-coordinator
      - adversarial-security-scanner
      - adversarial-architecture-critic
      - executor-implementer-task
    parallelGroups: []
    skipInLight:
      - adversarial-architecture-critic
    subRouteCondition: adversarial keywords + user confirms
---
# Team Registry
This registry is the SSOT for mapping pipeline profiles to executable team shapes, parallel review groups, and report versus fix routing.
