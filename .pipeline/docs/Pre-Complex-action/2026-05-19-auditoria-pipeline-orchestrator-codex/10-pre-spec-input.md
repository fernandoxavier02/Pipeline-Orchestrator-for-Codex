---
title: "Pre-Spec Input — Pipeline Orchestrator Trust Restoration"
intent: "Input estruturado pronto para virar spec formal (kiro-spec-init / kiro-spec-requirements)"
source_audit: ".pipeline/docs/Pre-Complex-action/2026-05-19-auditoria-pipeline-orchestrator-codex/"
source_findings: "09-findings-consolidated.md, 08-final-audit-report.md"
last_verified: "2026-05-19"
status: "ready-for-spec"
---

# Pre-Spec Input — Pipeline Orchestrator Trust Restoration

Este documento estrutura os achados da auditoria como input para uma spec formal. Cada seção mapeia para um campo padrão de spec (problem, audience, goals, non-goals, AC, risks, sequencing, open-questions). Quando o próximo turno rodar `kiro-spec-init` ou `kiro-spec-requirements`, este documento é o argumento de entrada principal.

## Problem statement

O plugin `pipeline-orchestrator-for-codex` (v0.4.1) promete revisão adversarial multi-agente independente como sua proposta de valor central. O runtime default substitui silenciosamente essa garantia por heurísticas locais determinísticas, e marca os veredictos fabricados identicamente aos reais em todos os logs persistidos. O usuário não consegue distinguir, observando o output (gate-decisions.jsonl, confidence score, sentinel checkpoints, Pa de Cal), se a revisão adversarial aconteceu ou foi inventada localmente. Isso gera "muitas falhas e não cumprimento de contratos" empíricos do ponto de vista do usuário — não porque o sistema dá crash, mas porque ele entrega silêncio onde deveria entregar enforcement.

A causa raiz é mecânica e estreita: `strictAgents` é `?: boolean` em `RuntimeOptions` (default `undefined`); `createReviewOrchestrator` e `createFinalAdversarialOrchestrator` em `src/index.ts:691,699-701` testam `=== true` (não a cascata segura do `src/index.ts:548`); o schema `decided_by` enum tem o valor `'system'` mas nenhum código o escreve; `confidence-model.ts` é puramente aritmético e não penaliza emulação. Quatro relatórios anteriores (2026-05-11) já documentaram componentes deste problema sob nomes diferentes; os commits "Harden / Enforce / Streamline" desde então não tocaram o default de `strictAgents`.

## Audience (quem se beneficia, quem aplica)

- **Beneficiário primário:** o usuário humano que invoca `/pipeline-orchestrator-for-codex:pipeline` no Codex CLI/app e precisa que o veredicto Pa de Cal seja evidência real de revisão multi-agente, não selo de borracha sobre heurística local.
- **Beneficiário secundário:** integradores que importam `createPipelineRuntime` programaticamente e atualmente herdam o footgun silencioso.
- **Aplicador:** maintainers do repo (Fernando Xavier / FX Studio AI) que vão executar os fixes P0/P1/P2.
- **Auditores de futuras versões:** os achados aqui devem permanecer fechados em auditorias subsequentes; padrão "fix-then-regress" indica que sem CI guards as correções regridem.

## Goals (P0 / P1 / P2)

### P0 — confiança mínima (antes de qualquer output do pipeline ser considerado evidência)

- **G-P0-1:** Veredictos emulados são distinguíveis de veredictos reais em `gate-decisions.jsonl`. Concretamente: dispatches emulados escrevem `decided_by='system'`; dispatches via real `spawn_agent` escrevem `decided_by='controller'` (ou `'user'` para gates aprovados pelo usuário, conforme schema atual).
- **G-P0-2:** Confidence score reflete presença de emulação. Concretamente: se há pelo menos uma entrada `decided_by='system'` em `gate-decisions.jsonl`, o `final_score` calculado é capado em 0.5 e o YAML inclui `confidenceSource: 'emulated'`.
- **G-P0-3:** Hooks de segurança falham-fechado em exception. Concretamente: `hooks/dispatch-guard.cjs:391-402` e `hooks/sentinel-hook.cjs:108-112,181-184` retornam `deny` (não `allow`) quando qualquer exception interna ocorre durante processamento de evento.

### P1 — eliminação da fonte de emulação silenciosa (sprint atual)

- **G-P1-1:** `createReviewOrchestrator` e `createFinalAdversarialOrchestrator` herdam a cascata segura. Concretamente: `src/index.ts:691,699-701` substituem `options.strictAgents === true` por `options.strictAgents ?? isOperationalPipelineDispatch(request)` (mesmo padrão da linha 548).
- **G-P1-2:** Existe cobertura de teste para o caminho `strictAgents=undefined`. Concretamente: três novos testes BDD/integration cobrem (a) review-orchestrator com strictAgents undefined; (b) final-adversarial-orchestrator com strictAgents undefined; (c) cap de confidence quando há `decided_by='system'`.
- **G-P1-3:** Observabilidade pós-mortem distingue emulação de real. Concretamente: schema em `src/state/protocol-events.ts` adiciona campo `dispatchMode: 'real' | 'emulated'`; writer popula a partir da presença de `agentRuntime`.
- **G-P1-4:** Hooks de edit cobrem Bash. Concretamente: `hooks/edit-guard-hook.cjs` adiciona matcher Bash e parse de comandos com `>`, `>>`, `rm`, `mv` para alvos fora do exec-window.
- **G-P1-5:** Exec-window é resistente a symlink attack. Concretamente: `scripts/exec-window/open.cjs:81,95` faz `lstat` antes de `renameSync` e aborta com deny se for symlink.
- **G-P1-6:** Templates de plugin são copy-paste-safe. Concretamente: ou todos os 5 .cjs referenciados em `assets/templates/hooks.json` shipam como stubs, ou o template é reescrito wirando apenas `hook-deny.cjs`; e o `hook-deny.cjs:51-54` faz `deny()` em catch (opt-in para fail-open documentado).
- **G-P1-7:** Resume preserva strictAgents. Concretamente: `src/continue/resume-pipeline.ts` persiste `strictAgents` na session JSON; recovery na resume re-aplica.

### P2 — saúde estrutural (próximo ciclo, "weeks")

- **G-P2-1:** Existe exatamente uma autoridade canônica para a lógica de orquestração. Concretamente: ou `agents/core/pipeline-controller.md` é restaurado como caminho N1 primário (via adapter real `spawn_agent`), ou recebe um header oficial AUTHORITY_NOTE declarando que `src/controller/pipeline-controller.ts` é o SSOT operacional e o markdown é referência humana.
- **G-P2-2:** Plugin ship com adapter nativo Codex `agentRuntime`. Concretamente: novo `src/adapters/codex-agent-runtime.ts` implementa `AgentRuntimeAdapter` bridgeando `runRole()` ao `spawn_agent` real do Codex; `createPipelineRuntime` defaulta `strictAgents: true` quando o adapter é detectado.
- **G-P2-3:** Autoridade de gate hardness é única. Concretamente: ou `gate-registry.ts` usa `classifyGateHardness()` para cada entrada (e literais ficam derivados), ou `hardness-policy.ts` é removido; CI test enforça consistência.
- **G-P2-4:** KB Codex tem SSOT único por conceito. Concretamente: padrão "Drift Notes" é retirado dos 4 arquivos KB antigos; corpus consolidado em `plugin-build-guide.md` é o autoritativo; `last_verified` tem um controller único.

## Non-goals (explicitamente fora do escopo)

- Refator total do `src/controller/pipeline-controller.ts` (1885 linhas) — o arquivo funciona; quebrá-lo agora aumenta blast radius sem fechar achados.
- Reescrita do `single-agent-runner.ts` (507 linhas de emulação) — é a fundação dos 505 testes CI; remover antes do adapter P2-2 estar shippado quebra CI.
- Renomeação de gates ou checkpoint labels — esses são persistidos em `gate-decisions.jsonl` e sentinel-state.json; renomes quebram parsing histórico.
- Mudanças no protocolo `GATE_REQUEST` / `DISPATCH_REQUEST` / `PLAN_MODE_REQUEST` — o protocolo está estável; ajustes nele tocam todos os agentes.
- Adicionar testes para os 12 achados de segurança herdados além do que está em P1 — fora do escopo desta spec; backlog separado.
- Mudanças no plugin manifest (`.codex-plugin/plugin.json`) versão/nome — bumps de versão acontecem como output dos fixes, não como goal independente.

## Acceptance criteria (por goal, verificáveis)

### P0

- **AC-P0-1.a:** Spawnar pipeline em modo de emulação produz pelo menos uma entrada em `gate-decisions.jsonl` com `decided_by='system'`. Verificável via: rodar `npm test -- gate-log-emulation` (novo teste) e via grep manual em log de run real sem adapter.
- **AC-P0-1.b:** Spawnar pipeline com adapter real produz zero entradas com `decided_by='system'`. Verificável via: rodar `npm test -- gate-log-real-agent` (novo teste).
- **AC-P0-2.a:** `confidence-score.yaml` tem campo `final_score <= 0.5` quando o gate-log da mesma run tem qualquer `decided_by='system'`. Verificável via: novo teste asserindo essa invariância.
- **AC-P0-2.b:** Mesmo arquivo inclui `confidenceSource: 'emulated'` no header quando o cap foi aplicado. Verificável via parsing YAML.
- **AC-P0-3.a:** Injetar payload corrompido no stdin do `dispatch-guard.cjs` produz exit code 2 e mensagem deny clara. Verificável via novo teste shell/integration.
- **AC-P0-3.b:** Mesmo para `sentinel-hook.cjs` com `sentinel-state.json` corrompido — fail-closed deny.

### P1

- **AC-P1-1:** Diff de `src/index.ts` mostra apenas as três linhas (691, 699-701) trocadas; mesmo padrão da linha 548. Verificável via code review.
- **AC-P1-2:** `npm test -- strictAgents-undefined` passa com 3 cenários (review, final-adversarial, confidence cap). Verificável via CI.
- **AC-P1-3:** Schema `ProtocolEvent` em `src/protocol/protocol-events.ts` tem campo opcional `dispatchMode: z.enum(['real', 'emulated']).optional()`. Verificável via Zod schema parse.
- **AC-P1-4:** `hooks/edit-guard-hook.cjs` matcher agora inclui `Bash`. Tentar `Bash` com `echo "x" > unauthorized.txt` produz deny. Verificável via integration test.
- **AC-P1-5:** Tentar `renameSync` sobre symlink em exec-window aborta com erro claro. Verificável via test que cria symlink pre-existente.
- **AC-P1-6:** Listar `assets/templates/` produz exatamente os .cjs files que `hooks.json` referencia. `hook-deny.cjs` catch block agora chama `deny()`. Verificável via grep + lint.
- **AC-P1-7:** Pipeline rodado com `strictAgents: true`, interrompido, e retomado com `/pipeline continue` sem args, NÃO degrada para emulação. Verificável via novo BDD scenario.

### P2

- **AC-P2-1:** `agents/core/pipeline-controller.md` ou (a) é loaded por um spawn real em pelo menos um caminho operacional, ou (b) tem header AUTHORITY_NOTE explicando o status e apontando para `src/controller/pipeline-controller.ts`. Verificável via inspect do arquivo + grep do código.
- **AC-P2-2:** Novo `src/adapters/codex-agent-runtime.ts` existe; quando `agentRuntime` é detectado em runtime, `createPipelineRuntime` resolve `strictAgents` para `true` por default. Verificável via integration test.
- **AC-P2-3:** `npm test -- gate-hardness-consistency` valida que cada entrada de `gate-registry.ts` tem hardness compatível com o que `classifyGateHardness()` produziria (ou hardness-policy.ts foi removido). Verificável via CI.
- **AC-P2-4:** `references/openai-codex-kb/` tem `last_verified` único e consistente em todos os arquivos. Os 4 arquivos antigos foram reescritos para a versão corrigida (não têm mais seção "Drift Notes"). Verificável via grep do timestamp.

## Risks

- **R-1 (alto):** Aplicar P0-2 (cap de confidence em 0.5) pode quebrar testes que assumem high-confidence em runs de emulação. Mitigação: auditar fixtures de teste antes do P0; atualizar para esperar 0.5 quando emulação for esperada.
- **R-2 (alto):** P1-1 (substituir `=== true` por cascata) muda comportamento sutilmente — em casos onde alguém DEPENDIA do bypass silencioso, o pipeline agora bloqueia. Isso é o objetivo, mas pode pegar usuários de surpresa. Mitigação: changelog claro + release notes + grace period com warning antes de error.
- **R-3 (médio):** P2-2 (adapter Codex real) é "weeks" porque depende de comportamento do harness Codex que pode mudar entre versões do CLI. Mitigação: feature-flag o adapter, manter emulation path como fallback opt-in até estabilizar.
- **R-4 (médio):** P0-1 (`decided_by='system'` para emulação) requer todos os call sites de gate-log write serem auditados — risco de site esquecido continuar escrevendo `'controller'`. Mitigação: grep abrangente + linter ESLint rule custom que proíbe hardcode de `decided_by` fora do writer central.
- **R-5 (baixo):** P1-6 (fail-closed em hook-deny.cjs template) muda default que usuários atuais podem ter copiado. Mitigação: já adversarial-reviewer flagou; documentar no template e em release notes.
- **R-6 (baixo):** P2-4 (retirar Drift Notes) é destrutivo na KB — perde história editorial. Mitigação: mover Drift Notes para um arquivo CHANGELOG.kb.md em vez de deletar.

## Sequencing / dependências

```
P0-3 (fail-closed hooks)  ──┐
                            ├──► independentes, paralelos
P0-1 (decided_by=system)  ──┤
                            │
P0-2 (confidence cap)     ──┘  depende de P0-1 (precisa do field para detectar)

P1-1 (cascade fix)            depende de P0-1, P0-2 (testes precisam ver decided_by funcionando)
P1-2 (3 testes críticos)      depende de P1-1, P0-1, P0-2 (testa o comportamento corrigido)
P1-3 (dispatchMode field)     independente, pode ir junto com P0-1
P1-4..P1-7 (security + resume) paralelos entre si, independentes de P0/P1-1..3

P2-1 (authority decision)     pre-requisito conceitual para P2-2
P2-2 (codex adapter)          depende de P2-1 estar resolvido
P2-3 (hardness unify)         independente, pode ir paralelo a P2-2
P2-4 (KB SSOT)                independente, baixo risco, pode ser feito a qualquer momento
```

Caminho crítico mínimo (para parar de produzir veredictos não-confiáveis): P0-1 → P0-2 → P1-1 → P1-2. Estimativa: 3-5 dias de trabalho focado.

## Open questions (precisam decisão antes da spec virar plan)

- **OQ-1:** P2-1 — restaurar `pipeline-controller.md` como N1 real (via adapter) ou tombstone formal? Trade-off: restaurar mantém a visão arquitetural "controller é prompt" mas requer P2-2 estar pronto; tombstone é mais honesto sobre o estado atual mas perde a aspiração original.
- **OQ-2:** P1-1 — cascata `?? isOperationalPipelineDispatch(request)` é apropriada para review-orchestrator e final-adversarial-orchestrator, ou esses devem ter regra própria mais estrita (sempre bloquear se `strictAgents !== true`, sem fallback operacional)? A primeira mantém UX consistente com runtimeRunRole; a segunda é mais defensiva mas pode bloquear casos legítimos.
- **OQ-3:** P0-2 — cap em 0.5 é arbitrário; pode ser 0.6 ou função do número de entradas emuladas. Decisão: número fixo simples ou fórmula?
- **OQ-4:** P2-4 — KB consolidation: o `plugin-build-guide.md` recém-criado vira o SSOT canônico e os 4 arquivos antigos são reescritos contra ele? Ou os antigos viram tombstones com forward pointer? Trade-off: reescrita preserva grep-ability nos nomes antigos; tombstone é menor trabalho.
- **OQ-5:** Versionamento: aplicar P0 + P1 é bump minor (0.4.1 → 0.5.0) ou major (0.4.1 → 1.0.0)? Sugestão: minor porque é fix de comportamento documentado mas não-funcional; major se quisermos marcar "agora é trustable".

## Sugestão de estrutura para a spec formal (próximo turno)

Quando rodar `kiro-spec-init` no próximo turno, sugerir os seguintes argumentos:

- **Nome da spec:** `pipeline-trust-restoration`
- **Tipo:** `feature` (porque introduz comportamento novo: emulation marking + confidence cap + cascade fix; não é só bugfix)
- **Complexity:** COMPLEXA (escopo: 3 grupos P0/P1/P2, 14 goals, dependências entre eles)
- **Variant:** `spec-heavy` (gates Spec-lifecycle completos — Format Gate, Content Review, Implementation, Post-Impl Validator)
- **Source documents para `kiro-spec-requirements`:** este `10-pre-spec-input.md`, `09-findings-consolidated.md`, `08-final-audit-report.md`
- **Steering files referenciados:** `.kiro/CONSTITUTION.md`, `.kiro/steering/product.md`, `.kiro/steering/tech.md`, `AGENTS.md`

## Notas para o spec-writer

- Toda evidência file:line está em `08-final-audit-report.md` — não re-derivar.
- Os 42 findings já têm IDs (CAR-*, CHAR-*, CANON-*, ADV-*, AUDIT-*); a spec deve referenciá-los, não renumerá-los.
- Os 4 padrões sistêmicos (A/B/C/D) são úteis como "themes" na requirements — fixes individuais ganham contexto quando agrupados sob o padrão.
- Verificação em CI é essencial para o Padrão D (fix-then-regress) — toda AC deve ter teste/lint correspondente, não só comentário "verificado manualmente".
- O usuário (Fernando) prefere linguagem leiga (CLAUDE.md global rule); a spec final deve ter um Executive Summary em prosa antes da estrutura técnica.
