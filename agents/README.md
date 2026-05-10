# Agents — Reference Documentation

This directory contains **rich reference documentation** for controller agents in the pipeline orchestrator. Each file is a Codex-adapted agent spec with frontmatter, role description, input contract, output contract, and prompt body.

## Important: this directory is NOT loaded by the runtime

The runtime resolves agent prompts via `src/prompts/prompt-registry.ts`, which reads minimal stubs from `prompts/agents/<subdir>/<name>.md`. This directory (`agents/`) is read by humans — it is the canonical human-readable source of truth for what each agent does.

## Why two locations?

| Location | Loaded by | Purpose | Style |
|----------|-----------|---------|-------|
| `agents/` | Readers (humans, docs) and parent dispatch instructions | v5.2 parity reference documentation | Rich: frontmatter + role + contract + prompt body |
| `prompts/agents/` | `prompt-registry.ts` at dispatch time | Minimum runtime prompt the dispatcher ships to the agent | Stub: 10-20 lines, only the role instruction and required output blocks |

If you update behavior, update BOTH files to keep them aligned. A CI-style test (`tests/unit/agents-inventory.test.ts`) verifies both directories exist with the expected file counts.

## Layout

- `brainstorm/` — preparation agents (step-00-intake, step-01-explore)
- `core/` — orchestration agents (task-orchestrator, brainstorm-controller, information-gate, sentinel, checkpoint-validator, final-validator, sanity-checker, finishing-branch, adversarial-batch)
- `executor/` — execution agents (executor-controller, executor-implementer-task, executor-fix, executor-quality-reviewer, executor-spec-reviewer) and type-specific subdirectories
- `quality/` — reviewer agents (architecture-reviewer, design-interrogator, final-adversarial-orchestrator, plan-architect, pre-tester, quality-gate-router, review-orchestrator)
