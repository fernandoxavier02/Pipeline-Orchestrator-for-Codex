# Research Log: Pipeline Trust Restoration

**Status:** consolidated from prior audit (não foram executados greps adicionais — os 22 file:line já estavam validados em `08-final-audit-report.md` Data Availability Matrix).
**Source audit:** `.pipeline/docs/Pre-Complex-action/2026-05-19-auditoria-pipeline-orchestrator-codex/`

## Greps Executados (consolidados do audit-intake)

| Padrão buscado | Arquivos encontrados | Insight chave |
| --- | --- | --- |
| `strictAgents` em `src/` | 11 call sites: `cli/pipeline-cli.ts:55,73,84`, `domain/pipeline-types.ts:42`, `index.ts:548,691,701,920,951`, `controller/pipeline-controller.ts:1101,1107` | Default é `undefined`; tratado inconsistente (cascade em 548, strict eq em 691,701) |
| `spawn_agent` em `src/`, `agents/`, `skills/` | `cli/pipeline-cli.ts:76` (error msg), `dispatcher/run-role.ts:18` (block), `security/dispatch-contract.ts:14,143` (tipo), `agents/core/pipeline-controller.md:18`, `agents/executor/executor-controller.md:147`, `skills/pipeline/SKILL.md:5,33` | TS nunca CHAMA spawn_agent; só declara como contrato |
| `isOperationalPipelineDispatch` | `src/index.ts:322` (def), `src/index.ts:548` (uso único) | Função existe e funciona — só não é aplicada em review/final-adv |
| `decided_by` em src/ | `src/domain/pipeline-schemas.ts:177` (enum: controller/user/system/resume-router), `src/index.ts:45,967` (hardcoded "controller") | Valor `'system'` previsto mas NUNCA escrito |
| Hook bindings em `hooks/hooks.json` | 7 bindings: SessionStart, UserPromptSubmit, Stop, PreToolUse:spawn_agent, PreToolUse:Agent, PreToolUse:Skill, PreToolUse:Edit\|Write\|NotebookEdit\|MultiEdit | PreToolUse:Skill omite sentinel-hook (H2 confirmed) |
| `gate-registry.ts` count | 26 keys em `src/gates/gate-registry.ts:15-225` | 4 mais que os 22 do inline invariant |
| `sentinel` save sites em `pipeline-controller.ts` | Lines 428, 454, 466 (phase_2_to_3 EXISTE), 1147, 1176, 1188, 1206, 1254, 1266, 1318, 1332, 1828, 1840 | H3 refutada — label existe; trust comprometido pela H1 upstream |
| `decided_by` confidence-model | `src/gates/confidence-model.ts:39-65` | Cálculo puramente aritmético; ZERO inspeção de provenance |
| `agentRuntime` em src/ | Pattern AgentRuntimeAdapter declarado, mas adapter Codex nativo NÃO existe | R7 cria do zero |
| `dispatchMode` em protocol-events | `src/protocol/protocol-events.ts:62-117` | Schema NÃO tem o campo |
| `strictAgents` em continue/resume | `src/continue/resume-pipeline.ts:1-16`, `continue-state.ts:118-143` | Não persistido nem recuperado |
| `Bash` em edit-guard | `hooks/hooks.json:85` (matcher: `Edit\|Write\|NotebookEdit\|MultiEdit`), `hooks/edit-guard-hook.cjs:24` | Bash NÃO está no matcher |
| `lstat` em exec-window | `scripts/exec-window/open.cjs:81,95` | Apenas `renameSync` direto — sem check de symlink |

## Pontos de Integração (file:line)

### Para Theme C (Emulation Theatre — root cause)

- **R1 (Gate_Log_Writer):** centralizar write em `src/state/gate-log.ts`; remover hardcode `decided_by="controller"` de `src/index.ts:45,967`; expor função `recordGateDecision(input)` que infere `decided_by` da dispatch provenance.
- **R2 (Confidence_Model):** estender `src/gates/confidence-model.ts:39-65` para escanear gate-log; cap em 0.5 se houver entrada `decided_by='system'`; escrever `confidenceSource` no YAML.
- **R3 (cascade fix):** patch 3 linhas em `src/index.ts:691,699-701` para substituir `=== true` por `?? options.strictAgents ?? isOperationalPipelineDispatch(request)`.
- **R4 (tests):** novo arquivo `tests/integration/strict-agents-undefined.test.ts`.
- **R5 (dispatchMode):** estender Zod schema em `src/protocol/protocol-events.ts:62-117` adicionando `dispatchMode: z.enum(['real','emulated']).optional()`; popular no writer.
- **R6 (resume persistence):** estender session schema + `src/continue/resume-pipeline.ts` para incluir `strictAgents` no persist/restore.
- **R7 (adapter):** novo arquivo `src/adapters/codex-agent-runtime.ts` implementando `AgentRuntimeAdapter`; integrar em `createPipelineRuntime` (src/index.ts) com detecção de `spawn_agent` no ambiente.

### Para Theme B (Authority Fragmentation)

- **R8 (controller authority):** ou adicionar `AUTHORITY_NOTE` header em `agents/core/pipeline-controller.md` (opção b), OU wirar via R7 adapter como N1 path (opção a — requer R7 pronto).
- **R9 (hardness unify):** ou rewrite `src/gates/gate-registry.ts` para usar `classifyGateHardness()` em loop (opção b), OU adicionar header tombstone em `src/gates/hardness-policy.ts` (opção a).
- **R10 (KB SSOT):** rewrite ou tombstone dos 4 arquivos KB antigos; mover Drift Notes para `references/openai-codex-kb/CHANGELOG.kb.md`.

### Para Security cluster

- **R11 (hooks fail-closed):** patch `hooks/dispatch-guard.cjs:391-402` e `hooks/sentinel-hook.cjs:108-112,181-184` envolvendo handler em try/catch que chama `deny()`.
- **R12 (Bash coverage):** estender matcher em `hooks/hooks.json:85` para incluir `Bash`; estender lógica de parse em `hooks/edit-guard-hook.cjs` para detectar `>`, `>>`, `rm`, `mv`.
- **R13 (symlink lstat):** patch `scripts/exec-window/open.cjs:81,95` adicionando `fs.lstatSync(target).isSymbolicLink()` check antes de `renameSync`.
- **R14 (plugin templates):** modificar arquivos em `C:/Users/win/.claude/skills/codex-plugin-builder/assets/templates/` — wiring de `hooks.json` para só `hook-deny.cjs` ou shippar os 4 stubs faltantes; flip do catch de `hook-deny.cjs:51-54` para `deny()`.

## Decisões de Arquitetura

| Decisão | Motivo | Alternativas descartadas |
| --- | --- | --- |
| Centralizar `Gate_Log_Writer` em `src/state/gate-log.ts` | SSOT único previne fix-then-regress (Theme D); permite CI lint forbidding hardcoded `decided_by` | Permitir múltiplos call sites com convenção — rejeitada porque já mostrou ser violada (CHAR-07 stale) |
| Inferir `decided_by` da dispatch provenance, não exigir parâmetro explícito | Reduz superfície de erro do caller; alinha com NFR-5 (doc honesty: docs já dizem "system" significa emulação) | Parâmetro explícito — rejeitado porque cada caller pode esquecer; provenance é única fonte de verdade |
| `Confidence_Cap_Threshold = 0.5` (número fixo, não fórmula) | Simplicidade > sofisticação; threshold semântico em "metade" sinaliza "não confie como se fosse real" sem matar a métrica | Fórmula `0.5 - 0.1 * count(system entries)` — rejeitada (OQ-3 do pre-spec); adiciona complexidade sem ganho material |
| Cascade idêntico em review/final-adv (não regra mais estrita) | Consistência com `runtimeRunRole`; menos surpresas para casos de borda | Regra exclusiva "sempre block se strictAgents !== true" — rejeitada (OQ-2 do pre-spec); bloqueia casos legítimos de diagnostic |
| Pipeline_Controller_Authority = opção (b) AUTHORITY_NOTE | Honesto sobre estado atual; não bloqueia ship de outros fixes; deixa porta aberta para opção (a) quando R7 estiver pronto | Opção (a) restaurar markdown como N1 — adiada (OQ-1): requer R7 maduro, não cabe no escopo de uma spec |
| KB consolidation = opção (a) reescrever bodies (não tombstone) | Mantém grep-ability dos arquivos antigos; padrão original sem Drift Notes; CHANGELOG.kb.md preserva editorial history (mitigação R-6) | Tombstone — rejeitado por perder navegabilidade interna; mas é fallback aceitável se reescrita for impeditiva |
| Versionamento = minor bump (0.4.1 → 0.5.0) | Comportamento documentado mas não funcional sendo corrigido; não há quebra de API pública; semver minor adequado | Major bump 1.0.0 — adiado para quando adapter R7 ship "produção" oficial; minor por enquanto |

## Padrões encontrados (vão informar Implementation)

| Padrão | Arquivo de referência | Como aplicar |
| --- | --- | --- |
| Atomic write (temp + rename) | `src/state/atomic-write.ts` (usado por `gate-log.ts`) | Aplicar mesma técnica em `sentinel-state.ts` (resolve AUDIT-017) |
| Zod schema validation com optional fields | `src/protocol/protocol-events.ts:62-117` | Estender com `dispatchMode` opcional (NFR-1 backward compat) |
| Hook deny output JSON shape | `hooks/dispatch-guard.cjs` permission_decision pattern | Replicar em fail-closed default (R11) |
| Cascade null coalescing `?? a ?? b ?? fn()` | `src/index.ts:548` | Replicar em 691, 699-701 (R3) |
| Session JSON persistence | `src/state/session-store.ts` (existing) | Adicionar `strictAgents` field (R6) |
| AgentRuntimeAdapter interface | `src/dispatcher/run-role.ts` (consumer side) | Implementar nova classe em `src/adapters/codex-agent-runtime.ts` (R7) |

## Áreas que NÃO precisam de research adicional

- ✅ Estrutura geral do pipeline (4 fases) — documentada em controller spec e SKILL.md.
- ✅ Gate registry (26 entradas) — já enumeradas em audit-intake.
- ✅ Sentinel checkpoints (5 labels) — já cross-checked.
- ✅ Hook event types e schemas — já mapeados.
- ✅ Test framework (Vitest) e BDD pattern — já em uso no projeto.

## Áreas que PODEM precisar de research durante spec-tasks

- 🟡 Detecção robusta de `spawn_agent` disponibilidade no ambiente Codex (R7) — pode requerer test em ambiente real Codex, não emulado.
- 🟡 Tool name canônico para `Bash` no Codex 2026 (R12) — confirmar se é `Bash` literal ou outro nome (cross-check com docs Codex).
- 🟡 Format exato de session.json persistido (R6) — verificar campos atuais antes de adicionar `strictAgents`.

Esses 3 itens são tracked como riscos no design (não bloqueantes — fallback documentado para cada).
