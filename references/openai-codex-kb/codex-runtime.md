---
title: "Codex Runtime"
kind: "openai-codex-knowledge-article"
topics:
  - "codex-app"
  - "codex-cli"
  - "ide-extension"
  - "cloud"
  - "worktrees"
  - "local-environments"
  - "approvals"
  - "sandboxing"
  - "windows"
  - "security"
source_urls:
  - "https://developers.openai.com/codex/llms.txt"
  - "https://developers.openai.com/codex/overview.md"
  - "https://developers.openai.com/codex/app.md"
  - "https://developers.openai.com/codex/cli.md"
  - "https://developers.openai.com/codex/ide.md"
  - "https://developers.openai.com/codex/cloud.md"
  - "https://developers.openai.com/codex/concepts/sandboxing.md"
  - "https://developers.openai.com/codex/agent-approvals-security.md"
  - "https://developers.openai.com/codex/app/windows.md"
source_sets:
  - "Codex"
globs:
  - "AGENTS.md"
  - ".codex-plugin/plugin.json"
  - "commands/**/*.md"
  - "skills/**/*.md"
  - "hooks/**/*.cjs"
  - "src/**/*.ts"
  - "tests/**/*.ts"
last_verified: "2026-05-18"
status: "active"
---

# Codex Runtime

Codex is the coding agent surface that runs across the app, CLI, IDE extension, web/cloud workflows, and integrations. This repo is a plugin for Codex, so runtime claims must be precise: a local plugin can provide skills, hooks, prompts, and workflow guidance, but it cannot invent host capabilities that the active Codex session does not expose.

## Runtime Surfaces

Codex appears in several operational forms:

- App: desktop command center with threads, workspaces, worktrees, browser/computer-use surfaces, automations, review, and local environment setup.
- CLI: terminal pairing and non-interactive execution.
- IDE extension: editor-native pairing with slash commands and file context.
- Web/cloud: delegated tasks in managed environments with separate internet/environment controls.
- Integrations: GitHub, Slack, Linear, and other product-specific entrypoints.

Do not assume every surface exposes the same tools. A behavior available in the app may not be available in CLI, and a cloud task may not have the same filesystem, network, or approval path as a local desktop thread.

## App, Worktrees, and Local Environments

The Codex app can work against local repositories and use Git worktrees to isolate parallel work. Local environment configuration is meant to prepare dependencies and common commands for those worktrees.

Repo guidance:

- Treat the current checkout as the source under edit unless the user explicitly asks for global cache sync or publication.
- Do not claim "published" or "active globally" after local edits. Verify the real plugin surfaces first.
- Avoid mutating generated or runtime-local state such as `.pipeline/sessions/audit.log` unless the task is explicitly about operational logs.
- When a task needs a dev server, browser, or app preview, verify the actual running target rather than relying on static code.

## CLI and Non-Interactive Mode

The CLI surface is useful for scripted work and CI-style checks. Non-interactive execution is powerful, but it increases the need for deterministic prompts, strict exit status handling, and explicit artifacts.

For this plugin:

- CLI tests should validate protocol behavior, not just happy-path prose.
- Non-interactive runs should fail clearly when required host capabilities are missing.
- The controller should not silently downgrade a workflow that requires real agents into a pretend multi-agent flow.

## Approvals and Sandboxing

Codex uses sandboxing, approvals, and network controls to reduce risk around filesystem, shell, network, and browser/computer use. The practical rule is simple: the agent may propose an action, but the host decides whether it is allowed.

Implementation guidance:

- Keep destructive operations behind explicit target and impact checks.
- Treat network access as environment-dependent.
- Separate read-only inspection from mutating execution.
- Use approval and sandbox failures as real signals. Do not hide them behind generic success language.

This repo's local rule remains stricter for governed workflows: if real subagents are mandatory and unavailable, the pipeline should block honestly with `blocked-no-agent-runtime`.

## Windows

The official Codex docs include Windows-specific guidance for app usage and PowerShell support. In this repo, Windows matters because the workspace path is `D:\Pipeline Orchestrator for Codex` and the active shell is PowerShell.

Practical Windows rules:

- Use PowerShell-native commands for file inspection and process checks.
- Be careful with quoting paths that contain spaces.
- Prefer `-LiteralPath` for exact paths when a PowerShell cmdlet supports it.
- Avoid cross-shell destructive pipelines.
- If a test fails with memory or IPC symptoms, run focused Vitest subsets before diagnosing it as a product regression.

## Security Boundaries

Codex security docs cover approvals, sandboxing, cyber safety, and enterprise controls. For plugin work, the local boundary is:

- Markdown can instruct.
- Hooks can enforce some lifecycle and tool-use rules.
- Runtime TypeScript and tests define product behavior.
- The host Codex app ultimately determines which tools exist in a given session.

Never describe a Markdown instruction as enforcement unless a hook, runtime check, test, or host permission actually enforces it.

## Runtime Drift Checklist

Before saying a Codex behavior is active:

1. Verify the local repo diff and branch state.
2. Verify the plugin manifest if the plugin surface changed.
3. Verify marketplace/config/cache surfaces if the claim is global availability.
4. Verify generated build output only if source changes require it.
5. Run the relevant tests or explain why they could not run.
6. State limits plainly, especially around subagents, MCP, browser/computer use, and network access.

