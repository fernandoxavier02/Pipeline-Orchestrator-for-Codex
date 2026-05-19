# Design Interrogator — Phase 0c
**Pipeline:** Auditoria do Pipeline Orchestrator para Codex
**Date:** 2026-05-19
**Gate Status:** RESOLVED (all 4 branches resolved by user)
**Agent:** design-interrogator

---

## Observability Header

```
+==================================================================+
|  DESIGN-INTERROGATOR - COMPLETE                                  |
|  Phase: 0c (Post Information-Gate)                               |
|  Decisions explored: 4                                           |
|  Decisions resolved: 4                                           |
|  Self-answered (from codebase): 0                                |
|  Status: RESOLVED                                                |
|  Next: Phase 1 — Pipeline Proposal (audit-architect)            |
+==================================================================+
```

---

## Decision Tree (Pre-Interrogation Map)

```
Root: How should the audit be scoped and structured?
├── B1: What deliverable format? (roadmap vs verdict vs both)
├── B2: How to weight the 6 audit axes?
│   └── Sub: Maximum depth on which axes?
├── B3: How to handle the 12 CRITICAL + 12 HIGH pre-existing findings?
│   └── Sub: Regression-check each? Accept as closed? Spot-check only?
└── B4: How to handle recurring systemic patterns across prior audits?
    └── Sub: Enumerate each independently or name + consolidate patterns?
```

---

## Gate Responses Received

| Gate | Question | User Choice |
|------|----------|-------------|
| B1 | Deliverable format | "Ambos — roadmap + veredicto" |
| B2 | Axis depth weighting | "Pesos diferenciados: 1+2+3 máximo, 4+5+6 médio" |
| B3 | Prior findings handling | "Regression-check cada achado — verificar still-open/closed" |
| B4 | Systemic pattern treatment | "Nomear + consolidar padrões sistêmicos" |

---

## DESIGN_INTERROGATION

```yaml
DESIGN_INTERROGATION:
  status: "RESOLVED"
  total_decisions: 4
  self_answered: 0
  user_decided: 4

  decisions:
    - id: "B1"
      title: "Deliverable Format — Dual Output"
      decision: "Produce BOTH a structured remediation roadmap AND an explicit audit verdict."
      rationale: |
        The user wants two things simultaneously:
        (a) a verdict — a clear pass/fail/critical judgment on the current state of the pipeline
            runtime, suitable for deciding whether to continue using it or halt;
        (b) a roadmap — a sequenced, actionable list of what to fix and in what order.
        Neither alone is sufficient: verdict without roadmap leaves the user knowing it is broken
        but not what to do; roadmap without verdict buries the lead and obscures the severity.
      source: "USER_DECIDED"
      evidence: "user response: 'Ambos — roadmap + veredicto'"
      effect_on_phase_1: |
        The plan-architect must structure the audit report template with two top-level sections:
        VERDICT (severity rating, confidence, single-sentence finding) at the front, and
        REMEDIATION_ROADMAP (sequenced by priority) at the back. Every audit axis contributes
        to both sections — findings feed the verdict severity, and remediations feed the roadmap.

    - id: "B2"
      title: "Axis Depth Weighting — Differentiated by Priority"
      decision: |
        Axes 1+2+3 (Authority conflict, spawn_agent/strictAgents, Hook enforcement) receive
        MAXIMUM depth: full line-by-line code reading, explicit contract mapping, live test
        execution tracing where possible. Axes 4+5+6 (Gate hardness, Sentinel fidelity, Test
        coverage validity) receive MEDIUM depth: pattern-level verification, sampled evidence,
        no exhaustive line scan.
      rationale: |
        Axes 1-3 are the root causes confirmed in the Information Gate (CONFLICT-1, -2, -3).
        They are the reason contracts fail. Spending maximum effort there maximizes signal.
        Axes 4-6 are downstream symptoms — important for completeness but verifiable at
        sample depth without full exhaustion. Differentiated weighting avoids equal-treatment
        dilution where everything gets shallow coverage.
      source: "USER_DECIDED"
      evidence: "user response: 'Pesos diferenciados: 1+2+3 máximo, 4+5+6 médio'"
      effect_on_phase_1: |
        The plan-architect assigns DEPTH:FULL to axes 1, 2, 3 and DEPTH:MEDIUM to axes 4, 5, 6
        in the audit execution plan. File reading budget: axes 1-3 get unlimited reads with
        full context windows; axes 4-6 get grep-and-sample approach. Time allocation reflects
        the same split (estimate: ~60% effort on axes 1-3, ~40% on 4-6).

    - id: "B3"
      title: "Prior Findings Handling — Full Regression-Check"
      decision: |
        Every one of the 12 CRITICAL + 12 HIGH findings from CONSOLIDATED_ADVERSARIAL_REVIEW.md
        (and the 4 critical findings from CODEX_HARNESS_ADEQUACY_REPORT.md and 3 gaps from
        AUDIT_CODEX_VS_CANONICAL.md) must be individually regression-checked. Each finding
        receives a status of: STILL_OPEN | CLOSED | REGRESSED | MUTATED (changed form but
        not resolved).
      rationale: |
        The git log shows a repeating pattern of "fix: restore / Harden / Enforce" commits
        suggesting the same root causes are addressed superficially and then regress.
        Accepting prior findings as "closed" without verification would miss this pattern.
        Spot-checking would risk leaving critical findings unexamined. Full regression-check
        is the only approach that can definitively answer whether any prior fix actually held.
        The user's framing ("muitas falhas e nao-cumprimento de contratos") implies they
        believe fixes were incomplete — the regression-check validates or refutes that belief
        with evidence.
      source: "USER_DECIDED"
      evidence: "user response: 'Regression-check cada achado — verificar still-open/closed'"
      effect_on_phase_1: |
        The plan-architect must include a REGRESSION_MATRIX section in the audit plan:
        a table with one row per prior finding (12+12+4+3 = 31 findings minimum),
        columns [Finding_ID | Source_Doc | Original_Severity | Current_Status | Evidence:Line].
        This matrix is produced before new findings are added, so that the audit report
        distinguishes between "old finding, now closed" vs "old finding, still open" vs
        "new finding not in any prior audit."

    - id: "B4"
      title: "Systemic Pattern Treatment — Name and Consolidate"
      decision: |
        When multiple findings share a root cause or failure mode, the audit must explicitly
        name the systemic pattern and consolidate it as a named entry in the report. Individual
        findings are still listed, but they are grouped under their pattern name with a
        pattern-level recommendation that addresses root cause rather than symptoms.
      rationale: |
        The four prior audits all independently found the same core failure: documentation
        promises that have no enforcement pathway into the TypeScript runtime. If the new
        audit lists each manifestation separately (strictAgents, spawn_agent, hook fail-open,
        test mocks, agent count drift) without naming the pattern, the roadmap will produce
        12 isolated fixes instead of 1 architectural fix that closes all 12. Named patterns
        force the roadmap to operate at the right level of abstraction. It also makes the
        verdict more legible — "3 systemic patterns, 31 individual findings" is a clearer
        health signal than "31 findings of varying severity."
      source: "USER_DECIDED"
      evidence: "user response: 'Nomear + consolidar padrões sistêmicos'"
      effect_on_phase_1: |
        The plan-architect adds a SYSTEMIC_PATTERNS section to the audit template, appearing
        between the VERDICT and the REMEDIATION_ROADMAP. Each pattern gets: a name (e.g.,
        "Doc-Promise / Runtime-Silence Gap"), a definition (the failure mode), a count of
        findings it subsumes, and a pattern-level remediation. The roadmap then cross-references
        pattern names so that individual fixes are clearly linked to their root cause.

  design_summary: |
    The audit will produce a dual deliverable — a front-loaded VERDICT (severity + confidence)
    followed by a REMEDIATION_ROADMAP — with differentiated depth: full exhaustive analysis on
    the three authority-conflict axes (which layer actually executes, does strictAgents enforce
    anything, do hooks actually block) and medium-depth sampling on the three downstream axes
    (gate hardness, sentinel fidelity, test validity). All 31+ prior findings from the four
    existing audit reports will be individually regression-checked and assigned a current status
    (still-open, closed, regressed, or mutated), and recurring failure modes will be named as
    systemic patterns with pattern-level remediations that address root cause rather than
    individual symptoms. This design maximizes the chance of producing one fix that closes
    many findings rather than many fixes that each close one.

  unresolved: []

  audit_blueprint_inputs:
    dual_deliverable:
      format: "VERDICT + REMEDIATION_ROADMAP"
      verdict_position: "Front of report — before any finding list"
      verdict_contents:
        - "Overall severity rating (CRITICAL / HIGH / MEDIUM / LOW)"
        - "Confidence level (0-100%) with evidence basis"
        - "Single-sentence finding (the one thing that explains all the failures)"
        - "Is-it-safe-to-run verdict (yes / conditional / no)"
      roadmap_position: "Back of report — after findings and patterns"
      roadmap_contents:
        - "Sequenced fix list by priority (P0 / P1 / P2)"
        - "Each fix cross-referenced to finding IDs and pattern name"
        - "Estimated impact (how many findings this fix closes)"
        - "Effort estimate (hours / complexity)"

    audit_axes:
      - axis: 1
        title: "Authority Conflict Resolution"
        description: "Which of the three authorities (SKILL.md, pipeline-controller.md, pipeline-controller.ts) actually executes in production? Does the user run the contract they think they run?"
        depth: "FULL"
        key_files:
          - "skills/pipeline/SKILL.md"
          - "agents/core/pipeline-controller.md"
          - "src/controller/pipeline-controller.ts"
          - "src/index.ts"
        prior_findings: ["Finding #6 (three-way conflict)", "Finding #12 (architectural inversion)", "GAP-3 (hoisting incomplete)"]

      - axis: 2
        title: "spawn_agent / strictAgents Contract Enforcement"
        description: "Is the real-agent promise reachable at all? Under what conditions? What happens when it is not — silent emulation or visible error?"
        depth: "FULL"
        key_files:
          - "src/index.ts (lines 548, 691, 701)"
          - "src/domain/pipeline-types.ts (line 42)"
          - "src/controller/pipeline-controller.ts (line 1107)"
          - "src/dispatcher/single-agent-runner.ts"
          - "src/dispatcher/multi-agent-runner.ts"
          - "skills/pipeline/SKILL.md (lines 33-45)"
          - "commands/pipeline.md"
        prior_findings: ["Finding #8 (strictAgents default)", "CODEX-C1 (spawn_agent never called)", "CODEX-C2 (multi-agent is Promise.all emulation)", "GAP-2 (emulation default)"]

      - axis: 3
        title: "Hook Enforcement Coverage"
        description: "Which hooks actually fire? Which fail-open? Which can be bypassed with a direct Bash call?"
        depth: "FULL"
        key_files:
          - "hooks/dispatch-guard.cjs"
          - "hooks/sentinel-hook.cjs"
          - "hooks/edit-guard-hook.cjs"
          - ".claude/settings.json (hook registration)"
        prior_findings: ["C1 ghost hook scripts", "C2 fail-open security defaults", "Security findings #1-#4"]

      - axis: 4
        title: "Gate Hardness vs Actual Enforcement"
        description: "Do MANDATORY gates actually block phase transitions, or do they emit warnings and continue? Sample 3-4 gate paths."
        depth: "MEDIUM"
        key_files:
          - "src/controller/pipeline-controller.ts (gate logic sections)"
          - "references/sentinel-integration.md"
          - "agents/core/sentinel.md"
        prior_findings: ["Finding #7 (gate softness)", "CODEX-C3 (harness blind)"]

      - axis: 5
        title: "Sentinel Checkpoint Fidelity"
        description: "Do the 5 sentinel checkpoints actually gate phase transitions, or are they advisory? Check sentinel-state.json coupling."
        depth: "MEDIUM"
        key_files:
          - "agents/core/sentinel.md"
          - ".pipeline/sessions/sentinel-state.json"
          - "src/controller/pipeline-controller.ts (sentinel call sites)"
        prior_findings: ["Finding #9 (checkpoint advisory)", "CODEX-C4 (runtime blind to config)"]

      - axis: 6
        title: "Test Coverage Validity"
        description: "Do the 515 tests validate real behavior or only emulation artifacts? Sample 10 tests across the BDD suite."
        depth: "MEDIUM"
        key_files:
          - "tests/bdd/real-agent-pipeline.feature.test.ts"
          - "tests/bdd/state-adapter-integration.feature.test.ts"
          - "tests/ (count and category scan)"
        prior_findings: ["Finding #11 (tests validate shadows)", "ARCHITECTURE_REVIEW_ROUND2 — 515 tests on emulation harness"]

    regression_matrix:
      source_documents:
        - "CONSOLIDATED_ADVERSARIAL_REVIEW.md — 12 CRITICAL + 12 HIGH findings"
        - "CODEX_HARNESS_ADEQUACY_REPORT.md — 4 critical findings (CODEX-C1 through CODEX-C4)"
        - "AUDIT_CODEX_VS_CANONICAL.md — 3 critical gaps (GAP-1, GAP-2, GAP-3)"
        - "ARCHITECTURE_REVIEW_ROUND2.md — Round 2 deferred findings"
        - ".pipeline/docs/Pre-Medium-action/2026-05-19-adversarial-review-codex-plugin-builder/final-adversarial-report.md — 5 consensus findings (C1-C5)"
      required_status_values: ["STILL_OPEN", "CLOSED", "REGRESSED", "MUTATED"]
      output_format: "Table with columns: Finding_ID | Source_Doc | Original_Severity | Current_Status | Evidence:Line | Notes"
      placement: "Produced BEFORE new findings — clearly separated from new discovery"

    systemic_patterns:
      instruction: |
        After the regression matrix and new findings are complete, identify recurring failure
        modes and give each a name. Required pattern structure:
          - pattern_name: short, memorable label
          - definition: what the failure mode is (1-2 sentences)
          - finding_ids: list of finding IDs that map to this pattern
          - pattern_level_remediation: the architectural fix that closes all member findings
      candidate_patterns_from_prior_audits:
        - "Doc-Promise / Runtime-Silence Gap: written contracts (SKILL.md, commands/pipeline.md, agents/) have no enforcement pathway into TypeScript runtime"
        - "Fix-then-Regress Cycle: same root causes addressed superficially, re-appear across successive audit cycles (visible in git log)"
        - "Authority Fragmentation: three layers each claim to be orchestrator, none consistently is"
        - "Emulation Theatre: the system executes production code paths but silently degrades to local emulation without surfacing this to the user"

    report_structure:
      - section: "VERDICT"
        position: 1
        contents: "severity + confidence + single-sentence finding + is-it-safe-to-run"

      - section: "REGRESSION_MATRIX"
        position: 2
        contents: "Table of all prior findings with current open/closed/regressed status"

      - section: "NEW_FINDINGS"
        position: 3
        contents: "Findings not present in any prior audit, by axis"

      - section: "SYSTEMIC_PATTERNS"
        position: 4
        contents: "Named patterns with finding membership and pattern-level remediations"

      - section: "REMEDIATION_ROADMAP"
        position: 5
        contents: "P0 / P1 / P2 sequenced fix list cross-referenced to patterns and findings"
```

---

*Design interrogation completed — 2026-05-19*
*All 4 branches resolved by user via GATE_RESPONSES.*
*Next: Phase 1 — plan-architect (audit execution plan)*
