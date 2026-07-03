# Phase 0b: Information Gate

**Timestamp:** 2026-07-02 21:15:00
**Session:** 2026-07-02-codex-hook-channel-bugfix
**Request:** Bug fix dos hooks Codex (canal de instrução + prisões de enforcement)
**Status:** SUCCESS — INFORMATION_GATE: RESOLVED (3/3 gaps resolvidos, 0 blockers)
**Persistido por:** pipeline-controller (agente information-gate é read-only; resultado retornado inline — agent ab95aaf4c12648963)

## Input Received

CLASSIFICATION Phase 0a (Bug Fix / COMPLEXA / Critical / bugfix-heavy) + 3 itens abertos do task-orchestrator.

## INFORMATION_GATE (resultado integral)

- status: RESOLVED · gaps_detected: 3 · gaps_resolved: 3 · gaps_remaining: 0
- severity: blocker 0 · important 0 · informational 3

### Q1 — continue/systemMessage/stopReason: manter ou descartar?

**KEEP aditivo; ADD campos Codex-nativos.** Evidência:
- `references/openai-codex-kb/plugin-build-guide.md:263-271` — shape genérico {continue, stopReason, systemMessage, hookSpecificOutput.additionalContext} é suportado pelo Codex (não é artefato Claude-Code-only).
- `plugin-build-guide.md:269` — contrato autoritativo de Stop: {"decision":"block","reason":"..."} (reason reentra como próximo prompt). AUSENTE em `hooks/completion-checklist.cjs:1429-1461`.
- `plugin-build-guide.md:265` — injeção de contexto em UserPromptSubmit via hookSpecificOutput.additionalContext. AUSENTE em `hooks/force-pipeline-agents.cjs:392-419`.
- Sem consumidor compartilhado: grep em `.kimi/**` por completion-checklist/force-pipeline-agents/edit-guard-hook/systemMessage/stopReason = zero matches; `.kimi/skills/pipeline/scripts/*.cjs` são cópias independentes.
- `stop_hook_active` documentado (`plugin-build-guide.md:261`) e não lido hoje pelo completion-checklist — gap real de anti-loop, a adicionar.
- Caminho de sucesso do Stop (`completion-checklist.cjs:1453`, {continue:true}) já é schema-correto.

### Q2 — Escopo exato do allowlist do edit-guard

- Dois caminhos de negação distintos confirmados: `edit-guard-hook.cjs:440-458` (required-first-actions pendente → nega TODO Bash) e `:463-480` (menção read-only a .codex/pipeline → nega).
- Testes existentes que assertam o comportamento bugado como esperado (em escopo p/ atualizar): `tests/unit/hooks/edit-guard-hook.test.ts:294-318` e `:320-373`.
- Resolução de caminho: aceitar invocação cujo script resolva (contra cwd OU $PLUGIN_ROOT/$CODEX_PLUGIN_ROOT/$CLAUDE_PLUGIN_ROOT, mesma ordem de fallback de `dispatch-guard.cjs:709-711` e `hook-events.cjs:45-47`) para EXATAMENTE: `scripts/exec-window/open.cjs`, `scripts/exec-window/close.cjs`, `scripts/pipeline-reset.cjs`. Nunca glob de diretório.
- Anti-smuggling (spec `pipeline-trust-restoration` R12, requirements.md:265): rejeitar chaining (&&, ;, |, backticks, $(...)) junto da invocação allowlisted.
- `pipeline-reset.cjs` deve ser permitido INCLUSIVE no fail-closed de estado adulterado (é a remediação projetada); exec-window open/close só no caso pending normal.

### Q3 — Localização do teste do pipeline-reset.cjs

- `tests/unit/scripts/` não existe; `vitest.config.ts:6` inclui `tests/**/*.test.ts`.
- Precedente exato: `tests/unit/security/exec-window-scripts.test.ts` (spawnSync contra ROOT/scripts/...).
- **Decisão: `tests/unit/security/pipeline-reset.test.ts`.**

### Lacunas padrão de Bug Fix

- Reprodução: estática (file:line no fonte) + telemetria `.codex/pipeline/hook-events.jsonl`; `recordHookEvent` de `hooks/hook-events.cjs` será reutilizado (não duplicado).
- Aceite: schema Codex-nativo por `plugin-build-guide.md:263-271` + lint:types + build + testes focados verdes.
- Regressão: 11 suítes em tests/unit/hooks/ + exec-window*.test.ts; 2 testes com expectativa a atualizar (listados acima).
- Domínio security/auth: adversarial review COMPLEXA (7 checklists) obrigatório.
- Domínio data/persistence: nenhum schema novo de estado; reset opera nos 4 arquivos protegidos existentes.

## Handoff

→ design-interrogator (Phase 0c, automático para COMPLEXA)
→ Context: decisões de design já parcialmente resolvidas pelo gate (aditivo, allowlist exato, teste em unit/security); interrogar trade-offs restantes.
