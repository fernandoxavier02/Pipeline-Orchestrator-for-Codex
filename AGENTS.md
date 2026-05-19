# AGENTS.md

Contexto local para agentes trabalhando em `D:\Pipeline Orchestrator for Codex`.

## Identidade do Projeto

Este repositorio e o SSOT local do plugin `pipeline-orchestrator-for-codex`. O plugin fornece o comando publico `/pipeline-orchestrator-for-codex:pipeline`, que classifica uma solicitacao, apresenta uma proposta ao usuario, executa em fases, aplica gates de qualidade, revisao adversarial e validacao final.

O objetivo principal do repositorio e preservar a verdade de runtime do plugin. Documentacao, README e specs ajudam a explicar o sistema, mas nao devem prometer comportamento que o runtime, hooks, skills, prompts e testes nao sustentem.

## Ordem de Autoridade

Quando houver conflito, use esta ordem:

1. Instrucoes de sistema/developer da sessao atual.
2. Este `AGENTS.md` e arquivos locais em `.kiro/`.
3. `skills/pipeline/SKILL.md`, que e o contrato operacional do skill `/pipeline-orchestrator-for-codex:pipeline`.
4. `commands/pipeline.md`, que e o entrypoint curto e deve encaminhar para o skill.
5. `src/**`, `hooks/**`, `agents/**`, `prompts/**` e `references/**`, conforme a area alterada.
6. `docs/**`, `README.md` e planos historicos, como contexto explicativo.

Se `docs/**` disser uma coisa e o runtime disser outra, trate como drift. Corrija o runtime ou atualize a documentacao, mas nao esconda a divergencia.

## Regras de Trabalho

Antes de trabalho nao trivial, emita `ORCHESTRATOR_DECISION` com tipo, severidade, persona, arquivos provaveis, fluxo e riscos.

Prefira mudanca minima. Nao edite `dist/**` manualmente; ele e saida de build. Se uma mudanca em `src/**` exigir build, rode `npm run build` e entao avalie o diff gerado em `dist/**`.

Nao trate execucao local como publicacao. Para responder se o plugin esta publicado, ativo ou carregado pelo Codex, verifique git, marketplace/cache e caminho efetivo de resolucao.

Nao prometa "multi-agent real" se a sessao ou runtime nao tiver suporte efetivo a `spawn_agent`. O contrato de `/pipeline-orchestrator-for-codex:pipeline` deve parar com `blocked-no-agent-runtime` quando agentes reais forem obrigatorios e indisponiveis.

Preserve SSOT: `commands/pipeline.md` deve continuar curto e discoverable; comportamento detalhado deve ficar no skill, runtime TypeScript, hooks, prompts, agentes e referencias adequadas.

## Eval Gate Local

Este repositório tem uma camada local de Eval Gate em `.codex/**`, `.agents/skills/workflow-eval-gate/**` e `evals/**`. Ela avalia mudanças no orquestrador, workflows, plugin, skills, hooks, commands, scripts, telemetry, gates, traces, batches e reviews sem reescrever o runtime.

Use `evals/README.md` como guia operacional do Eval Gate local. Use `docs/pipeline-orchestrator-codex/11-eval-gate-plan.md` como contrato historico da instalacao desta camada.

Antes de mudar esses arquivos, inspecione a estrutura real, identifique entrypoints e preserve a fonte de verdade do plugin. Nao adicione features, abstracoes, dependencias ou alteracoes fora de escopo sem pedido explicito.

Depois de qualquer mudanca em orquestrador, workflow, plugin, skill, hook, command ou script, atualize `evals/outputs/latest_output.md`, deixe os hooks capturarem telemetry quando estiverem confiados/ativos, ou rode `.codex/hooks/post_tool_use_telemetry.py` manualmente. Nao declare sucesso sem `python .agents/skills/workflow-eval-gate/scripts/run_eval.py` passando.

A habilitacao dos hooks e manual no Codex: abra `/hooks`, revise os comandos de `.codex/hooks.json` e confie somente nesta raiz do repositorio. Se a sessao nao provar que os hooks locais estao confiados/ativos, trate a telemetry como manual e registre isso no relatorio final.

A resposta final de trabalhos cobertos pelo Eval Gate deve informar: o que foi inspecionado, o que mudou, o que nao mudou, resultado do eval, riscos restantes e proximo passo mais seguro. Esta camada e local do projeto; nao trate como hook empacotado do plugin ou como runtime global sem verificar `/hooks`, `.codex/config.toml`, marketplace/cache e configuracao ativa do Codex.

## Comandos de Verificacao

Use estes comandos a partir da raiz do repo:

```powershell
npm run lint:types
npm run build
npm test
```

Em Windows, se o Vitest completo falhar por memoria ou IPC, rode subconjuntos focados antes de diagnosticar como regressao de codigo.

## Arquivos de Contexto

Leia `.kiro/CONSTITUTION.md` para principios permanentes, `.kiro/steering/product.md` para intencao do produto, `.kiro/steering/tech.md` para stack/runtime e `.kiro/steering/structure.md` para mapa do repositorio.

Antes de alterar superficies ligadas a OpenAI/Codex, API, skills, plugins, MCP, subagentes, rules, hooks ou `AGENTS.md`, consulte `references/openai-codex-kb/INDEX.md` e volte as fontes oficiais quando a mudanca depender de comportamento atual do produto.
