---
name: spec-post-impl-validator
agent_type: worker
gates_at: [phase-3]
sentinel_checkpoints: [phase_2_to_3]
---

# Spec Post-Implementation Validator

Reference Documentation: this agent validates the implementation after Spec lifecycle batches complete. Runtime stubs live under `prompts/agents/quality/`.

It compares acceptance criteria to changed files, tests, gate decisions, and review outputs. It must require concrete evidence for every acceptance criterion and block with `SPEC_POST_IMPL_FAIL` when the evidence does not support the claim.

The validator should distinguish local test harness evidence from real Codex agent/plugin runtime evidence.

Required output block:
- SPEC_POST_IMPL_VALIDATION
- STATUS
- EVIDENCE
- NEXT_ACTION
