# Information Gate — Phase 0b
**Pipeline:** Audit of Pipeline Orchestrator for Codex
**Date:** 2026-05-19
**Gate Status:** RESOLVED (no blockers)
**Agent:** information-gate

---

## Observability Header

```
+==================================================================+
|  INFORMATION-GATE (Macro-Gate)                                     |
|  Phase: 0b (Pre-Pipeline)                                          |
|  Status: RESOLVED                                                  |
|  Gaps detected: 4                                                  |
|  Gaps resolved: 4 (from filesystem inspection, no user Q&A needed) |
|  Blocker count: 0                                                  |
|  Next: design-interrogator (Phase 0c — mandatory for COMPLEXA)     |
+==================================================================+
```

---

## Gap Resolution Log

All gaps were resolved by reading the actual files. No user questions were needed.

---

### GAP-01: Agent Count Discrepancy (RESOLVED)

**Hypothesis from classification:** manifest claims 45, controller says 37, filesystem may differ.

**Evidence collected:**

| Source | Claim | File:Line |
|--------|-------|-----------|
| `plugin.json` shortDescription | "45 agent prompts" | `.codex-plugin/plugin.json:4` |
| `plugin.json` longDescription | "45 agent prompts" | `.codex-plugin/plugin.json:19` |
| `agents/core/pipeline-controller.md` frontmatter | "Dispatches **37** N2 agents" | `agents/core/pipeline-controller.md:3` |
| Filesystem (bash `find agents/ -name "*.md" | wc -l`) | **46** files total | — |
| Filesystem minus `agents/README.md` | **45** agent prompt files | — |

**Resolution:** The 37 figure in `pipeline-controller.md:3` is NOT a headcount of all agent files — it is the count of N2 agents dispatched by the controller (leaf executors), excluding the controller itself and orchestration-layer agents (brainstorm-controller, etc.). The plugin.json claim of 45 is the total inventory across all tiers. The filesystem count of 45 (excluding README.md) confirms the 45-agent inventory is accurate. The "37 dispatched by controller" is architecturally consistent but undocumented in the spec — a SSOT clarity gap, not a count error.

**Audit starting point:** `agents/core/pipeline-controller.md:3` vs `plugin.json:4` — the "37 vs 45" distinction needs explicit documentation in the agent manifest.

---

### GAP-02: `strictAgents` Default — Undefined vs Claimed Operational Default (RESOLVED)

**Hypothesis from classification:** spec claims `true` is operational default; `src/` may show otherwise.

**Evidence collected:**

| Location | Behavior | File:Line |
|----------|----------|-----------|
| `src/domain/pipeline-types.ts:42` | `strictAgents?: boolean` — optional, no default declared | `src/domain/pipeline-types.ts:42` |
| `src/index.ts:548` | `requireRealAgent: request.requireRealAgent ?? options.strictAgents ?? isOperationalPipelineDispatch(request)` — falls through to a third expression, NOT a boolean default of `true` | `src/index.ts:548` |
| `src/index.ts:691` | `requireRealAgent: options.strictAgents === true` — explicit false when unset | `src/index.ts:691` |
| `src/index.ts:701` | `requireRealAgent: options.strictAgents === true` — same pattern | `src/index.ts:701` |
| `src/cli/pipeline-cli.ts:54-55` | `strictAgents = true` only when `--strict-agents` flag is passed | `src/cli/pipeline-cli.ts:54-55` |
| `src/controller/pipeline-controller.ts:1107` | Blocks only when `runtime?.strictAgents && !runtime?.executionController` — so without explicit `strictAgents=true`, the block never fires | `src/controller/pipeline-controller.ts:1107` |
| `CODEX_HARNESS_ADEQUACY_REPORT.md:14` | Prior audit notes: "`options.strictAgents ?? false`" — this was the v0.4.0 path; v0.4.1 changed it to `??  isOperationalPipelineDispatch(request)` | `CODEX_HARNESS_ADEQUACY_REPORT.md:14` |
| `skills/pipeline/SKILL.md:33-45` | Claims "`strictAgents = true` (Operational)" is the production default and "production-grade use REQUIRES `strictAgents = true`" | `skills/pipeline/SKILL.md:33-45` |

**Resolution:** The divergence is confirmed and concrete. `skills/pipeline/SKILL.md:33-45` asserts `strictAgents = true` is the operational default. The actual TypeScript code never sets this default — `RuntimeOptions.strictAgents` is `?: boolean` (undefined when not passed), and the three evaluation points at `src/index.ts:548,691,701` and `src/controller/pipeline-controller.ts:1107` all treat "not provided" as falsy (emulation mode). The SKILL.md claim is a documentation promise with no code enforcement. This is a **live SSOT conflict** and a **primary cause of agent contract failures**.

---

### GAP-03: Three-Way Authority Conflict (RESOLVED)

**Hypothesis from classification:** SKILL.md says "thin delegator", controller spec says "I orchestrate", src/ controller actually does the work.

**Evidence collected:**

| Layer | Self-description | File:Line |
|-------|-----------------|-----------|
| `skills/pipeline/SKILL.md` | "You are the PIPELINE SKILL — a **thin delegator**. Your ONLY job is: 1. Open visible plan, 2. Show gate, 3. Read pipeline-controller.md, 4. Dispatch it as a worker agent via `spawn_agent`..." | `skills/pipeline/SKILL.md:50` |
| `agents/core/pipeline-controller.md` | "You are the **pipeline-controller** — the sole orchestrator of the pipeline-orchestrator plugin workflow." Dispatches 37 N2 agents. 1,471 lines. | `agents/core/pipeline-controller.md:1-9` |
| `src/controller/pipeline-controller.ts` | 1,885 lines of TypeScript. Contains classification, phase transitions, gate logic, confidence scoring, batch orchestration, spec lifecycle, continuation, workflow selection, proposal building, plan mode. It IS the runtime — the markdown prompt in `agents/core/pipeline-controller.md` exists but is never loaded at runtime by this file. | `src/controller/pipeline-controller.ts:1-1885` |

**Three-way contradiction confirmed:**
1. SKILL.md is a thin delegator that spawns the markdown agent via `spawn_agent`
2. `agents/core/pipeline-controller.md` is the markdown agent that supposedly does all the work
3. `src/controller/pipeline-controller.ts` is the actual runtime that does all the work — and never invokes the markdown prompt

**Additional confirmation from pre-existing audit:** `CONSOLIDATED_ADVERSARIAL_REVIEW.md:39` — "Canonical: 664 markdown files, 0 TS. Port: ~70 TS files, 11,783 lines of imperative code replacing LLM reasoning. Finding #12: Architectural inversion — 1,470-line canonical orchestrator prompt exists but is NEVER spawned; TypeScript state machine replaces it."

This is **the root identity crisis** of the plugin: three documents each claim to be the authority, and none of them accurately describes the actual runtime path.

---

### GAP-04: Failure Evidence — Where Are the "Many Failures"? (RESOLVED)

**Hypothesis:** The user reports "many failures and non-fulfillment of contracts by the agent." Are there TRACE.md, gate-decision logs, or incident reports?

**Evidence collected:**

- `TRACE.md`: Does not exist in the repo (no file found at any path).
- `.pipeline/gate-decisions.jsonl`: Does not exist (`.pipeline/` contains only `docs/` and `sessions/`).
- `.pipeline/sessions/audit.log`: Exists and contains 13 exec-window open/close pairs from test harness runs (all opened and closed cleanly — these are test executions, not production failures).
- `.pipeline/sessions/b7a9c366-4f74-4f2c-b277-df49a66921c8.lock`: A session lock file from the most recent run.

**Pre-existing audit reports (dated 2026-05-11) that document structural failures:**
- `AUDIT_CODEX_VS_CANONICAL.md` — Documents 3 critical gaps (GAP-1: controller truncated, GAP-2: emulation default, GAP-3: hoisting incomplete) and multiple functional gaps.
- `CODEX_HARNESS_ADEQUACY_REPORT.md` — Documents 4 critical findings: `spawn_agent` never called in default path, subagent delegation is "documentation theatre", multi-agent mode is local emulation, runtime is blind to host config.
- `CONSOLIDATED_ADVERSARIAL_REVIEW.md` — 12 critical + 12 high + 9 medium + 4 low findings. Dates 2026-05-11.
- `ARCHITECTURE_REVIEW_ROUND2.md` — Round 2 confirms Round 1 fixes were "indirection, not architecture"; deferred findings remain untouched.
- `.pipeline/docs/Pre-Medium-action/2026-05-19-adversarial-review-codex-plugin-builder/final-adversarial-report.md` — Most recent adversarial review (2026-05-19 today), which found ghost hook scripts, fail-open security defaults, dead skill routing, and SSOT drift.

**Resolution:** There is no live failure log (no TRACE.md, no gate-decisions.jsonl from a real production run). The "many failures" the user describes are structural — documented extensively in the four audit reports. The failure mode is not "the pipeline crashed" but "the pipeline runs silently in emulation mode and the agents don't actually execute with real independence or spawn_agent calls, so contracts (TDD gates, adversarial review independence, real multi-agent) are never fulfilled."

---

## Pre-Existing Evidence Index

These documents are inputs for the new audit — they should be incorporated, not rediscovered.

| Document | Summary | Relevance |
|----------|---------|-----------|
| `AUDIT_CODEX_VS_CANONICAL.md` (2026-05-11) | Canonical drift analysis: port replaced 664 markdown prompts with ~70 TS files. Identified GAP-1 (controller truncated), GAP-2 (emulation default), GAP-3 (hoisting incomplete). | Primary evidence base for the architecture audit dimension |
| `CODEX_HARNESS_ADEQUACY_REPORT.md` (2026-05-11) | Adversarial harness review: `spawn_agent` never called in default path (`src/index.ts:445`), `multi-agent-runner.ts` is `Promise.all` over local functions, runtime never reads `~/.codex/config.toml`. | Primary evidence for the harness/execution compliance dimension |
| `CONSOLIDATED_ADVERSARIAL_REVIEW.md` (2026-05-11) | 12 critical + 12 high + 9 medium + 4 low findings across Security, Architecture, and Harness dimensions. Finding #6 = three-way authority conflict; Finding #8 = `strictAgents` default; Finding #12 = architectural inversion. | Master findings register — audit should treat these as verified starting points |
| `ARCHITECTURE_REVIEW_ROUND2.md` (2026-05-11) | Round 2 confirms fixes were cosmetic; `state-adapter.ts` created but bypassed in critical path; controller still 1,876 lines; 515 tests validate shadows. | Establishes what was NOT fixed after Round 1 |
| `.pipeline/docs/Pre-Medium-action/2026-05-19-adversarial-review-codex-plugin-builder/final-adversarial-report.md` (2026-05-19) | 3-scanner adversarial pass on the plugin-builder skill artifact set. 5 consensus findings. Ghost hook scripts (C1), fail-open security (C2), dead skill routing (C3), SSOT drift (C4), unverified schema claims (C5). | Most recent audit — different scope (skill artifact) but reveals same systemic pattern of doc-promise vs. runtime reality |
| `CHANGELOG.md` + recent `git log` | Last 15 commits (since 2026-04-25) show pattern: `fix: restore codex pipeline operational runtime`, `Harden pipeline dispatch against missing agent runtime`, `Enforce real spawn_agent pipeline hooks` — repeated attempts to fix the same structural issue. | Confirms the failure pattern is recurring, not one-off |

---

## INFORMATION_GATE Decision Block

```yaml
INFORMATION_GATE:
  status: "RESOLVED"
  gaps_detected: 4
  gaps_resolved: 4
  gaps_remaining: 0
  severity_summary:
    blocker: 0
    important: 0
    informational: 0
  resolved_answers:
    - question: "What is the actual agent count — 45 (manifest), 37 (controller frontmatter), or something else?"
      answer: "45 agent files on disk (excluding README.md). The 37 figure is N2-agents-dispatched-by-controller, not total inventory. Both numbers are correct for their respective scopes but are undocumented as distinct concepts."
      impact: "Audit must clarify the 37 vs 45 distinction in the agent manifest SSOT."
      evidence: "plugin.json:4 (45), agents/core/pipeline-controller.md:3 (37), filesystem count=45"

    - question: "What is the strictAgents default in src/ and does it match the SKILL.md operational claim?"
      answer: "strictAgents is undefined by default in RuntimeOptions (pipeline-types.ts:42). SKILL.md:33-45 claims true is the operational default. The code never enforces this — all three evaluation points treat undefined as falsy (emulation). The divergence is confirmed with line numbers."
      impact: "Root cause of agent contract failures: the system runs in emulation mode silently. Audit must remediate or formally document which is authoritative."
      evidence: "src/domain/pipeline-types.ts:42, src/index.ts:548,691,701, src/controller/pipeline-controller.ts:1107, skills/pipeline/SKILL.md:33-45"

    - question: "Is the three-way authority conflict (SKILL.md thin delegator / controller.md orchestrator / controller.ts runtime) confirmed with file:line?"
      answer: "Confirmed. skills/pipeline/SKILL.md:50 says thin delegator. agents/core/pipeline-controller.md:1-9 says sole orchestrator (1,471 lines). src/controller/pipeline-controller.ts (1,885 lines) is the actual runtime — it never loads the markdown prompt. All three claim authority; only the TS file actually executes."
      impact: "Audit must establish SSOT hierarchy and determine whether the markdown agent (pipeline-controller.md) should be deprecated, the TS controller should be documented as the real orchestrator, or the SKILL.md delegation chain should be made operational."
      evidence: "skills/pipeline/SKILL.md:50, agents/core/pipeline-controller.md:3,9, src/controller/pipeline-controller.ts:1-1885, CONSOLIDATED_ADVERSARIAL_REVIEW.md Finding #6 and #12"

    - question: "Where is the evidence for the 'many failures' the user reports — TRACE.md, gate-decisions.jsonl, recent incident logs?"
      answer: "No TRACE.md exists. No gate-decisions.jsonl from a real production run exists. The .pipeline/sessions/audit.log contains only test harness exec-window events. The failures are structural: the system silently runs in emulation mode, so contracts (real spawn_agent, real adversarial review, real TDD gate enforcement) are never fulfilled. Four audit reports from 2026-05-11 and one from today document this pattern comprehensively."
      impact: "Audit should treat the four pre-existing reports as the failure evidence corpus and focus on what has changed (or not) since 2026-05-11, plus the recurring fix-then-regress pattern visible in git log."
      evidence: "CONSOLIDATED_ADVERSARIAL_REVIEW.md, CODEX_HARNESS_ADEQUACY_REPORT.md, AUDIT_CODEX_VS_CANONICAL.md, ARCHITECTURE_REVIEW_ROUND2.md, git log (fix: restore / Harden / Enforce commits)"

  remaining_gaps: []

  recommended_next_agent: "design-interrogator"
  next_agent_rationale: "Phase 0c is mandatory for COMPLEXA classification. The design-interrogator must interrogate the three-way authority conflict, the strictAgents enforcement gap, and scope whether the audit should recommend remediation (fix the TS runtime to honor strictAgents=true by default) or reclassification (formally document the TypeScript state machine as the real orchestrator and deprecate the agent delegation chain). These are architectural decisions the user must confirm before audit scope is finalized."
```

---

*Gate completed by information-gate agent. No user questions were required — all gaps resolved from filesystem inspection and pre-existing audit evidence.*
