# Mapa de-para: contrato Claude Code canonico vs Codex

Data: 2026-05-14

Escopo: comparar o contrato de execucao do plugin Codex em `D:\Pipeline Orchestrator for Codex` contra a fonte canonica local do Claude Code em `D:\Pipeline Orchestrator Claude\Pipeline-Orchestrator`.

## Veredito

O port para Codex nao preserva hoje o contrato canonico de execucao. Ele contem boa parte dos nomes, prompts, eventos e arquivos de controle, mas o caminho efetivo degrada em quatro pontos criticos:

1. O comando publico foi documentado de forma ambigua. No Codex o entrypoint publico e `/pipeline-orchestrator-for-codex:pipeline`; `/pipeline` aparece em textos, banners, CLI e hooks, mas nao deve ser tratado como comando publico real.
2. A execucao multiagente real nao e o comportamento padrao. O runtime padrao usa emulacao local (`strictAgents=false`), com funcoes TypeScript no mesmo processo, sem isolamento real entre implementador, revisores e validadores.
3. O contrato de gates foi portado como texto/protocolo, mas nao ha um loop pai nativo e obrigatorio que processe `GATE_REQUEST`, `DISPATCH_REQUEST` e `PLAN_MODE_REQUEST` com as primitivas reais do Codex em toda execucao.
4. Os hooks ainda carregam linguagem e shape do Claude (`CLAUDE_PLUGIN_ROOT`, `Agent`, `subagent_type`, `AskUserQuestion`, `Task`) enquanto o Codex usa outra superficie (`spawn_agent`, `request_user_input`/pergunta direta, `agent_type`, `message`). Isso faz os guardrails parecerem presentes, mas eles nao cobrem o caminho real de ferramenta com confianca.

Em linguagem direta: o plugin parece governado no papel, mas o caminho operacional mistura contrato canonico, harness de testes e residuos do Claude. Isso explica a degradacao: ele para de spawnar agentes reais, enfraquece gates, e os hooks deixam de ser garantia forte.

## Fontes comparadas

### Claude Code canonico local

- `D:\Pipeline Orchestrator Claude\Pipeline-Orchestrator\commands\pipeline.md`
- `D:\Pipeline Orchestrator Claude\Pipeline-Orchestrator\skills\pipeline\SKILL.md`
- `D:\Pipeline Orchestrator Claude\Pipeline-Orchestrator\agents\core\pipeline-controller.md`
- `D:\Pipeline Orchestrator Claude\Pipeline-Orchestrator\hooks\hooks.json`
- `D:\Pipeline Orchestrator Claude\Pipeline-Orchestrator\references\gate-request-protocol.md`

### Codex atual

- `commands/pipeline.md`
- `skills/pipeline/SKILL.md`
- `agents/core/pipeline-controller.md`
- `hooks/hooks.json`
- `hooks/force-pipeline-agents.cjs`
- `hooks/dispatch-guard.cjs`
- `hooks/sentinel-hook.cjs`
- `src/index.ts`
- `src/controller/pipeline-controller.ts`
- `src/dispatcher/run-role.ts`
- `src/dispatcher/parallel-emulation-runner.ts`
- `docs/technical-debt.md`
- `CODEX_HARNESS_ADEQUACY_REPORT.md`
- `AUDIT_CODEX_VS_CANONICAL.md`

## Mapa de-para

| Area | Claude Code canonico | Codex atual | Lacuna | Correcao necessaria |
| --- | --- | --- | --- | --- |
| Comando publico | `/pipeline-orchestrator:pipeline` e entrypoints correlatos no namespace do plugin. | O arquivo existe como `/pipeline-orchestrator-for-codex:pipeline`, mas varios textos ainda dizem `/pipeline`. | O usuario recebe um comando que nao existe como superficie publica real. | Remover `/pipeline` de banners, skill, CLI e prompts publicos, ou implementar alias real e documenta-lo como alias. O padrao deve ser `/pipeline-orchestrator-for-codex:pipeline`. |
| Skill principal | `skills/pipeline/SKILL.md` e um delegador fino: nao classifica, nao edita, nao executa; chama o controller via `Agent`. | `skills/pipeline/SKILL.md` diz ser delegador fino, mas tambem descreve emulacao padrao e usa exemplo de `spawn_agent` com parametro `name`, que nao existe no schema Codex desta sessao. | O contrato escrito nao bate com a ferramenta real. | Adaptar para `spawn_agent(agent_type: "worker", message: ...)`, sem `name`; se nao houver `spawn_agent`, bloquear. |
| Controller isolado | O `pipeline-controller` roda em subagente isolado e emite blocos estruturados para o pai. | O controller tambem existe como prompt, mas o runtime TypeScript executa grande parte localmente via `createPipelineController`. | O controlador deixa de ser uma entidade isolada e vira logica local/harness. | Fazer o skill chamar o controller como subagente real; o TypeScript deve virar adaptador/validador de protocolo, nao substituto do subagente. |
| Dispatch de agentes | O controller emite `DISPATCH_REQUEST`; o pai chama `Agent(subagent_type, description, prompt)`. | O Codex diz que `DISPATCH_REQUEST` vira `spawn_agent`, mas o caminho real so chama `agentRuntime.spawnAgent` se um adapter for injetado. Sem isso, cai em `runSingleAgentRole` ou `runParallelEmulation`. | "Agente" vira funcao local, sem contexto limpo nem independencia. | Criar adapter nativo `CodexHostAgentRuntime` ou mover o loop para o parent skill: parsear `DISPATCH_REQUEST`, chamar `spawn_agent`, esperar resultado, reinvocar controller. |
| Modo default | Claude canonico assume dispatch real via harness Claude e bloqueios via hooks. | `strictAgents=false` e default documentado; emulacao local e aceita como harness. | O modo padrao nao entrega o comportamento prometido pelo plugin. | Para o plugin operacional, default deve ser `strictAgents=true` ou "blocked-no-agent-runtime". Harness deve ficar restrito a testes/diagnostico explicito. |
| Gates de usuario | Gates usam `AskUserQuestion`; quando subagente nao pode chamar ferramenta, emite `GATE_REQUEST` e o pai pergunta. | Ha `GATE_REQUEST`, logs e gates no TypeScript, mas nao ha garantia universal de pausa real no parent antes de avancar. | O fluxo pode parecer gated mas seguir por defaults/controlador local. | Implementar loop obrigatorio no skill/parent: ao ver `GATE_REQUEST`, parar, perguntar ao usuario, persistir resposta, e so entao reinvocar controller. |
| Plan mode | Claude usa `EnterPlanMode`/`ExitPlanMode` pelo pai quando recebe `PLAN_MODE_REQUEST`. | Codex usa `update_plan` como plano visivel e menciona `PLAN_MODE_REQUEST`; ainda ha linguagem herdada de `EnterPlanMode`. | Mistura duas primitivas diferentes sem contrato claro. | Definir: no Codex, `PLAN_MODE_REQUEST` abre/atualiza `update_plan` e executa pesquisa read-only no parent; remover promessa literal de `EnterPlanMode` quando nao existir. |
| Hooks de dispatch | Hooks observam `Agent` e `Skill`, validam FQN `pipeline-orchestrator:*`, sentinel e edit guard. | Hooks ainda procuram `subagent_type`; mensagens falam `Agent tool` e `Task`; `hooks.json` usa `${CLAUDE_PLUGIN_ROOT}`. | Hooks nao batem com a ferramenta Codex real (`spawn_agent`) nem com o ambiente (`CODEX_PLUGIN_ROOT`/cache Codex). | Normalizar input de hook para `spawn_agent` (`agent_type`, `message`, possivel metadata), suportar `CODEX_PLUGIN_ROOT`, e remover referencias Claude-only de mensagens. |
| Sentinel | Claude exige `sentinel-state.json` antes de spawn e valida sequencia antes de `Agent`. | Codex tem `.codex/pipeline/sentinel-state.json`, mas o hook valida `subagent_type` e o runtime TypeScript pode operar sem hook efetivo. | O sentinel nao e uma trava universal. | Fazer o sentinel validar o evento real de spawn Codex e tambem ser chamado pelo runtime antes de qualquer dispatch. |
| Edit/write guard | Claude protege edicoes por hooks e exec-window; main LLM nao deveria editar fora do fluxo. | Codex tem `edit-guard` no runtime e hook para Edit/Write/MultiEdit, mas shell/escritas por comando e execucao local ainda precisam contrato claro. | O guardrail nao cobre toda superficie pratica de escrita. | Bloquear writes de shell em fluxo governado ou exigir exec-window/estado autorizado tambem no runtime antes de qualquer write-capable role. |
| TDD/ATDD | Claude passa por pre-tester, cenarios, aprovacao, RED/GREEN e gates. | Codex modela pre-tester/quality gate, mas em harness pode gerar prova estrutural/sintetica. | Gate de TDD pode virar checklist, nao evidencia real. | Exigir evidencia real de teste/comando ou gate humano antes de implementacao; testes devem falhar se TDD for pulado. |
| Revisao adversarial | Claude separa implementacao e revisao; revisores finais rodam de forma independente, com contexto minimo. | Codex usa `parallel-emulation` com `Promise.all` sobre funcoes locais; nao garante contexto independente. | "Revisao independente" nao e independente. | Spawns reais para revisores, `fork_context=false` quando aplicavel, prompt minimo com lista de arquivos, outputs persistidos separadamente. |
| Logs de protocolo | Claude separa `protocol-events.jsonl` de `gate-decisions.jsonl` e exige append de emissoes/respostas. | Codex tem parser/persistencia parcial, mas o parent loop nao e o caminho obrigatorio. | Pode haver logs sem garantia de que a decisao travou a execucao. | Teste de contrato: nenhum `GATE_REQUEST` pode terminar sem resposta persistida e reinvocacao do controller. |
| Finalizacao | Claude fecha com sanity-checker, final adversarial, final-validator e finishing-branch. | Codex tem closeout/final-validator/TRACE, mas a qualidade depende das evidencias anteriores. | Final pode validar artefatos de harness, nao trabalho multiagente real. | Final-validator deve rejeitar run sem eventos reais de spawn/gate/teste quando o modo nao for diagnostico. |
| Testes | Claude valida comportamento por prompts/hooks e contrato do runtime Claude. | Codex tem muitos testes, mas boa parte valida harness/emulacao. | A suite pode passar enquanto o plugin falha no uso real. | Adicionar testes vermelhos para: comando publico sem `/pipeline`; `spawn_agent` obrigatorio; hook aceitando shape Codex; bloqueio sem adapter; gate nao pulavel. |

## Causas-raiz

### 1. Confusao entre comando publico e alias historico

O contrato publico correto no Codex deve ser `/pipeline-orchestrator-for-codex:pipeline`. Mesmo assim, ha referencias visiveis a `/pipeline` em:

- `commands/pipeline.md`
- `skills/pipeline/SKILL.md`
- `hooks/hooks.json`
- `hooks/force-pipeline-agents.cjs`
- `src/cli/pipeline-cli.ts`
- `commands/brainstorm.md`

Impacto: o usuario tenta ou espera um comando que nao existe; os hooks tratam uma string historica como se fosse invocacao real; a documentacao passa uma falsa sensacao de contrato publico.

Correcao: padronizar tudo para `/pipeline-orchestrator-for-codex:pipeline`. Se o projeto quiser manter `/pipeline`, isso deve virar alias implementado e testado, nao texto solto.

### 2. Emulacao virou caminho normal

O Codex atual declara dois modos:

- `strictAgents=true`: exige `spawn_agent`.
- `strictAgents=false`: usa harness local.

O problema e que o default e `strictAgents=false`. O proprio codigo confirma que `runRole` so usa `agentRuntime.spawnAgent` quando `requireRealAgent` esta ativo; fora disso, chama `runParallelEmulation` ou `runSingleAgentRole`. O `parallel-emulation-runner` usa `Promise.all` sobre funcoes locais, no mesmo processo.

Impacto: sem `spawn_agent`, nao existe isolamento de contexto. Revisao adversarial, implementador, validador e controller viram logica local, nao agentes independentes.

Correcao: separar claramente produto e harness:

- Produto: exige agente real ou bloqueia com `blocked-no-agent-runtime`.
- Teste/diagnostico: pode usar harness, mas precisa se identificar como harness e nao concluir como pipeline real.

### 3. O loop parent/protocolo nao esta fechado

No Claude canonico, quando o controller emite:

- `GATE_REQUEST`
- `DISPATCH_REQUEST`
- `PLAN_MODE_REQUEST`

o pai tem obrigacao de processar o bloco, chamar a ferramenta real, registrar resultado e reinvocar o controller.

No Codex, esse contrato aparece no texto, mas nao esta fechado como mecanismo obrigatorio em todo entrypoint. O runtime TypeScript consegue simular partes do fluxo, mas isso nao equivale a parent loop usando as ferramentas reais do Codex.

Impacto: gates podem virar estado interno; dispatch pode virar emulacao; plan mode pode virar texto.

Correcao: o skill principal precisa virar um handler real de protocolo:

1. abrir `update_plan`;
2. ler o controller;
3. chamar `spawn_agent`;
4. parsear blocos;
5. perguntar ao usuario quando houver gate;
6. chamar novos `spawn_agent` para dispatches;
7. reinvocar controller ate `PIPELINE COMPLETE`;
8. bloquear se qualquer primitiva obrigatoria estiver ausente.

### 4. Hooks portados com shape Claude

O Claude canonico observa `Agent`, `Skill`, `AskUserQuestion` e usa `CLAUDE_PLUGIN_ROOT`. O Codex atual ainda traz:

- `CLAUDE_PLUGIN_ROOT` em `hooks/hooks.json` e `dispatch-guard.cjs`;
- `subagent_type` em `dispatch-guard.cjs` e `sentinel-hook.cjs`;
- mensagens mandando usar `Agent tool`, `Task tool` e `/pipeline`;
- validacao centrada em FQN de agente Claude-like.

Impacto: os hooks podem passar ou falhar pelos motivos errados. Mesmo quando existem, eles nao provam que `spawn_agent` real foi chamado nem que o gate travou a execucao.

Correcao: criar uma camada de normalizacao de eventos Codex:

- reconhecer `spawn_agent`;
- extrair `agent_type`, `message` e metadados;
- validar o agente pipeline por marcador no prompt ou metadata propria;
- suportar `CODEX_PLUGIN_ROOT`/cache Codex;
- manter fallback Claude somente se o plugin for deliberadamente dual-runtime.

## Prioridade de correcao

### P0 - Corrigir contrato publico e impedir falsa execucao

1. Remover referencias publicas a `/pipeline` ou implementar alias real.
2. Fazer `/pipeline-orchestrator-for-codex:pipeline` bloquear quando nao houver agente real.
3. Remover qualquer mensagem que diga que uma run foi "multi-agent" quando `dispatchMode` for harness/emulacao.
4. Ajustar `skills/pipeline/SKILL.md` para o schema real de `spawn_agent`.

### P0 - Fechar o loop de protocolo

1. Implementar parent handler para `DISPATCH_REQUEST`, `GATE_REQUEST` e `PLAN_MODE_REQUEST`.
2. Garantir que `GATE_REQUEST` sempre pausa a execucao e espera resposta do usuario.
3. Persistir `protocol-events.jsonl` e `gate-decisions.jsonl` apenas quando a acao real ocorreu.
4. Rejeitar run que tenta concluir com bloco pendente.

### P1 - Alinhar hooks ao Codex

1. Trocar `CLAUDE_PLUGIN_ROOT` por resolucao Codex, preservando fallback se necessario.
2. Fazer `dispatch-guard` e `sentinel-hook` entenderem o shape real de `spawn_agent`.
3. Atualizar mensagens dos hooks para nao mencionar `Agent tool`, `Task tool` ou `/pipeline` como contrato publico.
4. Adicionar testes de hook com payload real Codex.

### P1 - Restaurar independencia de revisao

1. Revisores adversariais devem ser spawns reais.
2. Revisores nao devem receber resumo da implementacao quando o contrato exige independencia.
3. Final adversarial deve falhar se nao houver evidencia de dispatch real.

### P2 - Limpar documentacao e debt register

1. Reclassificar harness como ferramenta de teste, nao modo default de produto.
2. Atualizar `docs/technical-debt.md` para refletir que `strictAgents=false` nao e aceitavel para uso operacional do plugin.
3. Atualizar README/help para comando publico real e modo de bloqueio.

## Testes que precisam nascer

1. `command-surface.test`: falha se `commands/**`, `skills/pipeline/**`, `hooks/**` ou CLI anunciarem `/pipeline` como comando publico sem alias implementado.
2. `real-agent-required.test`: invocar pipeline operacional sem `spawn_agent` deve retornar `blocked-no-agent-runtime`.
3. `spawn-agent-schema.test`: o skill nao pode documentar parametros inexistentes como `name` em `spawn_agent`.
4. `gate-request-blocks.test`: um `GATE_REQUEST` pendente impede `PIPELINE COMPLETE`.
5. `dispatch-request-spawns.test`: `DISPATCH_REQUEST target_kind=agent` precisa produzir evento real de `spawn_agent`.
6. `hook-codex-payload.test`: `dispatch-guard` e `sentinel-hook` precisam validar payload Codex, nao apenas `subagent_type`.
7. `review-independence-real.test`: revisores finais devem ter execucoes separadas, com evidencias persistidas separadamente.
8. `harness-labeling.test`: qualquer run em emulacao deve terminar como diagnostico/harness, nunca como execucao operacional real.

## Definicao de pronto

O plugin so deve ser considerado restaurado quando:

1. O unico comando publico anunciado for real e testado.
2. A execucao operacional chamar `spawn_agent` pelo menos para o controller e para cada dispatch de agente.
3. A ausencia de `spawn_agent` bloquear, em vez de cair em emulacao.
4. Gates do usuario forem pausas reais, nao defaults internos.
5. Hooks validarem o payload real do Codex.
6. Final validator rejeitar run sem evidencia real de agente, gate e teste.
7. A documentacao distinguir claramente produto, diagnostico e harness.

## Conclusao operacional

A causa principal nao e um bug isolado: e uma quebra de contrato de runtime. O port trouxe o vocabulario do Claude, mas substituiu o mecanismo por emulacao local como default e manteve hooks/prompting com shape antigo. A correcao deve comecar por bloquear a falsa execucao: sem agente real, o pipeline nao deve fingir que executou.
