# Implementation Tasks: Pipeline Trust Restoration

**Status:** ready-to-execute
**Total tasks:** 14 (P0:3 · P1:7 · P2:4) · **Sub-tasks:** ~30
**Estimated effort:** 10-14 days
**Critical path:** Task 1 → Task 2 → Task 4 → Task 5 (P0-1 → P0-2 → P1-1 → P1-2)

## Requirement-Task Mapping

| Requirement                            | Design Component                                  | Task | Arquivo principal                                                                 |
| -------------------------------------- | ------------------------------------------------- | ---- | -------------------------------------------------------------------------------- |
| R1 — Distinguishable Emulated         | Gate_Log_Writer                                   | T1   | `src/state/gate-log.ts`                                                          |
| R2 — Confidence Reflects Emulation    | Confidence_Model                                  | T2   | `src/gates/confidence-model.ts`                                                  |
| R11 — Hooks Fail Closed               | Hook_FailClosed (dispatch-guard + sentinel-hook)  | T3   | `hooks/dispatch-guard.cjs`, `hooks/sentinel-hook.cjs`                            |
| R3 — Review Cascade                   | Pipeline_Runtime + Review_Orchestrator            | T4   | `src/index.ts:691,699-701`, `src/review/review-orchestrator.ts`                  |
| R4 — Test strictAgents=undefined      | Test_Suite_StrictAgentsUndefined                  | T5   | `tests/integration/strict-agents-undefined.test.ts`                              |
| R5 — Post-Mortem dispatchMode         | Protocol_Event_Writer                             | T6   | `src/protocol/protocol-events.ts`                                                |
| R6 — Resume Preserves strictAgents    | Resume_Pipeline_Persistence                       | T7   | `src/state/session-store.ts`, `src/continue/resume-pipeline.ts`                  |
| R12 — Bash Edit Guard                 | Edit_Guard_Hook_Bash                              | T8   | `hooks/hooks.json:85`, `hooks/edit-guard-hook.cjs`                               |
| R13 — Exec Window Symlink             | Exec_Window_Symlink_Resistance                    | T9   | `scripts/exec-window/open.cjs:81,95`                                             |
| R14 — Plugin Templates                | Plugin_Templates_Repair                           | T10  | `~/.claude/skills/codex-plugin-builder/assets/templates/*`                       |
| R7 — Codex Adapter                    | Codex_Agent_Runtime_Adapter                       | T11  | `src/adapters/codex-agent-runtime.ts` (NEW), `src/index.ts:474`                  |
| R8 — Controller Authority             | Pipeline_Controller_Authority_Note                | T12  | `agents/core/pipeline-controller.md:1-20`                                        |
| R9 — Gate Hardness SSOT               | Gate_Hardness_Registry_Unification                | T13  | `src/gates/gate-registry.ts`, `src/gates/hardness-policy.ts`                     |
| R10 — KB Codex SSOT                   | KB_Codex_SSOT_Consolidation                       | T14  | `references/openai-codex-kb/*.md` + `CHANGELOG.kb.md`                            |

**Cobertura:** 14/14 requirements (100%). 14/14 design components (100%). 0 orphan tasks.

## Property-Task Mapping

| Property                            | Tipo       | Tasks que validam       | Test approach                                  |
| ----------------------------------- | ---------- | ----------------------- | ---------------------------------------------- |
| **P1: Provenance Determinism**     | Invariant  | T1.1, T1.2, T5.1, T6.1 | fast-check property test in T5.3              |
| **P2: Cascade Equivalence**        | Invariant  | T4.1, T5.2, T11.2      | fast-check property in T5.4                   |
| **P3: Confidence Monotonicity**    | Metamorphic| T2.1, T5.3              | fast-check metamorphic test in T2.2           |
| **P4: Hook Fail-Closed Universal** | Error      | T3.1, T3.2              | fast-check error-input test in T3.3           |
| **P5: Resume Idempotence**         | Idempotence| T7.1, T7.2              | fast-check idempotence test in T7.3           |

---

# PHASE 1 — P0 (Quick Wins) — Antes de confiar em qualquer output

## Task 1: Centralize Gate Log Writer + decided_by Provenance

**Requirement:** R1 — Distinguishable Emulated Dispatches
**Component:** Gate_Log_Writer
**Property:** P1: Provenance Determinism
**Estimated effort:** 2-3 hours

### 1.1 Extend `src/state/gate-log.ts` with `recordGateDecision` API

- [ ] **Arquivo:** `src/state/gate-log.ts`
- [ ] **Linhas:** estender com função nova + types
- [ ] **Grep para localizar:** `grep -n "atomicAppend\|gate-decisions" src/state/gate-log.ts`

**Contexto:**
Hoje, escritas em `gate-decisions.jsonl` acontecem em múltiplos sites (`src/index.ts:45,920-951,967`) com `decided_by` hardcoded. Criar API central que aceita provenance e infere `decided_by`.

**Antes (espalhado em src/index.ts):**

```typescript
// src/index.ts:45 (atualmente)
await gateLog.append({ /* ... */, decided_by: "controller" /* hardcoded */ });
```

**Depois (em src/state/gate-log.ts, NEW exports):**

```typescript
export type DecidedBy = "controller" | "user" | "system" | "resume-router";
export type DispatchMode = "real" | "emulated";

export type Provenance =
  | { source: "user" }
  | { source: "resume-router" }
  | { source: "dispatch"; dispatchMode: DispatchMode };

export interface RecordGateInput {
  pipelineDocPath: string;
  gate: string;
  hardness: "MANDATORY" | "HARD" | "CIRCUIT_BREAKER" | "SOFT";
  phase: string;
  decision: string;
  detail: string;
  confidence_impact?: number;
  provenance: Provenance;
}

function inferDecidedBy(p: Provenance): DecidedBy {
  if (p.source === "user") return "user";
  if (p.source === "resume-router") return "resume-router";
  if (p.source === "dispatch") return p.dispatchMode === "emulated" ? "system" : "controller";
  throw new Error("Indeterminable provenance");
}

export async function recordGateDecision(input: RecordGateInput): Promise<void> {
  const decided_by = inferDecidedBy(input.provenance);
  const entry = {
    gate: input.gate,
    hardness: input.hardness,
    phase: input.phase,
    decision: input.decision,
    decided_by,
    timestamp: new Date().toISOString(),
    detail: sanitizeDetail(input.detail),
    confidence_impact: input.confidence_impact ?? 0,
  };
  // Zod validate + atomic append (existing pattern)
  await atomicAppendGateLog(input.pipelineDocPath, entry);
}

function sanitizeDetail(d: string): string {
  return d.replace(/[\r\n]+/g, " ").slice(0, 200);
}
```

**Acceptance Criteria:**

1. [ ] `recordGateDecision` exported: `grep -n "export.*recordGateDecision" src/state/gate-log.ts`
2. [ ] `inferDecidedBy` covers all 3 provenance sources: `grep -A 10 "function inferDecidedBy" src/state/gate-log.ts`
3. [ ] Throws on indeterminable: visível no código
4. [ ] Build passa: `npm run lint:types`
5. [ ] Sanitize trims to 200 chars + strips newlines

### 1.2 Replace hardcoded `decided_by` in `src/index.ts`

- [ ] **Arquivo:** `src/index.ts`
- [ ] **Linhas:** 45, 920-951, 967
- [ ] **Grep para localizar:** `grep -n "decided_by" src/index.ts`

**Antes:**

```typescript
// src/index.ts:45 (atual)
await gateLog.append({ /* ... */, decided_by: "controller" });
```

**Depois:**

```typescript
await recordGateDecision({
  pipelineDocPath,
  gate: "...",
  hardness: "...",
  phase: "...",
  decision: "...",
  detail: "...",
  provenance: { source: "dispatch", dispatchMode: agentRuntime ? "real" : "emulated" },
});
```

**Acceptance Criteria:**

1. [ ] No hardcoded `decided_by: "controller"` outside gate-log.ts: `grep -rn "decided_by:" src/ --include="*.ts" | grep -v "gate-log.ts" | grep -v "schemas.ts"` should return 0 lines (or only test fixtures)
2. [ ] All 3 sites in src/index.ts converted: `grep -n "recordGateDecision" src/index.ts | wc -l` ≥ 3
3. [ ] Build passa: `npm run lint:types`

### 1.3 Add CI Lint Rule Forbidding Hardcoded `decided_by`

- [ ] **Arquivo:** novo arquivo `tests/unit/lint/decided-by-centralization.test.ts`
- [ ] **Grep para localizar:** N/A (novo)

**Cenários a testar:**

1. [ ] `it("forbids decided_by literal outside src/state/gate-log.ts")`
2. [ ] `it("allows decided_by in src/state/gate-log.ts itself")`
3. [ ] `it("allows decided_by in test fixtures under tests/")`

**Implementação (lint-as-test):**

```typescript
import { glob } from "node:fs/promises";
import { readFile } from "node:fs/promises";

it("forbids decided_by literal outside src/state/gate-log.ts", async () => {
  const files = await glob("src/**/*.ts");
  const violations: string[] = [];
  for (const file of files) {
    if (file.endsWith("gate-log.ts")) continue;
    if (file.endsWith("schemas.ts")) continue; // schema enum definition
    const content = await readFile(file, "utf8");
    if (/decided_by\s*:\s*["']/.test(content)) violations.push(file);
  }
  expect(violations).toEqual([]);
});
```

**Acceptance Criteria:**

1. [ ] Test exists: `ls tests/unit/lint/decided-by-centralization.test.ts`
2. [ ] Test passes: `npx vitest run tests/unit/lint/decided-by-centralization.test.ts`

### 1.4 Add Unit Tests for `recordGateDecision`

- [ ] **Arquivo:** `tests/unit/state/gate-log.test.ts` (estender ou criar)
- [ ] **Grep para localizar:** `ls tests/unit/state/gate-log.test.ts 2>/dev/null`

**Cenários a testar:**

1. [ ] `it("infers decided_by='system' for dispatch+emulated")`
2. [ ] `it("infers decided_by='controller' for dispatch+real")`
3. [ ] `it("infers decided_by='user' for source=user")`
4. [ ] `it("throws on indeterminable provenance")`
5. [ ] `it("sanitizes detail (trim 200, strip newlines)")`
6. [ ] `it("validates entry via Zod before append")`

**Acceptance Criteria:**

1. [ ] All 6 scenarios pass: `npx vitest run tests/unit/state/gate-log.test.ts`
2. [ ] Coverage of `inferDecidedBy` branches: 100%

---

## Task 2: Confidence Model Reflects Emulation

**Requirement:** R2 — Confidence Reflects Emulation
**Component:** Confidence_Model
**Property:** P3: Confidence Monotonicity
**Estimated effort:** 1-2 hours

### 2.1 Extend `Confidence_Model` with Emulation Scan + Cap

- [ ] **Arquivo:** `src/gates/confidence-model.ts`
- [ ] **Linhas:** 39-65 (cálculo aritmético atual)
- [ ] **Grep para localizar:** `grep -n "createConfidenceModel\|final_score" src/gates/confidence-model.ts`

**Antes:**

```typescript
// src/gates/confidence-model.ts:39-65 (atual)
function calculate(entries: ConfidenceGateEntry[]): ConfidenceResult {
  const sum = entries.reduce((acc, e) => acc + e.confidence_impact, 0);
  return {
    final_score: Math.max(0, Math.min(1, sum)),
    // ... outros campos
  };
}
```

**Depois:**

```typescript
const CONFIDENCE_CAP_THRESHOLD = 0.5;

async function calculate(
  entries: ConfidenceGateEntry[],
  pipelineDocPath: string,
): Promise<ConfidenceResult> {
  const arithmeticScore = Math.max(0, Math.min(1, entries.reduce((a, e) => a + e.confidence_impact, 0)));

  // R2 AC 2.1 — scan gate-decisions.jsonl for decided_by='system'
  const emulatedCount = await countEmulatedEntries(pipelineDocPath);

  if (emulatedCount > 0) {
    // R2 AC 2.2 — cap
    const finalScore = Math.min(arithmeticScore, CONFIDENCE_CAP_THRESHOLD);
    // R2 AC 2.5 — log
    logger.info("[trust-restoration] Confidence cap applied", {
      arithmeticScore, finalScore, emulatedCount,
    });
    return {
      final_score: finalScore,
      confidenceSource: "emulated", // R2 AC 2.3
      emulated_entry_count: emulatedCount,
      // ... outros campos
    };
  }

  return {
    final_score: arithmeticScore,
    confidenceSource: "real",         // R2 AC 2.4
    emulated_entry_count: 0,
    // ... outros campos
  };
}

async function countEmulatedEntries(pipelineDocPath: string): Promise<number> {
  const path = `${pipelineDocPath}/gate-decisions.jsonl`;
  if (!existsSync(path)) return 0;
  const content = await readFile(path, "utf8");
  return content.split("\n")
    .filter(line => line.trim())
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(e => e?.decided_by === "system")
    .length;
}
```

**Acceptance Criteria:**

1. [ ] `CONFIDENCE_CAP_THRESHOLD` constant present: `grep -n "CONFIDENCE_CAP_THRESHOLD" src/gates/confidence-model.ts`
2. [ ] `countEmulatedEntries` implemented: `grep -n "countEmulatedEntries" src/gates/confidence-model.ts`
3. [ ] Cap logic gated on count > 0
4. [ ] `confidenceSource` field added to result
5. [ ] Build passa: `npm run lint:types`

### 2.2 Update `confidence-score.yaml` Persistence to Include `confidenceSource`

- [ ] **Arquivo:** `src/state/confidence-score.ts` (writer)
- [ ] **Grep para localizar:** `grep -rn "confidence-score.yaml" src/`

**Mudança:** YAML serializer deve incluir `confidenceSource` no top-level.

### 2.3 Add Unit Tests for Confidence Cap (P3 Metamorphic Test)

- [ ] **Arquivo:** `tests/unit/gates/confidence-model.test.ts` (estender)
- [ ] **Grep para localizar:** `grep -n "describe.*confidence" tests/unit/gates/`

**Cenários a testar:**

1. [ ] `it("caps final_score to 0.5 when ≥1 system entry exists")`
2. [ ] `it("does NOT cap when zero system entries")`
3. [ ] `it("writes confidenceSource='emulated' when capped")`
4. [ ] `it("writes confidenceSource='real' when not capped")`
5. [ ] `it("P3 metamorphic: adding system entry never increases final_score")`

**P3 fast-check test:**

```typescript
import fc from "fast-check";

it("P3: adding decided_by='system' entry never increases final_score", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(arbGateEntry(), { minLength: 1, maxLength: 50 }),
      async (entries) => {
        const before = (await calculate(entries, mockPath)).final_score;
        const withSystem = [...entries, arbGateEntry({ decided_by: "system" })];
        const after = (await calculate(withSystem, mockPath)).final_score;
        return after <= before;
      },
    ),
    { numRuns: 100 },
  );
});
```

**Acceptance Criteria:**

1. [ ] All 5 scenarios pass: `npx vitest run tests/unit/gates/confidence-model.test.ts`
2. [ ] fast-check runs 100 cases without counterexample
3. [ ] Performance: scan + cap < 50ms in test environment

---

## Task 3: Hooks Fail Closed on Internal Exception

**Requirement:** R11 — Hooks Fail Closed
**Component:** Hook_FailClosed (dispatch-guard + sentinel-hook)
**Property:** P4: Hook Fail-Closed Universal
**Estimated effort:** 1-2 hours

### 3.1 Wrap `dispatch-guard.cjs` Handler in try/catch → deny

- [ ] **Arquivo:** `hooks/dispatch-guard.cjs`
- [ ] **Linhas:** 391-402 (main handler)
- [ ] **Grep para localizar:** `grep -n "module.exports\|async function" hooks/dispatch-guard.cjs`

**Antes:**

```javascript
// hooks/dispatch-guard.cjs (current handler)
async function evaluate(input) {
  // ... existing logic ...
  return result;
}
```

**Depois:**

```javascript
async function evaluate(input) {
  try {
    // ... existing logic unchanged ...
    return result;
  } catch (err) {
    // R11 AC 11.1, 11.4 — fail-closed + sanitized reason
    process.stderr.write(`[dispatch-guard] internal error: ${err.message}\n`);
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "hook internal error — failing closed",
      },
    };
  }
}
```

**Acceptance Criteria:**

1. [ ] try/catch wraps main handler: `grep -A 5 "try {" hooks/dispatch-guard.cjs | grep "catch"`
2. [ ] Fail-closed deny output present: `grep "failing closed" hooks/dispatch-guard.cjs`
3. [ ] No `err.message` or `err.stack` in user-facing reason
4. [ ] Hook still works on happy path (existing tests pass): `npx vitest run tests/unit/hooks/dispatch-guard.test.ts`

### 3.2 Wrap `sentinel-hook.cjs` Handler + Corrupted State Branch

- [ ] **Arquivo:** `hooks/sentinel-hook.cjs`
- [ ] **Linhas:** 108-112 (state load), 181-184 (sequence validation)
- [ ] **Grep para localizar:** `grep -n "JSON.parse\|catch" hooks/sentinel-hook.cjs`

**Mudança:** mesmo padrão de T3.1, mais branch específico para JSON.parse falhar em sentinel-state.json (R11 AC 11.3).

**Acceptance Criteria:**

1. [ ] try/catch in both handlers
2. [ ] Corrupted state branch fails-closed: inject malformed JSON in test
3. [ ] Bootstrap agents (per existing logic) still allowed to proceed

### 3.3 Integration Test: Malformed Payload → Deny (P4)

- [ ] **Arquivo:** `tests/integration/hook-fail-closed.test.ts` (NEW)
- [ ] **Grep para localizar:** N/A

**Cenários:**

1. [ ] `it("dispatch-guard denies on malformed stdin JSON")`
2. [ ] `it("sentinel-hook denies on corrupted state file (non-bootstrap)")`
3. [ ] `it("sentinel-hook allows bootstrap agents even when state is corrupted")`
4. [ ] `it("P4: any malformed input → permissionDecision='deny'")` — fast-check property

**Acceptance Criteria:**

1. [ ] All scenarios pass: `npx vitest run tests/integration/hook-fail-closed.test.ts`
2. [ ] fast-check P4 property runs ≥50 random inputs

---

## CHECKPOINT 1: P0 Quick Wins Complete

**Quando:** após T1, T2, T3
**Objetivo:** Pipeline runs now distinguish emulated dispatches in logs, cap confidence accordingly, and hooks fail closed on internal errors. Trust floor estabelecido.
**Properties validadas:** P1 (Provenance Determinism), P3 (Confidence Monotonicity), P4 (Hook Fail-Closed Universal)

### Validações Automáticas

- [ ] `npm run build` — sem erros
- [ ] `npm run lint:types` — sem erros
- [ ] `npx vitest run tests/unit/state/gate-log.test.ts` — todos passam
- [ ] `npx vitest run tests/unit/gates/confidence-model.test.ts` — todos passam
- [ ] `npx vitest run tests/integration/hook-fail-closed.test.ts` — todos passam
- [ ] `npx vitest run tests/unit/lint/decided-by-centralization.test.ts` — passa
- [ ] `grep -rn "decided_by:" src/ --include="*.ts" | grep -v "gate-log.ts\|schemas.ts\|/test"` — 0 linhas

### Validações Manuais

1. **Smoke test em pipeline real:**
   - Rodar `npm run build && node dist/src/cli/pipeline-cli.js "smoke test no adapter"`
   - Esperado: `confidence-score.yaml` tem `confidenceSource: "emulated"` e `final_score ≤ 0.5`
   - Esperado: `gate-decisions.jsonl` tem ≥1 entry com `decided_by: "system"`

### Critério de Sucesso

- Emulated dispatches são auditáveis em log
- Confidence reflete a presença de emulação
- Hooks não fazem fail-open em exception

### Se Falhar (Troubleshooting)

| Sintoma                                            | Causa provável                                          | Ação                                                         |
| -------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------ |
| Lint test 1.3 falha apontando arquivos fixture     | Fixtures de teste contém `decided_by` literal           | Adicionar exceção para `tests/**/fixtures/**` no glob        |
| `final_score` não cap em 0.5                       | `countEmulatedEntries` lendo path errado                | Verificar `pipelineDocPath` ser passado corretamente         |
| Hook denies bootstrap agents indevidamente         | try/catch não distingue bootstrap path                  | Inspecionar lógica original — manter bootstrap branch fora do catch |
| Confidence tests fast-check timeout                | Mock async path muito lento                             | Reduzir `numRuns` para 50 ou mockar I/O                      |

### Após Passar

- [ ] Commit: `fix(trust): P0 — centralize gate-log writer + confidence cap + hooks fail-closed (R1, R2, R11)`
- [ ] Push para branch
- [ ] Prosseguir para Phase 2

---

# PHASE 2 — P1 (Sprint)

## Task 4: Cascade Fix for Review Orchestrators

**Requirement:** R3 — Review Orchestrators Inherit Cascade
**Component:** Pipeline_Runtime + Review_Orchestrator + Final_Adversarial_Orchestrator
**Property:** P2: Cascade Equivalence
**Estimated effort:** 1-2 hours

### 4.1 Refactor Orchestrator Interfaces to Lazy Resolver

- [ ] **Arquivo:** `src/review/review-orchestrator.ts` + `src/review/final-adversarial-orchestrator.ts`
- [ ] **Grep para localizar:** `grep -n "requireRealAgent" src/review/`

**Antes:**

```typescript
// src/review/review-orchestrator.ts:75
export function createReviewOrchestrator(deps: { runRole: RunRoleFn; requireRealAgent: boolean }) {
  // ... uses deps.requireRealAgent ...
}
```

**Depois:**

```typescript
export interface ReviewOrchestratorDeps {
  runRole: RunRoleFn;
  requireRealAgentForRequest: (request: DispatchRequest) => boolean;
}

export function createReviewOrchestrator(deps: ReviewOrchestratorDeps) {
  // ... per-request: const requireRealAgent = deps.requireRealAgentForRequest(req);
}
```

Mesmo padrão em `final-adversarial-orchestrator.ts`.

**Acceptance Criteria:**

1. [ ] Interface usa `requireRealAgentForRequest` (function), não `requireRealAgent` (boolean)
2. [ ] Build passa: `npm run lint:types`
3. [ ] Existing tests adaptados ou atualizados para o novo contrato

### 4.2 Apply Cascade in `src/index.ts:691,699-701`

- [ ] **Arquivo:** `src/index.ts`
- [ ] **Linhas:** 691 (review), 699-701 (final-adversarial)
- [ ] **Grep para localizar:** `grep -n "createReviewOrchestrator\|createFinalAdversarialOrchestrator" src/index.ts`

**Antes:**

```typescript
const runtimeReviewOrchestrator = createReviewOrchestrator({
  runRole: runtimeRunRole,
  requireRealAgent: options.strictAgents === true,
});
const runtimeFinalAdversarialOrchestrator = createFinalAdversarialOrchestrator({
  runRole: runtimeRunRole,
  requireRealAgent: options.strictAgents === true,
});
```

**Depois:**

```typescript
const resolveRequireReal = (request: DispatchRequest) =>
  request.requireRealAgent ?? options.strictAgents ?? isOperationalPipelineDispatch(request);

const runtimeReviewOrchestrator = createReviewOrchestrator({
  runRole: runtimeRunRole,
  requireRealAgentForRequest: resolveRequireReal,
});
const runtimeFinalAdversarialOrchestrator = createFinalAdversarialOrchestrator({
  runRole: runtimeRunRole,
  requireRealAgentForRequest: resolveRequireReal,
});
```

**Acceptance Criteria:**

1. [ ] Cascade resolver definido uma vez (DRY): `grep -n "resolveRequireReal\|requireRealAgentForRequest" src/index.ts`
2. [ ] Old `=== true` removido: `grep -n "strictAgents === true" src/index.ts` retorna 0 ou só comentários
3. [ ] Build passa
4. [ ] Existing review tests passam (com fixtures atualizadas se necessário per R3 AC 3.5)

---

## Task 5: Test Coverage for strictAgents=undefined Path

**Requirement:** R4 — Test Coverage
**Component:** Test_Suite_StrictAgentsUndefined
**Property:** P2: Cascade Equivalence
**Estimated effort:** 2-3 hours

### 5.1 Create `tests/integration/strict-agents-undefined.test.ts`

- [ ] **Arquivo:** `tests/integration/strict-agents-undefined.test.ts` (NEW)
- [ ] **Grep para localizar:** N/A

**Header com referência ao spec (R4 AC 4.5):**

```typescript
/**
 * Spec: pipeline-trust-restoration / R4 / G-P1-2
 * Covers: R4 AC 4.1, 4.2, 4.3
 */
```

**Cenários (3 AC scenarios):**

1. [ ] `it("AC 4.1: review-orchestrator without adapter → decided_by='system' in gate-log")`
2. [ ] `it("AC 4.2: final-adversarial-orchestrator symmetric to 4.1")`
3. [ ] `it("AC 4.3: confidence final_score ≤ 0.5 when ≥1 decided_by='system'")`

### 5.2 P2 Cascade Equivalence Property Test

- [ ] No mesmo arquivo, adicionar:

```typescript
import fc from "fast-check";

it("P2: cascade equivalence across runtimeRunRole, review, final-adversarial", () => {
  fc.assert(
    fc.property(
      fc.record({
        strictAgents: fc.option(fc.boolean()),
        prompt: fc.string({ minLength: 1, maxLength: 200 }),
      }),
      ({ strictAgents, prompt }) => {
        const req = makeDispatchRequest({ input: { request: prompt } });
        const fromRunRole = resolveFromRunRole({ strictAgents }, req);
        const fromReview = resolveFromReview({ strictAgents }, req);
        const fromFinal = resolveFromFinal({ strictAgents }, req);
        return fromRunRole === fromReview && fromReview === fromFinal;
      },
    ),
    { numRuns: 200 },
  );
});
```

### 5.3 Determinism Check (AC 4.4)

- [ ] Adicionar `it("R4 AC 4.4: scenarios run deterministically (no flakiness)")` que roda cada cenário 10x e verifica resultado idêntico

**Acceptance Criteria:**

1. [ ] 4 scenarios + 1 property test present
2. [ ] All pass: `npx vitest run tests/integration/strict-agents-undefined.test.ts`
3. [ ] Header comment references R4 + AC numbers
4. [ ] CI wires this file (já coberto pelo glob `tests/integration/**`)

---

## Task 6: dispatchMode Field in Protocol Events

**Requirement:** R5 — Post-Mortem Distinguishability
**Component:** Protocol_Event_Writer
**Property:** P1: Provenance Determinism (extended)
**Estimated effort:** 1 hour

### 6.1 Extend Zod Schema with `dispatchMode`

- [ ] **Arquivo:** `src/protocol/protocol-events.ts`
- [ ] **Linhas:** 62-117 (schema)
- [ ] **Grep para localizar:** `grep -n "protocolEventSchema\|z.object" src/protocol/protocol-events.ts`

**Adicionar campo:**

```typescript
export const protocolEventSchema = z.object({
  // ... existing fields ...
  dispatchMode: z.enum(["real", "emulated"]).optional(), // R5 AC 5.2
});
```

### 6.2 Populate `dispatchMode` in Writer Call Sites

- [ ] **Grep para localizar:** `grep -rn "appendProtocolEvent\|recordDispatchEvent" src/`

**Mudança:** todo writer de `DISPATCH_REQUEST` event deve passar `dispatchMode` baseado em `agentRuntime ? "real" : "emulated"`.

### 6.3 Backward-Compat Parser Tag (AC 5.5)

- [ ] **Arquivo:** parser/reader de `protocol-events.jsonl`
- [ ] Mudança: ao ler entry sem `dispatchMode`, tag downstream report com `"unknown"`

**Acceptance Criteria:**

1. [ ] Schema test: `npx vitest run tests/unit/protocol/protocol-events.test.ts` — campo aceito como opcional
2. [ ] Writer test: `dispatchMode` populated when agentRuntime presence is checked
3. [ ] Legacy entry sem campo parse sem erro

---

## Task 7: Resume Preserves strictAgents

**Requirement:** R6 — Resume Preserves strictAgents
**Component:** Resume_Pipeline_Persistence
**Property:** P5: Resume Idempotence
**Estimated effort:** 2 hours

### 7.1 Add `strictAgents` to Session Schema

- [ ] **Arquivo:** `src/state/session-store.ts`
- [ ] **Grep para localizar:** `grep -n "interface.*Session\|PersistedSession" src/state/session-store.ts`

**Patch:**

```typescript
export interface PersistedSession {
  // ... existing fields ...
  strictAgents?: boolean; // R6 AC 6.1 (optional para backward-compat AC 6.3)
}
```

### 7.2 Resume Resolver Reads and Applies strictAgents

- [ ] **Arquivo:** `src/continue/resume-pipeline.ts` + `src/controller/continue-state.ts`
- [ ] **Linhas:** resume-pipeline.ts:1-16

**Mudança:** ao resumir, passar `strictAgents: persisted.strictAgents ?? options.strictAgents` para o runtime.

### 7.3 Integration Test (P5 Idempotence)

- [ ] **Arquivo:** `tests/integration/resume-strict-agents.test.ts` (NEW)

**Cenários:**

1. [ ] `it("R6 AC 6.5: resume with strictAgents=true does NOT emit decided_by='system'")`
2. [ ] `it("R6 AC 6.3: legacy session without strictAgents → cascade applies fresh")`
3. [ ] `it("P5: N consecutive resumes preserve strictAgents (idempotence)")` — fast-check com `numRuns: 50`

**Acceptance Criteria:**

1. [ ] Tests pass: `npx vitest run tests/integration/resume-strict-agents.test.ts`
2. [ ] Schema migration backward-compat: legacy fixture parses

---

## Task 8: Bash Tool Coverage in Edit Guard

**Requirement:** R12 — Bash Edit Guard
**Component:** Edit_Guard_Hook_Bash
**Property:** N/A (specific behavior)
**Estimated effort:** 2 hours

### 8.1 Update Matcher in `hooks/hooks.json`

- [ ] **Arquivo:** `hooks/hooks.json`
- [ ] **Linhas:** 85
- [ ] **Grep para localizar:** `grep -n "Edit\|Write\|matcher" hooks/hooks.json`

**Antes:**

```json
{ "matcher": "Edit|Write|NotebookEdit|MultiEdit", "hooks": [...] }
```

**Depois:**

```json
{ "matcher": "Edit|Write|NotebookEdit|MultiEdit|Bash", "hooks": [...] }
```

### 8.2 Implement Bash Parse Logic in `edit-guard-hook.cjs`

- [ ] **Arquivo:** `hooks/edit-guard-hook.cjs`
- [ ] **Linhas:** 24+ (existing logic)
- [ ] **Grep para localizar:** `grep -n "tool_name\|evaluate" hooks/edit-guard-hook.cjs`

**Adicionar branch para Bash:**

```javascript
if (event.tool_name === "Bash") {
  const command = event.tool_input?.command || "";
  return evaluateBashCommand(command, allowedScope);
}

function evaluateBashCommand(command, scope) {
  const writeRedirect = /(\s|^)([>]{1,2})\s*(\S+)/g;
  const rmOrMv = /\b(rm|mv)\s+(?:-[a-z]+\s+)?(\S+)/g;
  for (const m of command.matchAll(writeRedirect)) {
    if (!isPathAllowed(m[3], scope)) {
      return denyResponse(`write redirect '${m[2]}' to ${m[3]} outside allowed scope`);
    }
  }
  for (const m of command.matchAll(rmOrMv)) {
    if (!isPathAllowed(m[2], scope)) {
      return denyResponse(`${m[1]} on ${m[2]} outside allowed scope`);
    }
  }
  return allowResponse();
}
```

### 8.3 Integration Test

- [ ] **Arquivo:** `tests/integration/bash-edit-guard.test.ts` (NEW)

**Cenários:**

1. [ ] `it("R12 AC 12.5: Bash 'echo x > unauthorized.txt' is denied")`
2. [ ] `it("R12 AC 12.4: Bash 'cat file.txt' is allowed")`
3. [ ] `it("R12 AC 12.3: 'rm /tmp/safe' targeting allowed path is allowed")`

**Open issue (research.md):** Confirmar tool name `Bash` é canônico no Codex 2026. Se for outro nome, ajustar matcher.

**Acceptance Criteria:**

1. [ ] Tests pass
2. [ ] Existing Edit/Write tests não regridem

---

## Task 9: Exec Window Symlink Resistance

**Requirement:** R13 — Exec Window Symlink Resistance
**Component:** Exec_Window_Symlink_Resistance
**Property:** N/A
**Estimated effort:** 1 hour

### 9.1 Add `lstat` Check Before `renameSync`

- [ ] **Arquivo:** `scripts/exec-window/open.cjs`
- [ ] **Linhas:** 81, 95
- [ ] **Grep para localizar:** `grep -n "renameSync" scripts/exec-window/open.cjs`

**Patch:**

```javascript
function safeRenameSync(src, dest) {
  if (fs.existsSync(dest)) {
    const stats = fs.lstatSync(dest);
    if (stats.isSymbolicLink()) {
      auditLog({ event: "symlink-refused", target: dest });
      const err = new Error(`SymlinkRefusedError: refusing to renameSync over symlink at ${dest}`);
      err.code = "SYMLINK_REFUSED";
      throw err;
    }
  }
  fs.renameSync(src, dest);
}
```

Substituir as 2 chamadas `fs.renameSync(...)` por `safeRenameSync(...)`.

### 9.2 Integration Test

- [ ] **Arquivo:** `tests/integration/exec-window-symlink.test.ts` (NEW)

**Cenários:**

1. [ ] `it("R13 AC 13.5: pre-existing symlink at target → aborts with SymlinkRefusedError")`
2. [ ] `it("R13 AC 13.4: normal rename proceeds when no symlink")`

**Acceptance Criteria:**

1. [ ] Tests pass
2. [ ] Audit log entry written when refusal triggers

---

## Task 10: Plugin Templates Repair (FORMALIZATION)

**Requirement:** R14 — Plugin Templates Safe
**Component:** Plugin_Templates_Repair
**Property:** N/A
**Estimated effort:** 30 minutes (já foi feito; só formalizar)

### 10.1 Verify Templates Already Fixed

- [ ] **Path:** `C:/Users/win/.claude/skills/codex-plugin-builder/assets/templates/`
- [ ] **Grep para verificar:** `ls C:/Users/win/.claude/skills/codex-plugin-builder/assets/templates/`

**Estado esperado** (já corrigido em sessão anterior):

- `hook-deny.cjs` com fail-closed default (catch chama `deny()`)
- `hooks.json` wirando apenas `hook-deny.cjs` (sem refs ghost)
- `build-checklist.md` com item sobre file existence

**Verificação:**

```bash
grep -A 2 "catch" "C:/Users/win/.claude/skills/codex-plugin-builder/assets/templates/hook-deny.cjs"
# Esperado: catch block calls deny(), not allow()

grep -c "session-start.cjs\|user-prompt.cjs" "C:/Users/win/.claude/skills/codex-plugin-builder/assets/templates/hooks.json"
# Esperado: 0
```

### 10.2 Add Build Checklist Item (AC 14.5)

- [ ] **Arquivo:** `C:/Users/win/.claude/skills/codex-plugin-builder/references/build-checklist.md`
- [ ] **Grep para verificar:** `grep "every.*command.*resolves" C:/Users/win/.claude/skills/codex-plugin-builder/references/build-checklist.md`

Item esperado já presente (verificar fraseamento exato e ajustar se necessário).

**Acceptance Criteria:**

1. [ ] hook-deny.cjs catch → deny (já)
2. [ ] hooks.json sem refs ghost (já)
3. [ ] build-checklist item presente

---

## CHECKPOINT 2: P1 Mid-Sprint (after T4-T7)

**Quando:** após T4, T5, T6, T7
**Objetivo:** Cascade fix aplicada, test coverage do caminho `strictAgents=undefined` existe, observability post-mortem completa, resume preserva strictAgents.
**Properties validadas:** P1 (extended via T6), P2 (validated via T5.2), P5 (validated via T7.3)

### Validações Automáticas

- [ ] `npm run build` — sem erros
- [ ] `npm test` — todos passam
- [ ] `npx vitest run tests/integration/strict-agents-undefined.test.ts` — 4 scenarios + property test passa
- [ ] `npx vitest run tests/integration/resume-strict-agents.test.ts` — passa
- [ ] `grep -n "strictAgents === true" src/index.ts` — 0 matches no main code (só comentários se houver)

### Validações Manuais

1. **Resume smoke test:**
   - Rodar pipeline com `--strict-agents`, interromper, rodar `/pipeline continue`
   - Esperado: não há `decided_by: "system"` no gate-log da run resumida

### Critério de Sucesso

- Causa raiz do Emulation Theatre é corrigida em código
- Vetor R4 está coberto em CI
- Observability é queryável

### Se Falhar

| Sintoma | Causa provável | Ação |
| --- | --- | --- |
| P2 cascade test counterexample | Resolver assina diferente entre sites | Refatorar `resolveRequireReal` como utility exportada |
| Resume integration test flaky | Async session write não esperado | Adicionar `await` em session.save() antes de resume |
| Bash hook quebra tests existentes | Matcher regex muito agressiva | Refinar regex; testar com payloads de read-only |

### Após Passar

- [ ] Commit: `fix(trust): P1 mid — cascade + tests + dispatchMode + resume (R3, R4, R5, R6)`

---

## CHECKPOINT 3: P1 Complete (after T8-T10)

**Quando:** após T8, T9, T10
**Objetivo:** Cluster de segurança fechado; templates corrigidos.

### Validações Automáticas

- [ ] `npx vitest run tests/integration/bash-edit-guard.test.ts` — passa
- [ ] `npx vitest run tests/integration/exec-window-symlink.test.ts` — passa
- [ ] `grep "Bash" hooks/hooks.json` — Bash no matcher
- [ ] `grep "lstatSync" scripts/exec-window/open.cjs` — presente

### Após Passar

- [ ] Commit: `fix(trust): P1 security — Bash edit-guard + symlink + templates (R12, R13, R14)`

---

# PHASE 3 — P2 (Structural)

## Task 11: Codex agentRuntime Adapter (NEW)

**Requirement:** R7 — Native Codex agentRuntime Adapter
**Component:** Codex_Agent_Runtime_Adapter
**Property:** P2: Cascade Equivalence
**Estimated effort:** 3-5 days (iteração com ambiente Codex real)

### 11.1 Create `src/adapters/codex-agent-runtime.ts`

- [ ] **Arquivo:** `src/adapters/codex-agent-runtime.ts` (NEW)
- [ ] **Grep para verificar existência:** `ls src/adapters/codex-agent-runtime.ts 2>/dev/null`

**Implementação completa em design.md §3.7.** Resumo:

- `createCodexAgentRuntimeAdapter(options)` — implementa `AgentRuntimeAdapter`
- `detectCodexAgentRuntime()` — detector via `globalThis.spawn_agent` ou env vars

### 11.2 Integrate in `createPipelineRuntime`

- [ ] **Arquivo:** `src/index.ts`
- [ ] **Linhas:** ~474 (entry point)
- [ ] **Grep:** `grep -n "createPipelineRuntime" src/index.ts`

**Patch:** detectar adapter, defaultar `strictAgents` para `true` quando detectado, logar warning se opt-out.

### 11.3 Integration Test for Adapter Detection

- [ ] **Arquivo:** `tests/integration/adapter-detection.test.ts` (NEW)

**Cenários:**

1. [ ] `it("R7 AC 7.1: adapter registered when globalThis.spawn_agent exists")`
2. [ ] `it("R7 AC 7.2: strictAgents defaults to true when adapter detected")`
3. [ ] `it("R7 AC 7.4: adapter without spawn_agent throws AgentRuntimeUnavailableError")`
4. [ ] `it("R7 AC 7.5: opt-out emits warning log")`

**Open risk (research.md):** detecção robusta pode requerer iteração em ambiente Codex real. Documentar em test se algum cenário precisa de fixture específica.

**Acceptance Criteria:**

1. [ ] Adapter file created
2. [ ] Build passa
3. [ ] Tests pass with mock spawn_agent

---

## Task 12: Pipeline Controller AUTHORITY_NOTE

**Requirement:** R8 — Pipeline Controller Authority Resolution
**Component:** Pipeline_Controller_Authority_Note
**Property:** N/A
**Estimated effort:** 30 minutes

### 12.1 Add AUTHORITY_NOTE Header to `pipeline-controller.md`

- [ ] **Arquivo:** `agents/core/pipeline-controller.md`
- [ ] **Linhas:** 1-20
- [ ] **Grep para localizar:** `grep -n "^---\|sole orchestrator" agents/core/pipeline-controller.md`

**Patch (escolha opção (b) — tombstone com AUTHORITY_NOTE):**

```markdown
---
name: pipeline-controller
description: Pipeline controller — primary orchestration role for /pipeline-orchestrator-for-codex:pipeline workflow. SSOT operacional: src/controller/pipeline-controller.ts.
tools: Read, Write, Glob, Grep, Skill
model: gpt-4o
color: red
---

> **AUTHORITY_NOTE (2026-05-19):**
> Esta especificação markdown documenta o contrato conceitual...
> [conteúdo completo em design.md §3.8]
```

### 12.2 CI Test for AUTHORITY_NOTE Presence (CI-4)

- [ ] **Arquivo:** `tests/unit/agents-inventory.test.ts` (estender)
- [ ] **Grep para localizar:** `grep -n "agents-inventory" tests/unit/`

**Cenário:**

```typescript
it("R8 AC 8.3 / CI-4: pipeline-controller.md has AUTHORITY_NOTE in first 25 lines", () => {
  const content = readFileSync("agents/core/pipeline-controller.md", "utf8");
  const firstLines = content.split("\n").slice(0, 25).join("\n");
  expect(firstLines).toMatch(/AUTHORITY_NOTE/);
});
```

### 12.3 Update Stale "37 N2 agents" Claim (AC 8.5)

- [ ] **Arquivo:** mesmo, frontmatter description
- [ ] Substituir "37 N2 agents" pela contagem real (45) ou remover claim numérica

**Acceptance Criteria:**

1. [ ] AUTHORITY_NOTE presente
2. [ ] CI test passa
3. [ ] Frontmatter atualizado

---

## Task 13: Gate Hardness Single Authority

**Requirement:** R9 — Single Authority for Gate Hardness
**Component:** Gate_Hardness_Registry_Unification
**Property:** N/A
**Estimated effort:** 1 day

### 13.1 Demote `hardness-policy.ts` to Test Utility

- [ ] **Arquivo:** `src/gates/hardness-policy.ts`
- [ ] **Grep para localizar:** `grep -n "classifyGateHardness" src/gates/hardness-policy.ts`

**Patch:** adicionar header documentando demotion (não deletar — usado por CI test).

### 13.2 Create Consistency Test (AC 9.4)

- [ ] **Arquivo:** `tests/unit/gates/gate-hardness-consistency.test.ts` (NEW)
- [ ] **Grep para verificar existência:** `ls tests/unit/gates/gate-hardness-consistency.test.ts 2>/dev/null`

**Implementação em design.md §3.9.**

### 13.3 Documentation

- [ ] Atualizar `references/gates.md` ou criar (atualmente não existe) com referência clara: `gate-registry.ts` é SSOT; `hardness-policy.ts` é teste utility.

**Acceptance Criteria:**

1. [ ] Test passes for all 26 gates
2. [ ] Header in hardness-policy.ts declara demotion
3. [ ] Build passa

---

## Task 14: KB Codex SSOT Consolidation

**Requirement:** R10 — KB Codex SSOT
**Component:** KB_Codex_SSOT_Consolidation
**Property:** N/A
**Estimated effort:** 1-2 days

### 14.1 Rewrite 4 KB Files to Corrected State

- [ ] **Arquivos:** `references/openai-codex-kb/plugins.md`, `skills.md`, `agents-and-subagents.md`, `rules-hooks-agents-md.md`
- [ ] **Grep para localizar Drift Notes:** `grep -n "Drift Notes" references/openai-codex-kb/*.md`

**Process por arquivo:**

1. Identificar afirmações stale na parte superior
2. Reescrever inline com versão correta (do `plugin-build-guide.md`)
3. Remover seção `## Drift Notes (2026-05-19)`
4. Atualizar frontmatter `last_verified: 2026-05-19`

### 14.2 Create `CHANGELOG.kb.md`

- [ ] **Arquivo:** `references/openai-codex-kb/CHANGELOG.kb.md` (NEW)
- [ ] **Conteúdo:** mover conteúdo dos 4 Drift Notes para cá (preserva history editorial — mitigação R-6)

### 14.3 CI Test for last_verified Uniformity (CI-5)

- [ ] **Arquivo:** `tests/unit/openai-codex-kb.test.ts` (estender)
- [ ] **Grep para localizar:** `grep -n "openai-codex-kb" tests/unit/`

**Cenário:**

```typescript
it("R10 AC 10.2 / CI-5: all KB files have same last_verified date", () => {
  const files = globSync("references/openai-codex-kb/*.md", { ignore: ["**/CHANGELOG*"] });
  const dates = files.map(f => parseFrontmatter(readFileSync(f, "utf8")).last_verified);
  expect(new Set(dates).size).toBe(1);
});
```

**Acceptance Criteria:**

1. [ ] 4 KB files rewritten
2. [ ] CHANGELOG.kb.md created
3. [ ] CI test passes
4. [ ] Grep não retorna stale "Drift Notes" nos 4 arquivos antigos

---

## CHECKPOINT 4: P2 Complete (after T11-T14)

**Quando:** após T11, T12, T13, T14
**Objetivo:** Estrutura de autoridade unificada (controller markdown clear, gate hardness SSOT, KB SSOT) e adapter Codex nativo shipped (ou stubbed se ambiente real não acessível).

### Validações Automáticas

- [ ] `npm run build` — sem erros
- [ ] `npm test` — todos passam
- [ ] `npx vitest run tests/integration/adapter-detection.test.ts` — passa
- [ ] `npx vitest run tests/unit/gates/gate-hardness-consistency.test.ts` — passa
- [ ] `npx vitest run tests/unit/openai-codex-kb.test.ts` — passa
- [ ] `grep -l "Drift Notes" references/openai-codex-kb/` — só CHANGELOG.kb.md (não os 4 antigos)
- [ ] `grep "AUTHORITY_NOTE" agents/core/pipeline-controller.md` — presente

### Critério de Sucesso

- 6 autoridades competindo → 1 SSOT por concept
- Adapter detectável em runtime Codex real (verificar via smoke test em CLI)
- KB single-versioned

### Se Falhar

| Sintoma | Causa provável | Ação |
| --- | --- | --- |
| Adapter test passa mas runtime Codex real não detecta | `globalThis.spawn_agent` shape differs | Feature-flag adapter + ambiente test específico |
| Gate hardness test reprova ≥1 gate | Hardness literal != classifier output | Decidir caso-a-caso: ajustar literal OU ajustar classifier |
| KB rewrite quebra outros tests | Algum test grepou por conteúdo antigo | Atualizar test ou ajustar rewrite |

### Após Passar

- [ ] Commit: `refactor(trust): P2 structural — adapter + authority + hardness + KB (R7-R10)`
- [ ] Tag release: `v0.5.0-trust-restoration`
- [ ] Update CHANGELOG.md (root) com summary das 14 mudanças

---

## Verification Checklist

### Pre-Implementation

- [ ] Greps executados confirmam localização do código a modificar
- [ ] `npm run build && npm test` baseline passa
- [ ] Branch criada: `git checkout -b feature/pipeline-trust-restoration`

### Post-Implementation (por task)

| Task | Arquivo principal                                     | Build | Test                                                                  |
| ---- | ----------------------------------------------------- | ----- | --------------------------------------------------------------------- |
| T1   | `src/state/gate-log.ts`                               | ✅    | `tests/unit/state/gate-log.test.ts` + lint test                       |
| T2   | `src/gates/confidence-model.ts`                       | ✅    | `tests/unit/gates/confidence-model.test.ts` (com P3)                  |
| T3   | `hooks/dispatch-guard.cjs`, `hooks/sentinel-hook.cjs` | ✅    | `tests/integration/hook-fail-closed.test.ts`                          |
| T4   | `src/index.ts:691,699-701` + review/*                 | ✅    | existing review tests + adapted fixtures                              |
| T5   | `tests/integration/strict-agents-undefined.test.ts`   | ✅    | self (4 scenarios + P2 property)                                      |
| T6   | `src/protocol/protocol-events.ts`                     | ✅    | `tests/unit/protocol/protocol-events.test.ts`                         |
| T7   | `src/state/session-store.ts`, `src/continue/*`        | ✅    | `tests/integration/resume-strict-agents.test.ts` (com P5)             |
| T8   | `hooks/hooks.json`, `hooks/edit-guard-hook.cjs`       | ✅    | `tests/integration/bash-edit-guard.test.ts`                           |
| T9   | `scripts/exec-window/open.cjs`                        | ✅    | `tests/integration/exec-window-symlink.test.ts`                       |
| T10  | `~/.claude/skills/codex-plugin-builder/assets/*`      | N/A   | verificação manual (out-of-repo)                                      |
| T11  | `src/adapters/codex-agent-runtime.ts` (NEW)           | ✅    | `tests/integration/adapter-detection.test.ts`                         |
| T12  | `agents/core/pipeline-controller.md`                  | N/A   | `tests/unit/agents-inventory.test.ts` (CI-4 test)                     |
| T13  | `src/gates/gate-registry.ts`, `hardness-policy.ts`    | ✅    | `tests/unit/gates/gate-hardness-consistency.test.ts`                  |
| T14  | `references/openai-codex-kb/*` + `CHANGELOG.kb.md`    | N/A   | `tests/unit/openai-codex-kb.test.ts` (CI-5 test)                      |

### Final Verification

- [ ] Todos os greps de acceptance criteria passam
- [ ] Build completo: `npm run build`
- [ ] Type check: `npm run lint:types`
- [ ] Testes completos: `npm test`
- [ ] Smoke test pipeline real: rodar uma pipeline e verificar `gate-decisions.jsonl` tem entries corretos
- [ ] Manual review de:
  - [ ] `confidence-score.yaml` output (campo `confidenceSource` presente)
  - [ ] `protocol-events.jsonl` (campo `dispatchMode` presente em DISPATCH_REQUEST events)
  - [ ] Pa de Cal output mostra `confidenceSource` visível para usuário

### Spec Lifecycle Validation (kiro)

- [ ] `/kiro:validate-spec pipeline-trust-restoration` — passa
- [ ] `/kiro:validate-impl pipeline-trust-restoration` — passa após Phase 3 complete

### Release

- [ ] Bump version `0.4.1 → 0.5.0` em `package.json` e `.codex-plugin/plugin.json`
- [ ] Update `CHANGELOG.md` root com summary
- [ ] Tag `v0.5.0`

---

## Open Questions Resolution Status

Status das 5 Open Questions documentadas em `10-pre-spec-input.md`:

| OQ | Pergunta | Status | Decisão (em design.md §3.x) |
| --- | --- | --- | --- |
| OQ-1 | Restaurar pipeline-controller.md como N1 OU tombstone | RESOLVIDA | Tombstone via AUTHORITY_NOTE (T12); opção (a) restauração adiada até R7 estabilizado |
| OQ-2 | Cascade igual para review OU regra mais estrita | RESOLVIDA | Cascade igual (T4) — consistência com runtimeRunRole |
| OQ-3 | Cap em 0.5 fixo OU fórmula | RESOLVIDA | Fixo 0.5 (T2) — simplicidade > sofisticação |
| OQ-4 | KB rewrite (a) OU tombstone (b) | RESOLVIDA | Opção (a) rewrite com CHANGELOG (T14) |
| OQ-5 | Versionamento minor OU major | RESOLVIDA | Minor `0.5.0` — fix de comportamento documentado; major reservado para R7 ship maduro |

Todas as 5 OQs resolvidas — nenhum blocker antes da implementação.
