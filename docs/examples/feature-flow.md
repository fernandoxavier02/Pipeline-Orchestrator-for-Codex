# Paperclip Feature Flow Example

This example shows the repo-level shape of a Paperclip feature or user-story request in Codex. It does not prove Marketplace publication, installed-cache activation, or live plugin execution.

## Request

```text
As a maintainer, I want a repo-only compatibility fixture so Wave 6B has deterministic coverage.
```

## Expected Repo Surfaces

- Commands: `commands/paperclip-feature.md`, `commands/paperclip-user-story.md`
- Skills: `skills/paperclip-feature/SKILL.md`, `skills/paperclip-user-story/SKILL.md`
- Template families: `feature`, `user-story`
- Compatibility fixture: `tests/compat/wave6b-paperclip-scenarios.json`
- BDD parity: `tests/bdd/wave6b-paperclip-parity.feature.test.ts`

## Expected Boundary

Feature and user-story flows are code-changing only when the active workflow has passed its information gate, plan, tests, review, and validation requirements. If real agent runtime is mandatory but unavailable, the flow must stop with `blocked-no-agent-runtime`.
