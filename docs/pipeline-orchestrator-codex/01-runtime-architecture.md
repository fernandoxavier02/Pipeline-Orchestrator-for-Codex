# Runtime Architecture

## Top-Level Runtime

The original plugin is a pure-markdown Claude Code plugin whose runtime is assembled from four main layers:

1. plugin discovery and manifest
2. session hook
3. command controller
4. agent and reference library

## Layer 1: Plugin Discovery

Source files:

- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`

Observed behavior:

- plugin is auto-discoverable
- marketed as a Claude Code plugin
- no runtime dependencies
- command and agent behavior is encoded in markdown files

Practical meaning:

- the plugin does not ship executable code
- the "runtime" is the LLM following prompt contracts plus file-based configuration

## Layer 2: Session Hook

Source file:

- `hooks/hooks.json`

Observed behavior:

- registers `SessionStart`
- injects a startup prompt advertising:
  - `/pipeline [task]`
  - `/pipeline diagnostic [task]`
  - `/pipeline --grill [task]`
  - optional `.claude/pipeline.local.md`

Purpose:

- teach discovery at session start
- reduce friction for first use
- advertise config conventions

This hook is not core to pipeline logic. It is a discoverability layer.

## Layer 3: Command Controller

Source file:

- `commands/pipeline.md`

This is the true runtime brain of the system.

It defines:

- execution modes
- phase flow
- controller-side anti-injection rules
- project configuration detection
- artifact path creation
- gate registry
- phase transition summaries
- gate log schema
- confidence score schema
- rollback rules
- final output contract

The controller is effectively a state machine written as a prompt.

## Layer 4: Agent Library

Source directories:

- `agents/core/`
- `agents/executor/`
- `agents/quality/`

These agents do not exist independently from the controller. The controller invokes them as specialized subroutines with narrower responsibilities.

Architectural grouping:

- Core:
  triage, information completeness, per-batch adversarial review, checkpoint, sanity, final decision, closeout.
- Executor:
  implementation orchestration and scoped code-writing/fixing/review helpers.
- Quality:
  TDD planning, plan mode, architecture review, final adversarial orchestration.

## Layer 5: Reference Library

Source directories:

- `references/pipelines/`
- `references/gates/`
- `references/checklists/`
- `references/complexity-matrix.md`
- `references/glossary.md`

These references act as SSOT inputs.

They supply:

- complexity rules
- routing rules
- per-variant team shape
- per-domain checklist content
- macro-gate and micro-gate question/check definitions

The controller trusts them as data, but also explicitly prevents them from overriding phase flow and safety rules.

## Layer 6: Skill Layer

Source file:

- `skills/pipeline/SKILL.md`

Purpose:

- explain when the pipeline should be used
- summarize phases and modes
- expose user-facing onboarding for skill-driven use

This file is not the authoritative runtime definition.

The authoritative runtime is `commands/pipeline.md`.

## Configuration Model

Primary project-local configuration:

- `.claude/pipeline.local.md`

Recognized keys:

- `doc_path`
- `build_command`
- `test_command`
- `spec_path`
- `patterns_file`

Observed controller rule:

- only known keys are parsed
- other content is ignored as untrusted data

Fallback auto-detection:

- `package.json`
- `Makefile`
- `Cargo.toml`
- `pyproject.toml`
- common conventions

## Persisted Runtime Artifacts

The controller creates a run-scoped documentation folder:

- `{doc_path}/Pre-{level}-action/{YYYY-MM-DD}-{short-summary}/`

Inside that path, the pipeline expects:

- per-phase markdown files
- `gate-decisions.jsonl`
- `confidence-score.yaml`

This is central to the original design.

The pipeline is not only a workflow. It is a workflow plus an audit log.

## Runtime Modes

Defined in `commands/pipeline.md`:

- Full
- Diagnostic
- Continue
- Review-only
- Force level with `--simples`, `--media`, `--complexa`
- Hotfix with `--hotfix`
- Design interrogation override with `--grill`
- Planning override with `--plan`

These modes alter routing, gate strictness, and which phases execute.

## State Machine View

At runtime, the controller behaves like this:

1. parse arguments
2. choose mode
3. load or detect config
4. create doc path
5. run Phase 0
6. ask for proposal confirmation
7. optionally run Phase 1.5
8. run Phase 2 in batches
9. optionally run final adversarial review
10. run final validator
11. offer closeout

Alternative branches:

- Diagnostic stops after proposal.
- Review-only jumps straight to final adversarial review.
- Continue resumes from persisted artifacts with stale-context logic.
- Hotfix forces a reduced but still gated flow.

## Independence Model

One of the strongest architectural ideas is separation between:

- implementation context
- review context

The plugin is explicit that per-batch review must not be framed by the implementer.

That is why:

- `executor-controller` does not own adversarial review in v3
- `review-orchestrator` is spawned with clean context
- `final-adversarial-orchestrator` reviews the complete diff with zero implementation history

This independence model is a core requirement for Codex parity.

## Runtime Invariants

The original architecture treats these as non-negotiable invariants:

- classification always happens first
- information gaps are resolved before pipeline selection
- TDD planning happens before implementation
- tests are approved before code
- review is independent from implementation
- every gate trigger is logged
- every phase transition is explicit
- final claims need evidence

Any Codex port that drops these invariants would no longer be functionally equivalent.
