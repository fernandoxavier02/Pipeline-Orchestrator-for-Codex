# Design: Pipeline Meta IFRS16 Modalities Audit

## Evidence Setup

Auditoria executada em 2026-05-18.

Repositorio auditado:
- `D:\Pipeline Orchestrator for Codex`

Laboratorio descartavel:
- `D:\IFRS 16 (do replit para o Cursor)`
- branch temporaria criada: `codex/meta-pipeline-audit-20260518`
- worktrees temporarios criados sob `D:\IFRS-16-pipeline-meta-20260518`
- commit base do IFRS16: `d26a91f`

Estado inicial relevante:
- IFRS16 `main` tinha alteracoes pre-existentes: `.gitignore` modificado e `.vscode/` nao rastreado.
- Worktrees antigos em `D:\IFRS-16-po-eval` foram detectados e preservados.
- O build do Orchestrator passou com `npm run build` antes das simulacoes.

## Modalities Exercised

Foram exercitados 25 prompts simulados:

- Publicos oficiais: `full`, `diagnostic`, `continue`, `review-only`, `--simples`, `--media`, `--complexa`, `--plan`, `--grill`, `--hotfix`.
- Documentado mas nao reconhecido: `--no-plan`.
- Comandos diretos aceitos pelo parser: `audit`, `audit --light`, `audit --heavy`, `bugfix`, `bugfix --light`, `bugfix --heavy`, `feature`, `feature --light`, `feature --heavy`, `spec`, `spec --light`, `spec --heavy`, `spec --audit-only`, `review`.
- Prova adicional: CLI com `--strict-agents` sem adaptador real.

## Contract Baseline

Fontes verificadas:

- `skills/pipeline/SKILL.md`: exige `VISIBLE_PLAN`, `WORKFLOW_METHOD_GATE`, `NEXT_STEP`, `protocol-events.jsonl`, e bloqueio `blocked-no-agent-runtime` quando `spawn_agent` real e obrigatorio mas indisponivel.
- `commands/pipeline.md`: entrypoint curto, contrato de `strictAgents`, modos oficiais e exigencia de `NEXT_STEP`.
- `agents/core/pipeline-controller.md`: fonte canonica do workflow de 4 fases, com Phase 0 triage, Phase 1 proposta/confirmacao, Phase 1.5 planejamento, Phase 2 execucao em batches, Phase 3 fechamento, `DISPATCH_REQUEST`, `GATE_REQUEST`, `PLAN_MODE_REQUEST` e Step 1.7 de brainstorm/pre-execution routing.
- `references/workflow-method-gate.md`: gate visivel antes de execucao; `continue` so pode retomar sessao aprovada.
- `references/workflow-next-step.md`: toda workflow de comando ou skill deve terminar com bloco `NEXT_STEP`.
- `src/controller/parse-mode.ts`: reconhece comandos diretos e modos oficiais, mas nao reconhece `--no-plan`.
- `src/cli/pipeline-cli.ts`: bloqueia `--strict-agents` sem adaptador; sem strict, roda harness/controller local.

## Findings

### F1 - `--no-plan` Esta Documentado Mas Nao Existe No Parser

Evidencia:
- `skills/pipeline/SKILL.md` lista `/pipeline-orchestrator-for-codex:pipeline --no-plan [task]`.
- `commands/pipeline.md` e `src/domain/pipeline-types.ts` nao listam `--no-plan`.
- `src/controller/parse-mode.ts` nao possui prefixo para `--no-plan`.
- Execucao `documented-no-plan` foi interpretada como `mode: "full"`, `variant: "feature-light"`, com o texto `--no-plan` tratado como parte normal da solicitacao.

Impacto:
- Usuario pode acreditar que desativou planejamento quando, na pratica, apenas enviou texto comum.
- Isso e drift de contrato publico.

Severidade: Alta.

### F2 - Harness Executa Entrada Publica Sem Protocolo Persistido

Evidencia:
- Modos `full`, `--simples`, `--media`, `--complexa`, `--plan`, `--grill`, `--hotfix` e comandos diretos criaram `gate-decisions.jsonl`, `session.json` e `confidence-score.yaml`, mas `protocol-events.jsonl` ficou ausente em todos os casos.
- Os resultados continham `awaitingUserConfirmation: true` e `pendingDecision: "proposal-confirmation"`, mas a resposta JSON podia parecer uma execucao bem-sucedida (`status: ok` ou sem status de bloqueio).
- `strict-agents-cli-probe` retornou corretamente `blocked-no-agent-runtime` quando chamado com `--strict-agents` sem adaptador.

Impacto:
- O harness e util para diagnostico, mas nao prova o fluxo operacional com agentes reais.
- O contrato de protocol hoisting nao fica observavel nessas execucoes simuladas.

Severidade: Critica para claims de "pipeline real"; Media para harness diagnostico.

### F2a - Subagentes Nao Foram Spawnados Como O Contrato Operacional Exige

Evidencia:
- `skills/pipeline/SKILL.md` define que o skill e apenas um protocol handler: deve ler `agents/core/pipeline-controller.md`, chamar `spawn_agent` para o controller e processar `DISPATCH_REQUEST`, `GATE_REQUEST` e `PLAN_MODE_REQUEST`.
- O mesmo arquivo diz: "Self-check before responding: Did you call `spawn_agent` at least once? If no, you violated the pipeline contract."
- Nas execucoes simuladas via runtime/CLI local, nao houve evidencia de `spawn_agent`, `DISPATCH_REQUEST` processado, agent result ou `protocol-events.jsonl`.
- A unica prova positiva foi negativa: `--strict-agents` sem adapter retornou `blocked-no-agent-runtime`, ou seja, sem bridge real o runtime nao consegue executar o contrato operacional.

Impacto:
- O que rodou foi controller/harness local, nao pipeline multiagente operacional.
- Revisao adversarial independente, isolamento de contexto e dispatch por fase nao foram provados.
- Qualquer resumo que diga "pipeline executou" sem qualificar como harness diagnostico fica falso.

Severidade: Critica.

### F2b - Fases Do Workflow Nao Avancaram Com Os Gates Devidos

Evidencia:
- `agents/core/pipeline-controller.md` exige Phase 0, Phase 1, Phase 1.5, Phase 2 e Phase 3, com transicoes, gates e sentinelas.
- A matriz observou, na maioria dos modos, apenas `INFO_GATE_OK` ou `INFO_GATE_BLOCKED`, `DESIGN_INTERROGATION` e `SENTINEL_CHECKPOINT` de Phase 0.
- `session.json` ficou em `currentPhase: "phase-1"` com `pendingDecision: "proposal-confirmation"` e `awaitingUserConfirmation: true`.
- Nao houve `GATE_REQUEST` persistido para confirmacao da proposta, TDD approval, adversarial gate, final adversarial gate, closeout ou Pa de Cal.
- Nao houve Phase 2 batch execution, nem Phase 3 final validator, nos artefatos observados.

Impacto:
- O fluxo nao completou o workflow canonico; parou antes da parte que daria valor ao Orchestrator.
- Gates que deveriam proteger execucao real viraram apenas estado interno ou nao apareceram.
- A auditoria deve classificar isso como quebra de orquestracao, nao como detalhe de log.

Severidade: Critica.

### F2c - Brainstorm/Step 1.7 Nao Aconteceu

Evidencia:
- `agents/core/pipeline-controller.md` define o Step 1.7 como mandatory para MEDIA/COMPLEXA/Spec: carregar preparo existente, despachar brainstorm, registrar override ou bypass SIMPLES.
- Para MEDIA/COMPLEXA/Spec, a matriz nao mostrou `STEP_1_7_ROUTING`, `brainstorm-controller`, `GATE_REQUEST` de brainstorm, `GATE_RESPONSES`, prep run ou handoff.
- Os modos `full`, `--media`, `--complexa`, `--plan`, `--grill`, `direct-audit`, `direct-bugfix`, `direct-feature-heavy` e `spec*` foram direto para proposta/bloqueio sem evidencia de brainstorm obrigatorio.
- Memoria operacional anterior do plugin tambem registra que brainstorm deve ser troca real com gates, e que completar brainstorm sem resposta de gate deve bloquear.

Impacto:
- O pipeline perdeu a etapa que deveria levantar contexto antes de planejar/executar.
- MEDIA/COMPLEXA/Spec ficam sub-informados e podem chegar a proposta sem intake suficiente.
- Esse e um drift direto entre controller canonico e runtime observado.

Severidade: Alta.

### F3 - `continue` Sem Estado Quebra Com ENOENT

Evidencia:
- Execucao `official-continue` em worktree limpo resultou em excecao: `ENOENT: no such file or directory, scandir '...\\.codex\\pipeline'`.
- Nenhum `gate-decisions.jsonl`, `session.json` ou `NEXT_STEP` foi criado.
- O contrato exige retomar sessao aprovada ou parar se nao houver prova de aprovacao.

Impacto:
- O usuario recebe erro tecnico bruto em vez de bloqueio legivel.
- Nao ha gate log para auditoria do bloqueio.

Severidade: Alta.

### F4 - `review-only` e Alias `review` Terminam Sem Evidencia Persistida

Evidencia:
- `official-review-only` e `direct-review` retornaram `mode: "review-only"`, mas nao criaram state files, gate log ou protocol log.
- A matriz nao mostrou relatorio persistido nem bloqueio estruturado indicando ausencia de mudancas nao commitadas.

Impacto:
- Nao ha prova auditavel de que a revisao final adversarial rodou.
- Nao ha proxima acao persistida para o usuario.

Severidade: Alta.

### F5 - Spec Lifecycle Bloqueia Corretamente, Mas Mistura Proposta Com Falta de Artefato

Evidencia:
- `direct-spec`, `direct-spec-light`, `direct-spec-heavy` e `direct-spec-audit-only` retornaram `status: "blocked"` e registraram `SPEC_ARTIFACT_MISSING`.
- O path esperado foi `.kiro/specs/simulacao-meta-avaliar-melhoria-pequena-documentacao-ifrs16-sem-tocar-em-regra-negocio`.
- Ao mesmo tempo, o `session.json` ainda mantinha `workflowSelection.status: "awaiting-user-confirmation"`.

Impacto:
- O bloqueio tecnico esta correto.
- A comunicacao de estado pode confundir: falta artefato obrigatorio, entao a acao principal nao deveria parecer "confirmar proposta".

Severidade: Media.

### F6 - `execution_identity.cwd` Aponta Para o Repo do Plugin, Nao Para o Worktree IFRS16

Evidencia:
- Logs em `D:\IFRS-16-pipeline-meta-20260518\official-full\.codex\pipeline\gate-decisions.jsonl` tinham `state_root` no worktree IFRS16 correto.
- No mesmo evento, `execution_identity.cwd` apareceu como `D:\Pipeline Orchestrator for Codex`.

Impacto:
- A trilha de auditoria mistura o shell de chamada com o alvo real da execucao.
- Isso enfraquece rastreabilidade em auditorias multi-repo.

Severidade: Media.

## Result Matrix

Resumo dos principais grupos:

| Grupo | Resultado observado | Avaliacao |
| --- | --- | --- |
| `full`, `--simples`, `--media`, `--complexa`, `--plan`, `--grill` | Entram em fase de proposta, persistem gate/session, aguardam confirmacao | Parcial: bom para proposta, incompleto para protocolo/NEXT_STEP |
| `diagnostic` | Para apos proposta com `stoppedAfterProposal: true` | Parcial: comportamento esperado, mas sem `NEXT_STEP` |
| `--hotfix` | Forca `Bug Fix`, `COMPLEXA`, `validationIntent: reduced`; information gate bloqueia por falta de reproducao | Bom bloqueio inicial, mas ainda sem protocolo/NEXT_STEP |
| `continue` | Excecao `ENOENT` | Falha |
| `review-only` e `review` | Retornam sem evidencia persistida | Falha de auditabilidade |
| `--no-plan` | Interpretado como `full` | Falha de contrato |
| `spec*` | Bloqueia com `SPEC_ARTIFACT_MISSING` | Correto, com comunicacao de estado a melhorar |
| `--strict-agents` sem adapter | Retorna `blocked-no-agent-runtime` | Correto |

Resumo adversarial adicional:

| Eixo canonico | Fonte canonica | Observado na matriz | Veredito |
| --- | --- | --- | --- |
| Subagentes reais | `skills/pipeline/SKILL.md` exige `spawn_agent` para controller e dispatches | Sem evidencia de spawn/dispatch; `protocol-events.jsonl` ausente | Falha critica |
| Fases 0-3 | `agents/core/pipeline-controller.md` define triage, proposta, plano, batches, fechamento | Parou em Phase 0/Phase 1 aguardando confirmacao | Falha critica |
| Gates de usuario | `GATE_REQUEST` para proposta, TDD, adversarial, final review e closeout | Nenhum `GATE_REQUEST` persistido | Falha critica |
| Brainstorm Step 1.7 | MEDIA/COMPLEXA/Spec devem carregar/rodar brainstorm ou registrar bypass | Nenhum `STEP_1_7_ROUTING` ou brainstorm observado | Falha alta |
| Harness vs operacional | `strictAgents=true` requerido para produto real | Harness local retornou propostas, strict sem adapter bloqueou | Correto como diagnostico, insuficiente como produto |

## Recommended Fix Order

1. Corrigir `continue` para falhar fechado com status estruturado e `NEXT_STEP`.
2. Restaurar/provar o caminho operacional com `spawn_agent`: controller real, dispatches reais e `blocked-no-agent-runtime` quando a ponte nao existir.
3. Fazer o runtime respeitar as fases canonicas 0 -> 1 -> 1.5 -> 2 -> 3, com gates e transicoes persistidos.
4. Restaurar/provar Step 1.7: brainstorm obrigatorio para MEDIA/COMPLEXA/Spec ou bypass explicito auditavel.
5. Remover ou implementar `--no-plan`.
6. Fazer `review-only` persistir relatorio/bloqueio e gate log.
7. Garantir `NEXT_STEP` em todos os estados terminais.
8. Persistir `protocol-events.jsonl` quando houver gate/protocolo visivel, ou documentar claramente que o harness nao emite esses eventos.
9. Ajustar `execution_identity.cwd` para o cwd alvo.
10. Documentar comandos diretos suportados ou remove-los da superficie publica.
