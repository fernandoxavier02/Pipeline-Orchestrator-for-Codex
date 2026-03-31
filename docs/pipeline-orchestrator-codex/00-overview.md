# Pipeline Orchestrator for Codex: Overview

## Purpose

This package documents the `Pipeline-Orchestrator` plugin from Claude Code in a form that is directly useful for a future Codex port with functional parity.

The package has two simultaneous goals:

1. Preserve the original plugin behavior as faithfully as possible.
2. Translate that behavior into Codex-native execution patterns, limits, and implementation choices.

## Source Basis

Canonical source repository:

- [Pipeline-Orchestrator](https://github.com/fernandoxavier02/Pipeline-Orchestrator)

Inspected local clone:

- `C:\Users\ferna\OneDrive\Documentos\Playground\.tmp\Pipeline-Orchestrator`

Primary controlling files:

- `commands/pipeline.md`
- `.claude-plugin/plugin.json`
- `hooks/hooks.json`
- `skills/pipeline/SKILL.md`
- `references/complexity-matrix.md`
- `references/pipelines/*.md`
- `references/gates/*.md`
- `references/checklists/*.md`
- `agents/**/*.md`

## What This Plugin Is

At its core, the plugin is a governance layer for AI-assisted software work.

It is not just a slash command. It is a coordinated runtime made of:

- one command controller
- a classification system
- multiple gates
- multiple specialized agents
- a documentation trail
- a final decision system

The plugin turns a free-form request into a structured workflow with:

- classification
- information gathering
- optional design interrogation
- optional implementation planning
- TDD-first execution
- per-batch independent review
- optional final independent adversarial review
- final Go, Conditional, or No-Go validation

## Core Architectural Idea

The plugin assumes that AI coding quality improves when:

- requirements are clarified before coding
- tests are approved before implementation
- implementers do not review their own work
- reviews happen with clean context
- risky work uses stronger gates
- final claims require actual command evidence

This is why the plugin is organized as a pipeline instead of a single agent prompt.

## Package Structure

- `00-overview.md`
  Summary, package navigation, glossary of concepts.
- `01-runtime-architecture.md`
  Runtime shape of the original plugin.
- `02-phase-flow.md`
  End-to-end behavior across phases 0, 1, 1.5, 2, and 3.
- `03-gates-and-hardness.md`
  Gate registry, hardness taxonomy, gate log, stop rules, rollback.
- `04-agents-catalog.md`
  Agent-by-agent inventory.
- `05-prompts-and-behaviors.md`
  Cross-cutting behavioral rules embedded in prompts.
- `06-references-and-variants.md`
  Complexity matrix, question banks, checklists, variants.
- `07-codex-translation-matrix.md`
  Exact mapping from Claude Code mechanisms to Codex mechanisms.
- `08-implementation-blueprint-for-codex.md`
  Practical target architecture for the Codex port.
- `09-gap-analysis.md`
  Mismatches, risks, and non-1:1 areas.
- `10-source-inventory.md`
  Inventory of inspected source files and their role.

## Functional Boundaries

The original plugin is split into portable logic and Claude-specific integration.

Portable logic:

- task classification
- complexity routing
- macro and micro gates
- TDD workflow
- batch execution semantics
- independent review semantics
- gate hardness
- confidence scoring
- final validation

Claude-specific integration:

- plugin manifest format
- hook registration format
- slash command format in `commands/*.md`
- named agent invocation via Claude `Task`
- `AskUserQuestion`
- `EnterPlanMode` and `ExitPlanMode`

Codex portability is therefore mostly an integration rewrite, not a logic rewrite.

## Main Porting Strategy

This package assumes the target is functional parity, not mechanism parity.

That means the Codex port should preserve:

- the same phases
- the same decision points
- the same gates
- the same review independence goals
- the same risk scaling
- the same documentation artifacts

But it may implement them with different Codex primitives.

## Key Translation Principle

Whenever the original system uses a Claude-native feature that Codex does not expose directly, the Codex port should preserve the behavior, not the exact UI or API surface.

Examples:

- named `Task` agents become `spawn_agent` workers or explorers
- `TodoWrite` becomes `update_plan`
- `EnterPlanMode` becomes an explicit read-only planning phase enforced by controller logic
- `AskUserQuestion` becomes visible user checkpoint messages
- `SessionStart` hook becomes startup guidance in skill or plugin bootstrapping

## Recommended Reading Order

For implementation:

1. `01-runtime-architecture.md`
2. `02-phase-flow.md`
3. `03-gates-and-hardness.md`
4. `04-agents-catalog.md`
5. `07-codex-translation-matrix.md`
6. `08-implementation-blueprint-for-codex.md`
7. `09-gap-analysis.md`

For audit or comparison:

1. `00-overview.md`
2. `02-phase-flow.md`
3. `04-agents-catalog.md`
4. `06-references-and-variants.md`
5. `10-source-inventory.md`
