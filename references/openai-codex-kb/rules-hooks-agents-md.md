---
title: "Rules, Hooks, and AGENTS.md"
kind: "openai-codex-knowledge-article"
topics:
  - "rules"
  - "hooks"
  - "agents-md"
  - "configuration"
  - "precedence"
  - "sandbox"
  - "approval"
  - "governance"
source_urls:
  - "https://developers.openai.com/codex/rules.md"
  - "https://developers.openai.com/codex/hooks.md"
  - "https://developers.openai.com/codex/guides/agents-md.md"
  - "https://developers.openai.com/codex/config-basic.md"
  - "https://developers.openai.com/codex/config-advanced.md"
  - "https://developers.openai.com/codex/config-reference.md"
  - "https://developers.openai.com/codex/agent-approvals-security.md"
source_sets:
  - "Codex"
globs:
  - "AGENTS.md"
  - "hooks/**/*.cjs"
  - "hooks/**/*.json"
  - ".codex/**/*.toml"
  - ".codex-plugin/plugin.json"
  - "skills/**/*.md"
  - "tests/unit/hooks/**/*.ts"
last_verified: "2026-05-18"
status: "active"
---

# Rules, Hooks, and AGENTS.md

Codex configuration has several layers. Rules constrain command execution. Hooks run deterministic scripts at lifecycle points. `AGENTS.md` gives project-specific instructions. Plugin skills and prompts provide task-specific behavior. System and developer instructions still have higher authority than local files.

Use this article before changing project instructions, hook behavior, command permissions, or public claims about what Codex will enforce.

## AGENTS.md

`AGENTS.md` is project guidance for agents. It should explain the repository identity, authority order, working rules, verification commands, and important context files.

Good `AGENTS.md` guidance is:

- short enough to be loaded often;
- explicit about authority and drift;
- honest about runtime limits;
- focused on durable project behavior;
- not a dumping ground for every historical decision.

This repo's `AGENTS.md` already defines the local SSOT order and says `docs/**` cannot override runtime. Preserve that shape.

## Rules

Rules control which commands Codex can run outside sandbox or under approval policies. They are security controls, not documentation.

When adding or changing rules:

- Keep them as narrow as possible.
- Prefer command prefixes over broad shell permission.
- Consider read-only vs mutating commands.
- Treat network and secrets as separate risks.
- Test or manually verify the effective behavior.

Do not write docs saying a dangerous action is forbidden if the actual rule still allows it.

## Hooks

Hooks can inspect events, enforce policy, write logs, or block actions. They are useful because they are deterministic and not dependent on model discretion.

Hook design principles:

- Fail closed for security and governance enforcement.
- Emit auditable reasons.
- Avoid secret exposure in logs.
- Keep path handling cross-platform where possible.
- Keep hook logic small enough to review.
- Add tests for denied and allowed cases.

In this repo, hook changes are high-impact because they can affect dispatch, session locks, edit guards, prompt injection handling, and completion checks.

## Precedence and Conflict Handling

Use this order:

1. System/developer instructions from the active session.
2. Local `AGENTS.md` and `.kiro/**`.
3. Canonical skill contracts such as `skills/pipeline/SKILL.md`.
4. Runtime source and hooks.
5. References and docs.

If lower-priority docs conflict with runtime, say "drift" and fix the appropriate layer. Do not hide the conflict with vague wording.

## Practical Enforcement Matrix

| Surface | Best For | Not Enough For |
| --- | --- | --- |
| `AGENTS.md` | Project guidance and authority order | Hard security enforcement |
| Rules | Shell/command permission policy | Business logic |
| Hooks | Deterministic lifecycle checks | Full application runtime behavior |
| Skills | Reusable workflow procedure | Host tool availability |
| Runtime TypeScript | Product behavior and validation | Current external docs |
| Tests | Regression evidence | Official product changes |

## Local Change Pattern

When changing rules, hooks, or `AGENTS.md`:

1. Identify the authoritative layer.
2. Make the smallest change that resolves the issue.
3. Add or update tests if runtime behavior changes.
4. Run focused hook/config tests.
5. Run broader validation when a public workflow changes.
6. State whether the change is source-only or also synced to an installed cache.

## Drift Notes (2026-05-19)

See [plugin-build-guide.md](plugin-build-guide.md) for the schema-accurate consolidated version. Hook corrections: only `type: "command"` executes — `type: "prompt"` and `type: "agent"` are parsed-but-skipped (treat any `prompt` greeting in `SessionStart` as documentation, not enforcement). Supported events: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `Stop`. Matchers exist only on `PreToolUse` / `PostToolUse` / `PermissionRequest` (tool name regex) and `SessionStart` (start source); `UserPromptSubmit` and `Stop` ignore matchers. Deny contract for `PreToolUse`: `{ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "..." } }` (legacy form `{ "decision": "block", "reason": "..." }` still parsed; exit code 2 + stderr also blocks). `AGENTS.md` supports an `AGENTS.override.md` sibling that wins at the same scope; default `project_doc_max_bytes` is 32 KiB. Plugin hooks are default-enabled since 2026.

