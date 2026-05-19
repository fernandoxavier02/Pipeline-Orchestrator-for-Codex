# Findings Consolidados — Pipeline Orchestrator for Codex

**Data:** 2026-05-19
**Estado da auditoria:** completa, 4 batches Phase 2 + closure
**Veredicto:** CRITICAL — não seguro como está
**Confiança:** 0.90 (35 [VERIFIED] file:line evidences + 4 relatórios prévios corroborando)

Este documento consolida em formato narrativo os 42 achados produzidos pela auditoria. Para o relatório formal estruturado (com tabelas de regressão e matriz de risco), ler `08-final-audit-report.md`. Para a estrutura pré-spec pronta para virar specificação formal, ler `10-pre-spec-input.md`.

## O que está acontecendo (em uma frase)

O plugin promete revisão adversarial multi-agente independente como sua proposta de valor central; o runtime default substitui silenciosamente essa garantia por heurísticas locais determinísticas e marca o resultado como se fosse real em todos os logs persistidos. Você não consegue distinguir, observando o output, se a revisão adversarial aconteceu ou se foi inventada localmente.

## Como sabemos disso

Três cadeias de evidência convergem:

**Primeira cadeia — código fonte.** O default de `strictAgents` em `RuntimeOptions` (`src/domain/pipeline-types.ts:42`) é `undefined` (campo opcional). No `src/index.ts:548` o `runtimeRunRole` aplica uma cascata segura (`?? options.strictAgents ?? isOperationalPipelineDispatch(request)`) que de fato bloqueia quando deveria. Mas nas linhas 691 e 701, o `createReviewOrchestrator` e o `createFinalAdversarialOrchestrator` usam `=== true` estrito — quando `strictAgents` é `undefined`, isso resolve para `false` silenciosamente, e os orchestrators inteiros rodam em emulação por padrão. O guard no `src/controller/pipeline-controller.ts:1107` checa apenas `!executionController` (que é sempre injetado pelo `createPipelineRuntime`), portanto é código morto em produção.

**Segunda cadeia — log de decisões.** O schema em `src/domain/pipeline-schemas.ts:177` define `decided_by` como enum `["controller", "user", "system", "resume-router"]` — o valor `system` foi pensado para marcar dispatches emulados. Mas em `src/index.ts:45,967` o `decided_by` está hardcoded como `"controller"`, mesmo quando a emulação fabricou o veredito. O `confidence-model.ts` é puramente aritmético e nunca inspeciona `decided_by` — então um "approved" fabricado entra no score idêntico a um real.

**Terceira cadeia — testes.** Os testes BDD em `tests/bdd/state-adapter-integration.feature.test.ts` cobrem `strictAgents=true` (bloqueia corretamente) e `strictAgents=false` (permite fallback). Não cobrem `strictAgents=undefined` — que é exatamente o estado default em produção. O caminho de emulação dos orchestrators de revisão está completamente fora do CI.

Tudo isso é confirmado por quatro relatórios anteriores de 2026-05-11 (`AUDIT_CODEX_VS_CANONICAL.md`, `CODEX_HARNESS_ADEQUACY_REPORT.md`, `CONSOLIDATED_ADVERSARIAL_REVIEW.md`, `ARCHITECTURE_REVIEW_ROUND2.md`) que já tinham documentado 28 achados críticos/altos. Commits desde então (b5e194b "Harden", 2d138a3 "Enforce", d83f251 "Streamline") atacaram superfícies adjacentes mas não tocaram o default de `strictAgents` — padrão "fix-then-regress" empiricamente confirmado.

## Os 4 padrões sistêmicos

Os 42 achados não são problemas isolados. Eles formam 4 padrões com causas comuns.

### Padrão A — Doc-Promise / Runtime-Silence Gap

Sete instâncias onde a documentação user-facing (SKILL.md, README.md, error messages, agente markdown) declara uma garantia operacional que o runtime default não honra. O exemplo central é a frase do SKILL.md:34 — "ALWAYS call spawn_agent for every phase" — que o runtime ignora completamente quando `strictAgents` é `undefined`. O usuário lê o contrato, configura o plugin segundo o contrato, e o sistema responde com fabricação silenciosa em vez de cumprimento.

A remediação desse padrão é mecânica: estabeleça `strictAgents: true` como o default real, e exija opt-out explícito (mudança de código) para rodar em emulação. Isso fecha o gap entre promessa e runtime de uma só vez.

### Padrão B — Authority Fragmentation

Seis fontes diferentes competem para ser SSOT do mesmo conceito. Para "quem é o orchestrator", as fontes são: `skills/pipeline/SKILL.md` (declara "thin delegator"), `agents/core/pipeline-controller.md` (1471 linhas declarando "sole orchestrator", nunca carregado pelo runtime CLI/programático), `src/controller/pipeline-controller.ts` (1885 linhas, é o real). Para "qual é o contrato de `requireRealAgent`", `src/index.ts` tem três sites inconsistentes (548, 691, 701). Para "qual é a hardness de gates", `gate-registry.ts` tem strings literais e `hardness-policy.ts` tem uma utility `classifyGateHardness()` não usada — podem divergir sem CI catch.

A consequência prática é que ninguém sabe qual fonte ler primeiro, e correções aplicadas em uma fonte deixam as outras stale. Esse é o substrate do Padrão D abaixo.

### Padrão C — Emulation Theatre (mais severo)

O sistema fabrica veredictos de revisão multi-agente localmente, marca-os identicamente aos reais, e emite-os no gate-log onde se tornam indistinguíveis de evidência real. Decisões downstream (gates, confidence score, sentinel checkpoints) tratam essas fabricações como autoritativas. Doze achados se agrupam aqui — é a manifestação central da causa raiz.

A remediação requer três mudanças concorrentes: (1) `decided_by='system'` para dispatches emulados; (2) cap de confidence em 0.5 quando houver `decided_by='system'` no log; (3) `createReviewOrchestrator` e `createFinalAdversarialOrchestrator` herdarem a cascata do `src/index.ts:548` em vez de `=== true`. Mesmo que a emulação continue disponível, esses três fixes tornam-na auditável, distinguível, e penalizada — o cenário de "high-confidence sobre evidência fabricada" desaparece.

### Padrão D — Fix-then-Regress Cycle

Quatro achados confirmam o padrão: fixes são commitados (a história git mostra "Harden / Enforce / Streamline"), mas a causa estrutural não é endereçada, então a mesma classe de problema reaparece em commit subsequente. O `state-adapter.ts` define uma abstração limpa que o controller nunca importa — define inline. Hooks e runtime TS são "universos paralelos" compartilhando arquivos de estado mas nunca invocando um ao outro. O guard morto em `pipeline-controller.ts:1107` é o quarto caso.

Esse padrão é consequência do Padrão B. Sem unificação de autoridade, cada commit que "endurece dispatch" mexe em uma das seis fontes e deixa as outras cinco intactas — o problema migra de lado.

## Achados de segurança (cluster separado)

Sete achados de segurança herdados dos relatórios de 2026-05-11 continuam todos abertos: Bash tool bypass no `edit-guard` (CAR-01, CRITICAL), symlink attack no `exec-window/open.cjs` (CAR-02, CRITICAL), `dispatch-guard.cjs:391-402` fail-open em exception (CAR-03, CRITICAL), `sentinel-hook.cjs:108-112,181-184` fail-open em corrupted state (CAR-04, CRITICAL), unknown dispatch roles → "approved" por default (CAR-15, HIGH), prompt injection guard com 5 patterns triviais sem Unicode normalization (CAR-16, HIGH), writes não-atômicos em exec-window e session-lock (CAR-13, HIGH). Esses são bugs de fail-open clássicos: a primeira defesa de uma exception é virar "deny", não "allow".

## Achados de templates e KB (corpus mais novo)

Quatro achados da revisão adversarial anterior (Pre-Medium-action, mesmo dia) continuam abertos: `assets/templates/hooks.json` referencia 5 .cjs files que não são shipados — quem copiar o template pega plugin quebrado (ADV-C1); `hook-deny.cjs:51-54` faz fail-open por default num arquivo cujo nome literalmente diz "deny" (ADV-C2); SKILL.md tem 3 referências inconsistentes a `plugin-dev:plugin-validator` (ADV-C3); KB files já mostram `last_verified` divergente entre `2026-05-18` e `2026-05-19` (ADV-C4).

## O que NÃO está quebrado

Para não pintar quadro mais escuro do que é: a infraestrutura de estado funciona (atomic writes em `gate-log.ts`, schema validation Zod em `sentinel-state.ts`, persistência), o gate registry tem todas as gates declaradas, hook wiring é estruturalmente correto, plan-mode translation está implementada, e a auditoria atual usou 4 agents reais (intake/domain/compliance/risk-matrix) que produziram trabalho substantivo. O plugin não está "quebrado" no sentido de não funcionar — funciona inteiro. O problema é que funciona FAKE no eixo mais importante (revisão adversarial) e essa fake não é distinguível da real.

## Roadmap em prosa

**Imediato (P0, antes de confiar em qualquer output do pipeline):** três fixes pequenos, total ~1-2 dias. Escrever `decided_by='system'` para emulação. Capar confidence em 0.5 quando houver emulação no log. Flipar fail-open para fail-closed em dispatch-guard e sentinel-hook.

**Sprint atual (P1, mais 7 fixes pequenos, total ~1 semana).** Corrigir o `=== true` em `src/index.ts:691,699-701`. Escrever os 3 testes críticos para o caminho `strictAgents=undefined`. Adicionar `dispatchMode` ao schema do `protocol-events.jsonl`. Consertar Bash bypass no edit-guard. Symlink lstat check no exec-window. Templates ghost + fail-closed default no hook-deny. Persistir strictAgents no resume-pipeline.

**Próximo ciclo (P2, 4 mudanças estruturais).** Decidir destino do `pipeline-controller.md` (restaurar como N1 ou tombstone formal). Shippar adapter Codex nativo de `agentRuntime` com `strictAgents: true` default. Unificar autoridade de gate hardness (uma fonte, enforcement em CI). Consolidar SSOT da KB Codex (retirar padrão Drift Notes).

P2 é "weeks" porque requer adapter Codex real — quando estiver no lugar, o `strictAgents: true` default deixa de ser footgun (porque o adapter está disponível) e a emulação vira opt-in para diagnóstico. Esse é o ponto de "produto pronto" — antes disso, P0 e P1 são salvaguardas para não confiar em output enquanto o adapter não chega.

## O que o usuário deve saber agora

Você não está louco — os contratos realmente não são honrados. O plugin tem documentação completa que descreve corretamente o que ele DEVERIA fazer, mas o runtime default não faz. A boa notícia é que a discrepância é cirúrgica (três linhas em `src/index.ts`, um campo no schema, um cap em uma fórmula) — não requer refactor profundo. A má notícia é que enquanto não aplicar P0, qualquer Pa de Cal verde produzido pelo pipeline pode ter sido fabricado e você não tem como saber observando os logs.

A spec consolidada (próximo turno) vai amarrar isso tudo em estrutura formal pronta para execução governada — provavelmente como `kiro-spec-init` rodado sobre o `10-pre-spec-input.md` que está sendo gerado em paralelo a este documento.
