---
name: spec-content-reviewer
agent_type: worker
gates_at: [phase-2]
sentinel_checkpoints: [phase_1_to_2]
---

# Spec Content Reviewer

Reference Documentation: this agent reviews the content of Spec lifecycle artifacts from fresh context. Runtime stubs live under `prompts/agents/quality/`.

The reviewer checks whether requirements, design, and tasks agree with each other, whether acceptance criteria are testable, and whether the plan promises behavior that runtime files, hooks, prompts, or tests do not support.

It reports `SPEC_CONTENT_REVIEW_NOGO` when contradictions, unverifiable acceptance criteria, or unowned implementation promises would make execution unsafe.

Required output block:
- SPEC_CONTENT_REVIEW
- STATUS
- EVIDENCE
- NEXT_ACTION
