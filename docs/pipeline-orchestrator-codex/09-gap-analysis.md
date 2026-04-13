# Gap Analysis

## Overview

The original plugin is portable in spirit, but not every Claude-oriented mechanism has a one-to-one Codex equivalent.

This document identifies the gaps that matter for a functional Codex port and ranks their importance.

## Gap Type 1: Directly Portable Concepts

These parts translate well and should be preserved almost unchanged:

- explicit phase model
- task classification
- complexity routing
- variant selection
- batched execution
- review/fix loops
- checkpoint validation
- final validation
- persisted state
- gate log
- confidence score concept

These are not major risks.

## Gap Type 2: Adaptation Required

These parts are portable, but only if the Codex port introduces a different mechanism.

### Command surface

The original uses a Claude-style command model. Codex can support similar entrypoints through skills or plugins, but the packaging and invocation model differ.

Risk level: medium

### Question handling

Claude-specific workflow documents imply explicit question points. Codex can ask questions naturally, but there is no dedicated question primitive in the same way.

Risk level: medium

### Plan mode

The original distinguishes planning and execution in ways that align with Claude runtime concepts. Codex has collaboration modes, but those are not directly controlled by plugin prompts.

Risk level: medium-high

### Hooks

Claude hook configuration is explicit in `hooks/hooks.json`. Codex will need equivalent behavior implemented through controller startup, preflight checks, persistence writers, and closeout logic.

Risk level: medium-high

### Independent review

Claude can model this through separate agents and context boundaries. Codex can do the same only when subagent delegation is available and allowed; otherwise independence must be emulated.

Risk level: high

## Gap Type 3: Historically Hard Equivalents

These areas do not have a clean one-to-one Codex primitive.

### Named multi-agent orchestration as a default runtime assumption

The original repository is designed around many named agents. In this Codex port, controller-owned multi-agent orchestration now exists in the dispatcher layer, but the environment still differs from Claude-native agent semantics.

Implication:

- controller-owned fan-out still needs durable prompt contracts and explicit scope control
- review independence should remain a first-class test target

Risk level: high

### Claude-specific runtime semantics embedded in prompts

Some prompt language assumes Claude tool behavior and orchestration conventions. Those instructions cannot simply be copied into Codex and expected to work.

Risk level: high

## Repository-Level Modeling Gaps

There are also internal modeling gaps in the source repository that affect a faithful port.

### Conceptual roles vs concrete files

The runtime narrative sometimes refers to roles or teams more explicitly than the repository materializes them as individual prompt files.

Implication:

- the Codex port cannot rely only on file names
- it must derive some behaviors from orchestration text and examples

Current mitigation:

- central prompt artifacts now exist locally for sentinel, checkpoint-validator, pre-tester, quality-gate-router, sanity-checker, final-validator, design-interrogator, and plan-architect
- controller startup now preloads the shipped prompt bundle to fail fast on broken prompt contracts
- Phase 2 and Phase 3 now use explicit runtime roles for checkpoint validation, pre-testing, quality-gate routing, sanity checks, and final validation
- controller sovereignty is now narrower: phase transitions, gate decisions, rollback routing, session/checkpoint/gate-log/confidence/sentinel persistence, and closeout authority

### Mixed source-of-truth problem

Behavior is split across:

- command controller
- agent prompts
- hooks config
- pipeline variants
- README claims
- example docs

Implication:

- the port needs an explicit authority order
- otherwise behavior drift will happen quickly

Current mitigation:

- runtime-first execution now pushes role behavior into prompt-backed dispatchers instead of relying only on controller-inlined logic
- continue-state interpretation has been extracted so blocked continuation and resume routing share a dedicated boundary

### Product claims exceed hard implementation in places

Some guarantees are described strongly in README or skill copy but depend on convention rather than strict enforcement.

Implication:

- the Codex port should prefer explicit enforcement over aspirational wording

## UX Gaps to Resolve in the Port

### Proposal visibility

The original plugin strongly implies proposal-before-execution. The Codex version should preserve this as visible UX, not hide it inside internal planning.

### Continue-mode clarity

`continue` needs clear operator feedback:

- what phase is being resumed
- what remains blocked
- what evidence already exists

### Mode transparency

Operators should be able to tell when the controller is in:

- diagnostic
- hotfix
- planning-heavy
- review-only

Without this, Codex parity will be confusing even if the internals are correct.

## Safety Gaps to Resolve in the Port

### Write-scope discipline

The original plugin relies heavily on batch thinking, but a Codex port should explicitly track touched files and ownership to reduce accidental drift.

### Gate enforcement

If gates are left as prompt suggestions rather than controller-enforced transitions, the port will become much weaker than the original.

### Retry discipline

The fix-loop cap and stop rules should be implemented as deterministic controller logic. Otherwise the Codex port may over-loop or self-justify weak results.

## Migration Risk Ranking

### Highest risk

1. preserving review independence without guaranteed subagents
2. translating hooks into enforceable Codex runtime behavior
3. preserving clean `continue` semantics across sessions

### Medium risk

1. preserving mode differences cleanly
2. keeping question flow disciplined
3. turning markdown routing references into stable controller logic

### Lower risk

1. persisting gate and confidence artifacts
2. mirroring the folder structure
3. recreating closeout summaries

## Recommended Mitigations

1. Build controller logic first and keep gates deterministic.
2. Separate prompt registry from runtime orchestration code.
3. Support both single-agent and multi-agent execution from the start.
4. Persist state early, before complex implementation begins.
5. Treat review independence as a first-class test target.
6. Write scenario tests for `diagnostic`, `continue`, `review-only`, and `hotfix`.

## Bottom Line

The plugin is absolutely portable to Codex at the functional level.

The hardest part is not the phase graph. The hardest part is preserving governance quality:

- disciplined questioning
- clean review separation
- explicit gates
- durable resumability
- evidence-based final decisions

The remaining implementation gaps are now concentrated in controller slimming for continuation and final closeout boundaries, plus keeping docs and inventories synchronized as the runtime roles continue to mature.

If the Codex port gets those right, the remaining differences in packaging and tooling are manageable.
