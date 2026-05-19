# Technical Context

## Stack

Runtime de desenvolvimento:

- Node.js >= 20
- TypeScript ESM
- Vitest
- Zod para validacao de schemas
- `yaml` para arquivos de confidence/config quando aplicavel
- Python stdlib para o Eval Gate local (`unittest`, `json`, `subprocess`, `pathlib`)

Comandos principais:

```powershell
npm run lint:types
npm run build
npm test
python .agents/skills/workflow-eval-gate/scripts/run_eval.py
```

## Superficies de Runtime

`skills/pipeline/SKILL.md` contem o contrato operacional do skill. Ele deve refletir o fluxo real esperado quando `/pipeline-orchestrator-for-codex:pipeline` e usado.

`commands/pipeline.md` e o entrypoint discoverable. Deve permanecer curto e encaminhar para o skill, sem virar uma segunda implementacao completa.

`src/**` contem o substrate TypeScript: controller, classificacao, gates, dispatcher, estado, referencias, review, seguranca e validacao.

`hooks/**` contem hooks CJS e configuracao de hooks do plugin. Mudancas em hooks precisam considerar o schema real de hooks do Codex.

`.codex/**` contem configuracao e hooks locais do Eval Gate. Essa superficie e local do repositorio e exige trust manual no Codex via `/hooks`; nao trate esses hooks como globais ou empacotados no plugin sem evidencia.

`agents/**` e `prompts/**` contem contratos de agentes e papeis. Ao mudar comportamento de agente, mantenha frontmatter, nomes e testes de inventario/paridade alinhados.

`references/**` contem dados de roteamento, checklists, gates e variantes. Alteracoes aqui podem afetar classificacao e fluxo, mesmo quando nao tocam TypeScript.

`.agents/skills/workflow-eval-gate/**` contem o contrato e o runner deterministico do Eval Gate local.

`evals/**` contem casos, README, outputs, telemetry e testes Python do Eval Gate. `evals/outputs/latest_output.md` e `evals/telemetry/**` sao evidencia operacional, nao fonte canonica de produto.

## Estado Local

O estado de execucao do pipeline fica em `.codex/pipeline/` e e ignorado pelo git. Nao use esse diretorio como fonte canonica de produto; use-o como evidencia operacional de uma execucao.

## Build Gerado

`dist/**` e saida de build. Nao edite manualmente. Se `src/**` mudar, rode build antes de decidir se `dist/**` precisa acompanhar.

## Riscos Tecnicos Frequentes

O principal risco e drift entre narrativa e runtime: docs ou README prometem mais do que hooks, skill, dispatcher ou testes garantem.

Outro risco e confundir emulacao de testes com execucao real de agentes. A linha pratica e simples: `/pipeline-orchestrator-for-codex:pipeline` com contrato de agentes reais precisa de `spawn_agent`; sem isso, deve bloquear de forma honesta.

No Eval Gate, o risco especifico e tratar hook descrito como hook ativo. So declare execucao automatica quando `/hooks` provar que `.codex/hooks.json` foi confiado. Sem essa prova, rode telemetry e eval manualmente.
