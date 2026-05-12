# AUDIT: Pipeline Orchestrator for Codex vs. Fonte Canônica (Claude Code)

> Data: 2026-05-11
> Auditor: Kimi Code CLI
> Fonte Canônica: `D:\Pipeline Orchestrator Claude\Pipeline-Orchestrator` (v5.2.0)
> Port Avaliado: `D:\Pipeline Orchestrator for Codex` (v0.4.1)
> Escopo: Identificação de gaps e desvios do port em relação à fonte canônica

---

## 1. EXECUTIVE SUMMARY

O **Pipeline Orchestrator for Codex** é uma **reimplementação arquitetural significativa** da fonte canônica. Em vez de um prompt monolítico (`commands/pipeline.md` com 1.161 linhas) que orquestra **agentes reais** via `Agent` tool nativa do Claude Code, o port construiu um **runtime TypeScript completo** (`src/` com ~1900 linhas no controller, ~1250 no executor) com state machine, dispatcher, gate registry, confidence model e protocol handler.

**Veredito geral:**
- ✅ **Paridade de inventário:** Skills (25 vs 23), agentes (44 vs 44), steps prescriptivos (~80 em ambos)
- ✅ **Evoluções legítimas:** Spec lifecycle completo, hook observability, governed workflows
- 🔴 **Gaps críticos na orquestração:** Controller N1 truncado, emulação local como padrão, hoisting incompleto
- 🟡 **Gaps de funcionalidade:** STEP 1.7, TDD interativo, sentinel real, phase transition summaries
- 🟡 **Gaps de segurança:** Edit guard ausente, exec-window scripts ausentes

---

## 2. CONTEXTO DOS RUNTIMES

### 2.1 Claude Code Runtime (Fonte Canônica)

| Aspecto | Comportamento |
|---------|--------------|
| **Agent Dispatch** | `Agent` tool nativa com `subagent_type` FQN. Subagentes rodam em context windows isolados. |
| **Subagent Tools** | **Stripadas:** `AskUserQuestion`, `Agent`, `EnterPlanMode` são removidas do manifesto de subagents (Achado #7). |
| **Solução Canônica** | **Protocolo emit-and-hoist:** subagent emite blocos YAML (`GATE_REQUEST`, `DISPATCH_REQUEST`, `PLAN_MODE_REQUEST`) → para → parent parseia → invoca tool nativa → re-despacha subagent com resposta prepended. |
| **Hooks** | 9 eventos: `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SubagentStop`, `SessionStart`, `SessionEnd`, `PreCompact`, `Notification`. Suportam `command` (shell, 60s) e `prompt` (LLM, 30s). |
| **Matcher** | Regex para filtrar ferramentas: `"Agent"`, `"Skill\|Agent"`, `"Edit\|Write\|..."` |
| **Plugin** | `.claude-plugin/plugin.json` ou diretório `.claude/` |
| **Plan Mode** | `EnterPlanMode` / `ExitPlanMode` nativos |

### 2.2 Codex Runtime (Port)

| Aspecto | Comportamento |
|---------|--------------|
| **Agent Dispatch** | `spawn_agent`, `send_input`, `resume_agent`, `wait_agent`, `close_agent`. Agents definidos em `~/.codex/config.toml` com `[agents.<name>]` ou via plugin. |
| **Subagent Tools** | Subagentes têm acesso a ferramentas conforme configuração do agente. Não há stripping documentado de `AskUserQuestion` ou `spawn_agent`. |
| **Hooks** | `features.codex_hooks = true`. Hooks via `hooks.json` ou inline `[hooks]` em config.toml. Eventos: `SessionStart`, `UserPromptSubmit`, `Stop`, `PreToolUse`. |
| **Plugin** | `.codex-plugin/plugin.json` com `skills`, `hooks`, `interface` objects |
| **Plan Mode** | Sem `EnterPlanMode` nativo. Usa `update_plan` UI ou PLAN_MODE_REQUEST blocks |

### 2.3 Implicações para o Port

A fonte canônica **não precisa** do protocolo emit-and-hoist no Codex, porque o Codex não stripa `spawn_agent` de subagents. No entanto, o port **não implementou** a orquestração multi-agent real como padrão — em vez disso, emula tudo localmente. Isso é uma **escolha de arquitetura**, não uma limitação do runtime.

---

## 3. GAPS CRÍTICOS (🔴)

### GAP-1: Controller N1 Truncado — `pipeline-controller`

| | Fonte Canônica | Port Codex |
|---|---|---|
| **Arquivo** | `agents/core/pipeline-controller.md` (1.470 linhas) | `agents/core/pipeline-controller.md` (35 linhas) |
| **Arquitetura** | Prompt monolítico N1 com 4 fases, 37 dispatches, Achado #7 protocol | Prompt mínimo que delega para skill `pipeline` |
| **Skill** | `skills/pipeline/SKILL.md` (55 linhas, thin delegator) | `skills/pipeline/SKILL.md` (449 linhas, orquestração inline) |
| **Runtime** | `commands/pipeline.md` (1.161 linhas, controller v3.8 inline) | `src/controller/pipeline-controller.ts` (1.869 linhas, TypeScript state machine) |

**Problema:** A fonte canônica coloca a **inteligência de orquestração no prompt do agente N1** (pipeline-controller), que é um agente real com contexto isolado. O port **quebrou essa arquitetura**: o `pipeline-controller.md` foi reduzido a 35 linhas, e a orquestração foi movida para código TypeScript no processo principal.

**Impacto:**
- O "controller" no Codex não é um agente real — é uma state machine TypeScript.
- A decisão de qual agente despachar, quando, e com qual contexto, é codificada em TypeScript, não em um prompt de agente.
- Isso elimina a flexibilidade e a capacidade de reasoning do orquestrador.

**Recomendação:** Restaurar o `pipeline-controller.md` com conteúdo completo (ou adaptado para `spawn_agent`) e usar o runtime TypeScript como **adapter/harness**, não como orquestrador principal.

---

### GAP-2: Brainstorm Controller Truncado — STEP 1.7 Ausente

| | Fonte Canônica | Port Codex |
|---|---|---|
| **Arquivo** | `agents/core/brainstorm-controller.md` (232 linhas) | Prompt reduzido |
| **Funcionalidade** | 9 steps sequenciais, resume protocol, GATE_REQUEST para explore, manifest transition | Não invocado pelo controller TypeScript |

**Problema:** A fonte canônica tem **STEP 1.7: PRE-EXECUTION ROUTING** obrigatório para MEDIA/COMPLEXA/Spec:
- Se não houver `PREP_RUN_ID`, dispara `brainstorm-controller` obrigatoriamente
- Recursão limitada a 2 entradas
- Classification consistency guard ao resumir

O port Codex **não implementa STEP 1.7** no `pipeline-controller.ts`.

**Impacto:** Trabalhos complexos no Codex pulam o brainstorm obrigatório, perdendo a fase de discovery e spec que a fonte canônica exige.

---

### GAP-3: Emulação Local como Padrão — "Agentes" Simulados

| | Fonte Canônica | Port Codex |
|---|---|---|
| **Padrão** | Agentes reais sempre (`Agent` tool) | Emulação local (`single-agent-runner.ts`) |
| **Independência** | Context windows isolados reais | `freshContextEmulated: true` (flag booleana) |
| **Revisores** | 3 reviewers paralelos em contextos isolados | `Promise.all()` com outputs sintéticos |

**Problema:** O port Codex implementou um **dual-mode dispatcher** em `src/dispatcher/run-role.ts`:
- Se `requireRealAgent=true` E `agentRuntime` injetado → chama `spawnAgent()` real
- Senão → `single-agent-runner.ts` retorna outputs sintéticos baseados em regex

O `skills/pipeline/SKILL.md` tem `<MANDATORY-SUBAGENT-RULE>` ("ALWAYS call spawn_agent"), mas o **runtime TypeScript padrão emula localmente**.

**Impacto:**
- A "independence" dos adversarial reviewers é **simulada**, não real.
- O `checkpoint-validator` retorna PASS/FAIL baseado em regra de 2/3 codificada, não em análise real.
- O `final-validator` retorna GO/NO-GO computado por heurística, não por reasoning de agente.
- Isso invalida a garantia fundamental do pipeline: **revisão adversarial com zero contexto de implementação**.

**Recomendação:** O padrão deve ser `requireRealAgent=true`. A emulação local deve ser usada **apenas para testes** (`single-agent-runner.ts` é um test harness, não runtime de produção).

---

### GAP-4: Sentinel Perdeu SPEC PIPELINE CHECKPOINTS

| | Fonte Canônica | Port Codex |
|---|---|---|
| **Sentinel** | 239 linhas, 5 SPEC PIPELINE CHECKPOINTS | 193 linhas, **checkpoints removidos** |
| **Modos** | ORCHESTRATOR_VALIDATION, SEQUENCE_VALIDATION, COHERENCE_VALIDATION | Apenas SEQUENCE_VALIDATION implícito |

**Problema:** O `sentinel.md` da fonte canônica valida:
1. `SPEC_DISCOVERY_CHECK`
2. `SPEC_FORMAT_PASSED`
3. `SPEC_CONTENT_REVIEW_DONE`
4. `LOOP_STATE_CONSISTENT`
5. `SPEC_GRADE_CALCULABLE`

O port Codex **removeu esses 5 checkpoints** do prompt do sentinel.

**Impacto:** Pipelines de spec no Codex não têm validação de sentinel para o ciclo de vida de specs.

---

### GAP-5: Edit Guard Ausente

| | Fonte Canônica | Port Codex |
|---|---|---|
| **Hook** | `.claude/hooks/edit-guard-hook.cjs` (ativo) | **AUSENTE** |
| **Proteção** | Bloqueia edits fora de `.pipeline/` sem exec-window | Nenhuma proteção em hook layer |
| **Exec-Window** | Scripts Node `open.cjs` / `close.cjs` | Middleware TypeScript (`edit-guard.ts`) sem hook |

**Problema:** O Codex não tem `edit-guard-hook.cjs`. O `hooks.json` não registra `PreToolUse:Edit|Write`.

**Impacto:** Durante uma pipeline run, o LLM pode editar arquivos do projeto fora de `.codex/pipeline/` sem autorização. Não há defesa em profundidade.

**Nota:** O port tem `src/security/edit-guard.ts` no dispatcher, mas isso só bloqueia dispatches via `runRole()`. Edições feitas diretamente pelo LLM principal (fora do dispatcher) não são protegidas.

---

## 4. GAPS MÉDIOS (🟡)

### GAP-6: Session Lock Sem Heartbeat Contínuo

| | Fonte Canônica | Port Codex |
|---|---|---|
| **Evento** | `UserPromptSubmit` (todo prompt) | `SessionStart` (apenas no startup) |
| **Heartbeat** | Atualiza `last_seen_at` + GC de locks stale (10min) | Não há GC contínuo |

**Impacto:** Locks stale de sessões anteriores não são limpos automaticamente durante a sessão.

---

### GAP-7: TDD Interativo por Cenário — Perdido

| | Fonte Canônica | Port Codex |
|---|---|---|
| **Quality Gate Router** | Apresenta **cada cenário** via `AskUserQuestion`, usuário aprova um por um | `planQualityGateBatches()` retorna batches localmente |
| **Pre-tester** | Opus escreve testes que **devem falhar** (RED phase) | `derivePreTesterExecutionProof()` gera proof algoritmico |

**Impacto:** O usuário no Codex não interage com cenários TDD. O proof é sintético, não baseado em testes reais escritos por um agente.

---

### GAP-8: Phase Transition Summaries Ausentes

**Problema:** A fonte canônica **exige** blocos `PHASE TRANSITION SUMMARY` antes de toda transição de fase. O port Codex não implementa essa emissão.

**Impacto:** Transições de fase são silenciosas no Codex, dificultando auditoria e debug.

---

### GAP-9: Delegação por Skills na Phase 2 — Ausente

**Problema:** A fonte canônica delega Phase 2 para skills quando o variant é:
- `bugfix-light` → `Skill(pipeline-orchestrator:bugfix-light)`
- `bugfix-heavy` → `Skill(pipeline-orchestrator:bugfix-heavy)`
- `spec-light/heavy/audit-only` → skills correspondentes

O port Codex chama `executionController.executeApprovedWork()` diretamente, independente do variant.

**Impacto:** Skills prescriptivos com steps detalhados não são utilizados na execução. O workflow inline do controller TypeScript substitui os workflows declarativos dos skills.

---

### GAP-10: Sentinel como Agente Real — Reduzido a Estado JSON

| | Fonte Canônica | Port Codex |
|---|---|---|
| **Sentinel** | Spawnado como `Agent(pipeline-orchestrator:core:sentinel)` com 3 modos | `saveSentinelState()` escreve JSON diretamente |
| **Validação** | ORCHESTRATOR_VALIDATION, COHERENCE_VALIDATION, SEQUENCE_VALIDATION | Apenas atualização de `expectedNext` array |

**Impacto:** O sentinel no Codex não realiza validação ativa — apenas mantém estado para o hook consumir.

---

### GAP-11: Skill Frontmatter Enforcement — Parcial

| | Fonte Canônica | Port Codex |
|---|---|---|
| **Parser** | `skill-frontmatter-parser.cjs` (módulo compartilhado) | Parser YAML inline duplicado em `dispatch-guard.cjs` |
| **Validação** | 3 hooks validam `sentinel_checkpoints`, `agent_type`, `gates_at` | `dispatch-guard.cjs` valida contra allow-lists hardcoded |
| **Sentinel** | Valida `sentinel_checkpoints` contra SKILL.md | Não implementado |

---

### GAP-12: Team Registry Não Consumido

**Problema:** `references/team-registry.md` existe no Codex, mas o runtime TypeScript não o consome. Agent teams são hardcoded no executor (`executor-implementer`, `executor-fix`, etc.).

---

## 5. GAPS BAIXOS / DIFERENÇAS ARQUITETURAIS JUSTIFICÁVEIS (🟢)

### GAP-13: Achado #7 Hoisting Loop — Não Aplicável

**Justificativa:** O Codex não stripa `spawn_agent` de subagents. O protocolo emit-and-hoist é uma solução para um problema que não existe no Codex. O port tem `protocol-handler.ts` e `protocol-events.ts`, mas o hoisting real não é necessário.

**Nota:** O que falta não é o hoisting em si, mas a **interatividade** que ele proporcionava: subagentes que param para receber input do usuário e continuam. Isso pode ser feito via `spawn_agent` + `send_input` no Codex, mas não foi implementado.

---

### GAP-14: Exec-Window Scripts → Middleware TypeScript

**Justificativa:** Arquitetura diferente mas funcionalmente equivalente. O port usa `exec-window.ts` + `exec-window-store.ts` + `edit-guard.ts` no dispatcher. A ausência dos scripts `.cjs` é uma escolha de implementação.

**Risco:** Sem o hook `edit-guard-hook.cjs`, o LLM principal pode burlar o dispatcher e editar diretamente.

---

### GAP-15: EnterPlanMode Nativo — Limitação do Host

**Justificativa:** O Codex não tem `EnterPlanMode` nativo como o Claude Code. O uso de `PLAN_MODE_REQUEST v1` como fallback é apropriado.

---

## 6. EXTENSÕES DO PORT (NÃO SÃO GAPS)

O port Codex introduziu funcionalidades que **não existem** na fonte canônica e são evoluções legítimas:

| Extensão | Descrição |
|----------|-----------|
| `hook-events.cjs` | Observabilidade estruturada com execution identity |
| `governed-workflows.cjs` | Lista canônica de 28 skills governadas |
| `visible-plan-contract.md` | Contrato para `update_plan` UI do Codex |
| `workflow-method-gate.md` | Gate de seleção de workflow antes do Phase 0 |
| `workflow-next-step.md` | Sistema `NEXT_STEP` block para encadeamento |
| Spec lifecycle completo | `spec-lifecycle.ts` com 5 gates de spec |
| `help` skill | Skill de ajuda/router |
| `brainstorm` skill | Skill separado para brainstorm |

---

## 7. ANÁLISE POR CAMADA

### 7.1 Camada de Orquestração (N0/N1)

| Componente | Fonte Canônica | Port Codex | Status |
|------------|---------------|------------|--------|
| pipeline-controller | 1.470 linhas, agente real N1 | 35 linhas, delegador | 🔴 |
| brainstorm-controller | 232 linhas, 9 steps | Prompt reduzido, não invocado | 🔴 |
| task-orchestrator | 367 linhas, classificação completa | Prompt reduzido | 🟡 |
| sentinel | 239 linhas, 5 checkpoints | 193 linhas, sem checkpoints | 🔴 |
| information-gate | 234 linhas | Prompt reduzido | 🟡 |
| design-interrogator | 252 linhas | Prompt reduzido | 🟡 |
| plan-architect | 186 linhas | Prompt reduzido | 🟡 |

**Conclusão:** A camada de orquestração N1 foi **severamente truncada** no port. Os controllers não são agentes reais com reasoning — são stubs que delegam para código TypeScript.

### 7.2 Camada de Execução (N2)

| Componente | Fonte Canônica | Port Codex | Status |
|------------|---------------|------------|--------|
| executor-controller | 352 linhas, DISPATCH_REQUEST adaptation | Prompt reduzido | 🟡 |
| executor-implementer | 248 linhas, 6 iron laws | Prompt reduzido | 🟡 |
| executor-fix | Completo | Prompt reduzido | 🟡 |
| checkpoint-validator | Completo | Prompt reduzido | 🟡 |
| review-orchestrator | Completo, zero-context real | Prompt reduzido, emulação | 🔴 |
| final-adversarial-orchestrator | Completo, 3 reviewers reais | Prompt reduzido, emulação | 🔴 |
| sanity-checker | Completo | Prompt reduzido | 🟡 |
| final-validator (Pa de Cal) | 178 linhas | Prompt reduzido | 🟡 |

**Conclusão:** A camada de execução existe em ambos, mas no Codex os agentes são **emulados localmente** com outputs sintéticos. A qualidade da execução depende de heurísticas codificadas, não de reasoning de agentes especializados.

### 7.3 Camada Folha (N3 — Type-specific)

| Componente | Fonte Canônica | Port Codex | Status |
|------------|---------------|------------|--------|
| bugfix-* agents | 3 agentes | 3 agentes | ✅ |
| feature-* agents | 3 agentes | 3 agentes | ✅ |
| audit-* agents | 4 agentes | 4 agentes | ✅ |
| ux-* agents | 3 agentes | 3 agentes | ✅ |
| adversarial-* agents | 4 agentes | 4 agentes | ✅ |
| spec-* agents | 4 agentes | 4 agentes | ✅ |

**Conclusão:** Paridade quantitativa. Os prompts podem estar reduzidos, mas os agentes existem.

### 7.4 Camada de Hooks

| Hook | Fonte Canônica | Port Codex | Status |
|------|---------------|------------|--------|
| sentinel-hook | Completo, skill enforcement | Portado, sem skill enforcement | 🟡 |
| dispatch-guard | Completo, step-level validation | Portado, sem step-level | 🟡 |
| force-pipeline-agents | Completo, gates_at enforcement | Portado, sem gates_at enforcement | 🟡 |
| edit-guard-hook | Completo | **AUSENTE** | 🔴 |
| session-lock-hook | Completo, heartbeat | Portado, sem heartbeat | 🟡 |
| session-cleanup-hook | Completo | Portado | ✅ |
| completion-checklist | Completo | Portado | ✅ |
| skill-frontmatter-parser | Completo | **AUSENTE** | 🟡 |
| hook-events | Não existe | **NOVO** | ✅ |
| governed-workflows | Não existe | **NOVO** | ✅ |

### 7.5 Camada de Estado

| Componente | Fonte Canônica | Port Codex | Status |
|------------|---------------|------------|--------|
| session.json | ✅ | ✅ | ✅ |
| gate-decisions.jsonl | ✅ | ✅ | ✅ |
| protocol-events.jsonl | ✅ | ✅ | ✅ |
| sentinel-state.json | ✅ (string expected_next) | ✅ (array expectedNext) | 🟡 |
| confidence-score.yaml | ✅ | ✅ | ✅ |
| checkpoints/ | ✅ | ✅ | ✅ |
| TRACE.md | ✅ | ✅ | ✅ |
| manifest.yaml (RunManifest) | ✅ | ✅ | ✅ |
| run-directory (pipeline-runs/) | ✅ | **NÃO VERIFICADO** | 🟡 |

---

## 8. MATRIZ DE GAPS POR SEVERIDADE

| # | Gap | Severidade | Área | Esforço Estimado |
|---|-----|------------|------|-----------------|
| 1 | Controller N1 truncado (`pipeline-controller.md`) | 🔴 Alta | Orquestração | Alto (restaurar prompt + adaptar para spawn_agent) |
| 2 | Brainstorm controller truncado + STEP 1.7 ausente | 🔴 Alta | Orquestração | Alto |
| 3 | Emulação local como padrão (agentes simulados) | 🔴 Alta | Runtime | Médio (mudar default para requireRealAgent=true) |
| 4 | Sentinel sem SPEC checkpoints | 🔴 Alta | Qualidade | Médio (restaurar checkpoints no prompt) |
| 5 | Edit guard ausente | 🔴 Alta | Segurança | Médio (criar hook + exec-window scripts) |
| 6 | Session lock sem heartbeat | 🟡 Média | Hooks | Baixo |
| 7 | TDD interativo por cenário perdido | 🟡 Média | Execução | Médio |
| 8 | Phase transition summaries ausentes | 🟡 Média | Observabilidade | Baixo |
| 9 | Delegação por skills na Phase 2 ausente | 🟡 Média | Execução | Médio |
| 10 | Sentinel reduzido a estado JSON | 🟡 Média | Qualidade | Médio |
| 11 | Skill frontmatter enforcement parcial | 🟡 Média | Hooks | Médio |
| 12 | Team registry não consumido | 🟡 Média | Execução | Baixo |
| 13 | Hoisting loop não aplicável | 🟢 Baixa | Protocolo | N/A (justificado) |
| 14 | Exec-window scripts → middleware | 🟢 Baixa | Segurança | N/A (justificado) |
| 15 | EnterPlanMode nativo ausente | 🟢 Baixa | Plan Mode | N/A (limitação do host) |

---

## 9. RECOMENDAÇÕES

### 9.1 Prioridade 1 — Restaurar Orquestração Multi-Agent Real

1. **Restaurar `pipeline-controller.md`** com conteúdo completo (adaptado de 1.470 linhas da fonte canônica para `spawn_agent` em vez de `Agent` tool).
2. **Mudar o default do dispatcher** para `requireRealAgent=true`. A emulação local deve ser usada **apenas em testes**.
3. **Implementar STEP 1.7** no controller TypeScript: antes de iniciar Phase 2 para MEDIA/COMPLEXA/Spec, verificar `PREP_RUN_ID` e disparar `brainstorm-controller` se ausente.

### 9.2 Prioridade 2 — Restaurar Segurança e Qualidade

4. **Criar `edit-guard-hook.cjs`** e registrá-lo em `hooks.json` no `PreToolUse:Edit|Write|NotebookEdit|MultiEdit`.
5. **Restaurar SPEC PIPELINE CHECKPOINTS** no `sentinel.md`.
6. **Adicionar heartbeat contínuo** ao `session-lock-hook.cjs` (mover para `UserPromptSubmit` ou duplicar evento).

### 9.3 Prioridade 3 — Restaurar Funcionalidades de Interatividade

7. **Implementar TDD interativo por cenário** via `spawn_agent` + `send_input` ou protocolo equivalente.
8. **Emitir Phase Transition Summaries** em todas as transições de fase no controller TypeScript.
9. **Implementar delegação por skills** na Phase 2 (usar `bugfix-light/heavy`, `spec-*` skills quando o variant indicar).

### 9.4 Prioridade 4 — Melhorias de Manutenção

10. **Extrair `skill-frontmatter-parser.cjs`** como módulo compartilhado.
11. **Consumir `team-registry.md`** no runtime para compor agent teams dinamicamente.
12. **Restaurar `brainstorm-controller.md`** com conteúdo completo.

---

## 10. CONCLUSÃO

O **Pipeline Orchestrator for Codex** é um port tecnicamente competente que preservou a **estrutura** da fonte canônica (fases, gates, estado, modos), mas comprometeu a **alma** dela: **orquestração multi-agente real com reasoning isolado**.

A fonte canônica funciona porque:
1. Um **agente N1 real** (pipeline-controller) com 1.470 linhas de prompt decide qual agente despachar, quando, e com qual contexto.
2. Cada agente folha roda em um **contexto isolado real**, sem vazamento de reasoning.
3. A **revisão adversarial** é feita por agentes reais que nunca viram o reasoning do implementer.
4. O **sentinel** é um agente real que valida sequência e coerência.

O port Codex, no caminho padrão:
1. Usa uma **state machine TypeScript** para orquestrar — sem reasoning de agente.
2. "Agentes" são **funções puras** que retornam outputs sintéticos.
3. A "revisão adversarial" é um **objeto JSON** com `freshContextEmulated: true`.
4. O **sentinel** é um arquivo JSON escrito pelo controller.

**Para o port ser fiel à fonte canônica, ele precisa:**
- Restaurar os prompts dos controllers N1 com conteúdo completo.
- Usar `spawn_agent` real como padrão, não emulação.
- Adaptar (não truncar) os prompts para o runtime Codex.
- Implementar os 5 gaps críticos de segurança e qualidade.

---

*Este documento foi gerado por auditoria comparativa entre a fonte canônica (Claude Code v5.2.0) e o port para GPT Codex (v0.4.1).*
