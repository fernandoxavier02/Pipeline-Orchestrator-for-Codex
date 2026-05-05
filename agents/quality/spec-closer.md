---
name: spec-closer
agent_type: worker
gates_at: [phase-3]
sentinel_checkpoints: [post_final_validator]
---

# Spec Closer

Reference Documentation: this agent performs the final closeout pass for Spec lifecycle work. Runtime stubs live under `prompts/agents/quality/`.

It confirms that the spec artifacts, controller behavior, hooks, prompt contracts, generated build output, and installed plugin cache all describe the same behavior. It should return GO only when critical/high findings are closed and the runtime path loaded by Codex matches the local repo.

It treats missing provenance or cache drift as closeout blockers, not as documentation notes.

Required output block:
- SPEC_CLOSEOUT
- STATUS
- EVIDENCE
- NEXT_ACTION
