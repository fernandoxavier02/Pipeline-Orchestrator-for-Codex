# Requirements: Pipeline Meta IFRS16 Modalities Audit

## Goal

Registrar a auditoria meta de 2026-05-18 sobre as modalidades do `pipeline-orchestrator-for-codex` usando o projeto irmao `D:\IFRS 16 (do replit para o Cursor)` como laboratorio descartavel.

Esta spec documenta o que o Orchestrator deveria fazer segundo contratos, skills, gates, hooks e workflows, e o que o runtime realmente fez em execucoes simuladas.

## Scope

In scope:
- Contratos de `skills/pipeline/SKILL.md`, `commands/pipeline.md`, `references/workflow-method-gate.md`, `references/visible-plan-contract.md` e `references/workflow-next-step.md`.
- Parser e modos em `src/controller/parse-mode.ts`, `src/domain/pipeline-types.ts` e `src/cli/pipeline-cli.ts`.
- Execucoes simuladas em 25 worktrees descartaveis criados a partir do commit `d26a91f` do IFRS16.

Out of scope:
- Alterar codigo do IFRS16.
- Corrigir os achados nesta spec.
- Tratar worktrees antigos ja existentes em `D:\IFRS-16-po-eval`.

## Requirements

### R1 - Modalidades Publicas Devem Bater Com Parser e CLI

O contrato publico do pipeline deve listar somente modos que o parser e o CLI reconhecem, ou marcar explicitamente qualquer modo documentado mas ainda nao implementado.

Acceptance criteria:
- `skills/pipeline/SKILL.md`, `commands/pipeline.md`, `src/domain/pipeline-types.ts` e `src/controller/parse-mode.ts` concordam sobre modos publicos.
- `--no-plan` nao aparece como modo executavel enquanto nao existir no parser.
- Comandos diretos como `audit --light`, `bugfix --heavy`, `feature --heavy` e `spec --audit-only` estao documentados se permanecerem suportados pelo parser.

### R2 - Execucao Operacional Deve Falhar Fechada Sem Agentes Reais

O contrato operacional diz que o produto real exige `strictAgents=true` e adaptador para `spawn_agent`.

Acceptance criteria:
- Caminhos de produto nao devem ser reportados como execucao multiagente real quando rodam em harness local.
- Falta de adaptador real deve retornar `blocked-no-agent-runtime` antes de qualquer afirmacao de execucao operacional.
- Resultados de harness devem ser rotulados como diagnostico/teste, nao como prova de pipeline real.

### R3 - Gates Visiveis e Protocolo Devem Ser Persistidos

Os contratos `VISIBLE_PLAN`, `WORKFLOW_METHOD_GATE` e protocol hoisting exigem rastreio visivel e persistencia de eventos.

Acceptance criteria:
- Toda execucao terminal inclui `NEXT_STEP`.
- Emissoes e respostas de protocolo aparecem em `.codex/pipeline/protocol-events.jsonl`.
- Decisoes de gate de usuario nao sao inferidas silenciosamente pelo controller.
- O estado `awaitingUserConfirmation` nao deve coexistir com avanco que pareca execucao aprovada.

### R4 - Continue Deve Bloquear Com Diagnostico Legivel

`continue` deve retomar uma sessao aprovada existente ou bloquear com explicacao clara quando nao houver estado valido.

Acceptance criteria:
- Sem `.codex/pipeline` valido, `continue` retorna status bloqueado estruturado.
- O usuario recebe uma proxima acao concreta, nao um erro bruto de filesystem.
- O fluxo aplica a excecao estreita descrita em `references/workflow-method-gate.md`: pode retomar workflow aprovado, mas deve parar se nao houver prova de aprovacao.

### R5 - Review-only Deve Produzir Relatorio ou Bloqueio Estruturado

`review-only` deve executar revisao final adversarial sobre mudancas nao commitadas ou informar que nao ha superficie de revisao.

Acceptance criteria:
- O modo cria evidencia persistida ou retorna bloqueio estruturado.
- O modo nao deve terminar sem state files, gate log e next step quando invocado pelo entrypoint publico.
- Alias direto `/pipeline-orchestrator-for-codex:review` deve ter comportamento equivalente ao modo publico.

### R6 - Spec Lifecycle Deve Bloquear Antes de Execucao Sem Artefatos

As variantes `spec-*` devem exigir `requirements.md`, `design.md` e `tasks.md` antes de execucao.

Acceptance criteria:
- Falta de spec gera `SPEC_ARTIFACT_MISSING` com path esperado.
- O status externo deve ser claramente bloqueado.
- A proposta nao deve sugerir confirmacao de execucao enquanto falta artefato obrigatorio.

### R7 - Identidade de Execucao Deve Apontar Para o Alvo Real

Eventos persistidos devem distinguir corretamente o repo do plugin, o cwd do usuario e o state root.

Acceptance criteria:
- `execution_identity.cwd` representa o workspace alvo da execucao, nao apenas o shell de onde o auditor chamou o runtime.
- `plugin_root` ou campo equivalente representa o repo do plugin.
- Logs de auditoria permitem reconstruir qual worktree IFRS16 recebeu cada execucao.

### R8 - Subagentes Devem Ser Despachados No Fluxo Operacional

A fonte canonica do pipeline diz que o skill e um protocol handler: ele deve spawnar o `pipeline-controller` e processar os blocos `DISPATCH_REQUEST`, `GATE_REQUEST` e `PLAN_MODE_REQUEST` emitidos pelo controller.

Acceptance criteria:
- Invocar o entrypoint operacional chama `spawn_agent` pelo menos uma vez para o controller.
- Cada fase que depende de agente real emite ou processa dispatch real, nao apenas heuristica local.
- Sem adaptador real, o fluxo operacional para em `blocked-no-agent-runtime` antes de simular progresso.
- A execucao registra claramente se rodou em `real-agent` ou `harness`.

### R9 - Fases e Gates Devem Acontecer Na Sequencia Canonica

O contrato do `agents/core/pipeline-controller.md` define fases 0, 1, 1.5, 2 e 3, com gates obrigatorios e checkpoints sentinela.

Acceptance criteria:
- Phase 0 executa classificacao, information gate e design interrogation quando aplicavel.
- Phase 1 exige confirmacao do usuario via `GATE_REQUEST` antes de execucao.
- Phase 1.5 emite planejamento quando obrigatorio para MEDIA/COMPLEXA/Spec.
- Phase 2 executa batch, TDD/ATDD equivalente, checkpoint e revisao adversarial por batch.
- Phase 3 executa sanity/final validator/Pa de Cal e closeout.
- O log contem transicoes de fase e gates canonicos, nao apenas tres linhas de Phase 0.

### R10 - Brainstorm/Pre-execution Routing Deve Rodar Quando Obrigatorio

O Step 1.7 do controller canonico exige roteamento pre-execucao para MEDIA/COMPLEXA/Spec: carregar preparo existente, despachar brainstorm ou registrar bypass explicito.

Acceptance criteria:
- Para MEDIA/COMPLEXA/Spec sem preparo existente e sem override explicito, o controller despacha `brainstorm-controller`.
- O resultado do brainstorm deve ter gate interativo respondido (`GATE_RESPONSES`) antes de handoff/sintese.
- `STEP_1_7_ROUTING` aparece em `gate-decisions.jsonl`.
- Se o brainstorm nao puder rodar, o pipeline deve parar como parcial/bloqueado, nao seguir direto para proposta.
