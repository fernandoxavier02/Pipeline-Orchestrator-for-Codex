---
kind: checklist
id: data-integrity
title: Data Integrity
domains:
  - state
  - persistence
  - checkpoint
pathHints:
  - state
  - store
  - checkpoint
  - persistence
  - session
items:
  - Verify persisted data can be read back safely.
  - Verify state transitions stay append-only or atomic when required.
  - Verify schema changes do not drop or corrupt prior data.
---
# Data Integrity Checklist
Use when a change touches storage, checkpoints, or long-lived state.
