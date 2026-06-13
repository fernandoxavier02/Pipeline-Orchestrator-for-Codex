# Paperclip Audit Flow Example

This example shows the repo-level shape of a Paperclip audit request in Codex. It does not prove live Paperclip board execution.

## Request

```text
Audit the gate registry for canonical parity gaps and report evidence-backed findings.
```

## Expected Repo Surfaces

- Command: `commands/paperclip-audit.md`
- Skill: `skills/paperclip-audit/SKILL.md`
- Template family: `audit`
- Compatibility fixture: `tests/compat/wave6b-paperclip-scenarios.json`
- Deterministic check: `tests/compat/wave6b-paperclip-scenarios.test.ts`

## Expected Boundary

The audit flow is read-only. It may produce findings, risk notes, and evidence references. It must not claim that real adversarial agents ran unless Codex `spawn_agent` and artifact collection were actually observed.
