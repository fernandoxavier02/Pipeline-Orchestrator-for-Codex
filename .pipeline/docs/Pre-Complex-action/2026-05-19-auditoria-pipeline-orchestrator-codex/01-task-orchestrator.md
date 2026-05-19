# Task Orchestrator — Classification Report

**Date:** 2026-05-19
**Orchestrator version:** v2
**Phase:** 0 (Triagem)
**Request summary:** Audit da execucao, qualidade e todos os workflows do Pipeline Orchestrator para GPT Codex — usuario reporta muitas falhas e nao-cumprimento de contratos pelo agente.

---

## SSOT CONFLICT DETECTED (Phase 0 Blocker)

Before the full classification, three SSOT conflicts were found during evidence gathering. These are mandatory Phase 0 blockers per the pipeline discipline:

### CONFLICT-1: Agent Count — plugin.json vs pipeline-controller.md vs filesystem

| Source | Value | Authority Level |
|--------|-------|----------------|
| `.codex-plugin/plugin.json` | "45 agent prompts" | Public-facing manifest |
| `agents/core/pipeline-controller.md` (frontmatter) | "Dispatches 37 N2 agents" | Operational contract |
| `agents/**/*.md` actual filesystem count (excl. README) | 45 `.md` files | Ground truth |
| `prompts/**/*.md` additional count | 25 `.md` files | Ground truth |

**Conflict:** The public manifest says 45, the operational controller says 37, and the filesystem has 45 agent files not counting prompts. Three different numbers for the same claimed fact. Per CONSTITUTION.md: "SSOT acima de conveniencia" — the authoritative source must be identified and the drift corrected before pipeline execution.

**Severity:** P0 — manifests a false claim in the public-facing interface.

### CONFLICT-2: strictAgents Default — commands/pipeline.md vs src/index.ts vs SKILL.md

| Source | Claims | Authority Level |
|--------|--------|----------------|
| `commands/pipeline.md` | "`strictAgents = true` (Operational Default)" | Command contract |
| `skills/pipeline/SKILL.md` | "ALWAYS call `spawn_agent`... NEVER execute agent work inline" | Skill contract |
| `src/index.ts:548` | `options.strictAgents ?? isOperationalPipelineDispatch(request)` — no explicit `true` default | Runtime ground truth |
| `CODEX_HARNESS_ADEQUACY_REPORT.md` (prior audit) | "`strictAgents` defaults to `false`" | Adversarial finding |

**Conflict:** The command and skill documents claim `strictAgents = true` is the operational default, but the TypeScript runtime has no hard `true` default — it depends on `isOperationalPipelineDispatch` heuristic. This means the documented contract and the actual runtime behavior diverge on the single most critical safety property.

**Severity:** P0 — the central guarantee of real-agent execution is not enforced by the runtime.

### CONFLICT-3: Three Colliding Authorities (Architecture-Level SSOT Violation)

Per `CONSOLIDATED_ADVERSARIAL_REVIEW.md` finding #6 (pre-existing, confirmed by current read):

| Authority | Claims to be | Actually does |
|-----------|-------------|---------------|
| `skills/pipeline/SKILL.md` | "thin delegator — dispatch controller via spawn_agent" | Contains full protocol contracts, 449 lines |
| `agents/core/pipeline-controller.md` | N1 orchestrator dispatching 37 N2 agents | 35-line stub + reference to TypeScript |
| `src/controller/pipeline-controller.ts` | TypeScript runtime (executor) | 1,879-line state machine that IS the orchestrator |

**Conflict:** AGENTS.md §Order of Authority defines a clear hierarchy (skills > commands > src). But the actual orchestration logic sits in `src/`, not in the prompt-driven layer. The skill says it is a thin delegator; the TypeScript state machine makes all the decisions the skill and agent prompt claim to make.

**Severity:** P0 — this is the root cause of "contract non-compliance by the agent." The agent that users interact with does not follow the contracts written in markdown because those contracts have no enforcement pathway into the TypeScript runtime.

---

## CLASSIFICATION

```yaml
ORCHESTRATOR_DECISION:
  request: "Audit completa da execucao, qualidade e workflows do Pipeline Orchestrator para GPT Codex — muitas falhas e nao-cumprimento de contratos reportados pelo usuario"
  type: "Audit"
  complexity: "COMPLEXA"
  severity: "High"
  pipeline_variant: "audit-heavy"
  probable_files:
    - "src/controller/pipeline-controller.ts"
    - "src/dispatcher/single-agent-runner.ts"
    - "src/dispatcher/multi-agent-runner.ts"
    - "src/index.ts"
    - "skills/pipeline/SKILL.md"
    - "skills/audit-heavy/SKILL.md"
    - "agents/core/pipeline-controller.md"
    - "agents/core/task-orchestrator.md"
    - "agents/core/sentinel.md"
    - "agents/core/information-gate.md"
    - "hooks/dispatch-guard.cjs"
    - "hooks/sentinel-hook.cjs"
    - "hooks/edit-guard-hook.cjs"
    - "commands/pipeline.md"
    - ".codex-plugin/plugin.json"
    - "references/complexity-matrix.md"
    - "references/pipelines/audit-heavy.md"
    - "references/sentinel-integration.md"
    - "tests/bdd/real-agent-pipeline.feature.test.ts"
    - "tests/bdd/state-adapter-integration.feature.test.ts"
  has_spec: "No"
  spec_context: null
  notes: |
    SSOT CONFLICT DETECTED — 3 Phase 0 blockers identified:
    CONFLICT-1: Agent count: plugin.json=45, pipeline-controller.md=37, filesystem=45.
    CONFLICT-2: strictAgents default: commands/pipeline.md + SKILL.md claim 'true' as operational default, src/index.ts has no hard true default.
    CONFLICT-3: Three colliding authorities (SKILL.md thin delegator vs pipeline-controller.md N1 orchestrator vs src/controller/pipeline-controller.ts 1879-line state machine) with no SSOT — identified as root cause of contract non-compliance.

    ELEVATION: COMPLEXA justified by 3+ domains (runtime/prompts/hooks/tests), 6+ files in scope, architecture-level contract violations, and existing adversarial report confirming 12 CRITICAL + 12 HIGH findings.

    AUDIT SCOPE RECOMMENDATION: Per-contract audit cut (see section below) maximizes signal for the user's stated pain.
  execution: "pipeline"
  information_gate:
    status: "CLEAR"
    gaps_resolved: 0
  user_confirmed: false
  workflow:
    - "Phase 0: Classify + SSOT conflict detection (DONE — 3 blockers found)"
    - "Phase 0b: Information-gate — deep scope verification (NEXT)"
    - "Phase 0c: Design interrogator — audit scope decision tree"
    - "Phase 1: Plan Mode — audit execution order"
    - "Phase 2 Axis 1: Architecture + authority hierarchy — which layer actually executes?"
    - "Phase 2 Axis 2: Domain/SSOT — all three colliding authorities, contract drift"
    - "Phase 2 Axis 3: Contracts + API — spawn_agent, strictAgents, hook enforcement"
    - "Phase 2 Axis 4: Data/State — gate-log, sentinel-state, session-lock atomicity"
    - "Phase 2 Axis 5: Security — fail-open hooks, Bash bypass, prompt injection"
    - "Phase 2 Axis 6: Quality/Testing — 515 tests validating emulation shadow, not real behavior"
    - "Phase 3: Risk matrix assembly + Pa de Cal"
  risks:
    - "CRITICAL: runtime does not enforce its own written contracts (3 colliding authorities)"
    - "CRITICAL: strictAgents false default means production runs in emulation silently"
    - "HIGH: 12 pre-existing critical security findings (prior adversarial report, status unknown)"
    - "HIGH: hook fail-open conditions allow bypass of all gate enforcement"
    - "MEDIUM: 515 tests validate mocks inside emulation harness, not real Codex behavior"
    - "MEDIUM: agent count discrepancy in public manifest undermines trust in documentation"
```

---

## CLASSIFICATION RATIONALE

### Why Audit (not Bug Fix)

The user says "muitas falhas e nao-cumprimento de contratos" (many failures, contract non-compliance). There is no single reproducible crash with a specific root cause yet — the failure surface spans runtime architecture, hook enforcement, agent delegation, and documentation-to-code drift. The task is to map and evidence these failures across multiple axes before any fix is proposed. That is the definition of an Audit.

### Why COMPLEXA (not MEDIA)

Five dimensions all land in COMPLEXA territory simultaneously:

- **Files affected:** 20+ files across 6 distinct directories (src, skills, agents, hooks, commands, references, tests).
- **Domains:** at least 6 axes (architecture, contracts, security, data/state, quality/testing, harness adequacy).
- **Automatic elevation:** touches authentication and authorization via hook enforcement — minimum MEDIA. Touches data integrity via gate-log and sentinel-state. Prior audit found 12 CRITICAL security findings — production-grade concern.
- **Evidence quality:** three confirmed SSOT conflicts at Phase 0, before any analysis begins. That alone warrants COMPLEXA.
- **Scope:** the audit subject is the pipeline's own runtime — i.e., the infrastructure that governs ALL other work. Failure here propagates to every task the user runs through the plugin.

### Why audit-heavy (not audit-light)

Per `references/pipelines/audit-heavy.md`: "Use when audit covers more than 2 axes" — this audit has 6. Also: "Cross-cutting concerns are involved: persistence, concurrency, multi-user, identity, payment, idempotency, source of truth" — the sentinel, gate-log, session-lock, and dispatch-guard all qualify. And there is a prior baseline (AUDIT_CODEX_VS_CANONICAL.md, CONSOLIDATED_ADVERSARIAL_REVIEW.md, ARCHITECTURE_REVIEW_ROUND2.md) to verify regressions against — that is an explicit trigger for audit-heavy.

### Audit Scope Decomposition Recommendation

The user's pain ("many failures, contract non-compliance") points to a **per-contract audit cut** as the highest-signal approach, rather than a per-phase or per-failure-mode cut. Reasoning: the root cause is not in any single phase but in the gap between what contracts promise and what the runtime delivers. Mapping each contract (spawn_agent enforcement, gate hardness, sentinel checkpoints, hook coverage, review independence) to its actual runtime state will expose the failure modes directly.

Proposed axes in priority order:

1. **Authority conflict resolution** — which of the three authorities (SKILL.md, markdown agents, TypeScript) actually executes in production, and does the user know which one they are running?
2. **spawn_agent / strictAgents contract** — is the "real agent" promise reachable at all, under what conditions, and what happens when it is not?
3. **Hook enforcement coverage** — which hooks actually fire, which fail-open, and which can be bypassed?
4. **Gate hardness vs. actual enforcement** — do MANDATORY gates actually block, or do they emit warnings and continue?
5. **Sentinel checkpoint fidelity** — do the 5 checkpoints actually gate phase transitions, or are they advisory?
6. **Test coverage validity** — do the 515 tests validate real behavior or only emulation artifacts?

---

## EVIDENCE SOURCES

All findings above are tagged as [VERIFICADO] because they are drawn from existing files in the repository, not inferred:

- `CONSOLIDATED_ADVERSARIAL_REVIEW.md` — 12 CRITICAL + 12 HIGH + prior adversarial findings
- `AUDIT_CODEX_VS_CANONICAL.md` — canonical drift analysis vs Claude Code v5.2
- `ARCHITECTURE_REVIEW_ROUND2.md` — Round 2 architecture review
- `CODEX_HARNESS_ADEQUACY_REPORT.md` — harness adequacy verdict ("structural parity with semantic betrayal")
- `src/index.ts` — `strictAgents` default behavior
- `.codex-plugin/plugin.json` — "45 agent prompts" claim
- `agents/core/pipeline-controller.md` — "37 N2 agents" claim
- `filesystem count` — 45 agent `.md` files + 25 prompt `.md` files
- `commands/pipeline.md` — `strictAgents = true` claimed as operational default
- `skills/pipeline/SKILL.md` — "ALWAYS call spawn_agent" contract
- `references/complexity-matrix.md` — classification criteria (SSOT)
- `references/pipelines/audit-heavy.md` — audit-heavy selection criteria

---

*Generated by task-orchestrator v2 — 2026-05-19*
*Next: information-gate (Phase 0b)*
