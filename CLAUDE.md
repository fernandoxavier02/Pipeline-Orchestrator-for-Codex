# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Local SSOT for the Codex plugin `pipeline-orchestrator-for-codex`. The plugin exposes `/pipeline-orchestrator-for-codex:pipeline`, which classifies a request, confirms a proposal with the user, then executes in 4 phases (Classification → Proposal → Execution → Validation) with gates, TDD, adversarial review, and Go/No-Go validation.

The target consumers are **OpenAI Codex CLI** and **Kimi Code CLI** (port lives under `.kimi/`). This is *not* a Claude Code plugin — but Claude Code is used to develop/maintain it.

## Authority and where to read first

This file is a Claude-Code-specific shim. The real authority for working in this repo lives in:

1. `AGENTS.md` — identity, ordem de autoridade, regras de trabalho.
2. `.kiro/CONSTITUTION.md` — princípios permanentes (evidência > suposição, SSOT, runtime > docs).
3. `.kiro/steering/product.md` · `tech.md` · `structure.md` — produto, stack, mapa do repo.
4. `skills/pipeline/SKILL.md` — contrato operacional do skill público.
5. `commands/pipeline.md` — thin entrypoint (manter curto, encaminhar pro skill).
6. `references/openai-codex-kb/INDEX.md` — consultar antes de mexer em superfícies de Codex/OpenAI, skills, plugins, MCP, subagentes, hooks ou `AGENTS.md`.

Quando `docs/**` ou `README.md` divergirem do runtime, é drift. Corrija o lado certo, não esconda.

## Common commands

```bash
npm run lint:types   # tsc --noEmit (rápido, primeiro filtro)
npm run build        # tsc → dist/
npm test             # vitest run (suíte completa)
npm run test:watch   # vitest --watch
```

Para rodar um único teste no Windows (PowerShell ou bash):

```bash
npx vitest run tests/unit/controller/<arquivo>.test.ts
npx vitest run -t "<nome do teste ou describe>"
```

CLI runtime (após `npm run build`):

```bash
node dist/src/cli/pipeline-cli.js "<task>"
node dist/src/cli/pipeline-cli.js --mode=diagnostic "<task>"
node dist/src/cli/pipeline-cli.js --continue
```

**Windows / Vitest:** a suíte completa pode estourar memória/IPC localmente. Se isso acontecer, rode subconjuntos focados (`tests/unit/...`, `tests/integration/...`, `tests/bdd/...`) antes de tratar como regressão de código.

## Architecture (big picture)

**Plugin → Skill → Controller → Agentes.** O comando `/pipeline-orchestrator-for-codex:pipeline` é só um entrypoint. Quem orquestra é o controller TypeScript em `src/`, que dispara prompts em `agents/**` via `spawn_agent` do Codex.

### Runtime modes (contrato crítico)

- `strictAgents = true` (default operacional): `spawn_agent` é obrigatório. Sem ele, o runtime deve parar com `blocked-no-agent-runtime`. Nunca prometer "multi-agent real" se o adapter não existir.
- `strictAgents = false` (test harness/diagnóstico apenas): emulação local em TypeScript no mesmo processo Node, **zero isolamento de contexto** entre implementador e reviewer. Serve para validar o contrato de gates/protocol/confidence, não para execução real.

### Camadas em `src/`

- `controller/` — classificação, proposta, modos e pipeline controller.
- `execution/` — batches, pre-test, checkpoint, executor controller.
- `gates/` — information gate, micro gate, hardness, confidence model.
- `dispatcher/` — adapters de execução de papéis/agentes (`run-role`, `agent-runtime-loader`).
- `state/` — session store, checkpoint store, gate log, confidence score (stores atômicos, persistidos em `.codex/pipeline/`).
- `review/` — adversarial review e final adversarial orchestrator.
- `protocol/` — handlers de `GATE_REQUEST` / `DISPATCH_REQUEST` / `PLAN_MODE_REQUEST` (v5.2 protocol events).
- `security/` — guardas contra injeção e enforcement.
- `validation/` — validação final (Go/Conditional/No-Go).
- `cli/` — entrypoint Node + agent runtime loader.

### Biblioteca de prompts e variantes

- `agents/core/**` · `agents/executor/**` · `agents/quality/**` — 44 prompts versionados.
- `prompts/**` — bundle consumido pelo runtime.
- `references/pipelines/**` — variantes (`bugfix-light/heavy`, `feature-light/heavy`, `spec-light/heavy`, `audit-*`, etc.).
- `references/gates/**` · `references/checklists/**` — perguntas de gate e checklists adversariais por domínio.
- `references/complexity-matrix.md` — classificação e dureza.

### Skills publicáveis

`skills/` contém o skill `pipeline` (canônico) e variantes pré-classificadas (`bugfix*`, `feature*`, `spec*`, `audit*`, `brainstorm`, `review`, `verify-completion`, `validate-design`, `validate-gap`, `help`). O thin delegator pattern: a skill abre o visible plan, mostra o workflow/method gate, despacha `agents/core/pipeline-controller.md` como worker, processa os blocos de protocolo até `PIPELINE COMPLETE`.

### Hooks

`hooks/*.cjs` (CJS, **apenas Node builtins** — sem dependências de runtime) registrados em `hooks/hooks.json`. Cobrem `SessionStart`, `UserPromptSubmit`, `Stop`, dispatch guard, edit guard, session lock, sentinel checkpoints, completion checklist, cleanup. Schema deve seguir o do Codex.

## Working rules específicas deste repo

- **Nunca editar `dist/**` manualmente.** É saída de build. Se uma mudança em `src/**` exigir build, rode `npm run build` e avalie o diff de `dist/**` separadamente.
- **`.codex/pipeline/`** é estado de execução local, ignorado pelo git. Não tratar como fonte canônica de produto — só como evidência operacional de uma run.
- **`commands/pipeline.md` deve permanecer curto.** Comportamento detalhado mora no skill, no runtime TS, em hooks, prompts, agentes e referências adequadas.
- **Antes de trabalho não trivial**, emitir `ORCHESTRATOR_DECISION` (YAML) com tipo, severidade, persona, arquivos prováveis, fluxo, riscos — conforme regra global e `AGENTS.md`.
- **Mudança mínima, diff mínimo.** Preferir aditivo em schemas/dados.
- **Definition of Done** (de `.kiro/CONSTITUTION.md`): comportamento no ponto autoritativo correto + testes proporcionais (ou justificativa) + docs consistentes com runtime + sem churn fora de escopo.
- **Não confundir "publicado" com "presente em disco".** Para responder se o plugin está publicado/ativo/carregado pelo Codex, verificar git, marketplace/cache e caminho efetivo de resolução.
- **Integridade runtime/hook é política única.** Sentinel e ledgers não podem ter regras divergentes: `PIPELINE_SENTINEL_HMAC_KEY` tem precedência para sentinel; quando ausente, sentinel usa `PIPELINE_INTEGRITY_HMAC_KEY`, igual aos ledgers. Mantenha runtime, CLI, hooks CJS, writer e testes alinhados.

## Stack

Node >= 20 · TypeScript ESM (NodeNext) · Vitest · Zod (schemas) · `yaml` (config/confidence). Sem framework de runtime extra; o plugin funciona sem `npm install` para uso operacional (hooks só usam builtins) — `npm install` é só para desenvolvimento/testes.
