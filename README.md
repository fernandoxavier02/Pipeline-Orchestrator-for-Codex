<p align="center">
  <img src="https://img.shields.io/badge/Codex_CLI-Plugin-14532D?style=for-the-badge&logo=openai&logoColor=white" alt="Codex Plugin" />
  <img src="https://img.shields.io/badge/Kimi_CLI-Skill-0066FF?style=for-the-badge" alt="Kimi Skill" />
  <img src="https://img.shields.io/badge/version-0.5.1-blue?style=for-the-badge" alt="Version" />
  <img src="https://img.shields.io/badge/agents-45-orange?style=for-the-badge" alt="Agents" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=for-the-badge" alt="License" />
</p>

# Pipeline Orchestrator for Codex

> **Full-depth, prompt-driven multi-agent pipeline for OpenAI Codex CLI and Kimi Code CLI.**
> Ported toward parity with the local canonical Claude Code Pipeline Orchestrator v5.2.0, with runtime-native constraints made explicit for each platform.

A single `/pipeline-orchestrator-for-codex:pipeline` command classifies any task, confirms a proposal with you, then orchestrates **45 agent prompts** across **4 structured phases** when a real `spawn_agent` adapter is available. Without that adapter, operational pipeline execution blocks as `blocked-no-agent-runtime` rather than simulating multi-agent parity. The runtime now includes HMAC-backed sentinel and ledger integrity, v5.2 protocol events, brainstorm run directories, Spec lifecycle gates, TRACE.md validation, TDD gates, adversarial review loops, confidence scoring, and Go/No-Go validation.

**New: Kimi Code CLI port** — the same 4-phase pipeline is now available as a Kimi skill (`.kimi/skills/pipeline/`), with 13 agent prompts adapted for Kimi's `coder`/`explore` subagent types, deterministic exec-window scripts, and a parent handler loop that processes `GATE_REQUEST`, `DISPATCH_REQUEST`, and `PLAN_MODE_REQUEST` blocks.

---

## Why This Exists

| Without Pipeline | With Pipeline |
|:---|:---|
| Flat wall of text, no structure | 4 phases with clear gates between them |
| No information gap detection | Information Gate blocks until gaps are resolved |
| No user confirmation | Proposal + explicit user approval before execution |
| False PASS on everything | Independent adversarial review catches blind spots |
| No TDD, no regression checks | RED-GREEN-REFACTOR enforced per batch |
| Single monolithic response | Adaptive batches with checkpoint validation |

---

## Quick Start

### Codex CLI

#### Prerequisites

```toml
# ~/.codex/config.toml
multi_agent = true
model_reasoning_effort = "high"
```

#### Install

**Option 1: From Codex Plugin Registry** (if published)

```bash
codex install fx-studio-ai/pipeline-orchestrator-for-codex
```

**Option 2: From GitHub** (recommended for portable use)

```bash
# Clone the repo
git clone https://github.com/fernandoxavier02/Pipeline-Orchestrator-for-Codex.git

# Install into Codex plugins cache
mkdir -p ~/.codex/plugins/cache/fx-studio-ai/pipeline-orchestrator-for-codex/0.5.1
cp -r Pipeline-Orchestrator-for-Codex/* ~/.codex/plugins/cache/fx-studio-ai/pipeline-orchestrator-for-codex/0.5.1/

# Optional: Install Node.js dependencies (only needed for TypeScript development/testing)
# The plugin works WITHOUT npm install — hooks use only Node.js builtins (fs, path)
# cd ~/.codex/plugins/cache/fx-studio-ai/pipeline-orchestrator-for-codex/0.5.1
# npm install --production
```

**Option 3: Symlink for development**

```bash
git clone https://github.com/fernandoxavier02/Pipeline-Orchestrator-for-Codex.git
cd Pipeline-Orchestrator-for-Codex
npm install

# Create a symlink in the plugins cache
mkdir -p ~/.codex/plugins/cache/fx-studio-ai/pipeline-orchestrator-for-codex
ln -sf "$(pwd)" ~/.codex/plugins/cache/fx-studio-ai/pipeline-orchestrator-for-codex/0.5.1
```

#### Verify Installation

```bash
# Check the plugin is detected
ls ~/.codex/plugins/cache/fx-studio-ai/pipeline-orchestrator-for-codex/*/skills/pipeline/SKILL.md

# Should output: SKILL.md path with version number
```

#### Usage

```
/pipeline-orchestrator-for-codex:pipeline <your task description>
```

The first assistant action is visible planning: the orchestrator calls `update_plan` so Codex opens the plan panel before it dispatches agents, edits files, or writes a report. The first user decision is then `WORKFLOW_METHOD_GATE` from `references/workflow-method-gate.md`: it names the workflow it selected, for example Bug Fix, Audit, Implement, UX, Spec, Brainstorm, Review, or Verify Completion, and asks whether you want to keep it. Reply `yes` to keep it, `adjust` to revise it manually, `no` to stop, or reply with `audit`, `bugfix`, `feature`, `ux`, `spec`, `brainstorm`, `review`, or `verify-completion` to switch workflow before any execution. For `/pipeline-orchestrator-for-codex:pipeline`, both the visible plan and this gate happen before Phase 0 agent dispatch.

For complex work or `--plan`, the proposal also emits `PLAN_MODE_REQUEST v1`. Hosts that support native Codex Plan Mode should surface the planning checkpoint there; otherwise the generated implementation plan is shown and must be approved before edits.

Every public workflow also follows the `VISIBLE_PLAN` contract in `references/visible-plan-contract.md`: the parent Codex context must call `update_plan` as the first assistant action, keep one step in progress, execute in batches, run adversarial review after every batch, and preserve PDD, DDD, ATDD, and TDD or the report-only evidence-first equivalent.

---

## Local Eval Gate

This repository also includes a local Eval Gate around the orchestrator. It lives in `.codex/**`, `.agents/skills/workflow-eval-gate/**`, and `evals/**`, and checks whether changes to workflows, skills, hooks, commands, telemetry, gates, traces, batches, reviews, and policy surfaces have enough local evidence before they are reported as passing.

The Eval Gate is intentionally local. It does not rewrite the TypeScript runtime, does not replace `/pipeline-orchestrator-for-codex:pipeline`, and is not proof that plugin hooks are globally active. Codex hook activation still requires the manual `/hooks` trust step for `.codex/hooks.json`.

See [`evals/README.md`](./evals/README.md) for how the hooks, telemetry, deterministic runner, validation commands, and trust boundary work. The implementation contract for this layer is documented in [`docs/pipeline-orchestrator-codex/11-eval-gate-plan.md`](./docs/pipeline-orchestrator-codex/11-eval-gate-plan.md).

---

## Integrity Policy

PASS evidence is accepted only when the runtime and hooks agree on the same integrity chain. Ledger entries use `PIPELINE_INTEGRITY_HMAC_KEY` when configured. Sentinel state uses `PIPELINE_SENTINEL_HMAC_KEY` when present and otherwise falls back to `PIPELINE_INTEGRITY_HMAC_KEY`, so one operational secret can sign both surfaces without creating runtime/Stop-hook drift.

---

### Kimi Code CLI

#### Install

```bash
# Clone the repo
git clone https://github.com/fernandoxavier02/Pipeline-Orchestrator-for-Codex.git

# Option A: User-level (available in all projects)
cp -r Pipeline-Orchestrator-for-Codex/.kimi/skills/* ~/.kimi/skills/

# Option B: Project-level (only current project)
cp -r Pipeline-Orchestrator-for-Codex/.kimi/skills/* ./.agents/skills/
```

#### Usage

Type the skill name in the Kimi chat:

```
pipeline <your task description>
```

Or use one of the shortcut skills:

```
bugfix <bug description>
feature <feature description>
audit <scope>
spec <feature description>
review
```

#### How It Works

Kimi does not support nested `Agent` dispatches or `AskUserQuestion` from subagents. The pipeline skill uses a **parent handler loop**:

1. **SKILL.md** spawns the `pipeline-controller` as a `coder` subagent
2. The controller emits structured blocks (`GATE_REQUEST`, `DISPATCH_REQUEST`, `PLAN_MODE_REQUEST`)
3. The parent (main LLM) parses each block, invokes the appropriate Kimi tool, and feeds results back
4. Repeat until the controller emits `PIPELINE COMPLETE`

See `.kimi/skills/pipeline/references/parent-handler-protocol.md` for the full protocol specification.

---

## Architecture

```
                          /pipeline-orchestrator-for-codex:pipeline "fix auth bug"
                                    |
                    ╔═══════════════╧═══════════════╗
                    ║     PHASE 0 — TRIAGE          ║
                    ║  task-orchestrator             ║
                    ║  information-gate              ║
                    ║  design-interrogator (COMPLEXA)║
                    ╚═══════════════╤═══════════════╝
                                    |
                    ╔═══════════════╧═══════════════╗
                    ║     PHASE 1 — PROPOSAL        ║
                    ║  Classification + Confirmation ║
                    ║  plan-architect (COMPLEXA)     ║
                    ╚═══════════════╤═══════════════╝
                                    |
                         user confirms (yes/no/adjust)
                                    |
                    ╔═══════════════╧═══════════════╗
                    ║     PHASE 2 — EXECUTION       ║
                    ║  quality-gate-router → TDD     ║
                    ║  pre-tester (RED phase)        ║
                    ║  executor-controller (batches) ║
                    ║  checkpoint-validator           ║
                    ║  review-orchestrator (advers.) ║
                    ║  executor-fix (if needed)      ║
                    ╚═══════════════╤═══════════════╝
                                    |
                    ╔═══════════════╧═══════════════╗
                    ║     PHASE 3 — VALIDATION      ║
                    ║  sanity-checker                ║
                    ║  final-adversarial (3 parallel)║
                    ║  final-validator (Go/No-Go)    ║
                    ║  finishing-branch              ║
                    ╚═══════════════════════════════╝
```

---

## 45 Agent Prompts

### Core (8)

| Agent | Role |
|:------|:-----|
| `task-orchestrator` | Classifies task type, complexity, severity, and pipeline variant |
| `information-gate` | Detects information gaps — blocks pipeline until resolved |
| `checkpoint-validator` | Runs build + tests after each batch; enforces stop rule |
| `sanity-checker` | Proportional sanity check (build-only → build+tests → full regression) |
| `final-validator` | Consolidates all results; issues final Go / Conditional / No-Go |
| `finishing-branch` | Post-validation options: PR, merge, keep branch, or discard |
| `adversarial-batch` | Per-batch adversarial review with fix loop (max 3 attempts) |
| `sentinel` | Pipeline execution guardian — validates phase sequence and coherence |

### Executor (5 + 16 type-specific)

| Agent | Role |
|:------|:-----|
| `executor-controller` | Orchestrates adaptive batch execution |
| `executor-implementer-task` | Per-task implementation with micro-gate and TDD |
| `executor-spec-reviewer` | Per-task spec compliance verification |
| `executor-quality-reviewer` | SOLID, KISS, DRY, YAGNI checks per task |
| `executor-fix` | Targeted fixes for adversarial/architecture findings |

**Type-Specific Agents** (dispatched based on task type):

| Domain | Agents |
|:-------|:-------|
| Bug Fix | `bugfix-diagnostic-agent`, `bugfix-root-cause-analyzer`, `bugfix-regression-tester` |
| Feature | `feature-vertical-slice-planner`, `feature-implementer`, `feature-integration-validator` |
| Audit | `audit-intake`, `audit-domain-analyzer`, `audit-compliance-checker`, `audit-risk-matrix-generator` |
| Adversarial | `adversarial-review-coordinator`, `adversarial-security-scanner`, `adversarial-architecture-critic` |
| UX | `ux-simulator`, `ux-accessibility-auditor`, `ux-qa-validator` |

### Quality (7)

| Agent | Role |
|:------|:-----|
| `quality-gate-router` | Selects test strategy by pipeline type and intensity |
| `pre-tester` | Writes tests BEFORE implementation (RED phase) |
| `plan-architect` | Researches codebase and creates structured implementation plan |
| `design-interrogator` | Walks the design decision tree for COMPLEXA tasks |
| `review-orchestrator` | Spawns adversarial + architecture reviewers in parallel |
| `architecture-reviewer` | Verifies project patterns, abstractions, naming conventions |
| `final-adversarial-orchestrator` | 3 independent reviewers (security, architecture, quality) with zero context |

### Spec Lifecycle (4)

| Agent | Role |
|:------|:-----|
| `spec-format-gate` | Validates required Kiro spec artifacts before execution |
| `spec-content-reviewer` | Reviews requirements/design/tasks content against acceptance criteria |
| `spec-post-impl-validator` | Verifies implementation evidence after execution |
| `spec-closer` | Produces closeout evidence only after gates and reviewers pass |

---

## Pipeline Variants

| Task Type | Light | Heavy |
|:----------|:------|:------|
| Bug Fix | `bugfix-light` | `bugfix-heavy` |
| Feature | `implement-light` | `implement-heavy` |
| User Story | `user-story-light` | `user-story-heavy` |
| Audit | `audit-light` | `audit-heavy` |
| UX Simulation | `ux-sim-light` | `ux-sim-heavy` |
| Spec | `spec-light` | `spec-heavy` |
| Adversarial | `adversarial-light` | `adversarial-heavy` |

**SIMPLES** = direct execution (no pipeline phases, just do the task).

---

## Modes

| Mode | Command | Behavior |
|:-----|:--------|:---------|
| Full | `/pipeline-orchestrator-for-codex:pipeline <task>` | All 4 phases |
| Diagnostic | `/pipeline-orchestrator-for-codex:pipeline diagnostic <task>` | Phase 0 + 1 only (classify + propose) |
| Continue | `/pipeline-orchestrator-for-codex:pipeline continue` | Resume from Phase 2 |
| Review-only | `/pipeline-orchestrator-for-codex:pipeline review-only` | Phase 3 only on current changes |
| Hotfix | `/pipeline-orchestrator-for-codex:pipeline --hotfix <task>` | Reduced validation for emergencies |
| Design Grill | `/pipeline-orchestrator-for-codex:pipeline --grill <task>` | Forces design interrogation |

---

## Safety Mechanisms

| Mechanism | Description |
|:----------|:------------|
| **Strict Real-Agent Runtime** | `/pipeline-orchestrator-for-codex:pipeline` requires real `spawn_agent` execution; without an agent adapter it blocks with `blocked-no-agent-runtime` |
| **Spec Lifecycle Gates** | Spec variants block on missing artifacts, format/content failures, AC traceability gaps, and post-implementation validation failures |
| **Execution Identity** | Runtime stores, gate logs, hook logs, and dispatch results include a workflow trace id, event id, and plugin/runtime/version metadata |
| **Information Gate** | Blocks pipeline if critical info is missing — asks ONE focused question at a time |
| **Non-Invention Rule** | Agents STOP and ask rather than guess when information is absent |
| **Stop Rule** | 2 consecutive build/test failures → full stop and root cause analysis |
| **User Gates** | Explicit confirmation required before adversarial review phases |
| **Agent Isolation** | Each agent gets fresh context — no accumulated bias leakage |
| **Sentinel** | Validates phase sequence, blocks and auto-corrects deviations |
| **Fix Loop Cap** | Max 3 fix attempts per adversarial finding — escalates on 3rd failure |

## Hook Observability

Hooks append audit events to `.codex/pipeline/hook-events.jsonl` using `JSON.stringify`. Each line records `hook`, `event`, `decision`, `attempted`, `expected`, `timestamp`, `cwd`, `reason`, and `execution_identity`.

Use `execution_identity.trace_id` to correlate one workflow across `.codex/pipeline/gate-decisions.jsonl`, `session.json`, hook logs, real-agent dispatch requests, child reviewer outputs, and dispatcher output. Use `execution_identity.event_id` to identify the specific surface event that produced a line.

---

## Three-Layer Enforcement

A critical adaptation for GPT-based execution. Unlike Claude, GPT treats markdown instructions as documentation rather than executable commands. This plugin uses three reinforcement layers:

```
Layer 1: Hook (force-pipeline-agents.cjs)
  → Injects imperative "YOUR FIRST ACTION must be..." message

Layer 2: SKILL.md top (MANDATORY-SUBAGENT-RULE block)
  → "YOU MUST ALWAYS SPAWN SUBAGENTS. THIS IS NOT OPTIONAL."

Layer 3: SKILL.md bottom (self-check + anti-patterns)
  → "Did you call spawn_agent at least once? If no, you violated the contract."
```

---

## Project Structure

```
pipeline-orchestrator-for-codex/
├── .codex-plugin/
│   └── plugin.json              # Plugin manifest (v0.5.1)
├── .kimi/                       # Kimi Code CLI skill tree
│   └── skills/                  #   Skills for Kimi (pipeline, bugfix, feature, audit, review, spec)
│       ├── pipeline/
│       │   ├── SKILL.md         #     Parent handler loop (390+ lines)
│       │   ├── agents/          #     13 Kimi-adapted agent prompts
│       │   ├── references/      #     Protocol specs + gate taxonomy
│       │   └── scripts/         #     Deterministic exec-window scripts (Node.js)
│       ├── bugfix/
│       ├── feature/
│       ├── audit/
│       ├── review/
│       └── spec/
├── agents/                      # 45 agent prompt files plus inventory README (Codex/Claude)
│   ├── core/                    #   8 core agents
│   ├── executor/                #   5 executor agents
│   │   └── type-specific/       #  16 domain-specific agents
│   └── quality/                 #  12 quality/spec lifecycle agents
├── commands/
│   └── pipeline.md              # Full pipeline reference (1,058 lines)
├── hooks/
│   ├── hooks.json               # Hook registry
│   ├── force-pipeline-agents.cjs  # Agent spawn enforcement
│   ├── sentinel-hook.cjs        # Phase sequence guardian
│   └── completion-checklist.cjs # Post-completion verification
├── references/                  # 25 reference documents
│   ├── checklists/              #   Security & quality checklists
│   ├── gates/                   #   Macro/micro gate definitions
│   └── pipelines/               #  12 pipeline variant specs
├── skills/
│   └── pipeline/
│       └── SKILL.md             # Imperative execution script (315 lines)
├── src/                         # TypeScript runtime (51 files)
├── tests/                       # Unit + integration tests (44 files) + Kimi tests (6 files)
└── docs/                        # Architecture & planning docs
```

---

## Configuration

Create `.codex/pipeline.local.md` in your project root (optional):

```yaml
build_command: "npm run build"
test_command: "npm test"
```

If absent, the orchestrator auto-detects from `package.json`, `Makefile`, or common conventions.

---

## Stats

| Metric | Codex | Kimi |
|:-------|:------|:-----|
| Agent prompts | 45 | 13 |
| Pipeline variants | 12 | 12 |
| Reference documents | 25 | 8 |
| TypeScript source files | 51 | — |
| Test files | 44 | 6 |
| Hooks | 3 | — (compensating controls) |
| Pipeline phases | 4 | 4 |
| Execution modes | 6 | 6 |

---

## Troubleshooting

| Symptom | Cause | Fix |
|:---|:---|:---|
| `/pipeline-orchestrator-for-codex:pipeline` not recognized | Plugin not in Codex cache | Follow "Install from GitHub" steps above |
| `spawn_agent` not available | `multi_agent = false` | Set `multi_agent = true` in `~/.codex/config.toml` |
| Hook errors on startup | Unexpected — hooks use only Node.js builtins | Check Node.js >= 20 is installed |
| "agents directory not found" | Plugin not installed correctly | Verify `~/.codex/plugins/cache/fx-studio-ai/pipeline-orchestrator-for-codex/*/agents/` exists |
| Wall-of-text, no phases | GPT executing inline instead of spawning | Ensure hooks are registered — check `hooks/hooks.json` exists and `plugin.json` points to it |
| Wrong skill loaded | Duplicate command/skill entries | Select the SKILL.md entry (not commands/) in skill picker |
| `CODEX_PLUGIN_ROOT` undefined | Plugin not installed via standard Codex path | Reinstall plugin into `~/.codex/plugins/cache/` |
| **Kimi:** `pipeline` not triggered | Skill not in Kimi skills dir | Copy `.kimi/skills/` to `~/.kimi/skills/` or `.agents/skills/` |
| **Kimi:** controller loops forever | Parent handler not processing blocks | Ensure SKILL.md parent loop is loaded — check `references/parent-handler-protocol.md` |
| **Kimi:** edits blocked outside `.pipeline/` | No exec-window active | Run `node .kimi/skills/pipeline/scripts/open-exec-window.cjs` before edits |

### Requirements

- **Node.js >= 20** (for hooks — they use CommonJS `.cjs` format)
- **Codex CLI** with `multi_agent = true` enabled
- **`model_reasoning_effort = "high"`** recommended in `~/.codex/config.toml`

### Files That Matter for Runtime

The plugin does NOT require a build step for normal use. The runtime components are:

| Component | Files | Dependencies |
|:---|:---|:---|
| **Codex** Skill (instructions) | `skills/pipeline/SKILL.md` | None |
| **Codex** Agents (prompts) | `agents/**/*.md` (45 prompt files plus README) | None |
| **Codex** Hooks (enforcement) | `hooks/*.cjs` (3 files) | Node.js builtins only (fs, path) |
| **Codex** Manifest | `.codex-plugin/plugin.json` | None |
| **Kimi** Skill (instructions) | `.kimi/skills/pipeline/SKILL.md` | None |
| **Kimi** Agents (prompts) | `.kimi/skills/pipeline/agents/*.md` (13 files) | None |
| **Kimi** Scripts (exec-window) | `.kimi/skills/pipeline/scripts/*.cjs` (3 files) | Node.js builtins only (fs, path) |
| References | `references/**/*.md` | None |

The `src/`, `dist/`, and `tests/` directories are for development only and are NOT required for the plugin to function.

---

## Origin

This plugin is a Codex port targeting the local Pipeline Orchestrator for Claude Code v5.2.0 by FX Studio AI. The intelligence of the pipeline is split between markdown prompts and the TypeScript runtime: prompts define the operating contract, while runtime code enforces strict real-agent dispatch, protocol event persistence, run directories, gates, and TRACE.md validation.

**Key adaptation**: Claude naturally converts spawn instructions into tool calls. GPT does not. The port includes imperative enforcement layers (hook + SKILL.md + self-check) to ensure deterministic agent dispatch in the Codex runtime.

---

## License

MIT

---

<p align="center">
  <strong>FX Studio AI</strong><br/>
  <sub>Built by Fernando Xavier</sub>
</p>
