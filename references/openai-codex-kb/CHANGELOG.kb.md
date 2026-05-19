---
title: "openai-codex-kb — Editorial Changelog"
last_verified: "2026-05-19"
authority: "consolidated"
---

# KB Codex Changelog

This file preserves the editorial history previously embedded as bottom-appended
"Drift Notes" sections on the per-topic files (`plugins.md`, `skills.md`,
`agents-and-subagents.md`, `rules-hooks-agents-md.md`). It exists so the
corrected content can flow at the top of each per-topic file (no stale text
sitting above the corrections), while the older notes remain searchable for
auditors.

The schema-accurate consolidated version lives in
[`plugin-build-guide.md`](plugin-build-guide.md). When a per-topic file diverges
from the build guide, treat the build guide as the SSOT.

## 2026-05-19 — Drift consolidated into SSOT

Spec: [`pipeline-trust-restoration / R10`](../../.kiro/specs/pipeline-trust-restoration/requirements.md).
Migrated the four Drift Notes from per-topic files into this changelog so a
grep for corrected schema facts no longer lands on pre-correction text.

### plugins.md

Marketplace canonical location moved to `.agents/plugins/marketplace.json`
(`.codex-plugin/marketplace.json` is legacy). Custom prompts (`/prompts:...`)
are deprecated in favor of plugin skills. Plugin hooks are default-enabled
since 2026. Environment variables for hooks are `${PLUGIN_ROOT}` /
`${PLUGIN_DATA}` (the `CLAUDE_*` prefix remains only for compatibility).

### skills.md

Standalone skills live in `.agents/skills/` (not `skills/`); plugin-bundled
skills stay under `<plugin>/skills/` and are discovered via
`plugin.json:skills`. Required frontmatter is `name` + `description` only —
extension fields like `agent_type`, `gates_at`, `allowed-tools`, and
`argument-hint` are plugin-private and not parsed by Codex itself. Initial
skills list is capped at ~2% of context window. Same-name collisions surface
both skills in the picker — they do not merge.

### agents-and-subagents.md

Custom Codex subagents are TOML files at `~/.codex/agents/*.toml` (personal)
or `.codex/agents/*.toml` (project), with required fields `name` /
`description` / `developer_instructions` and optional `model`,
`model_reasoning_effort`, `sandbox_mode`, `mcp_servers`, `skills.config`,
`nickname_candidates`. Markdown files under `agents/**` in this repo are
internal role prompts consumed by the plugin's controller — they are not
Codex custom subagents. Built-in agent types are `default`, `worker`,
`explorer`. Multi-agent toolset (`spawn_agent`, `send_input`, `resume_agent`,
`wait_agent`, `close_agent`) is on by default since 2026
(`features.multi_agent = true`). `[agents] max_depth = 1` by default — raising
it amplifies token/latency cost fast.

### rules-hooks-agents-md.md

Only `type: "command"` executes in hooks — `type: "prompt"` and
`type: "agent"` are parsed-but-skipped (treat any `prompt` greeting in
`SessionStart` as documentation, not enforcement). Supported events:
`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`,
`PostToolUse`, `Stop`. Matchers exist only on `PreToolUse` / `PostToolUse` /
`PermissionRequest` (tool name regex) and `SessionStart` (start source);
`UserPromptSubmit` and `Stop` ignore matchers. Deny contract for `PreToolUse`:
`{ "hookSpecificOutput": { "hookEventName": "PreToolUse",
"permissionDecision": "deny", "permissionDecisionReason": "..." } }`
(legacy form `{ "decision": "block", "reason": "..." }` still parsed; exit
code 2 + stderr also blocks). `AGENTS.md` supports an `AGENTS.override.md`
sibling that wins at the same scope; default `project_doc_max_bytes` is
32 KiB. Plugin hooks are default-enabled since 2026.
