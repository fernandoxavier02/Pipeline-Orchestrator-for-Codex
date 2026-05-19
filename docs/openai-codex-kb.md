---
title: "OpenAI Codex Knowledge Base Guide"
kind: "documentation-guide"
topics:
  - "openai-codex-kb"
  - "agent-retrieval"
  - "source-map"
last_verified: "2026-05-18"
status: "active"
---

# OpenAI Codex Knowledge Base Guide

The local OpenAI/Codex knowledge base lives at `references/openai-codex-kb/`. It is a searchable reference layer for agents and maintainers working on this plugin. Use it before changing Codex/OpenAI-related surfaces such as skills, plugins, MCP, hooks, rules, agents, subagents, `AGENTS.md`, API docs, or public runtime claims.

## Where to Start

- Start with `references/openai-codex-kb/INDEX.md` for the article map and source policy.
- Use `references/openai-codex-kb/source-map.md` when you need the official OpenAI page behind a local statement.
- Use the topic articles for implementation context:
  - API behavior: `api-platform.md`
  - Codex runtime behavior: `codex-runtime.md`
  - Skills: `skills.md`
  - Plugins: `plugins.md`
  - Agents/subagents: `agents-and-subagents.md`
  - MCP/connectors: `mcp-and-connectors.md`
  - Rules/hooks/AGENTS: `rules-hooks-agents-md.md`
  - ChatGPT Apps: `chatgpt-apps.md`
  - Learn/Cookbook patterns: `learn-cookbook-patterns.md`

## When to Return to Official Docs

Return to `developers.openai.com` when a change depends on current product details: model names, parameters, pricing, limits, feature maturity, SDK syntax, MCP schema details, app submission rules, or security/admin behavior.

The local KB is intentionally not a copy of the official docs. It explains how to apply those docs inside this repository.

## Local Authority Boundary

For this plugin, local runtime truth still comes from `skills/**`, `src/**`, `hooks/**`, `agents/**`, `prompts/**`, tests, and actual Codex host capabilities. The KB helps agents find and apply official OpenAI context, but it does not override the repository SSOT.

