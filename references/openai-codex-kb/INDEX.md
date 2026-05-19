---
title: "OpenAI Codex Knowledge Base"
kind: "openai-codex-knowledge-index"
topics:
  - "openai-api"
  - "codex"
  - "chatgpt-apps"
  - "skills"
  - "plugins"
  - "agents"
  - "subagents"
  - "mcp"
  - "rules"
  - "hooks"
  - "agents-md"
source_urls:
  - "https://developers.openai.com/api/docs"
  - "https://developers.openai.com/api/docs/llms.txt"
  - "https://developers.openai.com/codex"
  - "https://developers.openai.com/codex/llms.txt"
  - "https://developers.openai.com/chatgpt"
  - "https://developers.openai.com/apps-sdk/llms.txt"
  - "https://developers.openai.com/learn"
  - "https://developers.openai.com/learn/llms.txt"
source_sets:
  - "API Docs"
  - "Codex"
  - "ChatGPT/Apps SDK"
  - "Learn"
globs:
  - "skills/**/*.md"
  - "hooks/**/*.cjs"
  - "agents/**/*.md"
  - "prompts/**/*.md"
  - "references/**/*.md"
  - ".codex-plugin/plugin.json"
  - "AGENTS.md"
last_verified: "2026-05-18"
status: "active"
---

# OpenAI Codex Knowledge Base

This directory is the local, agent-readable knowledge base for OpenAI and Codex surfaces that affect this plugin. It is intentionally written as original operational guidance, not as a verbatim mirror of OpenAI documentation. The official OpenAI pages remain the source of truth for product behavior, current parameters, pricing, model names, limits, and release status.

Use this KB before changing any local surface that touches OpenAI API behavior, Codex configuration, skills, plugins, agents, subagents, MCP, hooks, rules, `AGENTS.md`, or documentation that claims how Codex works.

## Source Policy

Primary source maps:

- OpenAI API Docs: `https://developers.openai.com/api/docs/llms.txt`
- Codex Docs: `https://developers.openai.com/codex/llms.txt`
- ChatGPT Apps SDK Docs: `https://developers.openai.com/apps-sdk/llms.txt`
- Learn and Cookbook: `https://developers.openai.com/learn/llms.txt`

The `llms.txt` files are preferred as the coverage map because OpenAI publishes them for tool and agent ingestion. When an exact behavior matters, follow the page link from the index and read the Markdown page directly. If a local rule conflicts with the official docs, treat it as drift: do not silently merge the two claims.

## Article Map

- [API Platform](api-platform.md): Responses API, tool use, structured output, state, background work, files, evals, and production readiness.
- [Codex Runtime](codex-runtime.md): Codex app, CLI, IDE, cloud, worktrees, approvals, sandboxing, local environments, Windows, and security boundaries.
- [Skills](skills.md): Skills as reusable knowledge and procedures, including differences between API-hosted skills, Codex skills, and this plugin's skill files.
- [Plugins](plugins.md): Codex plugin packaging, manifests, local/cache/runtime boundaries, and how this repo should avoid overclaiming availability.
- [Agents and Subagents](agents-and-subagents.md): Agent orchestration, subagent delegation, context isolation, handoffs, review independence, and local `spawn_agent` limits.
- [MCP and Connectors](mcp-and-connectors.md): Model Context Protocol, connectors, Docs MCP, Apps SDK MCP servers, and safe capability boundaries.
- [Rules, Hooks, and AGENTS.md](rules-hooks-agents-md.md): Configuration precedence, command rules, hooks, project instructions, and fail-closed governance.
- [ChatGPT Apps](chatgpt-apps.md): Apps SDK concepts, MCP-backed tools, UI components, state, authentication, deployment, and submission.
- [Learn and Cookbook Patterns](learn-cookbook-patterns.md): Practical engineering patterns from Learn, including eval loops, traces, prompt caching, cost/accuracy tradeoffs, and Codex workflows.
- [Source Map](source-map.md): Official links grouped by product area for follow-up research.

## How Agents Should Use This KB

Start with the narrowest article that matches the change. Use the `globs` in FrontMatter to decide whether an article applies to the current file. Then open the official source URL when:

- the work depends on a current model name, parameter, limit, price, or release state;
- the local doc would change public behavior or a user-facing claim;
- implementation touches auth, permissions, network access, file execution, browser/computer use, or external connectors;
- a test or runtime result contradicts a statement in this KB.

This KB is a retrieval layer. It does not override system/developer instructions, local `AGENTS.md`, `.kiro/**`, runtime source, hooks, skills, or tests.

