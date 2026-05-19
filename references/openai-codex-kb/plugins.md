---
title: "Plugins"
kind: "openai-codex-knowledge-article"
topics:
  - "plugins"
  - "plugin-manifest"
  - "skills"
  - "hooks"
  - "apps"
  - "connectors"
  - "marketplace"
  - "cache"
source_urls:
  - "https://developers.openai.com/codex/plugins.md"
  - "https://developers.openai.com/codex/plugins/build.md"
  - "https://developers.openai.com/apps-sdk/deploy/submission.md"
  - "https://developers.openai.com/learn/docs/developers-codex-plugin.md"
  - "https://developers.openai.com/learn/guide/developers-codex-plugin.md"
source_sets:
  - "Codex"
  - "ChatGPT/Apps SDK"
  - "Learn"
globs:
  - ".codex-plugin/plugin.json"
  - "skills/**/*.md"
  - "hooks/**/*.json"
  - "hooks/**/*.cjs"
  - "README.md"
  - "docs/**/*.md"
last_verified: "2026-05-18"
status: "active"
---

# Plugins

Codex plugins package reusable capabilities for Codex. A plugin can expose skills, hooks, apps/connectors, metadata, assets, and public interface information. In this repo, the plugin is `pipeline-orchestrator-for-codex`, and the local checkout is the SSOT for its source.

## What a Plugin Provides

A plugin may include:

- A manifest that describes name, version, display metadata, skills path, hooks path, assets, and public interface copy.
- Skills that Codex can discover and invoke.
- Hooks that run deterministic scripts at lifecycle points.
- App or connector integration metadata when applicable.
- Documentation and references that support the behavior.

The manifest and docs should not promise more than the runtime can prove.

## Manifest Discipline

This repo's manifest lives at `.codex-plugin/plugin.json`. Treat it as a public contract. Before changing it:

- Verify the skill paths and hook paths still exist.
- Keep display descriptions accurate.
- Do not claim global availability after a local source edit.
- Do not add capabilities unless Codex can actually use them in the installed environment.
- Keep version and changelog decisions aligned with the release workflow.

## Source, Marketplace, Config, Cache

Local plugin work has several layers:

- Source checkout: the files in this repository.
- Marketplace or plugin registry entry: how Codex discovers an installable plugin.
- User or workspace config: whether the plugin is enabled.
- Cache/install copy: what Codex actually loads at runtime.
- Host session: which tools and permissions are exposed right now.

Do not flatten these layers. A source diff can be correct while the active cache remains stale. A cache can match source while the current session still lacks a required host tool.

## Hooks in Plugins

Hooks are deterministic scripts tied to Codex lifecycle events. They can validate, deny, log, or shape workflow behavior. They should stay small and auditable.

For this repo:

- Hook changes are runtime-facing and require tests.
- A hook should not be the only place where critical business logic exists if TypeScript runtime also depends on it.
- Hook output must be safe to log and should avoid leaking secrets.
- If a hook enforces read-only behavior, tests should prove denied writes fail closed.

## Skills in Plugins

Plugin skills should be discoverable and scoped. For `pipeline-orchestrator-for-codex`, public workflows are exposed under the plugin namespace, and the skill body should describe the real contract.

Avoid:

- duplicate command bodies that drift from the canonical skill;
- undocumented aliases;
- hidden dependency on tools not declared or not available;
- mixing local docs and public runtime claims.

## Apps and Connectors

Plugins can be adjacent to apps/connectors, but those are not the same thing as Markdown skills. Apps/connectors expose external services through managed tool surfaces. Skills tell the agent how to use capability.

For this plugin, do not imply an app connector exists unless it is actually installed and callable in the Codex environment.

## Publication Language

Use precise language:

- "Implemented locally" means files changed in this checkout.
- "Validated locally" means tests/checks passed in this checkout.
- "Built" means generated output was produced where applicable.
- "Synced to cache" means the active install copy was updated and verified.
- "Published" means the remote or marketplace surface was actually updated and confirmed.

This distinction matters because the user frequently asks whether a plugin "pegou efeito" in real Codex runtime.

