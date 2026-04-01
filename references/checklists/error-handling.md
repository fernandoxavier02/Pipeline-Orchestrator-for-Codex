---
kind: checklist
id: error-handling
title: Error Handling
domains:
  - errors
  - failures
pathHints:
  - error
  - failure
  - recover
  - retry
  - guard
  - fallback
items:
  - Verify failure paths return actionable errors.
  - Verify retries or recovery paths do not hide the root cause.
  - Verify guard rails fail closed instead of silently passing.
---
# Error Handling Checklist
Use when a change could fail, retry, recover, or guard against invalid input.
