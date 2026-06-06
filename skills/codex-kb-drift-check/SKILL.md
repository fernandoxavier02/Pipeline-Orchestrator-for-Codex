---
name: codex-kb-drift-check
description: "Check whether local repo files have drifted from contracts documented in the Codex KB. Use before PR/release, after bulk edits to hooks, skills, AGENTS.md, plugin.json, marketplace/cache docs, agents, or when asked to verify KB compliance. Read-only: produces a drift report and never edits files."
disable-model-invocation: true
allowed-tools: update_plan, spawn_agent, wait_agent
argument-hint: "[scope: 'all' | article-name | glob-pattern]"
---

# Codex KB Drift Check

## VISIBLE_PLAN Contract

As the first assistant action for this workflow, call `update_plan` using `references/visible-plan-contract.md`. For drift check, the visible plan covers: determine scope, load articles, extract contracts, compare against repo files, classify findings, and emit report. If the drift check request includes a batch, TDD, ATDD, DDD, PDD, or adversarial review expectation, reflect those words in the recommendation but do not run the target workflow from drift check.

## WORKFLOW_METHOD_GATE Contract

Before any execution, dispatch, file edit, report generation, validation claim, or workflow launch, show the workflow/method boundary from `references/workflow-method-gate.md` in compact form: `codex-kb-drift-check` is read-only and produces a drift report. It never edits files. Allow switching to `audit`, `bugfix`, `feature`, `ux`, `spec`, `brainstorm`, `review`, or `verify-completion` before continuing. If fixes are needed, recommend `codex-kb-refresh` for KB updates or the appropriate pipeline workflow for repo fixes.

## NEXT_STEP Contract

When this workflow reaches a terminal response, emit the `NEXT_STEP` block described in `references/workflow-next-step.md`. If drift is found in KB articles, recommend `codex-kb-refresh`. If drift is found in repo files, recommend `pipeline review-only` or the appropriate fix workflow. If everything is aligned, the next step is `stop`.

## Codex Real-Agent Runtime Contract

Any operational path in this workflow that dispatches pipeline work MUST use real Codex `spawn_agent` with a `PIPELINE_AGENT_FQN` marker. If `spawn_agent` is unavailable, fails, or cannot return an isolated agent result, stop with `blocked-no-agent-runtime`. Do not continue inline, do not simulate subagents, and do not report the run as real multi-agent execution.

For informational-only workflows, do not launch the recommended workflow from the help/router context. Recommend the command and stop unless the user explicitly invokes an executable workflow with real agent support.

## Procedure

1. Determine scope from user input: `all` (default), a specific article name, or a file glob pattern.
2. Read `references/openai-codex-kb/INDEX.md` and load relevant article frontmatter (topics, globs, source_urls, last_verified).
3. Extract checkable contracts from each article: schema fields, required hook events, skill frontmatter rules, path conventions, tool/capability claims, source freshness dates.
4. For each contract, perform targeted reads against the governed repo files identified by the article globs.
5. Classify each finding:
   - `[DRIFT]` — repo file contradicts a KB contract.
   - `[STALE]` — KB article `last_verified` is older than 30 days or source URL returns different content.
   - `[UNDOCUMENTED]` — repo file exists in a governed glob but has no corresponding KB coverage.
   - `[ALIGNED]` — repo file matches KB contract.
6. Emit the drift report. Do not edit any files.

## Output

```text
CODEX_KB_DRIFT_REPORT:
  scope: "<checked scope>"
  checked_articles: ["<article paths>"]
  findings:
    - classification: "[DRIFT|STALE|UNDOCUMENTED|ALIGNED]"
      article: "<article path>"
      repo_file: "<file path>"
      detail: "<what diverges>"
  summary: "<counts by classification>"
  recommendation: "stop | codex-kb-refresh <scope> | pipeline review-only <scope>"
```
