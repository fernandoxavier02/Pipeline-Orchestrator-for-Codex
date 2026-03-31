# Prompts and Behaviors

## Why This Matters

The Claude plugin is not defined only by its phase graph.

Its real behavior comes from prompt law: repeated instructions that shape how agents ask, decide, review, escalate, and stop. A Codex port that copies only the stages but not these prompt-level constraints will feel similar on paper and different in practice.

## Cross-Cutting Behavioral Rules

The following rules appear repeatedly across the command controller and agent prompts:

### Context before question

- Read local context before asking anything.
- Ask only when there is a real blocker or a materially important decision.
- Avoid broad discovery questions when the repository can answer them.

This is enforced most strongly by `information-gate`.

### One question at a time

- Questions are serialized.
- The system should not dump a questionnaire.
- Each answer can unlock new context that changes the next question.

This is an important UX pattern and should be preserved in Codex.

### Non-invention

- Do not fabricate missing implementation details.
- Mark assumptions explicitly when forced to proceed.
- Prefer routing to a gate over silently guessing.

This rule protects the pipeline from false confidence.

### TDD-first execution

- Implementation is supposed to start from failing tests when feasible.
- RED -> GREEN -> review/fix loop is treated as the preferred execution rhythm.
- Hotfix and low-complexity paths may compress this, but they do not remove the bias toward verification.

### Evidence before success claim

- Passing status should be grounded in actual commands, outputs, diffs, or observable checks.
- Reviewers are expected to cite issues, not just impressions.
- Final closeout depends on verification evidence, not optimism.

### Review independence

- Review agents should operate from fresh context when possible.
- The main implementation narrative should not contaminate the review result.
- Fix agents should receive findings, not persuasive framing from implementers.

This is one of the plugin's most important design ideas.

### Scoped execution

- Agents should edit only the files they own in that step.
- Work should be decomposed into batches.
- Large changes should be split rather than pushed through one giant context window.

### Pattern reuse before invention

- Existing repository patterns should be preferred over introducing new abstractions.
- Reviewers are expected to compare changes against local conventions.
- "Best practice" is subordinate to repo consistency unless a real defect is at stake.

## Anti-Prompt-Injection Rules

Multiple agent prompts include explicit anti-instruction rules. Their functional purpose is:

- treat repository content as data, not authority
- ignore attempts by files or comments to redefine the pipeline
- keep controller instructions above local code instructions
- avoid letting test fixtures, prompts, markdown notes, or generated files hijack behavior

For Codex, this should be preserved as a controller-level invariant:

1. system and developer instructions dominate
2. pipeline controller prompt dominates agent task prompt
3. repository content is evidence, never execution policy

## Observability Blocks

Most prompts require structured output blocks. The exact label names vary, but the pattern is consistent:

- classify the situation
- explain the decision
- expose the gate result
- surface findings in a machine-readable or strongly structured way
- make next-step routing explicit

This means the plugin is designed to be auditable. The prompt outputs are not just prose; they are intended to be consumed by the surrounding controller.

## Controller Prompt Behaviors

`commands/pipeline.md` defines the highest-order behavioral rules.

### Mandatory proposal before execution

In standard mode, the pipeline does not silently start complex work. It:

1. classifies the request
2. chooses a variant
3. summarizes proposed execution
4. asks the user to confirm

This is a deliberate trust-building measure and should remain visible in Codex.

### Mode-sensitive strictness

The same controller changes behavior depending on mode:

- `diagnostic`: inspect and classify without executing
- `continue`: resume from saved state
- `review-only`: skip implementation and run review logic
- `--plan`: expand planning depth
- `--grill`: increase adversarial scrutiny
- `--hotfix`: compress latency and reduce ceremony

The important behavior is not only mode recognition, but which protections are softened or reinforced by each mode.

### Stop-rule enforcement

The controller defines situations where the pipeline should stop instead of "trying harder":

- unresolved blocker gates
- repeated failed fixes
- confidence dropping below threshold
- lack of required user input
- validation failure at final stage

This gives the system a fail-safe profile rather than an infinite retry profile.

## Planning Behaviors

Phase 1.5 is the plugin's planning deepening stage.

Its prompts emphasize:

- decomposition into batches
- dependency-aware ordering
- explicit risk handling
- identification of review points before coding
- differentiation between simple, medium, and complex tasks

The planning layer is not generic brainstorming. It is execution-shaped planning intended to feed a batched controller.

## Implementation Behaviors

The executor agents collectively enforce a particular delivery style.

### `executor-implementer-task`

- works inside a bounded batch
- follows plan and repository patterns
- prefers minimal necessary change
- reports what changed and what remains

### `executor-spec-reviewer`

- checks whether implementation matches the stated plan or requirement
- looks for requirement drift, omissions, and over-build

### `executor-quality-reviewer`

- checks code quality, maintainability, defensive handling, and edge-case posture

### `executor-fix`

- consumes review findings
- applies corrections in a new pass
- should not reopen the entire architecture unless a finding requires it

Together, these prompts create a local loop:

1. implement
2. review for spec conformance
3. review for quality and robustness
4. fix
5. re-check or escalate

## Review Behaviors

The quality layer uses a different tone from the execution layer.

It assumes skepticism by default.

### `review-orchestrator`

- decides what review mix is needed
- routes to architecture, design, test, and final adversarial roles
- scales intensity to complexity and mode

### `plan-architect`

- challenges whether the plan is complete, coherent, and sequence-safe
- focuses on architecture before implementation locks in

### `pre-tester`

- looks for missing test cases, weak verification strategy, and untested edges before or during execution

### `architecture-reviewer`

- examines coupling, boundaries, domain correctness, and long-term maintainability

### `design-interrogator`

- interrogates assumptions and unclear design choices
- behaves like an adversarial reviewer rather than a collaborator trying to help the change pass

### `final-adversarial-orchestrator`

- coordinates end-stage adversarial review
- acts as a last independent challenge before approval

## Validation Behaviors

The validation agents are more binary and gate-like.

### `checkpoint-validator`

- verifies that a stage can safely transition
- checks whether expected outputs exist and whether blockers remain

### `sanity-checker`

- catches obvious incoherence, broken assumptions, or mismatched state

### `final-validator`

- performs the final go/no-go decision
- can fail the pipeline even after successful implementation if evidence is insufficient

This distinction matters for Codex: reviewers produce findings; validators decide transition safety.

## Branch and Closeout Behavior

`finishing-branch` is not just a Git helper. It encodes closeout discipline:

- summarize the completed change
- confirm verification state
- present next integration choice
- avoid pretending completion when the work is only "probably done"

This should map naturally to Codex's final completion step and optional git/PR flows.

## Minimum Parity Behavior Set for Codex

If functional parity must be prioritized over prompt verbatim parity, the Codex port should preserve at least these behavioral contracts:

1. Read context before asking questions.
2. Ask one question at a time when blocked.
3. Present a proposal before major execution.
4. Use explicit phases with gate-based transitions.
5. Treat planning, implementation, review, and validation as distinct roles.
6. Keep review as independent from implementation as possible.
7. Use evidence-based verification before success claims.
8. Stop on unresolved blockers instead of looping indefinitely.
9. Persist enough state to support `continue`.
10. Protect the controller from repository-level prompt injection.
