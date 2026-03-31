# Gates and Hardness

## Why Gates Matter

The plugin is designed around explicit decision gates instead of implied caution.

Every major uncertainty or risk point is modeled as a named gate with:

- a trigger
- a hardness
- a recovery path
- a log entry
- optional confidence impact

This is one of the strongest features to preserve in the Codex port.

## Hardness Taxonomy

The controller defines four hardness levels.

### MANDATORY

Meaning:

- structural invariant
- cannot be skipped
- not even hotfix mode bypasses it

Examples:

- `SSOT_CONFLICT`
- `ADVERSARIAL_GATE_MANDATORY`

### HARD

Meaning:

- blocks progress until resolved
- has a legitimate resolution path

Examples:

- `INFO_GATE_BLOCKED`
- `TDD_APPROVAL`
- `PLAN_REJECTED`
- `MICRO_GATE_GAP`
- `CHECKPOINT_FAIL`
- `ADVERSARIAL_BLOCK`
- `FINAL_ADVERSARIAL_REWORK`

### CIRCUIT_BREAKER

Meaning:

- stop-for-safety gate
- requires reset or user intervention

Examples:

- `STOP_RULE`
- `FIX_LOOP_EXHAUSTED`

### SOFT

Meaning:

- recommended gate
- user may skip it
- skip must be logged
- skip reduces confidence

Examples:

- `STALE_CONTEXT`
- `ADVERSARIAL_GATE`
- `FINAL_ADVERSARIAL_GATE`
- `CLOSEOUT_CONFIRM`

## Gate Registry

### `SSOT_CONFLICT`

- Hardness: MANDATORY
- Trigger: multiple conflicting sources of truth
- Action: total block
- Recovery: user resolves conflict outside the pipeline or clarifies authoritative source

### `ADVERSARIAL_GATE_MANDATORY`

- Hardness: MANDATORY
- Trigger: batch touches auth, crypto, or data-sensitive domains
- Action: user cannot skip adversarial review
- Recovery: must approve review before continuing

### `INFO_GATE_BLOCKED`

- Hardness: HARD
- Trigger: critical unknown in macro-gate
- Action: pipeline blocks during Phase 0
- Recovery: user answers questions

### `TDD_APPROVAL`

- Hardness: HARD
- Trigger: test scenarios need approval
- Action: blocks before implementation
- Recovery: user approves or adjusts scenarios

### `PLAN_REJECTED`

- Hardness: HARD
- Trigger: user rejects plan
- Action: returns to earlier planning/classification point
- Recovery: reclassify, adjust, or exit

### `STOP_RULE`

- Hardness: CIRCUIT_BREAKER
- Trigger: two consecutive checkpoint or sanity failures in a phase
- Action: stop pipeline
- Recovery: user chooses reset path

### `FIX_LOOP_EXHAUSTED`

- Hardness: CIRCUIT_BREAKER
- Trigger: three fix attempts fail
- Action: stop pipeline and surface alternatives
- Recovery: user chooses alternative or exit

### `STALE_CONTEXT`

- Hardness: SOFT by default, can escalate
- Trigger: `/pipeline continue` on stale run
- Action: ask whether to revalidate or continue
- Recovery: user chooses
- Escalation: becomes effectively HARD for sensitive complex domains

### `MICRO_GATE_GAP`

- Hardness: HARD
- Trigger: per-task missing values, paths, or behavior
- Action: stop that task
- Recovery: answer the missing question

### `CHECKPOINT_FAIL`

- Hardness: HARD
- Trigger: build, test, or regression failure
- Action: return to executor
- Recovery: fix and re-validate

### `ADVERSARIAL_BLOCK`

- Hardness: HARD
- Trigger: critical review findings
- Action: enter fix loop
- Recovery: resolve findings or escalate

### `ADVERSARIAL_GATE`

- Hardness: SOFT
- Trigger: post-checkpoint per-batch review decision
- Action: ask user whether to start review
- Recovery: approve or skip

### `FINAL_ADVERSARIAL_GATE`

- Hardness: SOFT
- Trigger: final whole-diff review offer
- Action: ask user whether to run it
- Recovery: approve or skip

### `FINAL_ADVERSARIAL_REWORK`

- Hardness: HARD
- Trigger: final adversarial review reports critical findings
- Action: ask user whether to rework, proceed, or discard
- Recovery: controlled single rollback to targeted fix batch

### `CLOSEOUT_CONFIRM`

- Hardness: SOFT
- Trigger: PR, push, merge, discard actions
- Action: explicit confirmation
- Recovery: user confirms or cancels

## Gate Log

Every triggered gate is appended to:

- `{PIPELINE_DOC_PATH}/gate-decisions.jsonl`

Required fields:

- `gate`
- `hardness`
- `phase`
- `decision`
- `decided_by`
- `timestamp`
- `detail`
- `confidence_impact`

Important controller guarantees:

- append-only during a run
- strict JSON serialization
- sanitization of `detail`
- controller-only writes
- parse-time validation by final validator

## Confidence Penalties

Skipped SOFT gates reduce confidence.

Observed defaults:

- generic SOFT skip: `-0.10`
- `ADVERSARIAL_GATE`: `-0.15`
- `FINAL_ADVERSARIAL_GATE`: `-0.15`
- `CLOSEOUT_CONFIRM`: `-0.05`

This makes skipped review a materially visible risk signal.

## Phase Transition Summaries

Before each phase change, the controller emits a transition summary including:

- step outcomes
- gates triggered
- SOFT gates skipped
- confidence status
- carry-forward artifacts

This is both an observability feature and a governance feature.

## Confidence Score Model

Dimensions observed in controller:

- `classification_clarity`
- `info_completeness`
- `design_alignment`
- `plan_coverage`
- `tdd_coverage`
- `implementation_quality`
- `gate_penalty`
- `sanity_pass`

Formula:

- unweighted arithmetic mean of non-null dimensions
- then add gate penalty

Thresholds:

- High confidence: `>= 0.80`
- Medium confidence: `0.60 - 0.79`
- Low confidence: `< 0.60`

Important:

- the score is advisory only
- binary failures still take precedence

## Rollback Paths

The controller explicitly supports controlled rollback behavior.

### Re-plan Path

Trigger:

- systemic Phase 2 failure or plan rejection path

Rollback:

- back to Phase 1.5 or Phase 1

### Final Adversarial Rework Path

Trigger:

- critical findings in final adversarial review

Rollback:

- one allowed targeted fix cycle back into execution

### Continue Revalidation Path

Trigger:

- stale context

Rollback:

- back to Phase 0 revalidation

## Codex-Relevant Observations

These gate semantics are highly portable.

What must survive in Codex:

- named gates
- hardness levels
- logged decisions
- confidence penalties
- stale context handling
- explicit rollback options

What may change:

- how questions are displayed
- how plan mode is enforced
- where log files are written
- how approval UIs are rendered
