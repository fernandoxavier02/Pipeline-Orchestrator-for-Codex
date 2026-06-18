# Research Log: Pipeline Invocation Enforcement

## Summary

Esta pesquisa confirma que a spec e uma extensao brownfield sobre superficies existentes: `hooks/**`, `src/controller/**`, `src/governance/**`, `src/gates/**`, `src/domain/**`, testes unitarios e Eval Gate local. A direcao correta e endurecer o front-door e a validacao final reutilizando stores, hooks e schemas existentes, nao criar outro orquestrador.

## Sources Consulted

### Local Repository

- `AGENTS.md`
- `.kiro/CONSTITUTION.md`
- `.kiro/steering/product.md`
- `.kiro/steering/tech.md`
- `.kiro/steering/structure.md`
- `references/openai-codex-kb/INDEX.md`
- `hooks/hooks.json`
- `hooks/force-pipeline-agents.cjs`
- `hooks/completion-checklist.cjs`
- `hooks/dispatch-guard.cjs`
- `hooks/sentinel-hook.cjs`
- `hooks/session-lock-hook.cjs`
- `src/controller/pipeline-controller.ts`
- `src/controller/plan-mode.ts`
- `src/domain/pipeline-schemas.ts`
- `src/gates/gate-registry.ts`
- `src/workflow/next-step.ts`
- `tests/unit/controller/pipeline-controller.test.ts`
- `tests/unit/controller/plan-mode.test.ts`
- `tests/unit/workflow/next-step.test.ts`
- `evals/README.md`
- `.agents/skills/workflow-eval-gate/SKILL.md`

### Official Codex Documentation Checked

- `https://developers.openai.com/codex/hooks`
- `https://developers.openai.com/codex/config-reference`
- `https://developers.openai.com/codex/subagents`
- `https://developers.openai.com/codex/skills`

## Findings

### Finding 1: Hook config has a concrete SessionStart mismatch

`hooks/hooks.json` currently declares `SessionStart` with a `type: "prompt"` handler. Official Codex hook docs show lifecycle hooks organized as event, matcher group and handlers, with `SessionStart` examples using `type: "command"`. The docs also state command hooks need review/trust before running.

**Implication:** The spec should require a command-backed `SessionStart` context script and tests that reject prompt-only executable context.

### Finding 2: force-pipeline-agents is advisory by construction

`force-pipeline-agents.cjs` returns `advisoryOutput()`, which sets `continue: true`, `hook_enforcement_mode: "advisory"` and `pipeline_valid: false`.

**Implication:** The implementation should split advisory hints from blocking front-door enforcement. Pipeline-worthy prompts outside canonical commands should be denied before inline execution.

### Finding 3: Dispatch and sentinel guards protect calls, not omissions

`dispatch-guard.cjs` validates identity when `spawn_agent`, `Agent`, or `Skill` is attempted. `sentinel-hook.cjs` validates attempted agents against `expectedNext`. Neither can fire when the agent never calls a dispatch tool.

**Implication:** The `Stop` hook and early state bootstrap must own absence-of-evidence enforcement.

### Finding 4: Session lock currently depends on explicit enforcement or existing lock

`session-lock-hook.cjs` treats normal `SessionStart` as no-op unless explicitly opted in, and `UserPromptSubmit` only heartbeats existing locks.

**Implication:** Explicit pipeline requests need a bootstrap path that creates lock and sentinel before edits or claims. The controller already has state stores; this should reuse them rather than introduce a parallel state root.

### Finding 5: Stop hook already contains a strong artifact validator

`completion-checklist.cjs` validates required gates, hooks, ledgers, dispatch completion and wait-agent completion when it detects explicit pipeline completion.

**Implication:** The safest implementation is incremental: improve detection and blocked-artifact allowance rather than replace the validator.

### Finding 6: Runtime already has bootstrap and plan-gate direction

`pipeline-controller.ts` already imports session lock helpers, sentinel store, capability evaluation and blocked pipeline artifact creation. Tests already assert explicit bootstrap creates lock, session, sentinel and gate state.

**Implication:** The spec should preserve that architecture and add missing hook/front-door tests around it.

### Finding 7: Gate registry is richer than artifact validator names

`gate-registry.ts` includes canonical gates and runtime-specific gates like `INFO_GATE_OK`, `INFO_GATE_BLOCKED`, `DESIGN_INTERROGATION`, `COMPLEXITY_GATE`, `STEP_1_7_ROUTING`, `PLAN_GATE_ACTIVE`, `SENTINEL_CHECKPOINT` and spec lifecycle gates.

**Implication:** A deterministic mapping layer or direct emission contract is needed so validation does not force fake gate evidence.

### Finding 8: Official Codex subagents are explicit, not automatic

Official Codex docs state that Codex can spawn subagents and that current releases enable subagent workflows by default, but Codex only spawns them when explicitly asked.

**Implication:** The plugin must not rely on "the model will decide to spawn" as an enforcement boundary. It needs front-door and finalization gates.

## Design Decisions

1. **Reuse existing hooks and controller stores.** No new orchestration framework.
2. **Add one command-backed SessionStart script.** Keep hook code dependency-free.
3. **Make pipeline-worthy non-canonical prompts blocking.** Explicit workflow commands continue but create required state.
4. **Represent early state as first-class runtime evidence.** Do not depend only on prompt text.
5. **Extend stop enforcement rather than replacing it.** It already has the strongest validator.
6. **Keep publication/cache/VPS as report boundaries.** Do not implement deployment in this spec.

## Risks

- Hook trust cannot be proven by source code alone; closeout must report configured vs trusted.
- Some Codex hook behavior may drift; official docs must be rechecked before implementation.
- Hard-blocking pipeline-worthy prompts may be too aggressive if detection is too broad; tests need allow-list coverage for conversational prompts and explicit workflow commands.
- Worktree already has unrelated modified files; implementation must scope diffs tightly.

## Synthesis Outcome

The smallest useful architecture is:

1. Static hook/config validation for `SessionStart`.
2. Blocking front-door decision for pipeline-worthy prompts outside canonical commands.
3. Early bootstrap state for explicit pipeline workflows.
4. Stop hook acceptance of valid PASS artifact or structured BLOCKED artifact only.
5. Gate taxonomy parity tests.
6. Eval Gate and focused Vitest validation before any success claim.
