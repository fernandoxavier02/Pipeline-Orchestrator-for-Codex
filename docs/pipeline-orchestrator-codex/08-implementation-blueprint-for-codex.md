# Implementation Blueprint for Codex

## Objective

This blueprint describes how to build a Codex-native version of the Pipeline-Orchestrator with functional parity to the Claude-oriented original.

The goal is not to reproduce every file one-for-one. The goal is to preserve the runtime contracts that make the original plugin valuable.

## Recommended Architecture

Build the Codex port as nine cooperating layers.

### 1. Controller Layer

Responsibilities:

- parse user intent and optional mode flags
- classify task type, complexity, and urgency
- choose a pipeline profile
- present proposal
- coordinate all phase transitions

This is the heart of the system and should remain the single source of orchestration truth.

### 2. Prompt Registry

Responsibilities:

- store controller and agent prompts
- define expected structured outputs
- version prompt behavior explicitly

Recommended structure:

- `prompts/controller/`
- `prompts/agents/core/`
- `prompts/agents/executor/`
- `prompts/agents/quality/`

### 3. Agent Dispatcher

Responsibilities:

- launch a named review or execution role
- enforce ownership and scope
- choose between real subagents and single-agent emulation
- normalize outputs into controller-readable blocks

This layer is where Codex-specific delegation policy should be abstracted away from the rest of the pipeline.

### 4. Persistence Layer

Responsibilities:

- write proposal state
- write plan state
- write gate decisions
- write confidence score
- save current checkpoint
- support resume

Suggested runtime tree:

- `.codex/pipeline/session.json`
- `.codex/pipeline/proposal.md`
- `.codex/pipeline/plan.md`
- `.codex/pipeline/gate-decisions.jsonl`
- `.codex/pipeline/confidence-score.yaml`
- `.codex/pipeline/checkpoints/`

### 5. Gate Manager

Responsibilities:

- evaluate macro and micro gate conditions
- assign hardness
- determine whether to proceed, stop, or ask user
- log gate outcomes consistently

This should be a dedicated subsystem, not scattered ad hoc checks.

### 6. Plan and Approval Manager

Responsibilities:

- deepen plans when complexity requires it
- ask one blocking question at a time
- capture confirmations and decisions
- update phase status

### 7. Execution Layer

Responsibilities:

- split work into batches
- run implementation passes
- run spec and quality review passes
- run fix loops with a cap

### 8. Review Layer

Responsibilities:

- run clean-context review
- select domain checklists
- orchestrate adversarial inspection
- escalate when findings cross a threshold

### 9. Validation and Closeout Layer

Responsibilities:

- run checkpoint validation
- run final go/no-go validation
- prepare completion summary
- hand off to optional git/branch/PR flow

## Suggested Runtime Flow

The Codex implementation should follow this backbone:

1. bootstrap controller
2. inspect local context
3. classify task
4. choose variant and complexity
5. run macro information gate
6. present proposal
7. collect confirmation
8. deepen plan if needed
9. execute batched implementation
10. run review/fix loops
11. run final adversarial review
12. run final validator
13. summarize and persist final state

## Single-Agent and Multi-Agent Modes

The port should support both from day one.

### Multi-agent mode

Use when subagent delegation is available and appropriate.

Benefits:

- stronger review independence
- parallelizable review in later stages
- clearer ownership boundaries

### Single-agent emulation mode

Use when subagents are unavailable, disallowed, or unnecessary.

Requirements:

- explicit role switching
- fresh file reloading before review passes
- strict structured outputs
- no silent carryover of assumptions

The rest of the controller should not care which mode is active.

## Suggested Implementation Order

### Phase A: Core controller shell

Build:

- command or entrypoint
- triage/classification
- proposal rendering
- state initialization

Do not start with agent fan-out. Start with a trustworthy controller skeleton.

### Phase B: Planning and gating

Build:

- information gate
- plan generation
- approval capture
- gate log writing
- confidence score writing

At the end of this phase, `diagnostic`, `proposal`, and `continue` should already be viable.

### Phase C: Batched execution loop

Build:

- batch decomposition
- implementer role
- spec review role
- quality review role
- fix loop cap

At this point the system becomes operational for real work.

### Phase D: Adversarial and final validation

Build:

- review orchestrator
- domain checklist routing
- final adversarial orchestration
- final validator

This phase creates the quality posture that differentiates the plugin.

### Phase E: Productization

Build:

- cleaner operator messages
- durable resume UX
- closeout summaries
- optional branch/commit/PR helpers
- documentation and tests for the port itself

## Data Model Recommendations

Recommended session schema:

- session id
- created at
- current mode
- task classification
- complexity
- chosen variant
- current phase
- current batch index
- gate status summary
- confidence score
- unresolved blockers
- pending user decision
- files touched
- verification evidence

This schema is enough to support both auditability and resume.

## Testing Strategy for the Port

The Codex port should be tested as a workflow product, not only as isolated utilities.

Recommended test layers:

### Unit tests

- classifier behavior
- variant routing
- gate hardness evaluation
- state transitions
- resume reconstruction

### Prompt contract tests

- required output block presence
- parser compatibility
- stop-rule behavior in synthetic cases

### Scenario tests

- simple bugfix
- medium feature
- complex audit
- hotfix
- diagnostic only
- blocked information gate

### Failure-path tests

- missing state on `continue`
- repeated fix loop failures
- contradictory review outcomes
- final validator rejection

## Implementation Principles

### Preserve explicitness

The plugin is valuable partly because it makes its reasoning visible. Do not hide stage transitions or gate outcomes inside opaque helper calls.

### Prefer deterministic controller logic

Routing, thresholds, and persistence should be code-level logic where possible. LLMs should not be the only source of control flow.

### Keep prompt files modular

Avoid giant all-in-one prompts. The original plugin gains clarity from role separation.

### Make resume first-class

`continue` should not be an afterthought. The pipeline is designed to span multiple interactions.

### Design for auditability

Persist decisions in readable artifacts so operators can inspect what happened.

## Minimal First Release

If implementation must be staged, the smallest useful Codex release should include:

1. controller entrypoint
2. complexity classification
3. proposal generation and confirmation
4. information gate
5. planning output
6. batched execution loop
7. at least one independent review pass
8. final validation
9. persistent state with resume

Everything else can be layered on top, but these nine capabilities define the minimum viable identity of the plugin.
