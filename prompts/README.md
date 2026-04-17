# Prompts — Runtime Stubs

This directory contains the **runtime prompts** that `src/prompts/prompt-registry.ts` loads when the dispatcher spawns an agent. Stubs are intentionally short (10-20 lines each) — they communicate only the minimum the agent needs to produce a correct output block.

## Important: this is NOT the documentation

The rich human-readable reference docs live in `agents/`. If you want to understand what an agent does, read `agents/<subdir>/<name>.md`. If you want to know what the dispatcher actually sends to the agent, read `prompts/agents/<subdir>/<name>.md`.

## Why stubs and not the rich versions?

The Codex runtime has a tight context budget per spawned agent. A 200-line reference doc would consume the spawned context. The stubs capture the essential: role + "Required output block:" section declaring what structured output the controller expects to parse.

## Resolution contract

`src/prompts/prompt-registry.ts` resolves a role name (e.g. `"quality/quality-reviewer"`) to a file:

1. First tries `prompts/<name>.md` (e.g. `prompts/quality/quality-reviewer.md`) — not used today.
2. Falls back to `prompts/agents/<name>.md` (e.g. `prompts/agents/quality/quality-reviewer.md`) — this is where stubs live.

Throws `Prompt "<name>" was not found` if neither path exists.

## Stub invariants

Every stub under `prompts/agents/` must:

- Be under 30 lines (guideline, not enforced)
- Include a `Required output block:` section listing the structured blocks the controller will parse
- Be referenced by `REQUIRED_OUTPUT_BLOCKS` in `src/prompts/prompt-registry.ts` if the role is runtime-dispatched

Any stub that is not referenced by `REQUIRED_OUTPUT_BLOCKS` is a ghost — either wire it up or delete it.
