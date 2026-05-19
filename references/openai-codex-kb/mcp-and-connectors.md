---
title: "MCP and Connectors"
kind: "openai-codex-knowledge-article"
topics:
  - "mcp"
  - "connectors"
  - "apps-sdk"
  - "docs-mcp"
  - "tools"
  - "permissions"
  - "remote-services"
source_urls:
  - "https://developers.openai.com/api/docs/mcp.md"
  - "https://developers.openai.com/api/docs/guides/tools-connectors-mcp.md"
  - "https://developers.openai.com/api/docs/guides/realtime-mcp.md"
  - "https://developers.openai.com/codex/mcp.md"
  - "https://developers.openai.com/apps-sdk/concepts/mcp-server.md"
  - "https://developers.openai.com/apps-sdk/build/mcp-server.md"
  - "https://developers.openai.com/learn/docs/docs-mcp.md"
source_sets:
  - "API Docs"
  - "Codex"
  - "ChatGPT/Apps SDK"
  - "Learn"
globs:
  - ".mcp.json"
  - ".codex/**/*.toml"
  - "src/**/*.ts"
  - "docs/**/*.md"
  - "references/**/*.md"
  - "skills/**/*.md"
last_verified: "2026-05-18"
status: "active"
---

# MCP and Connectors

Model Context Protocol (MCP) is a way to expose external tools and context to model clients through a portable server interface. Connectors are managed integrations that expose product-specific capabilities, such as source control, docs, calendars, or messaging.

The important local distinction:

- MCP/connectors expose tools.
- Skills teach the agent when and how to use tools.
- Hooks/rules decide whether local actions are allowed.
- Runtime code enforces product behavior.

## MCP Server Role

An MCP server usually provides tools, resources, or prompts. The client decides which MCP servers are connected and which tools are available to the model.

For ChatGPT Apps, an MCP server can back an app experience by exposing tools and UI resources. For Codex, MCP can give the coding agent access to external systems or project-specific context.

Do not assume an MCP capability exists because a doc mentions it. Verify the active tool list or configured server.

## Connectors

Connectors are higher-level integrations managed by the host environment. They may expose search, read, write, creation, update, or deployment tools.

Operational rules:

- Check whether the connector is installed and callable.
- Prefer read-only lookup before mutation.
- Keep auth and permission boundaries clear.
- Do not ask a connector to do work that a local repo edit should own.
- For external systems, cite the resource inspected or the command result.

## Docs MCP

The Learn docs include a Docs MCP entrypoint and an OpenAI Developers plugin for Codex. Use official docs tooling when available for current OpenAI API guidance. If unavailable, use official `developers.openai.com` pages and record links.

For this KB, the `llms.txt` indexes are the stable map. They are not a substitute for reading exact source pages when current syntax matters.

## Apps SDK and MCP

Apps SDK builds ChatGPT apps around an MCP-powered server plus embeddable UI components. The app server exposes tools and resources; ChatGPT renders components and coordinates user interaction.

When documenting Apps SDK:

- Keep business rules server-side.
- Treat UI state and server state separately.
- Authenticate users where required.
- Avoid leaking private data through tool results or component metadata.
- Test the integration path, not only local UI rendering.

## MCP in API Workflows

The API docs describe MCP as a tool option for model workflows. That means an API application can let a model call external MCP tools, subject to application permissions and configuration.

Design guidance:

- Keep MCP tool schemas narrow.
- Use allowlists for sensitive tools.
- Log tool calls and results in a traceable way.
- Fail closed when auth, network, or schema validation fails.
- Prefer small, typed tool results over large raw payloads.

## Local Plugin Boundary

This repository is not itself an MCP server unless a specific runtime file implements one. Do not describe a skill, hook, or Markdown reference as an MCP server.

If a future feature adds MCP:

- create a real server entrypoint;
- document setup and auth;
- add tests for tool registration and tool behavior;
- keep dangerous tools behind explicit permission checks;
- update this KB and the plugin manifest only after runtime support exists.

