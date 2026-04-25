# Codex Pipeline Orchestrator — CC v4.1.0 Parity Upgrade

**Data:** 2026-04-24 (revisado 2026-04-25)
**Autor:** Fernando Xavier + Claude Code
**Status:** Em revisao (adversarial findings aplicados)
**Parity target:** Claude Code Pipeline Orchestrator v4.1.0-rc.1

## 1. Contexto e Motivacao

O Pipeline Orchestrator do Codex (v0.3.0) tem parity target com CC v3.8.0. O CC evoluiu para v4.1.0-rc.1 com mudancas arquiteturais fundamentais: agente controller isolado, hooks de seguranca (session-lock, edit-guard, dispatch-guard, session-cleanup), exec-window cooperative authorization, atomic writes e sentinel state management com 5 checkpoints.

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

**IMPORTANTE — Formato de output dos hooks (verificado em openai/codex):**

Os schemas oficiais do Codex (`codex-rs/hooks/schema/generated/`) definem que o output dos hooks PreToolUse usa:
```json
{
  "decision": "approve" | "block",
  "reason": "string | null",
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow" | "deny" | "ask",
    "permissionDecisionReason": "string | null",
    "additionalContext": "string | null",
    "updatedInput": "any | null"
  },
  "systemMessage": "string | null",
  "suppressOutput": false,
  "continue": true
}
```

Hooks de SessionStart e Stop usam formato simplificado:
```json
{ "decision": "block" | null, "reason": "string | null", "continue": true }
```

### 2.3 Testes

**Escolha:** TDD classico Red-Green-Refactor lidera. BDD para cenarios de integracao. DDD para value objects imutaveis.

**Formato dos testes de hooks:** Hooks CJS nao podem ser importados por testes TS com `import`. Os testes de hooks serao `*.test.cjs` rodando via Vitest com `require()`, ou testes TS que spawnam hooks como child processes via `child_process.execSync`.

### 2.4 Path Mapping (CC para Codex)

O CC usa `.pipeline/` como raiz de estado. O Codex usa `.codex/pipeline/`. Todos os hooks adaptados do CC devem usar a tabela abaixo:

| CC path | Codex path |
|---|---|
| `.pipeline/sessions/` | `.codex/pipeline/sessions/` |
| `.pipeline/docs/` | `.codex/pipeline/docs/` |
| `.pipeline/sentinel-state.json` | `.codex/pipeline/sentinel-state.json` |
| `.pipeline/gate-decisions.jsonl` | `.codex/pipeline/gate-decisions.jsonl` |
| `.pipeline/confidence-score.yaml` | `.codex/pipeline/confidence-score.yaml` |

### 2.5 Namespace de Agentes

O CC usa `pipeline-orchestrator:` como prefixo FQN. O Codex usa `pipeline-orchestrator-for-codex:`. Todos os hooks que verificam FQN (dispatch-guard, sentinel) devem usar o namespace do Codex.

## 3. Arquitetura

### 3.1 Modelo de Execucao

```
/hooks.json
    |
    +-- SessionStart -> session-lock-hook.cjs
    +-- PreToolUse:Bash -> edit-guard-hook.cjs (verifica se bash tenta criar/modificar arquivos de producao)
    +-- PreToolUse:Agent -> sentinel-hook.cjs
    |                     -> dispatch-guard.cjs
    +-- UserPromptSubmit -> force-pipeline-agents.cjs (existente)
    +-- Stop -> completion-checklist.cjs (existente)
           -> session-cleanup-hook.cjs
```

**NOTA CRITICA:** O schema oficial do Codex (`pre-tool-use.command.input.schema.json`) define `tool_name` como const `"Bash"`. O Codex suporta matchers (como `"matcher": "Agent"` no hooks.json existente), mas o PreToolUse pode nao receber `tool_input` estruturado para Edit/Write. Por isso:

- **edit-guard-hook.cjs**: Implementado como **middleware TypeScript no dispatcher** (`src/security/edit-guard.ts`) em vez de hook CJS. O `runRole` no dispatcher verifica o exec-window antes de permitir escritas.
- **dispatch-guard.cjs**: Funciona como hook PreToolUse:Agent (o sentinel-hook ja prova que Agent matcher funciona).

### 3.2 Exec-Window Flow

```
pipeline-controller (N1)
    -> cria .codex/pipeline/sessions/{id}.exec-window (TTL: 5 min, max 60)
    -> spawna executor-implementer (N2)
        -> edit-guard middleware no dispatcher verifica exec-window
        -> se valido: permite escrita em producao
        -> se invalido: bloqueia, retorna erro
    -> executor retorna
    -> controller deleta arquivo .exec-window (fecha janela)
```

### 3.3 Error Handling

Todos os hooks seguem o contrato oficial do Codex:

```typescript
// PreToolUse hook output
type PreToolUseHookOutput = {
  decision: 'approve' | 'block';
  reason?: string;
  hookSpecificOutput?: {
    hookEventName: 'PreToolUse';
    permissionDecision?: 'allow' | 'deny' | 'ask';
    permissionDecisionReason?: string;
    additionalContext?: string;
    updatedInput?: unknown;
  };
  systemMessage?: string;
  suppressOutput?: boolean;
  continue?: boolean;
}

// SessionStart / Stop hook output
type SimpleHookOutput = {
  decision?: 'block' | null;
  reason?: string;
  systemMessage?: string;
  suppressOutput?: boolean;
  continue?: boolean;
}
```

- Hook crash = block (fail-closed)
- State corrompido = `additionalContext` com WARNING, nao bloqueia
- Race conditions eliminadas por atomic writes (`.tmp` + `unlinkSync` + `renameSync`)
- TTL expirado = tratado como fechado
- **Windows atomic writes:** `unlinkSync(finalPath)` antes de `renameSync(tmpPath, finalPath)` para evitar EPERM

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

**Value Object DDD (alinhado com schema real do CC v4.1.0):**
```typescript
type SessionLock = Readonly<{
  session_id: string;
  created_at: number; // Unix timestamp
  expires_at: number; // Unix timestamp
  status: 'active' | 'expired';
}>
```

**Tratamento de SessionStart `source`:** O hook recebe `source: "startup" | "resume" | "clear"`. Em `resume`, o lock pode existir legitimamente — verificar `expires_at` antes de bloquear.

**Testes TDD (min 6 unit + 3 BDD, formato *.test.cjs):**
- Lock impede segunda sessao com source=startup
- Atomic write funciona no Windows (unlinkSync + renameSync)
- Sessao expirada permite nova execucao
- Lock removido ao finalizar (source=clear)
- Resume com lock valido nao bloqueia

### 4.3 Batch B2: Edit Guard

**Entrega:** Bloqueia escrita em producao sem exec-window ativo. TTL 5 min.

**IMPLEMENTACAO COMO MIDDLEWARE TS (nao hook CJS)** — ver secao 3.1.

**Arquivos novos:**
- `src/security/edit-guard.ts` (middleware do dispatcher)
- `src/security/exec-window.ts`
- `src/security/exec-window-store.ts`

**Arquivos modificados:**
- `src/dispatcher/run-role.ts` (adicionar verificacao de exec-window)

**Value Object DDD (alinhado com schema real do CC v4.1.0):**
```typescript
type ExecWindow = Readonly<{
  session_id: string;
  opened_at: number; // Unix timestamp
  expires_at: number; // Unix timestamp
  purpose: string;
  spawning_agent: string;
}>
type ExecWindowState = 'OPEN' | 'CLOSED' | 'EXPIRED'
// OPEN = arquivo existe E expires_at > now
// CLOSED = arquivo deletado pelo controller
// EXPIRED = arquivo existe MAS expires_at <= now
```

**Testes TDD (min 8 unit + 4 BDD, formato TS com child_process):**
- Escrita bloqueada sem exec-window
- Escrita permitida com exec-window valido
- Escrita bloqueada apos TTL expirado
- Escrita bloqueada apos arquivo deletado (CLOSED)
- Reuso de arquivo deletado bloqueado
- Par verification com gate-decisions.jsonl

### 4.4 Batch B3: Dispatch Guard

**Entrega:** Intercepta chamadas Skill quando deveria ser Agent.

**Arquivos novos:**
- `hooks/dispatch-guard.cjs`
- `src/security/dispatch-contract.ts`

**Arquivos modificados:**
- `hooks/hooks.json`

**Value Object DDD (namespace Codex):**
```typescript
type DispatchContract = Readonly<{
  agentLeaf: string;
  fullyQualified: string; // "pipeline-orchestrator-for-codex:<folder>:<leaf>"
  tool: 'Agent' | 'Skill';
}>
```

**Tabela AGENT_LEAF_TO_FQN deve ser gerada com namespace `pipeline-orchestrator-for-codex:`, nao `pipeline-orchestrator:`.**

**Testes TDD (min 4 unit + 2 BDD):**
- Skill call para agent bloqueado
- Agent call com FQN `pipeline-orchestrator-for-codex:` permitido
- Agent call sem prefixo bloqueado

### 4.5 Batch B4: Sentinel Enhancement

**Entrega:** Wiring dos 3 checkpoints faltantes (schema ja suporta 5).

O `sentinelStateSchema` em `src/domain/pipeline-schemas.ts` ja lista 5 checkpoints: `post_orchestrator`, `phase_0_to_1`, `phase_1_to_2`, `phase_2_to_3`, `post_final_validator`. O que falta e gravar `phase_2_to_3` e `post_final_validator` nos code paths de execucao e closeout.

**Arquivos modificados:**
- `src/controller/pipeline-controller.ts` (gravar phase_2_to_3)
- `src/validation/final-validator.ts` (gravar post_final_validator)
- `references/sentinel-integration.md`

**Testes TDD (min 5 unit + 3 BDD):**
- Bloqueia spawn fora de sequencia
- PASS para sequencia valida com 5 checkpoints
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

**NOTA:** `pipeline-controller.ts` importa `typescript` em runtime (devDependency). Preservar esse import.

**Testes:** 8 cenarios BDD existentes passam a validar runtime.

### 4.7 Batch B6: AskUserQuestion Wiring

**Entrega:** Conecta askUserQuestion ao confirm-proposal.

**Arquivos modificados:**
- `src/controller/confirm-proposal.ts`
- `src/primitives/ask-user-question.ts`

### 4.8 Batch B7: Plan-Mode Wiring

**Entrega:** Resolve colisao de nomes e conecta plan-session ao controller.

**Arquivos modificados:**
- `src/primitives/plan-mode.ts` -> renomear para `src/primitives/plan-session.ts`
- `src/controller/plan-mode.ts` -> importar de `../primitives/plan-session.js`

**CLARIFICACAO:** Somente `src/primitives/plan-mode.ts` e renomeado. `src/controller/plan-mode.ts` (que lida com ImplementationPlan artifact) permanece inalterado.

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

**Atomic writes pattern (Windows-safe):**
```javascript
const tmpPath = finalPath + '.tmp';
fs.writeFileSync(tmpPath, JSON.stringify(data));
try { fs.unlinkSync(finalPath); } catch (_) { /* ignore */ }
fs.renameSync(tmpPath, finalPath);
```

### 4.12 Batch B11: JSONL Sanitization + Final Integration

**Entrega:** Sanitizacao no hooks CJS (nao no Zod schema). Version bump para v0.4.0. Parity target atualizado.

**Arquivos modificados:**
- Hooks CJS (truncamento de detail para 200 chars com `.slice(0, 200)`)
- `package.json`
- `.codex-plugin/plugin.json`

**NOTA:** O truncamento de `detail` e aplicado nos hooks CJS (como o CC faz), nao no Zod schema. Manter `gateDecisionSchema.detail = z.string()` sem `.max()` para evitar breaking change em entradas existentes.

## 5. Criterios de Aceite

Cada batch so e completo quando:

1. Todos testes TDD passam (RED -> GREEN -> Refactor)
2. Cenarios BDD passam (Given/When/Then)
3. **27 testes de integracao existentes** e **56 testes totais** passam (zero regressao)
4. Adversarial review: sem CRITICAL ou HIGH findings
5. Checkpoint: `npm run build` + `npm test`
6. CHANGELOG atualizado

**STOP rule:** 2 batches consecutivos com falha apos 3 fix loops = STOP + decisao do usuario.

## 6. Estrutura de Testes

```
tests/
  unit/
    hooks/           (*.test.cjs — session-lock, dispatch-guard, cleanup)
    security/        (*.test.ts — session-lock, exec-window, dispatch-contract)
    modes/           (*.test.ts — hotfix-wired)
    domain/          (*.test.ts — gate-decision-sanitization)
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
| Atomic writes no Windows: renameSync falha | `unlinkSync` antes de `renameSync`; teste especifico no B1 | Medio |
| Regressao nos 27 testes de integracao e 56 totais | Cada batch roda testes existentes antes de prosseguir | Alto |
| Paridade imperfeita com CC v4.1.0-rc.1 | Spec e aberto sobre diferencas (runtime TS vs prompt-driven); paridade funcional, nao literal | Baixo |
| PreToolUse nao passa tool_input para Edit/Write | Edit-guard implementado como middleware TS, nao hook CJS | Alto (mitigado) |
| `typescript` import em runtime (devDependency) | Documentar; preservar import no pipeline-controller.ts | Medio |
| dist/ com 77 arquivos nao commitados | Verificar se `.gitignore` cobre `dist/`; se nao, adicionar | Baixo |

## 10. Adversarial Review Log

Revisao realizada em 2026-04-25 com 3 agentes paralelos + pesquisa em openai/codex GitHub.

**Findings corrigidos neste spec:**

| ID | Severidade | Finding | Correcao aplicada |
|---|---|---|---|
| CRITICAL-1 | CRITICAL | Hook output formato errado ("allow"/"deny" vs "approve"/"block") | Secao 2.2 atualizada com schema oficial |
| CRITICAL-2 | CRITICAL | PreToolUse so define tool_name:Bash; Edit/Write hooks podem nao funcionar | Edit-guard redesignado como middleware TS (secao 3.1, 4.3) |
| HIGH-1 | HIGH | Contagem de testes errada (26 vs 27) | Corrigido para 27 integracao / 56 total |
| HIGH-2 | HIGH | Path divergence .pipeline/ vs .codex/pipeline/ | Tabela de path mapping adicionada (secao 2.4) |
| HIGH-3 | HIGH | Value objects divergem dos schemas reais do CC | SessionLock e ExecWindow alinhados (secoes 4.2, 4.3) |
| HIGH-4 | HIGH | Namespace diferente no dispatch-guard | Documentado (secoes 2.5, 4.4) |
| HIGH-5 | HIGH | SessionStart source field ignorado | Tratamento de resume adicionado (secao 4.2) |
| MEDIUM-1 | MEDIUM | Sentinel ja tem schema para 5 checkpoints | B4 reduzido para wiring apenas (secao 4.5) |
| MEDIUM-2 | MEDIUM | Testes de hooks CJS precisam formato especifico | *.test.cjs documentado (secao 2.3, 6) |
| MEDIUM-3 | MEDIUM | Atomic writes Windows precisa unlinkSync | Pattern documentado (secao 4.11) |
| MEDIUM-4 | MEDIUM | B7 renomeia arquivo ambiguo | Clarificado: somente src/primitives/ (secao 4.8) |
| LOW-1 | LOW | dist/ nao commitado | Adicionado como risco (secao 9) |
