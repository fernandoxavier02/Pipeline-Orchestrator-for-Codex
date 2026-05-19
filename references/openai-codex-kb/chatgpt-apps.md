---
title: "ChatGPT Apps"
kind: "openai-codex-knowledge-article"
topics:
  - "chatgpt"
  - "apps-sdk"
  - "mcp-server"
  - "components"
  - "state"
  - "authentication"
  - "submission"
  - "security"
source_urls:
  - "https://developers.openai.com/chatgpt"
  - "https://developers.openai.com/apps-sdk/llms.txt"
  - "https://developers.openai.com/apps-sdk/quickstart.md"
  - "https://developers.openai.com/apps-sdk/build/mcp-server.md"
  - "https://developers.openai.com/apps-sdk/build/chatgpt-ui.md"
  - "https://developers.openai.com/apps-sdk/build/auth.md"
  - "https://developers.openai.com/apps-sdk/build/state-management.md"
  - "https://developers.openai.com/apps-sdk/guides/security-privacy.md"
source_sets:
  - "ChatGPT/Apps SDK"
globs:
  - "docs/**/*.md"
  - "references/**/*.md"
  - ".codex-plugin/plugin.json"
  - "skills/**/*.md"
  - "src/**/*.ts"
last_verified: "2026-05-18"
status: "active"
---

# ChatGPT Apps

ChatGPT Apps are built with the Apps SDK. The core architecture is an MCP-powered server plus UI components that ChatGPT can render. This matters to Codex plugin work because Codex plugins, MCP apps, and ChatGPT apps are related concepts but not interchangeable.

## Apps SDK Mental Model

An app typically has:

- an MCP server that exposes tools and resources;
- UI components that ChatGPT can display;
- metadata that helps ChatGPT understand and present the app;
- authentication when user-specific data or actions are involved;
- state management across server, UI, and conversation;
- deployment and submission steps.

The server remains the authority for business logic. The UI helps the user act, but it should not be the only place where validation or permission rules live.

## Tools and Components

Apps SDK tools let ChatGPT ask the app server for work. Components give the user a visual interactive surface. A good app keeps these responsibilities clear:

- Tools perform server-side operations and return structured results.
- Components display state and collect user interaction.
- The app server validates inputs and auth.
- ChatGPT coordinates the experience but does not replace application security.

For local documentation, always identify whether a claim is about:

- ChatGPT Apps SDK;
- Codex plugin packaging;
- OpenAI API tool calling;
- MCP in general.

## Authentication and State

Apps may need user authentication. Treat auth as a server-side concern:

- Never rely only on component state for permission.
- Avoid exposing tokens or secrets to the model or UI.
- Keep user-specific data scoped to the authenticated user.
- Log enough to debug without leaking private data.

State should be split:

- Business state belongs on the server or durable backend.
- UI state belongs in the component.
- Conversation state belongs in ChatGPT/Codex context only when it is safe and useful.

## Deployment and Submission

Apps SDK docs include deployment, testing, troubleshooting, and submission guidance. For this repo, do not claim that a Codex plugin is a submitted ChatGPT app unless it has actually gone through the relevant app flow.

Precise language:

- "Codex plugin" means a Codex plugin bundle.
- "ChatGPT app" means an Apps SDK app connected to ChatGPT.
- "MCP app" means an MCP-backed app surface.
- "Connector" means a configured integration exposed by the host.

## Security and Privacy

Security guidance for apps is especially relevant when tools can mutate external systems.

Checklist:

- Validate all tool inputs server-side.
- Use least privilege for tokens.
- Keep secrets outside repo files.
- Sanitize tool results.
- Avoid returning unnecessary personal or sensitive data.
- Make destructive actions explicit and reversible when possible.

## Relevance to This Plugin

`pipeline-orchestrator-for-codex` is not a ChatGPT app by default. It is a Codex plugin that provides workflow skills, hooks, prompts, and references. Apps SDK docs are still useful when:

- adding an MCP-backed integration;
- designing plugin metadata;
- comparing Codex plugin distribution with ChatGPT app submission;
- documenting external connector boundaries.

