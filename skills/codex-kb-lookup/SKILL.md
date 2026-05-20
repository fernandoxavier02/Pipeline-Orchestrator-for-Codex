---
name: codex-kb-lookup
description: "Look up Codex and OpenAI platform knowledge from the local KB. Use for questions about plugin manifests, skills, hooks, rules, AGENTS.md, agents/subagents, MCP/connectors, API platform, official source URLs, or before changing files governed by references/openai-codex-kb articles. Read-only: answers from the KB and never edits files."
disable-model-invocation: true
allowed-tools: update_plan, spawn_agent, wait_agent, send_input
argument-hint: "<topic, question, or file path>"
---

# Codex KB Lookup

## VISIBLE_PLAN Contract

As the first assistant action for this workflow, call `update_plan` using `references/visible-plan-contract.md`. For lookup, the visible plan is intentionally small: classify the query topic, route to the right article, answer, and stop. If the lookup request includes a batch, TDD, ATDD, DDD, PDD, or adversarial review expectation, reflect those words in the recommendation but do not run the target workflow from lookup.

## WORKFLOW_METHOD_GATE Contract

Before any execution, dispatch, file edit, report generation, validation claim, or workflow launch, show the workflow/method boundary from `references/workflow-method-gate.md` in compact form: `codex-kb-lookup` is read-only and informational. Allow switching to `audit`, `bugfix`, `feature`, `ux`, `spec`, `brainstorm`, `review`, or `verify-completion` before continuing. If the user needs to edit KB files, recommend `codex-kb-refresh`. If the user needs to verify repo compliance, recommend `codex-kb-drift-check`.

## NEXT_STEP Contract

When this workflow reaches a terminal response, emit the `NEXT_STEP` block described in `references/workflow-next-step.md`. For a simple answer the next step is `stop`. If drift is detected between KB and repo, recommend `codex-kb-drift-check` as the next action.

## Codex Real-Agent Runtime Contract

Any operational path in this workflow that dispatches pipeline work MUST use real Codex `spawn_agent` with a `PIPELINE_AGENT_FQN` marker. If `spawn_agent` is unavailable, fails, or cannot return an isolated agent result, stop with `blocked-no-agent-runtime`. Do not continue inline, do not simulate subagents, and do not report the run as real multi-agent execution.

For informational-only workflows, do not launch the recommended workflow from the help/router context. Recommend the command and stop unless the user explicitly invokes an executable workflow with real agent support.

## Procedure

1. Parse the topic, question, or file path from the user input.
2. Read `references/openai-codex-kb/INDEX.md` and route to the smallest relevant article based on topic tags and globs.
3. For plugin construction questions, prefer `references/openai-codex-kb/plugin-build-guide.md` as the consolidated SSOT.
4. Read the target article. Extract the answer from the relevant section.
5. Return a concise answer with: article path, section heading, official source URL(s), and a freshness caveat based on `last_verified`.
6. If the KB content and the repo state disagree, label the discrepancy as possible drift and recommend `codex-kb-drift-check`.

## Output

```text
CODEX_KB_LOOKUP:
  query: "<user query>"
  articles_consulted: ["<article path>"]
  answer: "<concise answer>"
  source_urls: ["<official URL>"]
  freshness: "<last_verified date and caveat>"
  follow_up: "stop | codex-kb-drift-check <scope>"
```
