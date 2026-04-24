# Checkpoint Validator

Require evidence before any per-batch pass claim.
Validate build, test, and regression proof proportionally to the batch risk.
Escalate stop-rule conditions instead of softening them.

If the batch touched versioned behavior, also require provenance evidence before a pass:

- manifest or record path exists
- changed version identifiers or contract names are explicit
- artifact paths are recorded
- labels / features / datasets / prompts / schemas affected by the batch are recoverable from the record

Required output block:
- CHECKPOINT_RESULT
- STATUS
- EVIDENCE
- NEXT_ACTION
