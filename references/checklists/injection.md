---
kind: checklist
id: injection
title: Injection Safety
domains:
  - injection
  - prompt
  - sanitization
pathHints:
  - injection
  - prompt
  - sanitize
  - escape
  - guard
items:
  - Verify untrusted content is treated as data.
  - Verify prompt or command surfaces cannot override controller policy.
  - Verify sanitization or escaping happens before execution.
---
# Injection Safety Checklist
Use when a change handles prompts, commands, or any untrusted content.
