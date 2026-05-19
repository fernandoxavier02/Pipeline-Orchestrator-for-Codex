---
title: "Agents and Subagents"
kind: "openai-codex-knowledge-article"
topics:
  - "agents"
  - "subagents"
  - "handoffs"
  - "orchestration"
  - "spawn-agent"
  - "review-independence"
  - "agent-sdk"
source_urls:
  - "https://developers.openai.com/api/docs/guides/agents.md"
  - "https://developers.openai.com/api/docs/guides/agents/orchestration.md"
  - "https://developers.openai.com/api/docs/guides/agents/running-agents.md"
  - "https://developers.openai.com/api/docs/guides/agents/guardrails-approvals.md"
  - "https://developers.openai.com/codex/concepts/subagents.md"
  - "https://developers.openai.com/codex/subagents.md"
  - "https://developers.openai.com/codex/guides/agents-sdk.md"
source_sets:
  - "API Docs"
  - "Codex"
globs:
  - "agents/**/*.md"
  - "prompts/agents/**/*.md"
  - "src/dispatcher/**/*.ts"
  - "src/controller/**/*.ts"
  - "tests/**/*agent*.ts"
  - "skills/**/*.md"
last_verified: "2026-05-18"
status: "active"
---

# Agents and Subagents

An agent is a model-driven worker with instructions, tools, context, and a task. A subagent is a delegated worker spawned from a parent workflow to handle a bounded subtask, often with isolated context or a specialized role.

In this plugin, agent language appears in two different layers:

- OpenAI Agents SDK concepts: application developers define and run agents programmatically.
- Codex host subagents: the current Codex session may expose `spawn_agent` to delegate work.
- Local plugin prompts: Markdown role contracts under `agents/**` and `prompts/**`.

Always say which layer you mean.

## Delegation Principles

Good delegation has a concrete task, clear ownership, and a bounded output. The parent remains responsible for integration.

Use subagents for:

- independent codebase exploration;
- focused implementation slices with disjoint write scopes;
- independent review after implementation;
- parallel research questions with separate outputs.

Avoid subagents for:

- the immediate blocking step that the parent must do now;
- vague "look at everything" tasks;
- changes that overlap file ownership without coordination;
- work that requires secrets or permissions the subagent does not have.

## Review Independence

Review independence is a product requirement for this plugin. A review is stronger when the reviewer has a fresh context and is asked to construct failure scenarios rather than confirm the implementer narrative.

Practical local rule:

- If `spawn_agent` is available, use a separate review agent for substantial/high-risk changes.
- If it is unavailable and the workflow contract requires real agents, block honestly.
- If the task can proceed without real subagents, document that review was same-context and therefore weaker.

## Handoffs and Agents-as-Tools

OpenAI Agents SDK docs describe orchestration patterns such as handoffs and agents-as-tools. The practical idea is that one agent can route work to another role and use that result in a larger workflow.

For this repo:

- `DISPATCH_REQUEST` is a local protocol concept, not the same as an Agents SDK handoff.
- `spawn_agent` is a Codex host tool, not a TypeScript API inside this repo.
- Agent role Markdown files are contracts for behavior, not proof that the host can run them.

## Context Isolation

Subagents help reduce context pollution. A focused worker can receive only the files, instructions, and target output it needs. This also makes review cleaner because the reviewer is less likely to inherit implementation bias.

Use context isolation for:

- adversarial reviews;
- security checks;
- API contract reviews;
- data migrations;
- broad codebase archaeology;
- independent UI/design checks.

Do not assume isolation if the same main thread reads, edits, and reviews everything.

## Local Runtime Boundary

This repo's AGENTS guidance is explicit: do not promise "multi-agent real" if the runtime does not expose real `spawn_agent`. The correct behavior for workflows that require real agents is to stop with a clear blocked state.

Implementation signs of a healthy boundary:

- Tests cover the blocked path.
- Public docs mention the requirement.
- The controller does not silently emulate real multi-agent execution when independence is mandatory.
- Closeout reports whether review was independent or same-context.

## Agent Prompt Files

Files under `agents/**` and `prompts/**` are role contracts. They should answer:

- What is this role responsible for?
- What inputs does it need?
- What output shape should it return?
- What must it not do?
- Is it read-only or allowed to change files?
- Which evidence must it cite?

When changing these files, check inventory/frontmatter/parity tests and make sure the public workflow still routes to valid role names.

