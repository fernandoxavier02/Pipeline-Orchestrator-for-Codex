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
