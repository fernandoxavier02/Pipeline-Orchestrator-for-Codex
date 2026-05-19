---
title: "OpenAI API Platform"
kind: "openai-codex-knowledge-article"
topics:
  - "responses-api"
  - "tools"
  - "structured-outputs"
  - "function-calling"
  - "conversation-state"
  - "background-mode"
  - "files"
  - "evals"
  - "production"
source_urls:
  - "https://developers.openai.com/api/docs/llms.txt"
  - "https://developers.openai.com/api/docs/guides/text.md"
  - "https://developers.openai.com/api/docs/guides/tools.md"
  - "https://developers.openai.com/api/docs/guides/function-calling.md"
  - "https://developers.openai.com/api/docs/guides/structured-outputs.md"
  - "https://developers.openai.com/api/docs/guides/conversation-state.md"
  - "https://developers.openai.com/api/docs/guides/background.md"
  - "https://developers.openai.com/api/docs/guides/evals.md"
  - "https://developers.openai.com/api/docs/guides/production-best-practices.md"
source_sets:
  - "API Docs"
globs:
  - "src/**/*.ts"
  - "tests/**/*.ts"
  - "docs/**/*.md"
  - "references/**/*.md"
  - "prompts/**/*.md"
last_verified: "2026-05-18"
status: "active"
---

# OpenAI API Platform

The OpenAI API platform is the source for application-facing model behavior: text generation, tools, structured output, files, state, background execution, evals, and production controls. In this repo, use this article when a prompt, agent contract, runtime adapter, or documentation claim depends on how OpenAI API workflows are actually built.

The API docs index says each guide has a Markdown twin and also exposes a combined Markdown export. Prefer the index for coverage and the exact page for implementation detail.

## Core Mental Model

Modern OpenAI API work should be designed around a model run that can read input, produce text or structured output, call tools, reference files, and preserve or resume state when the workflow needs continuity. The exact endpoint and SDK surface may evolve, so do not hard-code assumptions from memory when changing real code.

For this plugin, the important distinction is:

- The API platform describes how a developer builds agentic applications.
- Codex describes how OpenAI's coding agent operates in local, IDE, app, and cloud contexts.
- This repository implements a Codex plugin and workflow controller; it should not claim to be the full OpenAI API runtime.

## Responses API

Use Responses as the default conceptual model for new OpenAI API workflows unless a legacy surface is explicitly required. Responses is the platform area that brings together model output, multimodal input, tools, streaming, background work, state, and structured results.

Practical implications:

- A response is not just a string. It may include tool calls, reasoning-related metadata, structured JSON, files, citations, or stream events depending on configuration.
- Multi-turn work should be explicit about state. Either pass the relevant conversation state, use platform state features, or store your own state in an application database.
- Tool calling must be treated as a contract. A tool schema describes what the model may request; application code still owns validation, auth, execution, retry, logging, and error handling.
- Background mode is for long-running tasks where the client should not hold a synchronous request open.

Local repo guidance:

- If a future adapter talks to the API, keep request/response parsing in `src/**`, not in Markdown.
- Avoid embedding model IDs, pricing, or feature maturity claims in static plugin docs unless they are linked to current official docs.
- If a prompt asks an agent to rely on a tool, document whether that tool is an OpenAI API built-in, a Codex host tool, an MCP tool, or a local plugin primitive.

## Tools

OpenAI docs group tools into built-in tools, remote MCP/connectors, function calling, shell/computer use, file search, code interpreter, image generation, and related capabilities. The common theme is that tools extend what the model can ask the surrounding runtime to do.

For safe engineering:

- A model request for a tool is not itself authorization. The host application or Codex runtime decides whether to execute it.
- The schema should be narrow enough that invalid or unsafe requests are rejected before reaching side-effectful code.
- Tool results should be concise, structured, and traceable. Avoid dumping huge raw outputs when a small typed result would preserve context better.
- Separate read-only tools from mutating tools. This matters for MCP servers, shell tools, filesystem edits, GitHub operations, and browser/computer use.

Repo mapping:

- `spawn_agent`, shell access, `apply_patch`, and in-app browser capabilities are Codex-host tools, not OpenAI API tools.
- Pipeline protocol blocks such as `GATE_REQUEST` and `DISPATCH_REQUEST` are local plugin contracts, not platform API objects.
- When docs mention "tools", always clarify which runtime owns the tool.

## Function Calling and Structured Outputs

Function calling lets the model request an application-defined function with arguments. Structured outputs constrain the response to a schema so downstream code can parse it reliably.

Use structured outputs when:

- a gate decision must be machine-readable;
- a validator needs stable fields;
- a test will assert fields rather than prose;
- downstream workflow state depends on the result.

Use prose when:

- the output is primarily explanatory;
- the shape changes often;
- the agent is writing a review or design rationale for humans.

Avoid using structured output as a substitute for domain validation. The schema can enforce shape, but application code must enforce permission, invariants, path safety, and business rules.

Repo mapping:

- Pipeline session state, gate logs, protocol events, and closeout artifacts should keep typed fields in runtime code.
- Markdown references can describe the schema, but they should not be the only enforcement point.
- Tests should fail when schema-facing docs and runtime validation drift.

## Conversation State and Context Management

OpenAI docs distinguish several state patterns: passing conversation history, using server-side state where available, compaction, prompt caching, token counting, and explicit retrieval.

Operational guidance:

- Store durable decisions outside the prompt when they matter. A long prompt can be compacted or omitted; persisted state can be reloaded.
- Compact context intentionally. Summaries should preserve decisions, constraints, file paths, test evidence, and unresolved risks.
- Use retrieval for large knowledge bases. Do not paste every article into the context if a targeted file read or search is enough.
- Treat prompt caching as performance/cost optimization, not as a correctness mechanism.

Repo mapping:

- This plugin already has state and run directories; do not replace those with giant prompts.
- This KB should be searched and opened on demand.
- When a workflow resumes, use persisted run state plus relevant KB files instead of relying on memory alone.

## Files, Retrieval, and File Search

File workflows usually have two separate concerns:

- Input files: what the model can inspect.
- Retrieval/indexing: how relevant chunks are selected for a question.

For a local Markdown KB:

- Keep articles focused by topic so `rg` finds terms quickly.
- Put stable metadata in FrontMatter.
- Use `source_urls` for canonical links and human auditability.
- Use `globs` to tell agents when a document applies.

This repo does not need vector retrieval for the initial KB. Plain Markdown plus file search is enough because the corpus is small, structured, and local.

## Evals and Production Readiness

OpenAI eval guidance is most useful here as a pattern: write tests that check the behavior you care about, not just that files exist.

For this KB, production readiness means:

- every article has valid FrontMatter;
- links point to official OpenAI sources;
- the index references all article files;
- local docs avoid unsupported runtime promises;
- tests catch missing metadata before publication.

For future API-backed features, use evals or focused regression tests when model behavior becomes a product dependency. A "worked once" transcript is evidence, but it is not enough for a reliable workflow contract.

## Drift Rules

If official API docs and local docs disagree:

1. Trust the official docs for platform behavior.
2. Trust local runtime and tests for this plugin's actual behavior.
3. Record the mismatch as drift if both need to be reconciled.
4. Do not edit `dist/**` manually to make documentation appear true.

