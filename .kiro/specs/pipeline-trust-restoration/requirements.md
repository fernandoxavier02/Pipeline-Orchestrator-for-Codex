# Requirements Document: Pipeline Trust Restoration

## Introduction

O plugin `pipeline-orchestrator-for-codex` (v0.4.1) promete revisão adversarial multi-agente independente como sua proposta de valor central, mas o runtime default substitui silenciosamente essa garantia por heurísticas locais determinísticas (Padrão C — "Emulation Theatre" identificado na auditoria de 2026-05-19). Veredictos fabricados em emulação ficam indistinguíveis de revisão real em `gate-decisions.jsonl`, `confidence-score.yaml` e `protocol-events.jsonl`. Esta spec restaura confiabilidade através de 14 requirements organizados por theme sistêmico (Theme C — root cause; Theme B — authority fragmentation; Theme A — doc-runtime gap fechado como side-effect; segurança como cluster paralelo), em três níveis de prioridade (P0 = 3 fixes mínimos antes de qualquer output ser tratado como evidência; P1 = 7 fixes de sprint; P2 = 4 mudanças estruturais).

## Glossary

- **Strict_Agents_Flag**: O campo `RuntimeOptions.strictAgents?: boolean` em `src/domain/pipeline-types.ts:42`. Quando `true`, o runtime exige adapter real Codex (`spawn_agent`); quando `undefined` ou `false`, atualmente cai em emulação silenciosa (estado pré-fix).
- **Emulation_Path**: O caminho de execução em que `single-agent-runner.ts:450-506` fabrica veredictos via heurística local em vez de invocar agente real.
- **Operational_Dispatch_Fallback**: A cascata `request.requireRealAgent ?? options.strictAgents ?? isOperationalPipelineDispatch(request)` em `src/index.ts:548`. Pretende ser o padrão seguro; atualmente é aplicado em `runtimeRunRole` mas NÃO em `Review_Orchestrator` nem `Final_Adversarial_Orchestrator`.
- **Decided_By_Provenance**: Campo do schema `gate-decisions.jsonl` (`src/domain/pipeline-schemas.ts:177`) com valores `controller | user | system | resume-router`. `system` está previsto para emulação mas nunca é escrito.
- **Confidence_Cap_Threshold**: Valor numérico (`0.5` proposto) que o `Confidence_Model` aplica como teto quando há qualquer entrada `decided_by='system'` no log da run.
- **Pipeline_Controller_Authority**: A questão de qual artefato é SSOT operacional — `agents/core/pipeline-controller.md` (1471 linhas, atualmente dead doc) vs `src/controller/pipeline-controller.ts` (1885 linhas, runtime real).
- **Gate_Hardness_Source**: Atualmente dual — `src/gates/gate-registry.ts` (literais por entrada) vs `src/gates/hardness-policy.ts` (utility `classifyGateHardness()` não usada). Spec exige autoridade única.
- **Fail_Closed_Default**: Comportamento desejado de hooks de enforcement quando ocorre exception interna — emitir `permissionDecision: 'deny'` em vez de fallback silencioso para `allow`.
- **Audit_Trail_Distinguishability**: Propriedade que requer que um auditor lendo apenas os arquivos persistidos (`gate-decisions.jsonl`, `confidence-score.yaml`, `protocol-events.jsonl`) consiga determinar se a run usou agentes reais ou emulação.

## Requirements

### Requirement 1: Distinguishable Emulated Dispatches in Gate Log

**User Story:** As a auditor reviewing a pipeline run, I want emulated review verdicts to be marked differently from real-agent verdicts in `gate-decisions.jsonl`, so that I can determine post-mortem whether the recorded "approved" was real evidence or a fabricated heuristic.

#### Acceptance Criteria

1. WHEN the `Gate_Log_Writer` records a gate decision originating from an emulated dispatch, THE `Gate_Log_Writer` SHALL write `decided_by: "system"` to the entry.
2. WHEN the `Gate_Log_Writer` records a gate decision originating from a real `spawn_agent` dispatch, THE `Gate_Log_Writer` SHALL write `decided_by: "controller"` to the entry (or `"user"` for user-resolved gates, per existing schema).
3. IF the `Pipeline_Runtime` cannot determine the dispatch provenance for a given gate decision, THEN THE `Gate_Log_Writer` SHALL refuse to write the entry and emit a structured error referencing this requirement.
4. WHEN any source file under `src/` writes to `gate-decisions.jsonl`, THE writer SHALL route through a single centralized `Gate_Log_Writer` (not hardcode `decided_by` inline).
5. WHEN a CI lint rule runs over `src/`, THE lint SHALL fail the build if `decided_by` literal strings are hardcoded outside the centralized writer module.

#### Prework Analysis

| AC  | Testable        | Tipo            | Razão                                                                                                  |
| --- | --------------- | --------------- | ------------------------------------------------------------------------------------------------------ |
| 1.1 | yes - property  | Invariant       | Qualquer dispatch emulado, regra universal: `dispatchMode='emulated'` ⇒ `decided_by='system'`.        |
| 1.2 | yes - property  | Invariant       | Qualquer dispatch real, regra universal: `dispatchMode='real'` ⇒ `decided_by='controller' or 'user'`. |
| 1.3 | edge-case       | Error path      | Caso de provenance indeterminável — comportamento defensivo.                                           |
| 1.4 | yes - example   | Architectural   | Verificável via grep + análise estática (todos writes passam pelo módulo central).                     |
| 1.5 | yes - example   | CI Guard        | ESLint custom rule — Theme D defense contra fix-then-regress.                                          |

### Requirement 2: Confidence Score Reflects Emulation Presence

**User Story:** As a user reading the Pa de Cal confidence score, I want the score to be capped when the run included emulated dispatches, so that I cannot mistake high confidence over fabricated evidence for high confidence over real agent review.

#### Acceptance Criteria

1. WHEN the `Confidence_Model` calculates `final_score`, THE `Confidence_Model` SHALL scan the run's `gate-decisions.jsonl` for entries with `decided_by: "system"`.
2. IF the scan finds at least one `decided_by: "system"` entry, THEN THE `Confidence_Model` SHALL cap `final_score` at the `Confidence_Cap_Threshold` (0.5).
3. IF the cap is applied, THEN THE `Confidence_Model` SHALL write `confidenceSource: "emulated"` into `confidence-score.yaml`.
4. WHEN the scan finds zero `decided_by: "system"` entries, THE `Confidence_Model` SHALL write `confidenceSource: "real"` into `confidence-score.yaml` and apply NO cap.
5. WHEN the `Confidence_Model` runs, THE `Confidence_Model` SHALL log the cap decision (applied/not-applied) with the count of emulated entries.

#### Prework Analysis

| AC  | Testable        | Tipo          | Razão                                                                          |
| --- | --------------- | ------------- | ------------------------------------------------------------------------------ |
| 2.1 | yes - example   | Behavior      | Verificável via teste unitário com fixture de gate-log.                        |
| 2.2 | yes - property  | Invariant     | Qualquer log com `system` entry ⇒ score ≤ 0.5. Regra universal.                |
| 2.3 | yes - property  | Invariant     | Cap aplicado ⇒ field `confidenceSource: 'emulated'` presente.                  |
| 2.4 | yes - property  | Invariant     | Zero system entries ⇒ field `confidenceSource: 'real'` + sem cap.              |
| 2.5 | yes - example   | Observability | Verificável via log capture em teste.                                          |

### Requirement 3: Review Orchestrators Inherit Safe Cascade

**User Story:** As a maintainer fixing the root cause of silent emulation, I want `Review_Orchestrator` and `Final_Adversarial_Orchestrator` to use the same dispatch resolution as `runtimeRunRole` (the cascade `?? options.strictAgents ?? isOperationalPipelineDispatch(request)`), so that operational invocations enforce real-agent dispatch on those paths instead of falling silently into emulation.

#### Acceptance Criteria

1. WHEN `createReviewOrchestrator` is called at `src/index.ts:691`, THE `Pipeline_Runtime` SHALL pass `requireRealAgent: options.strictAgents ?? isOperationalPipelineDispatch(request)` (matching the cascade at line 548), NOT `options.strictAgents === true`.
2. WHEN `createFinalAdversarialOrchestrator` is called at `src/index.ts:699-701`, THE `Pipeline_Runtime` SHALL pass `requireRealAgent` using the same cascade as in 3.1.
3. WHEN `Review_Orchestrator` receives `requireRealAgent: true` AND no real `agentRuntime` adapter is available, THE `Review_Orchestrator` SHALL emit `blocked-no-agent-runtime` and refuse to proceed in `Emulation_Path`.
4. WHEN `Final_Adversarial_Orchestrator` receives `requireRealAgent: true` AND no real `agentRuntime` adapter is available, THE `Final_Adversarial_Orchestrator` SHALL emit `blocked-no-agent-runtime` and refuse to proceed in `Emulation_Path`.
5. IF a downstream test that previously exercised silent emulation now fails because of this requirement, THEN THE test fixture SHALL be updated to explicitly opt into emulation via `strictAgents: false` (not by omission), AND the change SHALL appear in the spec's CHANGELOG.

#### Prework Analysis

| AC  | Testable        | Tipo          | Razão                                                                |
| --- | --------------- | ------------- | -------------------------------------------------------------------- |
| 3.1 | yes - example   | Code review   | Diff de 1 linha verificável via grep + code review.                  |
| 3.2 | yes - example   | Code review   | Mesmo padrão da 3.1.                                                 |
| 3.3 | yes - property  | Invariant     | Qualquer chamada com `requireRealAgent: true` + sem adapter ⇒ block. |
| 3.4 | yes - property  | Invariant     | Mesmo padrão da 3.3 para final-adversarial.                          |
| 3.5 | edge-case       | Migration     | Side-effect previsto; documentação obrigatória.                      |

### Requirement 4: Test Coverage for strictAgents=undefined Path

**User Story:** As a CI maintainer, I want explicit test coverage for the `strictAgents=undefined` production-default path on `Review_Orchestrator`, `Final_Adversarial_Orchestrator`, and the `Confidence_Cap`, so that any future regression of the root cause fails CI before it ships.

#### Acceptance Criteria

1. WHEN `npm test -- strictAgents-undefined` runs, THE test suite SHALL include a scenario that invokes `createPipelineRuntime({})` (no `strictAgents` set), spawns a Review_Orchestrator run, and asserts the resulting `gate-decisions.jsonl` contains at least one `decided_by: "system"` entry IF no real `agentRuntime` is injected, OR zero such entries IF the cascade resolves to `requireRealAgent: true` via `isOperationalPipelineDispatch`.
2. WHEN the same test suite runs, THE test suite SHALL include a scenario covering `Final_Adversarial_Orchestrator` symmetrically to 4.1.
3. WHEN the same test suite runs, THE test suite SHALL include a scenario asserting that `confidence-score.yaml` `final_score <= 0.5` when at least one `decided_by: "system"` exists.
4. IF any of the three scenarios fails to run as a deterministic test (no flaky behavior), THEN THE failure SHALL block CI.
5. WHEN a test file enters the suite, THE test SHALL declare the requirement ID (`R4`) and AC number it covers in a header comment so coverage maps to spec.

#### Prework Analysis

| AC  | Testable      | Tipo         | Razão                                                          |
| --- | ------------- | ------------ | -------------------------------------------------------------- |
| 4.1 | yes - example | Test         | Teste BDD/integration concreto e isolado.                      |
| 4.2 | yes - example | Test         | Teste BDD/integration concreto e isolado.                      |
| 4.3 | yes - example | Test         | Teste integration sobre fixture de gate-log.                   |
| 4.4 | yes - property | CI Guard    | Qualquer flakiness ⇒ block. Regra universal para CI hygiene.   |
| 4.5 | yes - example | Architectural | Convenção de header — verificável via grep / lint.            |

### Requirement 5: Post-Mortem Distinguishability in Protocol Events

**User Story:** As a debug-time investigator, I want `protocol-events.jsonl` to record whether each agent dispatch was real or emulated, so that I can reconstruct dispatch provenance from the queryable JSONL log (not just from TRACE.md prose).

#### Acceptance Criteria

1. WHEN the `Pipeline_Runtime` writes a `DISPATCH_REQUEST` event to `protocol-events.jsonl`, THE writer SHALL include a `dispatchMode` field with value `"real"` or `"emulated"`.
2. WHEN the `ProtocolEvent` Zod schema in `src/protocol/protocol-events.ts` is updated, THE schema SHALL add `dispatchMode: z.enum(["real", "emulated"]).optional()`.
3. WHEN `agentRuntime` is present at runtime, THE writer SHALL populate `dispatchMode: "real"`.
4. WHEN `agentRuntime` is absent at runtime, THE writer SHALL populate `dispatchMode: "emulated"`.
5. IF a legacy `protocol-events.jsonl` is read that lacks `dispatchMode`, THEN THE parser SHALL accept the entry (backward-compat) and tag it as `dispatchMode: "unknown"` in any downstream report.

#### Prework Analysis

| AC  | Testable        | Tipo          | Razão                                                       |
| --- | --------------- | ------------- | ----------------------------------------------------------- |
| 5.1 | yes - property  | Invariant     | Qualquer dispatch ⇒ campo presente. Regra universal.        |
| 5.2 | yes - example   | Schema        | Verificável via Zod schema test.                            |
| 5.3 | yes - property  | Invariant     | `agentRuntime ≠ null` ⇒ `"real"`.                          |
| 5.4 | yes - property  | Invariant     | `agentRuntime === null/undefined` ⇒ `"emulated"`.           |
| 5.5 | edge-case       | Backward-compat | Caso legado — parser deve degradar graciosamente.         |

### Requirement 6: Resume Preserves strictAgents

**User Story:** As a user resuming a pipeline via `/pipeline continue`, I want the original `strictAgents` setting to be honored after resume, so that the pipeline does not silently degrade to emulation across the resume boundary.

#### Acceptance Criteria

1. WHEN the `Pipeline_Runtime` persists a session state, THE writer SHALL include the `strictAgents` value in the persisted JSON.
2. WHEN `Resume_Pipeline` resolves continuation, THE resolver SHALL read `strictAgents` from the persisted session and apply it to the resumed `RuntimeOptions`.
3. IF the persisted session has no `strictAgents` field (legacy session), THEN THE `Resume_Pipeline` SHALL treat it as `undefined` and apply the cascade as if it were a fresh invocation.
4. WHEN the same pipeline is resumed twice in sequence, THE `strictAgents` value SHALL remain consistent across both resumes (no degradation).
5. WHEN an integration test asserts resume preserves `strictAgents=true`, THE test SHALL fail if the resumed pipeline emits any `decided_by: "system"` entry.

#### Prework Analysis

| AC  | Testable        | Tipo          | Razão                                                       |
| --- | --------------- | ------------- | ----------------------------------------------------------- |
| 6.1 | yes - property  | Persistence   | Qualquer session write ⇒ campo presente.                    |
| 6.2 | yes - property  | Invariant     | Qualquer resume ⇒ campo lido e aplicado.                    |
| 6.3 | edge-case       | Backward-compat | Sessions legadas devem ser tolerantes.                    |
| 6.4 | yes - property  | Invariant     | Resume idempotente em relação ao strictAgents.              |
| 6.5 | yes - example   | Test          | Teste integration concreto.                                 |

### Requirement 7: Native Codex agentRuntime Adapter

**User Story:** As an operator running the plugin in production Codex, I want a native `agentRuntime` adapter that bridges the runtime to real `spawn_agent` calls, so that `strictAgents: true` becomes the viable default (not a footgun) and the `Emulation_Path` becomes opt-in for diagnostic/test contexts only.

#### Acceptance Criteria

1. WHEN the plugin loads in a Codex session that exposes `spawn_agent`, THE `Codex_Agent_Runtime_Adapter` SHALL detect the adapter availability and register itself with `createPipelineRuntime`.
2. WHEN `createPipelineRuntime` is invoked AND the `Codex_Agent_Runtime_Adapter` is detected, THE runtime SHALL default `options.strictAgents` to `true` (overridable by explicit caller).
3. WHEN the adapter receives a `DispatchRequest`, THE adapter SHALL invoke real `spawn_agent` with the correct FQN and return the agent's structured output to `runRole`.
4. WHEN the adapter is invoked in a context where `spawn_agent` is unavailable, THE adapter SHALL throw `AgentRuntimeUnavailableError` (per `src/dispatcher/run-role.ts:116-126`) and NOT silently fall back to emulation.
5. WHEN the adapter is opt-out for diagnostic purposes (`strictAgents: false` explicit), THE runtime SHALL emit a one-time warning log indicating the user has opted into the `Emulation_Path`.

#### Prework Analysis

| AC  | Testable        | Tipo            | Razão                                                                          |
| --- | --------------- | --------------- | ------------------------------------------------------------------------------ |
| 7.1 | yes - example   | Detection       | Verificável via integration test em ambiente Codex.                            |
| 7.2 | yes - property  | Invariant       | Adapter detectado ⇒ default `true`. Regra universal.                           |
| 7.3 | yes - example   | Integration     | Teste end-to-end com mock spawn_agent.                                         |
| 7.4 | yes - property  | Invariant       | Adapter sem spawn_agent ⇒ throw. Regra defensiva.                              |
| 7.5 | yes - example   | Observability   | Verificável via log capture em teste de opt-out.                               |

### Requirement 8: Pipeline Controller Authority Resolution

**User Story:** As a contributor reading the codebase, I want exactly one authoritative artifact for the orchestration logic (either the markdown agent prompt or the TypeScript controller), so that I do not read 1471 lines of dead documentation believing it describes runtime behavior.

#### Acceptance Criteria

1. WHEN the `Pipeline_Controller_Authority` resolution is applied, THE repo SHALL designate exactly one of: (a) `agents/core/pipeline-controller.md` restored as the N1 primary path loaded via real `spawn_agent`, OR (b) `agents/core/pipeline-controller.md` retained as human reference with an explicit `AUTHORITY_NOTE` header declaring `src/controller/pipeline-controller.ts` as the operational SSOT.
2. IF option (a) is chosen, THEN THE plugin SHALL provide a real `spawn_agent` invocation path that loads the markdown content as the spawned agent's message (requires R7 adapter to be shipped).
3. IF option (b) is chosen, THEN THE first 20 lines of `agents/core/pipeline-controller.md` SHALL contain a clearly-formatted `AUTHORITY_NOTE` referencing the TypeScript SSOT file path, the date of the decision, and a one-line explanation of why the markdown is retained.
4. WHEN a contributor greps the repo for "sole orchestrator", THE grep result SHALL NOT return content that contradicts the chosen authority.
5. WHEN this requirement is satisfied, THE `agents/core/pipeline-controller.md` frontmatter `description` field SHALL be updated to remove the "Dispatches 37 N2 agents" stale claim and reflect the current state (45 agents OR the chosen alternative description).

#### Prework Analysis

| AC  | Testable        | Tipo            | Razão                                                          |
| --- | --------------- | --------------- | -------------------------------------------------------------- |
| 8.1 | no              | Manual          | Decisão arquitetural — verificável em revisão humana.          |
| 8.2 | yes - example   | Integration     | Se opção (a) — teste E2E que loads markdown via spawn_agent.   |
| 8.3 | yes - example   | Documentation   | Se opção (b) — verificável via grep do header.                 |
| 8.4 | yes - property  | Consistency     | Grep de termos chave deve ser consistente com decisão.         |
| 8.5 | yes - example   | Documentation   | Verificável via parse do frontmatter.                          |

### Requirement 9: Single Authority for Gate Hardness

**User Story:** As a contributor changing gate behavior, I want exactly one source of truth for gate hardness (literals in `gate-registry.ts` OR utility `classifyGateHardness()` — not both), so that hardness assignments cannot drift silently between the two sources.

#### Acceptance Criteria

1. WHEN the `Gate_Hardness_Source` resolution is applied, THE repo SHALL designate exactly one of: (a) `gate-registry.ts` is the SSOT with literal hardness per entry AND `hardness-policy.ts` is removed OR demoted to a test utility, OR (b) `hardness-policy.ts` `classifyGateHardness()` is the SSOT AND `gate-registry.ts` literals are computed/derived from it.
2. IF option (a) is chosen, THEN THE `hardness-policy.ts` file SHALL contain a header comment declaring its demoted status, OR SHALL be deleted.
3. IF option (b) is chosen, THEN THE `gate-registry.ts` entries SHALL invoke `classifyGateHardness()` per entry (or via a single computed assignment loop) instead of literal strings.
4. WHEN `npm test -- gate-hardness-consistency` runs, THE test SHALL fail if any `gate-registry.ts` entry's hardness does not match what `classifyGateHardness()` would produce (only applicable if option (a) is chosen and the utility is retained for cross-check).
5. WHEN the `Gate_Hardness_Registry` is queried for the canonical hardness of a given gate name, THE response SHALL be deterministic and consistent across all consumers.

#### Prework Analysis

| AC  | Testable        | Tipo            | Razão                                                       |
| --- | --------------- | --------------- | ----------------------------------------------------------- |
| 9.1 | no              | Manual          | Decisão de design — revisão humana.                         |
| 9.2 | yes - example   | Documentation   | Verificável via grep do header ou ausência do arquivo.      |
| 9.3 | yes - example   | Code review     | Verificável via grep das literais vs chamadas à utility.    |
| 9.4 | yes - property  | CI Guard        | Consistência universal — Theme D defense.                   |
| 9.5 | yes - property  | Invariant       | Determinismo — regra universal de SSOT.                     |

### Requirement 10: KB Codex SSOT Consolidation

**User Story:** As a contributor adding Codex plugin schemas to documentation, I want exactly one canonical KB corpus (not 4 old files with bottom-appended "Drift Notes" plus a new consolidated guide), so that grep results land on the corrected content first instead of stale pre-correction text.

#### Acceptance Criteria

1. WHEN the KB consolidation is applied, THE `references/openai-codex-kb/` directory SHALL designate `plugin-build-guide.md` (or its successor) as the SSOT corpus AND the 4 old per-topic files (`plugins.md`, `skills.md`, `agents-and-subagents.md`, `rules-hooks-agents-md.md`) SHALL be either (a) rewritten to the corrected state with the "Drift Notes" section removed, OR (b) reduced to a tombstone header with a single forward-pointer to the SSOT.
2. WHEN any file in `references/openai-codex-kb/` declares `last_verified`, THE date SHALL be consistent across all files (single controller).
3. IF option (b) is chosen, THEN THE tombstoned file SHALL preserve its frontmatter (for cross-reference) but its body SHALL be replaced by a single-paragraph forward-pointer.
4. WHEN a `Drift Notes` section content is removed, THE removed content SHALL be appended to a new `CHANGELOG.kb.md` file under `references/openai-codex-kb/` (preserves editorial history; addresses risk R-6).
5. WHEN a contributor greps any of the 4 old files for a corrected schema fact (e.g., "decided_by"), THE first match SHALL be either the corrected content (option a) or the forward-pointer (option b) — NOT the pre-correction stale text.

#### Prework Analysis

| AC   | Testable       | Tipo          | Razão                                                        |
| ---- | -------------- | ------------- | ------------------------------------------------------------ |
| 10.1 | no             | Manual        | Decisão editorial — revisão humana.                          |
| 10.2 | yes - property | Consistency   | Grep universal de timestamps deve ser idêntico.              |
| 10.3 | yes - example  | Documentation | Verificável via parse do frontmatter + body.                 |
| 10.4 | yes - example  | Migration     | Verificável via grep do CHANGELOG.kb.md.                     |
| 10.5 | yes - property | Retrieval     | Universal: grep land na verdade. Theme A defense.            |

### Requirement 11: Hooks Fail Closed on Internal Exception

**User Story:** As a security operator, I want `Dispatch_Guard_Hook` and `Sentinel_Hook` to deny tool use when an internal exception or corrupted state occurs during processing, so that crash conditions in the hook do not silently allow potentially-unsafe operations.

#### Acceptance Criteria

1. WHEN `Dispatch_Guard_Hook` catches an exception during its event processing logic (currently at `hooks/dispatch-guard.cjs:391-402`), THE hook SHALL emit `permissionDecision: "deny"` with reason `"hook internal error — failing closed"`.
2. WHEN `Sentinel_Hook` catches an exception during state load or sequence validation (currently at `hooks/sentinel-hook.cjs:108-112,181-184`), THE hook SHALL emit `permissionDecision: "deny"` with reason `"sentinel internal error — failing closed"`.
3. WHEN `Sentinel_Hook` reads a corrupted `sentinel-state.json` (JSON parse failure), THE hook SHALL emit deny (not exit 0) for non-bootstrap agent spawns.
4. WHEN the hook fails closed, THE hook SHALL NOT include raw exception messages, paths, or any payload in the user-visible reason (avoid secret leak).
5. WHEN integration tests inject a corrupted payload, THE test SHALL assert the hook returns exit code 2 (or `permissionDecision: deny`) and the reason text matches the canonical error message pattern.

#### Prework Analysis

| AC   | Testable        | Tipo            | Razão                                                       |
| ---- | --------------- | --------------- | ----------------------------------------------------------- |
| 11.1 | yes - property  | Security        | Qualquer exception ⇒ deny. Regra universal fail-closed.     |
| 11.2 | yes - property  | Security        | Mesma regra para sentinel.                                  |
| 11.3 | edge-case       | Security        | Corrupted state ⇒ deny — caso defensivo específico.         |
| 11.4 | yes - property  | Security        | Sanitização de erro user-facing. Regra universal.           |
| 11.5 | yes - example   | Test            | Teste integration concreto.                                 |

### Requirement 12: Bash Tool Coverage in Edit Guard

**User Story:** As a security operator, I want `Edit_Guard_Hook` to also intercept file writes performed via `Bash` (`>`, `>>`, `rm`, `mv`), so that an LLM cannot bypass edit governance by switching from `Edit/Write/MultiEdit` tools to shell redirection.

#### Acceptance Criteria

1. WHEN `Edit_Guard_Hook` is configured in `hooks/hooks.json`, THE matcher SHALL include `Bash` in addition to `Edit|Write|NotebookEdit|MultiEdit`.
2. WHEN a `Bash` tool invocation is intercepted, THE hook SHALL parse the command string for write-redirect operators (`>`, `>>`) and destructive operators (`rm`, `mv`) targeting paths.
3. IF the parsed command targets a path outside the exec-window or session-allowed scope, THEN THE hook SHALL emit `permissionDecision: "deny"` with a structured reason naming the offending operator.
4. IF the parsed command is read-only (`cat`, `ls`, `grep`, etc.) or targets only allowed paths, THEN THE hook SHALL allow the invocation.
5. WHEN an integration test attempts `Bash` with `echo "x" > unauthorized.txt`, THE test SHALL assert the hook denies the call with the documented reason.

#### Prework Analysis

| AC   | Testable        | Tipo            | Razão                                                      |
| ---- | --------------- | --------------- | ---------------------------------------------------------- |
| 12.1 | yes - example   | Configuration   | Verificável via parse do hooks.json.                       |
| 12.2 | yes - property  | Invariant       | Qualquer Bash invocation ⇒ parse aplicado.                 |
| 12.3 | yes - property  | Invariant       | Comando fora de escopo ⇒ deny. Regra universal.            |
| 12.4 | yes - property  | Invariant       | Comando read-only ou em escopo ⇒ allow.                    |
| 12.5 | yes - example   | Test            | Teste integration concreto.                                |

### Requirement 13: Exec Window Resists Symlink Attack

**User Story:** As a security operator, I want `Exec_Window` to refuse to rename through a symlink, so that a pre-created symlink at the target path cannot be exploited to overwrite arbitrary files.

#### Acceptance Criteria

1. WHEN `Exec_Window` is about to `renameSync` a file (currently at `scripts/exec-window/open.cjs:81,95`), THE code SHALL first call `lstat` on the target path.
2. IF `lstat` returns a result where `isSymbolicLink()` is true, THEN THE code SHALL abort the rename and throw a structured `SymlinkRefusedError`.
3. WHEN the abort occurs, THE error reason SHALL identify the offending target path AND log the abort to the session audit log.
4. WHEN no symlink is present at the target, THE rename SHALL proceed normally.
5. WHEN an integration test pre-creates a symlink at the target path, THE test SHALL assert `Exec_Window` aborts with the documented error and does NOT modify the symlink target.

#### Prework Analysis

| AC   | Testable        | Tipo          | Razão                                                       |
| ---- | --------------- | ------------- | ----------------------------------------------------------- |
| 13.1 | yes - property  | Invariant     | Toda rename ⇒ lstat. Regra universal defensiva.             |
| 13.2 | yes - property  | Security      | Symlink detected ⇒ abort. Regra universal.                  |
| 13.3 | yes - example   | Observability | Verificável via log capture.                                |
| 13.4 | yes - property  | Invariant     | Sem symlink ⇒ proceed normal.                               |
| 13.5 | yes - example   | Test          | Teste integration concreto com symlink fixture.             |

### Requirement 14: Plugin Templates Are Copy-Paste-Safe

**User Story:** As a user copying the `codex-plugin-builder` skill templates into a new Codex plugin, I want the template files to work end-to-end without referencing missing files and without shipping security-degraded defaults, so that the resulting plugin works as advertised on first invocation.

> **Note on scope:** The plugin templates live in the `codex-plugin-builder` skill at `~/.claude/skills/codex-plugin-builder/assets/templates/` (outside this repo). This requirement is in-scope for this spec because the skill is the publish-time companion to the plugin under audit, and the audit (`ADV-C1`, `ADV-C2`) found defects there.

#### Acceptance Criteria

1. WHEN `assets/templates/hooks.json` is parsed, THE every `command` value SHALL resolve to a file that actually exists in the `assets/templates/` directory.
2. IF a `command` value references a file that does not ship, THEN THE template SHALL be rewritten to either ship the missing file as a stub OR wire only the shipped files.
3. WHEN `assets/templates/hook-deny.cjs` catches a JSON parse exception (currently at lines 51-54), THE catch block SHALL call `deny()` (fail-closed) by default.
4. IF a user opts into fail-open behavior for `hook-deny.cjs`, THEN THE opt-in SHALL require an explicit code change AND THE template SHALL document the opt-in with a `SECURITY:` comment.
5. WHEN the `Plugin_Templates` `build-checklist.md` is updated, THE checklist SHALL include an item: "every `command` value in `hooks.json` resolves to a file that exists in the templates directory".

#### Prework Analysis

| AC   | Testable        | Tipo            | Razão                                                        |
| ---- | --------------- | --------------- | ------------------------------------------------------------ |
| 14.1 | yes - property  | Invariant       | Universal: toda referência tem arquivo. Theme D defense.     |
| 14.2 | yes - example   | Migration       | Verificável via diff do template.                            |
| 14.3 | yes - example   | Security        | Verificável via inspeção do código.                          |
| 14.4 | edge-case       | Documentation   | Verificável via grep do comentário SECURITY.                 |
| 14.5 | yes - example   | Documentation   | Verificável via parse do build-checklist.md.                 |

## Non-Functional Requirements

### NFR-1 — Backward Compatibility

The fixes in R1, R5, R6 SHALL accept legacy data (pre-fix `gate-decisions.jsonl` without `decided_by`, pre-fix `protocol-events.jsonl` without `dispatchMode`, pre-fix sessions without `strictAgents`) without throwing parse errors. Legacy entries SHALL be tagged with sentinel values (`decided_by: "unknown"`, `dispatchMode: "unknown"`) for downstream reporting.

### NFR-2 — Performance

The `Confidence_Model` scan for `decided_by: "system"` entries (R2 AC 2.1) SHALL complete in O(N) over the size of `gate-decisions.jsonl` and SHALL NOT add more than 50ms to the existing `final-validator` step on a typical run (≤100 entries).

### NFR-3 — Observability

Every fix SHALL emit structured log entries when its enforcement decision differs from prior behavior (e.g., R3 cascade block, R11 fail-closed deny, R12 Bash deny), so that operators can audit the impact of the fixes in real runs.

### NFR-4 — CI Discipline (Theme D defense)

Every CI guard required by these requirements (R1 AC 1.5 lint rule; R4 ACs; R9 AC 9.4 hardness consistency test; R10 AC 10.2 last_verified consistency; R14 AC 14.1 template file existence) SHALL be wired into `npm test` and SHALL fail the build on violation. No requirement is satisfied if it relies only on manual verification.

### NFR-5 — Documentation Honesty

All public docs (`README.md`, `skills/pipeline/SKILL.md`, error messages in `src/`) SHALL be reviewed for claims that became inaccurate after the fixes. Any claim that no longer matches runtime SHALL be updated. Documentation drift caused by a fix MUST be treated as part of the fix, not a follow-up item.

## Out of Scope

- **Refactor of `src/controller/pipeline-controller.ts` (1885 lines).** The file functions; refactor expands blast radius without closing audit findings. Tracked separately.
- **Rewrite of `src/dispatcher/single-agent-runner.ts` (507 lines emulation runner).** This is the CI test foundation for 505 tests; remove only after R7 adapter is shipped and validated. Tracked as post-spec cleanup.
- **Renaming of any gate name string in `gate-registry.ts` or sentinel checkpoint label in `sentinel-state.json`.** These names are persisted in JSONL audit logs; renames break historical parsing.
- **Changes to the `GATE_REQUEST` / `DISPATCH_REQUEST` / `PLAN_MODE_REQUEST` protocol structure.** Protocol is stable; changes touch every agent.
- **Backlog of remaining ~12 security findings (CAR-13, CAR-15, CAR-16, etc.) beyond those explicitly addressed in R11-R13.** These belong in a follow-up security-hardening spec; addressing them here inflates scope past one ship.
- **Plugin manifest version/name changes.** Version bumps are output of these fixes (semver), not goals.
- **Test for the existence of a `references/gates.md` file (AUDIT-003).** The file is referenced by the controller spec but does not exist. This is documentation drift, not a runtime defect. Tracked separately.

## Coverage Matrix (Pre-Spec Goals → Requirements)

| Goal ID  | Goal Name                                                       | Prioridade | Requirement | ACs | Coberto |
| -------- | --------------------------------------------------------------- | ---------- | ----------- | --- | ------- |
| G-P0-1   | Distinguishable emulated dispatches                             | P0         | R1          | 5   | ✅      |
| G-P0-2   | Confidence reflects emulation                                   | P0         | R2          | 5   | ✅      |
| G-P0-3   | Hooks fail closed on exception                                  | P0         | R11         | 5   | ✅      |
| G-P1-1   | Cascade fix for review/final-adversarial                        | P1         | R3          | 5   | ✅      |
| G-P1-2   | Test coverage for strictAgents=undefined                        | P1         | R4          | 5   | ✅      |
| G-P1-3   | dispatchMode in protocol-events                                 | P1         | R5          | 5   | ✅      |
| G-P1-4   | Bash bypass in edit-guard                                       | P1         | R12         | 5   | ✅      |
| G-P1-5   | Symlink resistance in exec-window                               | P1         | R13         | 5   | ✅      |
| G-P1-6   | Templates copy-paste-safe                                       | P1         | R14         | 5   | ✅      |
| G-P1-7   | Resume preserves strictAgents                                   | P1         | R6          | 5   | ✅      |
| G-P2-1   | Pipeline-controller authority resolution                        | P2         | R8          | 5   | ✅      |
| G-P2-2   | Native Codex agentRuntime adapter                               | P2         | R7          | 5   | ✅      |
| G-P2-3   | Single authority for gate hardness                              | P2         | R9          | 5   | ✅      |
| G-P2-4   | KB Codex SSOT consolidation                                     | P2         | R10         | 5   | ✅      |

**Cobertura:** 14/14 goals (100%). 0 gaps. ✅

## Data Availability Matrix

Verified file:line evidence for each requirement's referenced fields/locations:

| Campo / Local                                     | Arquivo                                       | Linha     | Status     |
| ------------------------------------------------- | --------------------------------------------- | --------- | ---------- |
| `strictAgents` (RuntimeOptions field)             | `src/domain/pipeline-types.ts`                | 42        | ✅ VERIFIED |
| `requireRealAgent` cascade (`runtimeRunRole`)     | `src/index.ts`                                | 548       | ✅ VERIFIED |
| `requireRealAgent` strict eq (review-orch)        | `src/index.ts`                                | 691       | ✅ VERIFIED |
| `requireRealAgent` strict eq (final-adv-orch)     | `src/index.ts`                                | 699-701   | ✅ VERIFIED |
| `decided_by` schema enum (incl. `'system'`)       | `src/domain/pipeline-schemas.ts`              | 177       | ✅ VERIFIED |
| `decided_by` hardcoded `'controller'`             | `src/index.ts`                                | 45, 967   | ✅ VERIFIED |
| `Confidence_Model` arithmetic core                | `src/gates/confidence-model.ts`               | 39-65     | ✅ VERIFIED |
| `dispatch-guard` exception handler                | `hooks/dispatch-guard.cjs`                    | 391-402   | ✅ VERIFIED |
| `sentinel-hook` corrupted state handler           | `hooks/sentinel-hook.cjs`                     | 108-112, 181-184 | ✅ VERIFIED |
| `edit-guard-hook` matcher (currently no Bash)     | `hooks/hooks.json` + `hooks/edit-guard-hook.cjs` | 85, 24 | ✅ VERIFIED |
| `Exec_Window` rename call sites                   | `scripts/exec-window/open.cjs`                | 81, 95    | ✅ VERIFIED |
| `ProtocolEvent` Zod schema                        | `src/protocol/protocol-events.ts`             | 62-117    | ✅ VERIFIED |
| `Resume_Pipeline` resolver                        | `src/continue/resume-pipeline.ts`             | 1-16      | ✅ VERIFIED |
| `continue-state` resolver internals               | `src/controller/continue-state.ts`            | 118-143   | ✅ VERIFIED |
| `single-agent-runner` emulation path              | `src/dispatcher/single-agent-runner.ts`       | 43-114, 450-506 | ✅ VERIFIED |
| `pipeline-controller.md` "sole orchestrator"      | `agents/core/pipeline-controller.md`          | 11        | ✅ VERIFIED |
| `pipeline-controller.ts` real orchestrator        | `src/controller/pipeline-controller.ts`       | 1086, 1107 | ✅ VERIFIED |
| `gate-registry.ts` 26 entries                     | `src/gates/gate-registry.ts`                  | 15-225    | ✅ VERIFIED |
| `hardness-policy.ts` utility (unused)             | `src/gates/hardness-policy.ts`                | 3-20      | ✅ VERIFIED |
| `references/openai-codex-kb/*` drift              | 4 files + plugin-build-guide.md               | bottom    | ✅ VERIFIED |
| `assets/templates/hooks.json` ghost refs (skill)  | `C:/Users/win/.claude/skills/codex-plugin-builder/assets/templates/hooks.json` | full | ✅ VERIFIED (out-of-repo) |
| `hook-deny.cjs` fail-open catch (skill)           | `C:/Users/win/.claude/skills/codex-plugin-builder/assets/templates/hook-deny.cjs` | 51-54 | ✅ VERIFIED (out-of-repo) |

**Verificação:** 22/22 referências validadas (100%). 0 referências fantasmas. ✅

## Validation Checklist

- [x] Cada requirement tem User Story completa (R1-R14, 14/14)
- [x] Cada requirement tem ≥3 acceptance criteria (cada R tem exatamente 5)
- [x] Todos os criteria usam EARS (WHEN/IF... THE... SHALL) em MAIÚSCULAS
- [x] Nenhum ID alfabético (apenas Requirement 1, 2, ..., 14)
- [x] Componentes usam underscore (`Gate_Log_Writer`, `Review_Orchestrator`, etc.)
- [x] Keywords em MAIÚSCULAS (WHEN, THE, SHALL, IF, THEN)
- [x] Critérios são verificáveis (cada um tem método em Prework Analysis)
- [x] Não há detalhes de implementação além do estritamente necessário (HOW vs WHAT)
- [x] Glossary define 9 termos específicos do domínio
- [x] Cada requirement tem Prework Analysis (R1-R14, 14/14)
- [x] Cada AC está classificado (property / example / edge-case / no)
- [x] Coverage Matrix mostra 14/14 goals cobertos (P0=3, P1=7, P2=4)
- [x] Data Availability Matrix mostra 22/22 referências validadas
- [x] Themes sistêmicos (A/B/C/D) mencionados ao longo dos requirements como justificativa
- [x] 5 NFRs cobrem backward-compat, performance, observability, CI discipline, doc honesty
- [x] Out of Scope lista 7 itens explicitamente fora

## Next Phase

```bash
/kiro:spec-design pipeline-trust-restoration
```

A próxima fase (`spec-design`) deve produzir:

1. Arquitetura técnica dos 14 requirements (HOW para o WHAT desta requirements).
2. Resolução das 5 open questions documentadas em `10-pre-spec-input.md` (autoridade do markdown agent, fórmula vs número fixo do cap, etc.).
3. Decisão sobre versionamento (minor vs major bump).
4. Sequencing detalhado para o caminho crítico mínimo (G-P0-1 → G-P0-2 → G-P1-1 → G-P1-2 = R1 → R2 → R3 → R4).
5. Correctness Properties para cada AC classificado como `yes - property`.
