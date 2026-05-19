---
title: "Skills"
kind: "openai-codex-knowledge-article"
topics:
  - "skills"
  - "skill-md"
  - "frontmatter"
  - "procedures"
  - "plugin-skills"
  - "hosted-skills"
source_urls:
  - "https://developers.openai.com/api/docs/guides/tools-skills.md"
  - "https://developers.openai.com/codex/skills.md"
  - "https://developers.openai.com/codex/concepts/customization.md"
  - "https://developers.openai.com/codex/plugins.md"
  - "https://developers.openai.com/learn/docs/developers-codex-plugin.md"
source_sets:
  - "API Docs"
  - "Codex"
  - "Learn"
globs:
  - "skills/**/*.md"
  - ".agents/skills/**/*.md"
  - "tests/**/*skill*.ts"
  - "hooks/**/*frontmatter*.cjs"
  - "references/**/*.md"
last_verified: "2026-05-18"
status: "active"
---

# Skills

Skills are reusable packets of instruction, procedure, and supporting context. They let an agent load targeted expertise only when the task calls for it, instead of carrying every rule in the main prompt.

There are multiple skill contexts:

- OpenAI API skills: reusable capabilities attached to hosted environments or API workflows.
- Codex skills: local or plugin-provided instructions that Codex can discover and follow.
- This repo's workflow skills: `skills/**/SKILL.md` files that define governed pipeline entrypoints.

Do not blur those contexts. A field or behavior that exists in one skill system may not exist in another.

## What a Good Skill Contains

A useful skill should have:

- A clear name and description.
- A tight trigger condition.
- Enough workflow detail to execute safely.
- Links to local references when the body would otherwise become too long.
- Explicit boundaries: what the skill does not do, what it requires, and what blocks it.
- Tests or validation when the skill affects runtime behavior.

This repo's public skills should remain operationally honest. If a workflow needs tools that the host does not expose, the skill should block or route to a supported fallback, not pretend success.

## FrontMatter

FrontMatter is machine-readable metadata at the top of Markdown. In this repo, different surfaces have different metadata expectations:

- Simple Codex skill files often keep only `name` and `description`.
- Governed workflow steps may declare execution mode, gate requirements, agent type, and write policy.
- Reference KB articles use metadata for retrieval, source tracing, and applicability, not dispatch.

Do not copy FrontMatter fields from one surface into another without checking tests and hooks. This repo already has tests that reject stale Claude-era fields in some skill contexts.

The system `skill-creator` `quick_validate.py` is still the right validator for ordinary generated skills. It is not the acceptance validator for this plugin's governed workflow skills, because those skills intentionally add runtime-governance fields such as `gates_at`, `sentinel_checkpoints`, `agent_type`, `sequence`, and `disable-model-invocation`. For governed workflow skills, validate against this repo's tests and hook contracts instead of stripping those fields to satisfy the generic scaffold validator.

## Local Skill Boundaries

For `pipeline-orchestrator-for-codex`:

- `skills/pipeline/SKILL.md` is the primary operational contract.
- `commands/pipeline.md` is a short entrypoint and should not duplicate the full behavior.
- `skills/feature/**`, `skills/bugfix/**`, `skills/audit/**`, and `skills/spec/**` are workflow variants.
- `references/**` supports routing, gates, checklists, and now OpenAI/Codex knowledge retrieval.

Changing a skill can affect runtime behavior even if no TypeScript changes are made. Use tests that cover the relevant command, hook, or surface contract.

## Skill vs Prompt vs Documentation

Use a skill when the agent should follow a reusable procedure.

Use a prompt file when the runtime dispatches a specific role or subagent with a role contract.

Use documentation when humans and agents need background knowledge but no automatic workflow should start.

This KB is documentation/reference, not a new command skill. It should be consulted by agents, but it should not auto-run a workflow.

## Common Failure Modes

- Overloaded skill: too many unrelated topics make retrieval noisy.
- Aspirational skill: promises behavior that hooks/runtime/tests do not enforce.
- Stale migration field: old Claude or another agent framework metadata remains in Codex files.
- Hidden mutability: a report-only skill can still reach an edit tool unless hooks/runtime block it.
- Unclear source: the skill repeats docs without linking official sources.

## Maintenance Rule

When editing skills:

1. Read the local skill body and any referenced rules.
2. Check tests for frontmatter, command surface, and dispatch behavior.
3. Keep changes minimal and local to the workflow.
4. Update `references/openai-codex-kb/**` only when the change affects general Codex/OpenAI knowledge.
5. Run focused tests first, then broader tests if runtime-facing behavior changed.

## Drift Notes (2026-05-19)

See [plugin-build-guide.md](plugin-build-guide.md) for the schema-accurate consolidated version. Corrections relevant here: standalone skills live in `.agents/skills/` (not `skills/`); plugin-bundled skills stay under `<plugin>/skills/` and are discovered via `plugin.json:skills`. Required frontmatter is `name` + `description` only — extension fields like `agent_type`, `gates_at`, `allowed-tools`, and `argument-hint` are plugin-private and not parsed by Codex itself. Initial skills list is capped at ~2% of context window (~8k chars unknown). Same-name collisions surface both skills in the picker — they do not merge.
