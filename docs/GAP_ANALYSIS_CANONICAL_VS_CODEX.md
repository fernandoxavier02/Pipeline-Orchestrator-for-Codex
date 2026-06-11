# Mapeamento de Gaps — Canônico (Claude) vs Codex

> **Data do mapeamento:** 2026-06-11
> **Versão do canônico analisada:** v7.12.0
> **Versão do Codex analisada:** v0.5.0 (alvo declarado de paridade: v5.2.0)
> **Gap de versões coberto:** v5.2 → v7.12 (~2 major versions)
> **Repositório canônico:** `D:\Pipeline Orchestrator Claude\Pipeline-Orchestrator`
> **Repositório Codex:** `D:\Pipeline Orchestrator for Codex`

---

## 1. Sumário Executivo

O repo do Codex está **duas versões maiores atrás** do canônico. O alvo declarado de paridade (v5.2.0) foi superado pelo canônico em treze releases menores (v6.0.0 → v7.12.0), cada um trazendo gates mais fortes, telemetria, modo paralelo, Plan Mode, dois novos tipos de tarefa (user-story, ux-sim), Paperclip avançado e camada de disciplina de implementação.

A base do Codex é sólida — 47 agentes, 27 skills, runtime TypeScript de ~13.830 linhas, 139 testes — e tem **extensões exclusivas** que o canônico não possui (base de conhecimento OpenAI/Codex, port Kimi, Eval Gate com hooks Python). Portanto, portar não é refundação: é complemento em cima de chão firme.

**Números lado a lado:**

| Métrica | Canônico v7.12 | Codex v0.5 | Delta |
|---|---|---|---|
| Skills públicos | 29 | 27 | -2 (user-story, ux-sim, measure-fidelity) |
| Comandos | 12 | 13 | +1 (help) |
| Agentes | ~40 | 47 | +7 (mas falta `step-01b-alternatives`) |
| Gates registradas | 35 (23 mandatory) | ~25 | -10 |
| Hardness levels | 5 | 4 | -1 (AUDIT) |
| Runtime modules | 17 CJS (`lib/`) | 84 TS (`src/`) | modelos diferentes |
| Hooks JS | 12 + 2 espelho | 10 + 3 Python | modelos diferentes |
| Testes | ~90+ | 139 | +49 |
| Regression versions | 17 (v6.0→v7.12) | 0 | -17 |
| Kiro specs | 4 | 4 | = |
| Paperclip flow-mirror lib | 16 módulos + tests | parcial | gap |
| Paperclip provisioner | 47 cargos + 11 skills | — | gap |

---

## 2. Metodologia

O mapeamento foi feito por varredura exaustiva em paralelo dos dois repositórios, lendo arquivos-índice (`CLAUDE.md`, `AGENTS.md`, `README.md`, `CHANGELOG.md`, `PROJECT_CONTEXT.md`, `CONSTITUTION.md`, `product.md`, `tech.md`, `structure.md`, `INDEX.md` de KBs) e confirmando com Glob/Grep a presença real de cada artefato.

A comparação foi feita **feature por feature**, não arquivo por arquivo — porque os repos têm estruturas diferentes (CJS em `lib/` vs TS em `src/`) e o que importa é o comportamento observável, não o caminho do módulo.

Cada gap recebeu uma classificação de esforço (Pequeno / Médio / Alto) e risco (Baixo / Médio / Alto) baseados em:
- **Esforço:** quantidade de arquivos a criar/editar + complexidade de tradução CJS→TS.
- **Risco:** probabilidade de a mudança quebrar comportamento existente ou exigir refatoração em cascata.

---

## 3. Gaps — Grupo 1: Novos Tipos de Tarefa e Skills

**Perfil:** porta de entrada natural, baixo risco, dependência zero com o core. Entrega valor visível pro usuário final rápido.

### 3.1 Skill `user-story` (thin entry + light/heavy)

**O que é:** atalho pra tarefa tipo "história de usuário". Pré-classifica `task_type=User Story` e roteia entre variantes light (10 steps, até 5 arquivos) e heavy (10 steps, 6+ arquivos).

**Estado no canônico:** presente desde v7.12.0 (skill-dispatch wiring). Variantes `user-story-light` e `user-story-heavy` em `references/pipelines/`.

**Estado no Codex:** pipeline variant existe (`references/pipelines/user-story-{light,heavy}.md`), mas **não há skill pública** nem wiring no controller pra despachar por skill.

**Pra portar:**
- Criar `skills/user-story/SKILL.md` + `skills/user-story-light/SKILL.md` + `skills/user-story-heavy/SKILL.md`.
- Wire `task_type=User Story` no `pipeline-controller.ts` (rota por skill em vez de task_type direto).
- Adicionar commands `user-story.md` (opcional).

**Tamanho:** Médio. **Risco:** Baixo. **Dependência:** skill-dispatch wiring (3.4).

### 3.2 Skill `ux-sim` (thin entry + light/heavy)

**O que é:** atalho pra simulação de experiência do usuário. Pré-classifica `task_type=UX Simulation`, roteia light (5 steps, 2-3 jornadas) / heavy (7 steps, 5+ jornadas cross-device). É **report-only** (não muda código).

**Estado no canônico:** presente desde v7.12.0.

**Estado no Codex:** pipeline variants existem (`ux-sim-{light,heavy}.md`), agentes também (`ux-simulator`, `ux-accessibility-auditor`, `ux-qa-validator`). Falta a skill pública e o wiring.

**Pra portar:** mesmo padrão do 3.1.

**Tamanho:** Médio. **Risco:** Baixo. **Dependência:** skill-dispatch wiring (3.4).

### 3.3 Skill `measure-paperclip-fidelity`

**O que é:** skill utilitária que avalia fidelidade de uma execução no Paperclip versus o contrato do pipeline. Consome a flow-mirror lib.

**Estado no canônico:** presente.

**Estado no Codex:** **não existe**. A flow-mirror lib existe parcialmente em `references/paperclip/spec/lib/`, mas a skill que a empacota pro usuário não.

**Tamanho:** Pequeno. **Risco:** Baixo. **Dependência:** flow-mirror lib completa (8.1).

### 3.4 Skill-dispatch wiring (v7.12)

**O que é:** mudança no controller pra despachar por **skill** em vez de `task_type` direto. É a feature que habilita os atalhos 3.1 e 3.2.

**Estado no canônico:** introduzida em v7.12.0.

**Estado no Codex:** controller ainda roteia por `task_type`. Mudança conceitual pequena mas estrutural — toca `src/controller/pipeline-controller.ts` e testes de classificação.

**Tamanho:** Médio. **Risco:** Médio (muda contrato interno). **Dependência:** nenhuma. **Recomendação:** fazer primeiro dentro do Grupo 1, pois destrava os atalhos.

### 3.5 Agente `step-01b-alternatives` (brainstorm)

**O que é:** terceiro agente do brainstorm, explora alternativas depois da fase de exploração inicial.

**Estado no canônico:** presente em `agents/brainstorm/step-01b-alternatives.md`.

**Estado no Codex:** brainstorm tem só `step-00-intake` e `step-01-explore`. Falta o 01b.

**Tamanho:** Pequeno. **Risco:** Baixo. **Dependência:** none.

---

## 4. Gaps — Grupo 2: Fortalecimento do Core

**Perfil:** maior impacto na robustez. Esforço médio-alto. É onde o canônico realmente se distanciou.

### 4.1 Registry de 35 gates (vs ~25 atuais)

**O que é:** o canônico consolidou 35 gates no `references/gates.md` como SSOT, sendo 23 mandatory (nunca bypassadas, nem por `--hotfix`/`--force`). O Codex tem ~25 gates em `src/gates/gate-registry.ts`.

**Estado no canônico:** SSOT em `references/gates.md` + `plan-mode-mandatory-agents.json`.

**Estado no Codex:** `src/gates/gate-registry.ts` + `references/gates.md` (precisa conferir se o registry bate com o MD).

**Pra portar:**
- Revisar `references/gates.md` do Codex e alinhar com o canônico.
- Adicionar gates faltantes em `src/gates/gate-registry.ts`.
- Garantir que mandatory gates não têm caminho de bypass.

**Tamanho:** Médio. **Risco:** Médio (muda o que é bloqueado). **Dependência:** none.

### 4.2 Hardness taxonomy de 5 níveis

**O que é:** classificação de dureza das gates. Canônico tem 5: MANDATORY, HARD, CIRCUIT_BREAKER, SOFT, AUDIT. Codex tem 4 (falta AUDIT, que é telemetria informativa e nunca bloqueia).

**Tamanho:** Pequeno. **Risco:** Baixo. **Dependência:** none.

### 4.3 Plan Mode generalizado pra 10 agentes (v7.10)

**O que é:** 10 agentes específicos (7 de pesquisa + 2 implementadores + plan-architect) são obrigados a operar em "modo plano" — pedem autorização antes de agir, via protocolo `PLAN_MODE_REQUEST` → `PLAN_MODE_RESULTS`. O dispatch-guard aplica o bypass (`PLAN_MODE_BYPASS`).

**Estado no canônico:** `references/plan-mode-mandatory-agents.json` (roster machine-readable) + enforcement no `dispatch-guard.cjs`.

**Estado no Codex:** já existe `src/protocol/plan-mode-bypass.ts` e o protocolo `PLAN_MODE_REQUEST`, mas **o roster de 10 agentes obrigatórios e o enforcement no hook não estão completos**.

**Tamanho:** Alto. **Risco:** Alto (muda fluxo de agentes). **Dependência:** dispatch-guard (já existe), protocol (já existe).

### 4.4 Parallel dispatch de lotes MÉDIA (v7.10)

**O que é:** lotes classificados como MÉDIA com flag `parallel_eligible: true` podem ser executados em paralelo, desde que os escopos de arquivo não se sobreponham (file-scope disjointness check).

**Estado no canônico:** `parallel_eligible` default contract (v7.10.1) + checkpoint com `per_task_status` condicional.

**Estado no Codex:** `src/dispatcher/parallel-emulation-runner.ts` existe, mas é pra emulação. O dispatch paralelo real com disjointness check não.

**Tamanho:** Alto. **Risco:** Alto (concorrência real). **Dependência:** executor-controller, checkpoint-validator. **Nota Codex-specific:** exige verificação de como o Codex lida com `spawn_agent` paralelo — consultar `references/openai-codex-kb/agents-and-subagents.md`.

### 4.5 CHANGE_CONTRACT + SCOPE LOCK CHECK (v6.3)

**O que é:**
- **CHANGE_CONTRACT** é um bloco inline gerado pelo plan-architect que lista arquivos permitidos/proibidos, orçamento de diff, e bootstrap.
- **SCOPE LOCK CHECK** é um gate de 5 checks aplicado antes de cada Write/Edit via hook, garantindo que a mudança está dentro do contrato.

**Estado no canônico:** enforcement no `scope-lock-hook.cjs` + integração com plan-architect.

**Estado no Codex:** `edit-guard-hook.cjs` existe (requer exec-window OPEN), mas **não há scope-lock específico nem CHANGE_CONTRACT inline**.

**Tamanho:** Alto. **Risco:** Alto (toca todo write path). **Dependência:** plan-architect, hook registration.

### 4.6 Visible Progress Protocol (v7.11)

**O que é:** lista de checkboxes por fase/batch exibida no terminal do Codex via `TaskCreate`/`TaskUpdate`, dando progresso visível pro usuário.

**Estado no canônico:** introduzido em v7.11.0.

**Estado no Codex:** **não existe como protocolo**. O Codex tem seu próprio sistema de plano visível (`update_plan`), mas não o protocolo canônico.

**Tamanho:** Pequeno. **Risco:** Baixo. **Dependência:** none. **Nota Codex-specific:** traduzir pras primitivas do Codex (`update_plan`, `TaskCreate`).

### 4.7 HMAC-signed sentinel state

**O que é:** o estado sentinela (`sentinel-state.json`) é assinado com HMAC pra evitar adulteração por agentes ou hooks.

**Estado no canônico:** `lib/sentinel-state-signer.cjs`.

**Estado no Codex:** `src/sentinel/sentinel-state.ts` existe, mas **sem assinatura**.

**Tamanho:** Médio. **Risco:** Médio. **Dependência:** none.

### 4.8 Diff discipline reviewer (v6.3)

**O que é:** revisor dedicado a validar escopo, mudança mínima e bypass de SSOT. Tem loop de fix independente (max 5 tentativas).

**Estado no canônico:** agente `diff-discipline-reviewer` + integração com architecture-reviewer (5 novos checks).

**Estado no Codex:** agente existe (`agents/quality/diff-discipline-reviewer.md`). **Verificar** se os 5 checks adicionais e o loop independente estão implementados.

**Tamanho:** Médio. **Risco:** Baixo. **Dependência:** none.

---

## 5. Gaps — Grupo 3: Observabilidade e Telemetria

**Perfil:** valor operacional — te deixa enxergar o que acontece dentro do pipeline. Baixo risco de quebrar comportamento.

### 5.1 Langfuse Cloud integration (v7.3+)

**O que é:** tracing de execuções enviado pro Langfuse Cloud (opt-in via variáveis de ambiente). Inclui cliente, carriers de trace/span keyed por `PIPELINE_RUN_ID`, sanitização de dados, e escopo configurável (`PIPELINE_TRACING_SCOPE`: agent-only / agent-plus-skill / full).

**Estado no canônico:** 3 módulos em `lib/` (`langfuse-client`, `langfuse-carrier`, `langfuse-sanitizer`) + hook `langfuse-hook.cjs` em PreToolUse + PostToolUse + espelho em `.codex/hooks/`.

**Estado no Codex:** **não existe**. O Codex tem execution-identity tracing interno (`src/observability/execution-identity.ts`), mas nada externo.

**Tamanho:** Alto. **Risco:** Baixo (é aditivo, opt-in). **Dependência:** RunDirectory.allocate (5.2) pro `PIPELINE_RUN_ID`. **Nota Codex-specific:** dependência npm `langfuse` — avaliar bundle ou install.

### 5.2 RunDirectory.allocate (v7.5)

**O que é:** alocação de run directory à prova de corrida, com mkdir exclusivo e uniqueId collision-resistant. Formato do runId: `${ordinal}-${uniqueId}-${slug}`.

**Estado no canônico:** `lib/run-directory.cjs` + testes de race condition.

**Estado no Codex:** `src/run/run-directory.ts` existe. **Verificar** se tem o exclusive mkdir e o collision-resistant uniqueId.

**Tamanho:** Médio. **Risco:** Médio. **Dependência:** none.

### 5.3 Fidelity reporter (v7.6)

**O que é:** gera relatórios de fidelidade de execução, validando vocabulário de hardness/decision contra o canônico.

**Estado no canônico:** `lib/fidelity-reporter.cjs` + testes.

**Estado no Codex:** **não existe**.

**Tamanho:** Médio. **Risco:** Baixo. **Dependência:** gate-decision-writer (5.6).

### 5.4 Run-log aggregator com dedup (v7.9.3)

**O que é:** função `appendRunLog` + `shouldAppendRunLogEntry` que deduplica entradas baseado em 8 campos materiais, evitando log duplicado no stop-hook.

**Estado no canônico:** `lib/run-log.cjs`.

**Estado no Codex:** **não existe como módulo**. Pode haver lógica similar espalhada.

**Tamanho:** Médio. **Risco:** Baixo. **Dependência:** none.

### 5.5 User Score Collection (v7.6)

**O que é:** coleta scores do usuário por run, persistidos via `score-writer`.

**Estado no canônico:** `lib/score-writer.cjs`.

**Estado no Codex:** **não existe**.

**Tamanho:** Pequeno. **Risco:** Baixo. **Dependência:** none.

### 5.6 Gate-decision-writer SSOT (v7.1)

**O que é:** escritor SSOT de `gate-decisions.jsonl` com vocabulário canônico de 8 valores (BLOCKED, DISPATCHED, SKIPPED, APPROVED, CONFIRMED, REJECTED, TRIGGERED, NOT_TRIGGERED) + auto-correlação de campos.

**Estado no canônico:** `lib/gate-decision-writer.cjs` + `lib/jsonl-sanitizer.cjs` (ALLOWED_GATE_DECISION_KEYS).

**Estado no Codex:** `src/state/gate-log.ts` existe. **Verificar** se o vocabulário de 8 valores bate e se tem auto-correlação.

**Tamanho:** Médio. **Risco:** Médio (muda contrato de persistência). **Dependência:** none.

### 5.7 Execution identity tracing

**O que é:** trace_id + event_id + plugin metadata em cada execução.

**Estado no Codex:** **já existe** em `src/observability/execution-identity.ts`. Listado aqui pra completar o painel — não é gap, é feature madura.

### 5.8 Telemetry correlation (v7.11) + Discovery pointer (v7.11)

**O que é:**
- **Correlation:** telemetria com campos pra correlacionar eventos entre componentes.
- **Discovery pointer:** variável `PIPELINE_DOC_PATH` apontando pro doc de referência da run.

**Estado no canônico:** introduzido em v7.11.0.

**Estado no Codex:** **não existe**.

**Tamanho:** Médio (os dois juntos). **Risco:** Baixo. **Dependência:** RunDirectory.allocate (5.2).

---

## 6. Gaps — Grupo 4: Paperclip Avançado

**Perfil:** totalmente independente do core. Só vale a pena se você usa Paperclip de verdade.

### 6.1 Flow-mirror completo (v7.9)

**O que é:** 14 fluxos do pipeline espelhados como árvore de issues do Paperclip (audit, bugfix, feature, spec, user-story, ux, adversarial, hotfix, etc.), com biblioteca JS (`references/paperclip/spec/lib/`) de 16 módulos pareados com testes (`tree-template`, `tree-factory`, `tree-factory-io`, `grow-tree`, `classify-bridge`, `paperclip-execution-state`, `mirror-fidelity-*`).

**Estado no canônico:** completo, com scripts de instalação (`install-junctions.bat`) e provisionamento.

**Estado no Codex:** **parcial**. `references/paperclip/` tem 16 arquivos raiz + 11 skills reference + 1 spec/lib + 1 script, mas precisa conferir se a flow-mirror lib está completa com todos os módulos e testes pareados.

**Tamanho:** Alto. **Risco:** Baixo (independente). **Dependência:** none.

### 6.2 Company provisioner (v7.8)

**O que é:** script `provision-pipeline-company.cjs` que provisiona empresa Paperclip com 47 cargos + 11 skills custom.

**Estado no canônico:** presente em `references/paperclip/scripts/`.

**Estado no Codex:** script existe (`references/paperclip/scripts/provision-pipeline-company.cjs`). **Verificar** se os 47 cargos e 11 skills estão completos.

**Tamanho:** Médio. **Risco:** Baixo. **Dependência:** flow-mirror lib (6.1).

### 6.3 Fidelity report idempotente no Stop (v7.9.3)

**O que é:** stop-hook gera fidelity report uma única vez por run, mesmo que o hook rode múltiplas vezes (idempotência).

**Estado no canônico:** `stop-hook.cjs` com fidelity-report idempotente + dedup + enriquecimento Langfuse.

**Estado no Codex:** `hooks/completion-checklist.cjs` e `hooks/session-cleanup-hook.cjs` existem no Stop, mas **não há fidelity report idempotente**.

**Tamanho:** Médio. **Risco:** Baixo. **Dependência:** fidelity-reporter (5.3).

---

## 7. Gaps — Grupo 5: Testes e Regression

**Perfil:** garante que features uma vez portadas não quebrem no futuro. Baixo risco, esforço variável.

### 7.1 Regression test versions (v6.0.0 → v7.12.0)

**O que é:** 17 versões de regression tests, cada uma pinando invariantes de uma versão específica do canônico. Total: ~40+ arquivos de teste.

**Estado no canônico:** `tests/regression/` organizado por versão (v6.0.0, v6.1.0, ..., v7.12.0).

**Estado no Codex:** **não há suite de regression por versão**. Testes existem, mas não pinam invariante por versão do canônico.

**Pra portar:** traduzir cada arquivo `.test.js` do canônico pra `.test.ts` no Codex, adaptando imports e runtime.

**Tamanho:** Alto (40+ arquivos). **Risco:** Baixo. **Dependência:** features correspondentes já portadas.

### 7.2 BDD features (.feature)

**O que é:** arquivos Cucumber/Gherkin (.feature) descrevendo comportamentos em linguagem natural.

**Estado no canônico:** presentes em `tests/regression/v7.2.0/` e seguintes.

**Estado no Codex:** tem `tests/bdd/` com 8 arquivos, mas o formato pode não bater com o canônico.

**Tamanho:** Médio. **Risco:** Baixo. **Dependência:** none.

### 7.3 Compat fixtures

**O que é:** cenários fixture pra validar compatibilidade com versões antigas (audit, bugfix, feature, hotfix, spec, ux).

**Estado no canônico:** `tests/compat/` com runner.cjs + 6 fixture scenarios.

**Estado no Codex:** **não existe** `tests/compat/`.

**Tamanho:** Pequeno. **Risco:** Baixo. **Dependência:** none.

---

## 8. Gaps — Grupo 6: Documentação e Kiro Specs

### 8.1 Guias de migração

**O que é:** docs `MIGRATION-v3-to-v4.md`, `MIGRATION-v4-to-v5.md`, `migration-v5.0-to-v5.1.md`.

**Estado no Codex:** **não existem**.

**Pra portar:** adaptar pro contexto Codex (a migração do canônico não se aplica 1:1).

**Tamanho:** Médio. **Risco:** Baixo. **Dependência:** none.

### 8.2 Diagramas HTML interativos

**O que é:** 5 diagramas HTML em `docs/diagrams/` (pipeline-overview, gate-hierarchy, audit-history, achado-7-protocol, index).

**Estado no Codex:** **não existem**.

**Tamanho:** Médio. **Risco:** Baixo. **Dependência:** none.

### 8.3 Exemplos canônicos

**O que é:** 4 exemplos em `docs/examples/` (simple-bugfix, medium-feature, complex-audit, brainstorm-feature).

**Estado no Codex:** **não existem** como pasta estruturada.

**Tamanho:** Pequeno. **Risco:** Baixo. **Dependência:** none.

### 8.4 Kiro spec `paperclip-task-tree-factory`

**O que é:** spec com 13 flow docs (tronco, modos, comandos, fidelidade, VPS operação, DECISOES-FLUXOS, audit/bugfix/feature/spec/user-story/ux).

**Estado no Codex:** specs diferentes (`codex-harness-claude-absorption`, `codex-v5.2-parity`, `pipeline-meta-ifrs16-modalities-audit`, `pipeline-trust-restoration`). **Não há** paperclip-task-tree-factory.

**Tamanho:** Alto. **Risco:** Baixo. **Dependência:** flow-mirror lib (6.1).

---

## 9. Extensões Exclusivas do Codex (não são gaps)

O Codex tem features que o canônico **não** tem — são extensões legítimas do port. Listar aqui pra não dar a impressão errada de que é só buraco:

| Extensão | Descrição |
|---|---|
| `openai-codex-kb/` (13 artigos) | Base de conhecimento local sobre Codex/OpenAI. |
| Skills `codex-kb-lookup`, `codex-kb-drift-check`, `codex-kb-refresh` | Operam a KB acima. |
| Comando `help.md` | Lista formas de execução e recomenda fluxo. |
| Port `.kimi/` | Kimi CLI port com skills/agents/references próprios. |
| Eval Gate (hooks Python) | `pre_tool_use_policy.py`, `post_tool_use_telemetry.py`, `stop_eval_gate.py` — camada local de avaliação. |
| 139 testes (vs ~90+ do canônico) | Suite mais numerosa. |
| Testes BDD (8 arquivos) | Com formato próprio. |
| Reports de auditoria específicos | `AUDIT_CODEX_VS_CANONICAL.md`, `CODEX_HARNESS_ADEQUACY_REPORT.md`, `CONSOLIDATED_ADVERSARIAL_REVIEW.md`, `ARCHITECTURE_REVIEW_ROUND2.md`. |

---

## 10. Matriz de Dependências

Features que dependem de outras features pra serem portadas com segurança:

| Feature | Depende de |
|---|---|
| 3.1 user-story skill | 3.4 skill-dispatch wiring |
| 3.2 ux-sim skill | 3.4 skill-dispatch wiring |
| 3.3 measure-paperclip-fidelity | 6.1 flow-mirror lib completa |
| 5.1 Langfuse integration | 5.2 RunDirectory.allocate |
| 5.3 Fidelity reporter | 5.6 Gate-decision-writer SSOT |
| 5.8 Telemetry correlation + discovery pointer | 5.2 RunDirectory.allocate |
| 6.2 Company provisioner | 6.1 Flow-mirror lib |
| 6.3 Fidelity report idempotente no Stop | 5.3 Fidelity reporter |
| 7.1 Regression test versions | features correspondentes já portadas |
| 8.4 Kiro spec paperclip-task-tree-factory | 6.1 Flow-mirror lib |

**Features independentes** (podem ser portadas em qualquer ordem):
3.4, 3.5, 4.1, 4.2, 4.6, 4.7, 5.4, 5.5, 5.6, 6.1 (raiz), 7.2, 7.3, 8.1, 8.2, 8.3.

---

## 11. Ordem de Port Sugerida

Organizada em 6 ondas, cada uma entregando valor por si só e preparando o terreno pra próxima.

### Onda 1 — Fundação (1-2 semanas)
**Objetivo:** fortalecer o core sem adicionar features novas.

1. **4.2** Hardness taxonomy de 5 níveis (Pequeno)
2. **4.1** Registry de 35 gates (Médio)
3. **5.6** Gate-decision-writer SSOT (Médio)
4. **3.4** Skill-dispatch wiring (Médio)

**Entrega:** gates mais fortes + preparação pra novos tipos de tarefa.

### Onda 2 — Novos tipos de tarefa (1 semana)
**Objetivo:** entregar valor visível pro usuário final.

1. **3.1** Skill `user-story` (Médio)
2. **3.2** Skill `ux-sim` (Médio)
3. **3.5** Agente `step-01b-alternatives` (Pequeno)

**Entrega:** 2 novos atalhos + brainstorm mais rico.

### Onda 3 — Disciplina de implementação (2-3 semanas)
**Objetivo:** camada de proteção contra scope creep.

1. **4.7** HMAC-signed sentinel state (Médio)
2. **4.8** Diff discipline reviewer (Médio)
3. **4.5** CHANGE_CONTRACT + SCOPE LOCK (Alto)
4. **4.6** Visible Progress Protocol (Pequeno)

**Entrega:** mudanças mais seguras, progresso visível.

### Onda 4 — Modo plano e paralelo (2-3 semanas)
**Objetivo:** maturar execução.

1. **5.2** RunDirectory.allocate (Médio)
2. **4.3** Plan Mode generalizado pra 10 agentes (Alto)
3. **4.4** Parallel dispatch de lotes MÉDIA (Alto)

**Entrega:** agentes mais controlados, execução mais rápida.

### Onda 5 — Observabilidade (2-3 semanas)
**Objetivo:** enxergar o que acontece.

1. **5.4** Run-log aggregator com dedup (Médio)
2. **5.3** Fidelity reporter (Médio)
3. **5.5** User Score Collection (Pequeno)
4. **5.8** Telemetry correlation + discovery pointer (Médio)
5. **5.1** Langfuse Cloud integration (Alto)

**Entrega:** telemetria completa, opt-in pra nuvem.

### Onda 6 — Paperclip avançado + regressão (contínuo)
**Objetivo:** Paperclip maduro + garantia de não-regressão.

1. **6.1** Flow-mirror completo (Alto)
2. **6.2** Company provisioner (Médio)
3. **3.3** Measure-paperclip-fidelity (Pequeno)
4. **6.3** Fidelity report idempotente no Stop (Médio)
5. **7.3** Compat fixtures (Pequeno)
6. **7.2** BDD features (Médio)
7. **7.1** Regression test versions (Alto, contínuo)
8. **8.1–8.4** Documentação (Médio, paralelo)

**Entrega:** Paperclip completo, suite de regression pinando invariantes.

---

## 12. Riscos e Considerações de Adaptação

### 12.1 Tradução CJS → TypeScript

O canônico é JavaScript CommonJS em `lib/`; o Codex é TypeScript ESM (NodeNext) em `src/`. Cada módulo a portar exige:
- Reescrever em TS com tipos.
- Ajustar imports (ESM vs CJS).
- Integrar com o runtime TS existente (Zod schemas, DI-3 cascade).

**Não é copiar-e-colar.** É tradução conceito-a-conceito.

### 12.2 Diferenças de harness

O canônico roda no Claude Code; o Codex roda no Codex CLI (e Kimi CLI). Diferenças conhecidas:
- **Agente:** canônico usa `Agent` tool; Codex usa `spawn_agent`.
- **Plano visível:** canônico usa `TaskCreate`/`TaskUpdate`; Codex tem `update_plan`.
- **Hooks:** eventos pareados, mas schemas diferentes (validar contra `references/openai-codex-kb/rules-hooks-agents-md.md`).

Cada feature do Grupo 2 e 3 precisa consultar a KB local antes de portar.

### 12.3 Risco de regressão

O Codex tem 139 testes passando. Cada onda deve:
1. Rodar `npm run lint:types` + `npm test` antes e depois.
2. Adicionar testes pra feature nova antes de passar pra próxima onda.
3. Se a feature portada tiver regression test correspondente no canônico, portar o teste junto.

### 12.4 Risco de escopo

Cada onda é independente. Se uma onda estourar o orçamento de tempo, as seguintes podem ser adiadas sem prejuízo pro que já foi entregue. **Não tentar portar tudo de uma vez.**

### 12.5 SSOT e drift

O canônico continua evoluindo (v8.0.0 em preparação, segundo `RELEASE-v8.0.0-canonico-CHECKLIST.md`). Decidir uma política:
- **Opção A:** congelar o alvo na v7.12 e portar só o que está mapeado aqui.
- **Opção B:** subir o alvo pra v8.0 quando sair, e ampliar o mapeamento.

Recomendação: **Opção A** por ora, reavaliar depois da Onda 3.

---

## 13. Próximos Passos

1. **Revisar este relatório** e validar a classificação de esforços/dependências.
2. **Escolher a Onda 1** como ponto de partida (recomendado) OU começar por uma feature específica de outro grupo.
3. **Para cada feature da onda escolhida:** abrir uma spec Kiro em `.kiro/specs/` com requirements + tasks.
4. **Portar feature por feature**, com teste proporcional e PR separado.
5. **Ao final de cada onda:** rodar a suite completa, atualizar `PROJECT_CONTEXT.md` e `CHANGELOG.md`, e reavaliar o mapeamento.

---

## 14. Apêndice — Fontes Consultadas

### Canônico (`D:\Pipeline Orchestrator Claude\Pipeline-Orchestrator`)
- `CLAUDE.md`, `AGENTS.md`, `README.md`, `CHANGELOG.md` (240KB, v3.8.0 → v7.12.0)
- `context.md`, `NOTICE.md`, `LICENSE` (PolyForm Shield 1.0.0)
- `.kiro/CONSTITUTION.md`, `.kiro/steering/{product,tech,structure}.md`
- `skills/**/SKILL.md` (29 skills)
- `commands/*.md` (12 comandos)
- `agents/{core,executor,quality,brainstorm}/**/*.md` (~40 agentes)
- `references/{gates,checklists,pipelines,paperclip,spec-templates,trace-schema}/**`
- `lib/*.cjs` (17 módulos runtime)
- `hooks/hooks.json` + `.claude/hooks/*.cjs` (12 hooks)
- `tests/{unit,integration,regression,snapshot,compat,contracts,fixtures}/**` (~90+ arquivos)
- `docs/{audits,diagrams,examples,plans,superpowers,migrations}/**`
- `RELEASE-v8.0.0-canonico-CHECKLIST.md` (na raiz do workspace externo)

### Codex (`D:\Pipeline Orchestrator for Codex`)
- `CLAUDE.md`, `AGENTS.md`, `README.md`, `CHANGELOG.md`, `PROJECT_CONTEXT.md`
- `AUDIT_CODEX_VS_CANONICAL.md`, `CODEX_HARNESS_ADEQUACY_REPORT.md`, `CONSOLIDATED_ADVERSARIAL_REVIEW.md`, `ARCHITECTURE_REVIEW_ROUND2.md`
- `.kiro/CONSTITUTION.md`, `.kiro/PATTERNS.md`, `.kiro/steering/{product,tech,structure}.md`, `.kiro/specs/**`
- `skills/**/SKILL.md` (27 skills)
- `commands/*.md` (13 comandos)
- `agents/{brainstorm,core,executor,executor/type-specific,quality}/**/*.md` (47 agentes)
- `prompts/{agents,controller}/**/*.md` (25 prompts)
- `references/{checklists,gates,openai-codex-kb,paperclip,pipelines,trace-schema}/**`
- `src/**` (84 arquivos TS, ~13.830 linhas, 27 subpastas)
- `hooks/*.cjs` (10 hooks) + `.codex/hooks/*.py` (3 hooks Python)
- `tests/{unit,integration,bdd}/**/*.test.ts` + `evals/tests/*.py` (139 arquivos)
- `docs/{pipeline-orchestrator-codex,audits,superpowers}/**`
- `evals/**` (Eval Gate local)
- `.kimi/**` (port Kimi CLI)

---

**Fim do relatório.**
