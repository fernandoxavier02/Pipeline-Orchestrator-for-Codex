---
title: "OpenAI Source Map"
kind: "openai-codex-knowledge-source-map"
topics:
  - "sources"
  - "api-docs"
  - "codex"
  - "chatgpt-apps"
  - "learn"
source_urls:
  - "https://developers.openai.com/api/docs/llms.txt"
  - "https://developers.openai.com/codex/llms.txt"
  - "https://developers.openai.com/apps-sdk/llms.txt"
  - "https://developers.openai.com/learn/llms.txt"
  - "https://developers.openai.com/llms.txt"
source_sets:
  - "API Docs"
  - "Codex"
  - "ChatGPT/Apps SDK"
  - "Learn"
globs:
  - "references/openai-codex-kb/**/*.md"
  - "docs/**/*.md"
  - "AGENTS.md"
last_verified: "2026-05-18"
status: "active"
---

# OpenAI Source Map

This map records the official source families used for the local KB. Use it to jump back to the live OpenAI docs when syntax, availability, pricing, model names, or security behavior matters.

## API Docs

Primary map: https://developers.openai.com/api/docs/llms.txt

| Area | Official URL | Use For |
| --- | --- | --- |
| API docs index | https://developers.openai.com/api/docs | Human navigation for API docs |
| LLM index | https://developers.openai.com/api/docs/llms.txt | Agent-readable coverage map |
| Full docs export | https://developers.openai.com/api/docs/llms-full.txt | Broad ingestion when a full corpus is needed |
| Text generation | https://developers.openai.com/api/docs/guides/text.md | Text input/output concepts |
| Tools | https://developers.openai.com/api/docs/guides/tools.md | Built-in tools and tool-use model |
| Function calling | https://developers.openai.com/api/docs/guides/function-calling.md | Application-defined tools |
| Structured outputs | https://developers.openai.com/api/docs/guides/structured-outputs.md | JSON/schema-constrained results |
| Conversation state | https://developers.openai.com/api/docs/guides/conversation-state.md | State and multi-turn workflows |
| Background mode | https://developers.openai.com/api/docs/guides/background.md | Async long-running tasks |
| File inputs | https://developers.openai.com/api/docs/guides/file-inputs.md | Files as model inputs |
| File search | https://developers.openai.com/api/docs/guides/tools-file-search.md | Retrieval over files |
| MCP and connectors | https://developers.openai.com/api/docs/guides/tools-connectors-mcp.md | Remote MCP/connectors as tools |
| MCP servers | https://developers.openai.com/api/docs/mcp.md | Building MCP servers |
| Agents SDK overview | https://developers.openai.com/api/docs/guides/agents.md | Agent SDK concepts |
| Agent orchestration | https://developers.openai.com/api/docs/guides/agents/orchestration.md | Handoffs and multi-agent patterns |
| Agent guardrails | https://developers.openai.com/api/docs/guides/agents/guardrails-approvals.md | Guardrails and human review |
| Evals | https://developers.openai.com/api/docs/guides/evals.md | Evaluation workflows |
| Production best practices | https://developers.openai.com/api/docs/guides/production-best-practices.md | Launch readiness |
| Safety best practices | https://developers.openai.com/api/docs/guides/safety-best-practices.md | Safety controls |

## Codex

Primary map: https://developers.openai.com/codex/llms.txt

| Area | Official URL | Use For |
| --- | --- | --- |
| Codex overview | https://developers.openai.com/codex/overview.md | Product mental model |
| LLM index | https://developers.openai.com/codex/llms.txt | Agent-readable coverage map |
| Full docs export | https://developers.openai.com/codex/llms-full.txt | Broad ingestion when a full corpus is needed |
| Codex app | https://developers.openai.com/codex/app.md | Desktop app concepts |
| App features | https://developers.openai.com/codex/app/features.md | Feature overview |
| App settings | https://developers.openai.com/codex/app/settings.md | App configuration |
| Automations | https://developers.openai.com/codex/app/automations.md | Recurring tasks and monitors |
| Worktrees | https://developers.openai.com/codex/app/worktrees.md | Parallel local work |
| Local environments | https://developers.openai.com/codex/app/local-environments.md | Setup scripts and worktree prep |
| In-app browser | https://developers.openai.com/codex/app/browser.md | Local web preview and review |
| Windows app | https://developers.openai.com/codex/app/windows.md | Windows support |
| CLI | https://developers.openai.com/codex/cli.md | Terminal use |
| CLI reference | https://developers.openai.com/codex/cli/reference.md | Command-line options |
| IDE extension | https://developers.openai.com/codex/ide.md | IDE usage |
| Cloud/web | https://developers.openai.com/codex/cloud.md | Cloud task environment |
| Sandboxing | https://developers.openai.com/codex/concepts/sandboxing.md | Sandbox model |
| Agent approvals/security | https://developers.openai.com/codex/agent-approvals-security.md | Approval and security behavior |
| Customization | https://developers.openai.com/codex/concepts/customization.md | Skills, MCP, subagents, guidance |
| Subagents concept | https://developers.openai.com/codex/concepts/subagents.md | Delegated agent work |
| Subagents reference | https://developers.openai.com/codex/subagents.md | Custom agents/subagents |
| AGENTS.md | https://developers.openai.com/codex/guides/agents-md.md | Project instructions |
| Hooks | https://developers.openai.com/codex/hooks.md | Lifecycle scripts |
| Rules | https://developers.openai.com/codex/rules.md | Command permission rules |
| MCP | https://developers.openai.com/codex/mcp.md | MCP in Codex |
| Plugins | https://developers.openai.com/codex/plugins.md | Plugin concept |
| Build plugins | https://developers.openai.com/codex/plugins/build.md | Plugin packaging |
| Skills | https://developers.openai.com/codex/skills.md | Codex skills |
| Config basics | https://developers.openai.com/codex/config-basic.md | Basic configuration |
| Config reference | https://developers.openai.com/codex/config-reference.md | Exact config fields |
| Best practices | https://developers.openai.com/codex/learn/best-practices.md | Practical usage guidance |

## ChatGPT/Apps SDK

Primary map: https://developers.openai.com/apps-sdk/llms.txt

| Area | Official URL | Use For |
| --- | --- | --- |
| ChatGPT developers hub | https://developers.openai.com/chatgpt | Human navigation for ChatGPT developer products |
| Apps SDK index | https://developers.openai.com/apps-sdk/llms.txt | Agent-readable Apps SDK map |
| Full docs export | https://developers.openai.com/apps-sdk/llms-full.txt | Broad ingestion when a full corpus is needed |
| Quickstart | https://developers.openai.com/apps-sdk/quickstart.md | First app setup |
| MCP apps in ChatGPT | https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt.md | Portable MCP app model |
| MCP server concept | https://developers.openai.com/apps-sdk/concepts/mcp-server.md | How MCP powers apps |
| Build MCP server | https://developers.openai.com/apps-sdk/build/mcp-server.md | Server implementation |
| Build ChatGPT UI | https://developers.openai.com/apps-sdk/build/chatgpt-ui.md | Components and UI |
| Authentication | https://developers.openai.com/apps-sdk/build/auth.md | User auth |
| State management | https://developers.openai.com/apps-sdk/build/state-management.md | App/server/UI state |
| Security and privacy | https://developers.openai.com/apps-sdk/guides/security-privacy.md | Security checklist |
| Deploy app | https://developers.openai.com/apps-sdk/deploy.md | Deployment |
| Submission | https://developers.openai.com/apps-sdk/deploy/submission.md | Submit and maintain apps |
| Reference | https://developers.openai.com/apps-sdk/reference.md | Schema/API fields |

## Learn

Primary map: https://developers.openai.com/learn/llms.txt

| Area | Official URL | Use For |
| --- | --- | --- |
| Learn hub | https://developers.openai.com/learn | Human navigation for learning resources |
| Learn index | https://developers.openai.com/learn/llms.txt | Agent-readable Learn map |
| Full docs export | https://developers.openai.com/learn/llms-full.txt | Broad ingestion when a full corpus is needed |
| Docs MCP | https://developers.openai.com/learn/docs/docs-mcp.md | OpenAI docs via MCP |
| Developers plugin for Codex | https://developers.openai.com/learn/docs/developers-codex-plugin.md | Codex docs plugin |
| Codex prompting guide | https://developers.openai.com/learn/cookbook/codex-prompting-guide.md | Prompting Codex effectively |
| Code modernization with Codex | https://developers.openai.com/learn/cookbook/code-modernization.md | Modernization workflow |
| MCP tool guide | https://developers.openai.com/learn/cookbook/mcp-tool-guide.md | MCP with Responses |
| Orchestrating agents | https://developers.openai.com/learn/cookbook/orchestrating-agents.md | Multi-agent patterns |
| Responses evaluation | https://developers.openai.com/learn/cookbook/responses-evaluation.md | Eval examples |
| Deployment checklist | https://developers.openai.com/learn/guide/deployment-checklist-guide.md | Production checklist |
| Tracing guide | https://developers.openai.com/learn/guide/tracing-guide.md | Observability and traces |
| Orchestrating multiple agents | https://developers.openai.com/learn/guide/orchestrating-multiple-agents-guide.md | Agent coordination |

## Refresh Procedure

1. Open the relevant `llms.txt` map.
2. Add or update local article links only when the source remains official.
3. Keep local summaries original.
4. Update `last_verified`.
5. Run `npm test -- openai-codex-kb` or the full unit suite.

