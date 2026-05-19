---
title: "Codex Plugin Build Guide"
kind: "openai-codex-knowledge-article"
topics:
  - "plugin-manifest"
  - "skills"
  - "hooks"
  - "subagents"
  - "marketplace"
  - "build-checklist"
  - "drift"
source_urls:
  - "https://developers.openai.com/codex/plugins.md"
  - "https://developers.openai.com/codex/plugins/build.md"
  - "https://developers.openai.com/codex/skills.md"
  - "https://developers.openai.com/codex/hooks.md"
  - "https://developers.openai.com/codex/subagents.md"
  - "https://developers.openai.com/codex/concepts/subagents.md"
  - "https://developers.openai.com/codex/concepts/customization.md"
  - "https://developers.openai.com/codex/config-reference.md"
  - "https://developers.openai.com/codex/guides/agents-md.md"
  - "https://developers.openai.com/codex/custom-prompts.md"
  - "https://developers.openai.com/codex/changelog.md"
source_sets:
  - "Codex"
globs:
  - ".codex-plugin/plugin.json"
  - ".agents/plugins/marketplace.json"
  - "skills/**/SKILL.md"
  - "hooks/**/hooks.json"
  - "hooks/**/*.cjs"
  - ".codex/agents/**/*.toml"
  - "AGENTS.md"
  - "AGENTS.override.md"
last_verified: "2026-05-19"
status: "active"
---

# Codex Plugin Build Guide

End-to-end, schema-accurate guide for building Codex plugins that ship skills, hooks, MCP servers, and (optionally) custom subagents. This article consolidates the per-topic KB pages with the corrections detected against the live OpenAI docs on 2026-05-19. When the per-topic pages disagree with this guide, this guide is the more recent source — open the linked official pages before changing user-facing behavior.

## Five Customization Layers (Mental Model)

OpenAI documents Codex customization as five complementary surfaces. Choose the layer that matches the intent, not the layer that is easiest to ship:

| Surface | Best For | Where It Lives |
| --- | --- | --- |
| `AGENTS.md` | Persistent project/personal rules every session inherits | `~/.codex/AGENTS.md` (+ `AGENTS.override.md`), repo-root `AGENTS.md`, nested dirs |
| Memories | Knowledge that should carry across sessions | Codex-managed memory store |
| Skills | Repeatable workflows with optional scripts/refs/assets | `.agents/skills/` (standalone) or `<plugin>/skills/` (bundled) |
| MCP servers | External tools, resources, prompts via Model Context Protocol | `~/.codex/config.toml` `[mcp_servers]` or `<plugin>/.mcp.json` |
| Subagents | Delegated specialists with their own role, tools, sandbox | `~/.codex/agents/*.toml` or `.codex/agents/*.toml` |
| Plugins | Distribution wrapper around one or more of the above | `.codex-plugin/plugin.json` + bundled component dirs |

A plugin is not a sixth layer — it is the packaging contract that lets you ship the other layers as a single installable unit.

## Plugin Manifest (`.codex-plugin/plugin.json`)

The only mandatory file in a Codex plugin is `.codex-plugin/plugin.json`. Everything else is opt-in.

### Schema (verified 2026-05-19)

```json
{
  "name": "kebab-case-stable-id",
  "version": "0.1.0",
  "description": "One-line plugin summary.",
  "skills": "./skills/",
  "hooks": "./hooks/hooks.json",
  "mcpServers": "./.mcp.json",
  "apps": "./.app.json",
  "author":     { "name": "...", "email": "...", "url": "..." },
  "homepage":   "https://...",
  "repository": "https://...",
  "license":    "MIT",
  "keywords":   ["codex", "..."],
  "interface": {
    "displayName":       "Plugin Display Name",
    "shortDescription":  "60-80 char chip-style summary",
    "longDescription":   "Multi-sentence paragraph for the plugin store",
    "developerName":     "...",
    "category":          "Coding | Productivity | ...",
    "capabilities":      ["Interactive", "Write"],
    "websiteURL":        "https://...",
    "privacyPolicyURL":  "https://.../privacy",
    "termsOfServiceURL": "https://.../terms",
    "defaultPrompt":     ["First-run prompt line 1", "Line 2"],
    "brandColor":        "#14532D",
    "composerIcon":      "./assets/icon.svg",
    "logo":              "./assets/logo.svg",
    "screenshots":       ["./assets/screen-1.png"]
  }
}
```

### Rules

- All paths inside the manifest are **relative to plugin root** and should start with `./`.
- `hooks` may be a string (path), array, or object — most plugins use a single `./hooks/hooks.json`.
- Optional component fields (`skills`, `hooks`, `mcpServers`, `apps`) should be omitted unless the plugin actually ships that component.
- Keep `name` stable forever — it appears in install paths and marketplace entries.

### Install Layout

Codex installs plugins to:

```
~/.codex/plugins/cache/<MARKETPLACE_NAME>/<PLUGIN_NAME>/<VERSION>/
```

For local installs `<VERSION>` is the literal string `local`. Source diffs only affect the cache after a sync. Never claim "active in Codex" based on a source diff alone.

## Marketplace

A marketplace file lets Codex (and other users) discover your plugin.

### Locations (priority high → low)

1. `$REPO_ROOT/.agents/plugins/marketplace.json` — repo-scoped, shared via git.
2. `~/.agents/plugins/marketplace.json` — personal.
3. `.codex-plugin/marketplace.json` — legacy compatibility (still parsed; do not start new work here).

### Minimal Entry

```json
{
  "name": "my-plugin",
  "source": {
    "source": "local",
    "path": "./plugins/my-plugin"
  },
  "policy": {
    "installation":   "AVAILABLE",
    "authentication": "ON_INSTALL"
  },
  "category": "Coding"
}
```

`source.source` values: `local`, `url`, `git-subdir`. `installation` values: `AVAILABLE`, `INSTALLED_BY_DEFAULT`, `NOT_AVAILABLE`. `authentication` values: `ON_INSTALL`, `ON_FIRST_USE`.

## Skills

A skill is a Markdown file with YAML frontmatter that teaches Codex when and how to perform a reusable procedure.

### Two Discovery Paths

- **Standalone** (not part of a plugin): `$CWD/.agents/skills/<name>/SKILL.md`, walking up to `$REPO_ROOT/.agents/skills/`, then `$HOME/.agents/skills/`, then `/etc/codex/skills/`, then system bundled skills.
- **Plugin-bundled**: `<plugin-root>/skills/<name>/SKILL.md`, made discoverable through `plugin.json:skills` pointing at `./skills/`.

If two skills share a `name`, **both appear in the skill picker** — they do not merge. Pick distinctive names.

### Frontmatter Schema (verified 2026-05-19)

Only `name` and `description` are documented as required. Anything else is plugin-private extension and not interpreted by Codex.

```yaml
---
name: skill-name
description: When this skill should trigger AND what it does. Concrete contexts beat abstract claims.
---
```

Optional plugin-private fields you may see in the wild (this repo uses several): `agent_type`, `gates_at`, `sentinel_checkpoints`, `allowed-tools`, `argument-hint`. Codex itself does not parse these — they are consumed by the plugin runtime/hooks.

### Body Conventions

- Initial skill list is capped at ~2% of the model context window (~8k chars when unknown). Keep `description` substantive but tight.
- Progressive disclosure: name + description + path are always in context; SKILL.md body loads on selection; bundled files load when the body references them.
- Keep SKILL.md under ~500 lines. Split larger material into `references/*.md` and reference them from SKILL.md with explicit "Read X when Y" pointers.

### Layout

```
my-skill/
├── SKILL.md              (required)
├── scripts/              (executable helpers; can run without loading)
├── references/           (loaded on demand)
├── assets/               (outputs, templates, images)
└── agents/openai.yaml    (optional UI/MCP dependency declaration)
```

### Trigger Language

The `description` is the only signal Codex uses to decide whether to invoke the skill implicitly. Write it like a router:

- State the concrete contexts that should match ("when the user asks to ...").
- Mention near-miss cases the skill should NOT cover when there is real overlap risk.
- Avoid generic verbs ("helps with code"). Codex will not pick it.

## Hooks

Hooks are deterministic scripts that run at Codex lifecycle points. They are the only enforcement layer below the runtime itself.

### Supported Events

`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `Stop`.

Turn-scoped events (carry `turn_id`): `PreToolUse`, `PermissionRequest`, `PostToolUse`, `UserPromptSubmit`, `Stop`.

### Schema

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "spawn_agent|Agent",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${PLUGIN_ROOT}/hooks/dispatch-guard.cjs\"",
            "statusMessage": "Validating dispatch",
            "timeout": 600
          }
        ]
      }
    ]
  }
}
```

### Matcher Rules

Only some events support a matcher:

| Event | Matcher Filter | Examples |
| --- | --- | --- |
| `PreToolUse` / `PostToolUse` / `PermissionRequest` | tool name regex | `Bash`, `^apply_patch$`, `Edit\|Write`, `mcp__filesystem__.*` |
| `SessionStart` | start source | `startup\|resume\|clear` |
| `UserPromptSubmit` / `Stop` | unsupported (ignored) | — |

`"*"`, `""`, or omitting `matcher` matches everything.

### Hook Types

| Type | Behavior |
| --- | --- |
| `command` | Spawn the executable, pass event JSON on stdin, read JSON on stdout. |
| `prompt` | **Parsed but skipped.** Do not rely on it for enforcement. |
| `agent` | **Parsed but skipped.** Do not rely on it. |

`"async": true` is also parsed-but-skipped. If you ship a `"prompt"` hook for session greeting, treat it as documentation only.

### Input/Output Contract

All events receive on stdin:

```json
{
  "session_id":      "...",
  "transcript_path": "...|null",
  "cwd":             "...",
  "hook_event_name": "PreToolUse",
  "model":           "...",
  "permission_mode": "default|acceptEdits|plan|dontAsk|bypassPermissions"
}
```

Event-specific additions: `source` (SessionStart), `turn_id` + `tool_name` + `tool_use_id` + `tool_input` (PreToolUse/PostToolUse/PermissionRequest), `tool_response` (PostToolUse), `prompt` (UserPromptSubmit), `stop_hook_active` + `last_assistant_message` (Stop).

Output on stdout (exit 0):

- Generic: `{ "continue": true|false, "stopReason": "...", "systemMessage": "...", "suppressOutput": false, "hookSpecificOutput": { "hookEventName": "...", "additionalContext": "..." } }`
- `PreToolUse` deny: `{ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "why" } }`
- `PermissionRequest` allow/deny: `{ "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": { "behavior": "allow|deny", "message": "..." } } }`
- `PostToolUse` block: `{ "decision": "block", "reason": "...", "hookSpecificOutput": { "hookEventName": "PostToolUse", "additionalContext": "..." } }`
- `Stop` continuation: `{ "decision": "block", "reason": "..." }` — `reason` becomes the next prompt.

Exit code `2` with stderr is the universal "deny/block + reason" fallback. Exit code `0` with no output means success.

### Environment Variables

Plugin hooks receive both the canonical and the legacy set:

| Canonical | Legacy (Claude Code compat) |
| --- | --- |
| `PLUGIN_ROOT` | `CLAUDE_PLUGIN_ROOT` |
| `PLUGIN_DATA` | `CLAUDE_PLUGIN_DATA` |

Use `${PLUGIN_ROOT}` in new code; keep `${CLAUDE_PLUGIN_ROOT}` only when porting from an existing Claude Code plugin.

### Configuration Discovery & Opt-In

Codex loads hooks from (low → high precedence, all matching layers contribute):

1. `~/.codex/hooks.json`
2. `~/.codex/config.toml`
3. `<repo>/.codex/hooks.json`
4. `<repo>/.codex/config.toml`
5. Plugin-bundled `hooks.json` (via `plugin.json:hooks`)

Plugin hooks were opt-in (`[features].plugin_hooks = true`) until they became default-enabled in 2026. Check `codex --version` and the changelog before assuming the default in older environments.

### Defaults & Constraints

- Default per-hook timeout: 600 s.
- Commands run with the session `cwd`.
- Non-managed hooks require explicit trust review before they run.
- Repo-local hooks should resolve through `"$(git rev-parse --show-toplevel)/.codex/hooks/..."` rather than fragile relative paths.

## Custom Subagents (TOML in `.codex/agents/`)

Custom subagents are **TOML files**, not Markdown. The Markdown files under a plugin's `agents/**` are internal role prompts consumed by the plugin's runtime — they are not Codex custom subagents.

### File Location

| Scope | Path |
| --- | --- |
| Personal | `~/.codex/agents/<name>.toml` |
| Project | `.codex/agents/<name>.toml` |

### Schema

Required:

- `name`
- `description`
- `developer_instructions`

Optional (inherit from parent session when omitted):

- `model`
- `model_reasoning_effort` (`minimal|low|medium|high|xhigh`)
- `sandbox_mode` (`read-only|workspace-write|danger-full-access`)
- `mcp_servers`
- `skills.config`
- `nickname_candidates`

### Built-In Agent Types

Codex ships with three defaults: `default`, `worker`, `explorer`. Custom agents that share these names take precedence.

### Invocation

There is no special syntax. Codex spawns subagents only when the user explicitly asks for them in natural language ("spawn two agents", "delegate this in parallel", "use one agent per failure"). The multi-agent toolset (`spawn_agent`, `send_input`, `resume_agent`, `wait_agent`, `close_agent`) is on by default since 2026 (`features.multi_agent = true`). Inside `~/.codex/config.toml`:

```toml
[agents]
max_threads             = 6      # concurrent open agents
max_depth               = 1      # default prevents grandchild spawns
job_max_runtime_seconds = 1800   # spawn_agents_on_csv worker timeout

[agents.code-reviewer]
description       = "Reviews changes for security and correctness"
config_file       = "./agents/code-reviewer.toml"
nickname_candidates = ["Auditor", "Critic"]
```

### Context Isolation

Subagents inherit the parent sandbox policy. They are independent threads — inspect with `/agent`. Output returns as a **summary** to the parent thread, not raw transcripts (avoids context rot).

### Boundaries

Good for: read-heavy work (exploration, testing, triage, summarization, independent review).
Bad for: write-heavy parallel work (conflicts), tasks the parent must complete now, work that needs secrets the subagent does not have.

`max_depth=1` is intentional — raising it amplifies token and latency cost fast.

## MCP Servers

A plugin ships MCP servers by pointing `plugin.json:mcpServers` at a relative `.mcp.json`. Codex also accepts `[mcp_servers.<id>]` entries directly in `~/.codex/config.toml`.

Each server entry typically declares command/url, env, enabled tools, timeouts, and approval mode. Keep tool schemas narrow, fail-closed on auth, and prefer typed results over raw payloads.

## AGENTS.md

Codex searches `AGENTS.md` (or `AGENTS.override.md`) starting at `~/.codex/` then walking the project from git root down to `cwd`. `AGENTS.override.md` beats `AGENTS.md` at the same level; files closer to `cwd` beat distant ones. Default size cap: `project_doc_max_bytes = 32768`. Fallback filenames are configurable via `project_doc_fallback_filenames`.

## Slash Commands and Custom Prompts

There is **no `commands/` directory in the Codex plugin schema**. Codex Claude-Code-style command files (`commands/foo.md`) are not interpreted as slash commands by Codex.

Codex uses two patterns instead:

1. **Custom prompts** (`~/.codex/prompts/*.md`) — invoked with `/prompts:<name>`. Personal, not shared via repo. **Deprecated in 2026** in favor of skills inside plugins.
2. **Plugin skills** — invoked through the `/skills` picker or `$plugin:skill` mention. Shareable, implicit invocation, supports scripts/references/assets.

For new work, ship behaviour as a skill. Use custom prompts only for personal, throwaway aliases.

## Build Checklist

When adding or shipping a Codex plugin:

1. `.codex-plugin/plugin.json` exists, has stable `name` + valid semver `version`.
2. Manifest paths are relative, start with `./`, and the referenced directories actually exist.
3. Skills live in `<plugin>/skills/<name>/SKILL.md` with a tight `description`. Body < 500 lines; reference files under `references/`.
4. Hooks use `type: "command"` for enforcement. `prompt`/`agent` types are documentation only.
5. Custom subagents (if any) ship as TOML at `~/.codex/agents/` or `.codex/agents/` — not as markdown inside the plugin.
6. MCP servers (if any) declared in `.mcp.json` and referenced from the manifest.
7. Marketplace entry at `.agents/plugins/marketplace.json` (repo) or `~/.agents/plugins/marketplace.json` (personal).
8. `${PLUGIN_ROOT}` is used in hook commands; `${CLAUDE_PLUGIN_ROOT}` only as legacy fallback.
9. Tests cover at minimum: manifest validity, skill frontmatter, hook deny path, and any enforcement claim.
10. Documentation matches runtime. If a claim cannot be enforced by hook/skill/runtime, mark it as documentation, not behavior.

## Drift Notes (2026-05-19)

Versus the per-topic KB pages last verified 2026-05-18, these are the corrections this guide carries:

- Custom prompts (`/prompts:...`) are **deprecated**. Ship behaviour as skills inside plugins.
- Plugin hooks are **default-enabled** since the 2026 plugin workflow update. `[features].plugin_hooks` is mostly historical.
- Hook `type: "prompt"` and `type: "agent"` are parsed-but-skipped. Only `type: "command"` executes.
- Custom Codex subagents are **TOML** at `~/.codex/agents/` or `.codex/agents/`. Markdown files under a plugin's `agents/**` are internal role prompts, not Codex custom subagents.
- The multi-agent toolset is broader than just `spawn_agent` — `send_input`, `resume_agent`, `wait_agent`, and `close_agent` are part of the set and **on by default** since 2026.
- `${PLUGIN_ROOT}` / `${PLUGIN_DATA}` are the canonical env vars; `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_DATA}` are kept only for legacy compatibility.
- Standalone skills live in `.agents/skills/`, not `skills/`. Inside a plugin, skills live in `<plugin>/skills/` and become discoverable via `plugin.json:skills`.
- Marketplace canonical location is `.agents/plugins/marketplace.json`. `.codex-plugin/marketplace.json` is legacy compatibility.
- `AGENTS.override.md` exists as a precedence override over `AGENTS.md` at the same scope; default size cap is 32 KiB.
- `@` mentions in 2026 search files, directories, plugins, and skills in a single picker — useful for cross-discovery.
