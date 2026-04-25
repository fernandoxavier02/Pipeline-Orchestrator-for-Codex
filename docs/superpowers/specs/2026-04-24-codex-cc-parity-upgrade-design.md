# Codex Pipeline Orchestrator — CC v4.1.0 Parity Upgrade

**Data:** 2026-04-24
**Autor:** Fernando Xavier + Claude Code
**Status:** Aprovado
**Parity target:** Claude Code Pipeline Orchestrator v4.1.0-rc.1

## 1. Contexto e Motivação

O Pipeline Orchestrator do Codex (v0.3.0) tem parity target com CC v3.8.0. O CC evoluiu para v4.1.0-rc.1 com mudanças arquiteturais fundamentais: agente controller isolado, hooks de seguranca (session-lock, edit-guard, dispatch-guard, session-cleanup), exec-window cooperative authorization, atomic writes e sentinel state management com 5 checkpoints.

O Codex precisa alinhar com o CC para:
- Evitar drift de comportamento entre os dois runtimes
- Adicionar governanca de seguranca que o CC ja possui
- Completar o wiring de contratos documentados mas nao conectados

## 2. Decisoes de Design

### 2.1 Paradigma

**Escolha:** Espelhar a arquitetura CC (prompt-driven + hooks CJS) sobre o runtime TypeScript existente do Codex.

O runtime TypeScript (56 modulos, Zod validation, dispatcher tipado) e mantido como substrate. Os hooks CJS sao adicionados como camada de governanca de seguranca.

### 2.2 Hooks

**Escolha:** Reusar `hooks/hooks.json` existente, adicionando novos hooks CJS no mesmo formato.

O Codex ja suporta hooks via hooks.json (SessionStart, UserPromptSubmit, Stop, PreToolUse). Os novos hooks seguem esse contrato.

### 2.3 Testes

**Escolha:** TDD classico Red-Green-Refactor lidera. BDD para cenarios de integracao. DDD para value objects imutaveis.

## 3. Arquitetura

### 3.1 Modelo de Execucao

```
/hooks.json
    |
    +-- SessionStart -> session-lock-hook.cjs
    +-- PreToolUse:Agent -> sentinel-hook.cjs
    |                     -> dispatch-guard.cjs
    |                     -> edit-guard-hook.cjs
    +-- PreToolUse:Edit -> edit-guard-hook.cjs
    +-- PreToolUse:Write -> edit-guard-hook.cjs
    +-- PreToolUse:Skill -> dispatch-guard.cjs
    +-- UserPromptSubmit -> force-pipeline-agents.cjs (existente)
    +-- Stop -> completion-checklist.cjs (existente)
           -> session-cleanup-hook.cjs
```

### 3.2 Exec-Window Flow

```
pipeline-controller (N1)
    -> cria .codex/pipeline/sessions/{id}.exec-window (TTL: 5 min, max 60)
    -> spawna executor-implementer (N2)
        -> edit-guard-hook verifica exec-window
        -> se valido: permite Edit/Write
        -> se invalido: bloqueia
    -> executor retorna
    -> controller fecha exec-window
```

### 3.3 Error Handling

Todos os hooks seguem o contrato:

```typescript
type HookResult = {
  decision: 'allow' | 'deny';
  reason?: string;
  stderr?: string;
}
```

- Hook crash = deny (fail-closed)
- State corrompido = WARNING no stderr, nao bloqueia
- Race conditions eliminadas por atomic writes (.tmp + rename)
- TTL expirado = tratado como fechado

## 4. Batches de Implementacao

### 4.1 Dependencias

```
B1 (session-lock) ------+
                         +---> B2 (edit-guard) ---> B10 (cleanup)
B4 (sentinel) -----------+
                         +---> B8 (pipeline-controller)
B3 (dispatch-guard) -----+

B5 (hotfix) -> B6 (askUser) -> B7 (plan-mode) -> B11 (final)

B9 (adversarial-reviewer) --- independente
```

B1, B3, B4 podem rodar em paralelo. B2 depende de B1. B5-B7 sequenciais. B9 independente.

### 4.2 Batch B1: Session Lock

**Entrega:** Lock de sessao que impede execucoes concorrentes. Atomic writes.

**Arquivos novos:**
- `hooks/session-lock-hook.cjs`
- `src/security/session-lock.ts`

**Arquivos modificados:**
- `hooks/hooks.json`

**Value Object DDD:**
```typescript
type SessionLock = Readonly<{
  sessionId: string;
  createdAt: string;
  pid: number;
  ttlMinutes: number;
}>
```

**Testes TDD (min 6 unit + 3 BDD):**
- Lock impede segunda sessao
- Atomic write funciona
- Sessao expirada permite nova execucao
- Lock removido ao finalizar
- Lock sobrevive a crash do processo (stale lock)

### 4.3 Batch B2: Edit Guard

**Entrega:** Bloqueia Edit/Write sem exec-window ativo. TTL 5 min.

**Arquivos novos:**
- `hooks/edit-guard-hook.cjs`
- `src/security/exec-window.ts`
- `src/security/exec-window-store.ts`

**Arquivos modificados:**
- `hooks/hooks.json`

**Value Object DDD:**
```typescript
type ExecWindow = Readonly<{
  sessionId: string;
  openedAt: string;
  ttlMinutes: number;
  closed: boolean;
}>
type ExecWindowState = 'OPEN' | 'CLOSED' | 'EXPIRED'
```

**Testes TDD (min 8 unit + 4 BDD):**
- Edit bloqueado sem exec-window
- Edit permitido com exec-window valido
- Edit bloqueado apos TTL
- Edit bloqueado apos close
- Reuso de exec-window fechado bloqueado
- Par verification com gate-decisions.jsonl

### 4.4 Batch B3: Dispatch Guard

**Entrega:** Intercepta chamadas Skill quando deveria ser Agent.

**Arquivos novos:**
- `hooks/dispatch-guard.cjs`
- `src/security/dispatch-contract.ts`

**Arquivos modificados:**
- `hooks/hooks.json`

**Value Object DDD:**
```typescript
type DispatchContract = Readonly<{
  agentLeaf: string;
  fullyQualified: string;
  tool: 'Agent' | 'Skill';
}>
```

**Testes TDD (min 4 unit + 2 BDD):**
- Skill call para agent bloqueado
- Agent call com FQN permitido
- Agent call sem prefixo bloqueado

### 4.5 Batch B4: Sentinel Enhancement

**Entrega:** Upgrade para 5 checkpoints e schema versioning.

**Arquivos modificados:**
- `hooks/sentinel-hook.cjs`
- `src/sentinel/sentinel-state.ts`
- `references/sentinel-integration.md`

**Testes TDD (min 5 unit + 3 BDD):**
- Bloqueia spawn fora de sequencia
- PASS para sequencia valida
- WARNING para schema_version desconhecido

### 4.6 Batch B5: HOTFIX Wiring

**Entrega:** Conecta hotfixReductionPolicy() aos 9+ call-sites espalhados.

**Arquivos modificados:**
- `src/modes/hotfix-mode.ts`
- `src/controller/pipeline-controller.ts`
- `src/gates/information-gate.ts`
- `src/review/domain-checklists.ts`
- `src/review/adversarial-review.ts`
- `src/execution/executor-controller.ts`
- `src/execution/quality-gate-router.ts`
- `src/dispatcher/single-agent-runner.ts`

**Testes:** 8 cenarios BDD existentes passam a validar runtime.

### 4.7 Batch B6: AskUserQuestion Wiring

**Entrega:** Conecta askUserQuestion ao confirm-proposal.

**Arquivos modificados:**
- `src/controller/confirm-proposal.ts`
- `src/primitives/ask-user-question.ts`

### 4.8 Batch B7: Plan-Mode Wiring

**Entrega:** Resolve colisao de nomes e conecta plan-session ao controller.

**Arquivos modificados:**
- `src/primitives/plan-mode.ts` -> renomear para `plan-session.ts`
- `src/controller/plan-mode.ts` -> usar plan-session

### 4.9 Batch B8: Agent Pipeline-Controller

**Entrega:** Prompt do agente N1 isolado com ferramentas restritas.

**Arquivos novos:**
- `prompts/controller/pipeline-controller.md` (~1046 linhas adaptadas)

**Arquivos modificados:**
- `src/prompts/prompt-registry.ts`

### 4.10 Batch B9: Adversarial Quality Reviewer

**Entrega:** Prompt do agente adversarial-quality-reviewer ausente.

**Arquivos novos:**
- `prompts/agents/quality/adversarial-quality-reviewer.md`
- `agents/quality/adversarial-quality-reviewer.md`

### 4.11 Batch B10: Session Cleanup + Atomic Writes

**Entrega:** Limpeza de sessoes expiradas + atomic writes em todos stores.

**Arquivos novos:**
- `hooks/session-cleanup-hook.cjs`

**Arquivos modificados:**
- `src/state/session-store.ts`
- `src/state/gate-log.ts`
- `src/state/confidence-score.ts`

### 4.12 Batch B11: JSONL Sanitization + Final Integration

**Entrega:** Zod .max(200) no detail. Version bump para v0.4.0. Parity target atualizado.

**Arquivos modificados:**
- `src/domain/pipeline-schemas.ts`
- `package.json`
- `.codex-plugin/plugin.json`

## 5. Critérios de Aceite

Cada batch so e completo quando:

1. Todos testes TDD passam (RED -> GREEN -> Refactor)
2. Cenarios BDD passam (Given/When/Then)
3. 26 testes de integracao existentes passam (zero regressao)
4. Adversarial review: sem CRITICAL ou HIGH findings
5. Checkpoint: `npm run build` + `npm test`
6. CHANGELOG atualizado

**STOP rule:** 2 batches consecutivos com falha apos 3 fix loops = STOP + decisao do usuario.

## 6. Estrutura de Testes

```
tests/
  unit/
    hooks/           (session-lock, edit-guard, dispatch-guard, cleanup)
    security/        (session-lock, exec-window, dispatch-contract)
    modes/           (hotfix-wired)
    domain/          (gate-decision-sanitization)
  bdd/
    session-lifecycle.feature.test.ts
    edit-authorization.feature.test.ts
    dispatch-protection.feature.test.ts
    sentinel-checkpoints.feature.test.ts
    hotfix-runtime.feature.test.ts
  integration/
    controller-parity.test.ts    (atualizar)
    hook-chains.test.ts          (novo)
```

## 7. Hook Observability

O Codex ja possui `hooks/hook-events.cjs` que loga decisoes de hooks em `.codex/pipeline/hook-events.jsonl`. Todos os novos hooks devem emitir eventos nesse log para rastreabilidade.

## 8. Nao-Escopo

- Migrar o runtime TypeScript completo para prompt-driven (o substrate TS e mantido)
- Adicionar novos tipos de pipeline (os 12 existentes sao suficientes)
- Modificar a interface publica de `src/index.ts` exports (additive-only)
- Adicionar checklists adicionais (os 7 existentes cobrem o necessario)

## 9. Riscos

| Risco | Mitigacao | Impacto |
|---|---|---|
| Hooks CJS bloqueiam operacoes legitimas | Fail-open com WARNING para state corrompido; fail-closed apenas para seguranca | Medio |
| Atomic writes nao funcionam em Windows | Teste especifico para Windows no B1; fallback para write direto com lock file | Baixo |
| Regressao nos 26 testes de integracao | Cada batch roda testes existentes antes de prosseguir | Alto |
| Paridade imperfeita com CC v4.1.0-rc.1 | Spec e aberto sobre diferecas (runtime TS vs prompt-driven); paridade funcional, nao literal | Baixo |
