# Requirements Document: Pipeline Invocation Enforcement

## Introduction

O `pipeline-orchestrator-for-codex` precisa fechar a brecha em que uma invocacao explicita do plugin, ou um pedido claramente pipeline-worthy, pode virar execucao manual do agente sem evidencias reais de pipeline.

O problema nao e falta de instrucao escrita. O problema e que algumas superficies ainda funcionam como orientacao tardia ou advisory: `SessionStart` pode estar configurado como handler nao executavel, `force-pipeline-agents.cjs` injeta mensagem mas continua, lock/sentinel podem nao existir antes da primeira resposta, e `Stop` pode nao capturar todos os casos de ausencia de dispatch real.

Esta spec exige um front-door deterministico: quando o pedido requer o Pipeline Orchestrator, o sistema deve criar estado minimo antes da execucao, bloquear inline quando necessario, validar evidencia no fim e reportar `BLOCKED` estruturado quando `spawn_agent`/`wait_agent` ou hooks confiados nao sustentarem o contrato.

## Source Evidence

- O input original do usuario esta em `C:/Users/win/.codex/attachments/dc68a94a-5f2b-4cba-b19f-c86492b65b49/pasted-text.txt`.
- `AGENTS.md` define este repositorio como SSOT local do plugin e exige que runtime, hooks, skills, prompts e testes sustentem qualquer promessa publica.
- `.kiro/CONSTITUTION.md` exige evidencia acima de suposicao e enforcement de permissao/gate/session lock no backend/runtime, nao apenas em Markdown.
- `hooks/hooks.json` registra `SessionStart` com `type: "prompt"`, enquanto a documentacao oficial de hooks mostra `SessionStart` com handler `type: "command"` e afirma que command hooks precisam de trust.
- `hooks/force-pipeline-agents.cjs` usa `advisoryOutput`, com `continue: true`, `hook_enforcement_mode: "advisory"` e `pipeline_valid: false`.
- `hooks/session-lock-hook.cjs` nao cria lock em `UserPromptSubmit`; ele atualiza heartbeat somente quando lock ja existe.
- `hooks/dispatch-guard.cjs` e `hooks/sentinel-hook.cjs` protegem chamadas feitas, mas nao conseguem provar a ausencia de chamada de agente.
- `hooks/completion-checklist.cjs` ja valida `PipelineGovernanceArtifact`, ledgers, gates, hooks e dispatch/wait evidence quando detecta tentativa de conclusao de pipeline.
- `src/controller/pipeline-controller.ts`, `src/controller/plan-mode.ts`, `src/gates/gate-registry.ts` e `src/domain/pipeline-schemas.ts` ja contem parte do bootstrap, gate registry, schema e plan gate.
- `tests/unit/controller/pipeline-controller.test.ts`, `tests/unit/controller/plan-mode.test.ts` e `tests/unit/workflow/next-step.test.ts` ja cobrem parte do comportamento esperado e devem ser estendidos.

## Glossary

- **Front-door deterministico**: camada de entrada que decide se o pedido pode continuar inline, deve entrar pelo comando canonico, ou deve bloquear antes de qualquer execucao.
- **Pedido pipeline-worthy**: pedido nao trivial de implementacao, bugfix, auditoria, investigacao, refactor, setup ou validacao que exige workflow governado mesmo quando o comando canonico nao foi digitado.
- **Pedido explicito de pipeline**: invocacao com `/pipeline-orchestrator-for-codex:pipeline`, `/pipeline-orchestrator-for-codex:<workflow>` governado ou mencao explicita do plugin como front door.
- **Estado minimo de governanca**: arquivos persistidos em `.codex/pipeline/**` que provam lock, sentinel, session, required-first-actions e gate inicial.
- **Artifact valido**: `PipelineGovernanceArtifact` com `pipeline_requested=true`, `pipeline_valid=true`, `runtime_mode=real-agent`, `hook_enforcement_mode=blocking`, ledgers correspondentes e verdict final PASS.
- **Blocked artifact**: artifact estruturado com `status=BLOCKED`, `pipeline_valid=false`, capacidades faltantes, gates relevantes e `manual_fallback_counts_as_pipeline=false`.
- **Hook advisory**: hook que retorna contexto/mensagem mas deixa `continue: true`; nao conta como barreira executavel.
- **Hook blocking**: hook que pode negar ou parar a acao/resposta com razao estruturada.

## Requirements

### Requirement 1: Canonical Pipeline Front Door

**User Story:** Como mantenedor, quero que pedidos explicitos ou pipeline-worthy entrem por uma porta canonica, para que o agente nao transforme governanca em execucao inline.

#### Acceptance Criteria

1.1 WHEN a user submits an explicit `/pipeline-orchestrator-for-codex:pipeline` request, THE system SHALL classify the request as `explicit_pipeline_request=true` before any assistant execution, edit, audit, validation claim, or terminal response.

1.2 WHEN a user submits a governed workflow command such as `/pipeline-orchestrator-for-codex:spec`, `/pipeline-orchestrator-for-codex:bugfix`, `/pipeline-orchestrator-for-codex:feature`, `/pipeline-orchestrator-for-codex:audit`, or `/pipeline-orchestrator-for-codex:review`, THE system SHALL classify the request as `explicit_governed_workflow=true`.

1.3 WHEN a user submits a pipeline-worthy prompt without the canonical command, THE system SHALL block inline execution and instruct the user to re-submit through the canonical workflow command or emit a structured blocked artifact.

1.4 IF the prompt is a short literal greeting or purely conversational response, THEN THE system SHALL allow it without pipeline front-door enforcement.

1.5 IF a prompt is ambiguous between conversational and pipeline-worthy, THEN THE system SHALL choose the non-executing path and ask for clarification rather than editing files inline.

### Requirement 2: Executable SessionStart Context

**User Story:** Como operador do plugin, quero que `SessionStart` carregue contexto por mecanismo executavel e confiavel, para que a mensagem de runtime nao seja um cartaz ignorado.

#### Acceptance Criteria

2.1 WHEN plugin hooks are configured, THE `SessionStart` hook SHALL use a supported `type: "command"` handler for executable context.

2.2 WHEN `SessionStart` emits runtime context, THE output SHALL use a Codex-supported context channel such as structured hook output or stdout accepted for that event.

2.3 IF the hook configuration contains `type: "prompt"` for `SessionStart`, THEN a static validation test SHALL fail with a remediation message.

2.4 WHEN hook trust is required by Codex, THE final report SHALL distinguish configured hooks from trusted and executed hooks.

2.5 IF official Codex hook semantics change, THEN the local KB or spec research SHALL record the verification date before modifying runtime claims.

### Requirement 3: Blocking Prompt Gate For Pipeline-Worthy Requests

**User Story:** Como usuario, quero que pedidos de engenharia nao triviais sejam bloqueados quando tentarem escapar do workflow, para que o sistema nao aceite "manual fallback" como pipeline.

#### Acceptance Criteria

3.1 WHEN `force-pipeline-agents.cjs` detects a pipeline-worthy prompt without explicit governed workflow, THE hook SHALL return a blocking decision rather than advisory-only context.

3.2 WHEN the blocking decision is emitted, THE user-visible reason SHALL name the canonical command and state that inline execution is blocked.

3.3 IF the prompt already invokes a governed workflow command, THEN the hook SHALL NOT block the command itself; it SHALL mark the request as requiring first-action enforcement.

3.4 IF the hook crashes or cannot parse input, THEN the system SHALL fail closed for pipeline-worthy enforcement surfaces and record a sanitized reason.

3.5 WHEN a hook decision is advisory, THE system SHALL NOT count it as `hook_enforcement_mode=blocking`.

### Requirement 4: Early Governance State Bootstrap

**User Story:** Como mantenedor, quero lock, sentinel e primeiras acoes obrigatorias antes da resposta inicial, para que edit guards e stop checks tenham estado real para validar.

#### Acceptance Criteria

4.1 WHEN an explicit pipeline request is accepted, THE system SHALL create `.codex/pipeline/session-lock.json` before any edit, shell write, dispatch claim, or final response.

4.2 WHEN an explicit pipeline request is accepted, THE system SHALL create `.codex/pipeline/sentinel-state.json` with `pipelineActive=true`, `currentPhase=phase-0` or the earliest equivalent bootstrap phase, and non-empty `expectedNext`.

4.3 WHEN an explicit pipeline request is accepted, THE system SHALL persist required first actions that include visible plan, workflow/method gate, capability gate, and controller dispatch or blocked runtime artifact.

4.4 IF lock or sentinel state cannot be created, THEN the system SHALL stop with `BLOCKED` and SHALL NOT continue as manual pipeline execution.

4.5 WHEN the controller later owns the session, THE bootstrap state SHALL be reconciled with controller-created session identifiers instead of creating competing state.

### Requirement 5: Capability Gate And Runtime Mode Truth

**User Story:** Como usuario, quero saber se o runtime tem agentes reais, para que a entrega nao prometa multi-agent quando `spawn_agent` ou `wait_agent` nao existem.

#### Acceptance Criteria

5.1 WHEN an explicit pipeline request starts, THE system SHALL evaluate capabilities for `spawn_agent`, `wait_agent`, artifact collection, gate recording, checkpoint recording, and structured final state.

5.2 IF required real-agent capabilities are missing, THEN the system SHALL emit `status=BLOCKED`, `runtime_mode=blocked-no-agent-runtime`, `pipeline_valid=false`, and `manual_fallback_counts_as_pipeline=false`.

5.3 IF `strictAgents=false` or harness mode is active, THEN the system SHALL mark the run as harness/dev-bypass and SHALL NOT pass capability gate for operational pipeline validity.

5.4 WHEN capability gate passes, THE system SHALL record the gate in a ledger that final validation can check independently.

5.5 IF capability status is unknown, THEN the system SHALL treat it as missing rather than assuming availability.

### Requirement 6: Stop Hook Evidence Enforcement

**User Story:** Como mantenedor, quero que o `Stop` hook bloqueie conclusoes sem evidencia minima, para que a ausencia de dispatch real nao escape por falta de ferramenta chamada.

#### Acceptance Criteria

6.1 WHEN an explicit pipeline request reaches a terminal assistant response, THE `Stop` enforcement SHALL require either a valid `PipelineGovernanceArtifact` or a structured `BLOCKED` artifact.

6.2 WHEN a response attempts to claim `PIPELINE COMPLETE`, `pipeline_valid=true`, `GO`, or equivalent completion language, THE system SHALL validate gates, hooks, dispatches, wait-agent events, and final verdict against persisted ledgers.

6.3 IF no dispatch happened for a run that required real agents, THEN the stop enforcement SHALL block completion even though `dispatch-guard` had no tool call to intercept.

6.4 IF the response is a blocked runtime report with `manual_fallback_counts_as_pipeline=false`, THEN stop enforcement SHALL allow the terminal response.

6.5 WHEN stop enforcement blocks, THE reason SHALL list missing evidence in sanitized, actionable terms.

### Requirement 7: Gate Taxonomy Parity

**User Story:** Como mantenedor, quero que gate registry, controller output e artifact validation usem uma taxonomia compativel, para que runs reais nao sejam rejeitadas por burocracia ou aceitas por nomes sinteticos.

#### Acceptance Criteria

7.1 WHEN the controller emits a gate, THE gate SHALL exist in `src/gates/gate-registry.ts` or be mapped to a canonical registry gate.

7.2 WHEN final artifact validation requires a gate such as `INTAKE_GATE`, `SCOPE_GATE`, `EVIDENCE_GATE`, `ADVERSARIAL_GATE`, or `FINAL_VERDICT_GATE`, THE implementation SHALL either emit that gate directly or provide a deterministic canonical mapping.

7.3 IF a gate appears only in prompts/docs and not in runtime/tested registry, THEN validation SHALL report drift.

7.4 WHEN `PLAN_GATE_ACTIVE` is mentioned in TypeScript, prompt, docs, or tests, THE naming and phase semantics SHALL match.

7.5 IF a gate is introduced for compatibility only, THEN it SHALL be documented as mapping metadata and SHALL NOT create fake PASS evidence.

### Requirement 8: Edit And Dispatch Guard Coverage

**User Story:** Como operador, quero que edits, shell writes e dispatches sejam negados fora de janela permitida, para que o pipeline nao seja burlado por ferramentas laterais.

#### Acceptance Criteria

8.1 WHEN a pipeline lock is active and no execution window is open, THE edit guard SHALL deny production file edits.

8.2 WHEN a dispatch targets a pipeline agent, THE dispatch guard SHALL require `spawn_agent` with `agent_type="worker"` and `PIPELINE_AGENT_FQN` in the message.

8.3 IF a pipeline agent is invoked by bare leaf name, legacy namespace, direct identity field without marker, or `Skill`, THEN dispatch guard SHALL deny it with a canonical expected FQN.

8.4 WHEN sentinel state is active, THE sentinel guard SHALL deny dispatches that do not match `expectedNext`.

8.5 IF lock state is absent during explicit pipeline execution, THEN the system SHALL treat that as bootstrap failure rather than allowing edits by default.

### Requirement 9: Test And Eval Coverage For Escape Paths

**User Story:** Como mantenedor, quero testes focados para todos os caminhos de escape, para que regressao de enforcement seja detectada localmente.

#### Acceptance Criteria

9.1 WHEN `SessionStart` hook config uses unsupported or non-command handler for executable context, THE test suite SHALL fail.

9.2 WHEN a pipeline-worthy prompt lacks canonical workflow, THE hook tests SHALL prove a blocking response.

9.3 WHEN explicit workflow starts, THE controller/hook tests SHALL prove lock, session, sentinel, required first actions, and gate state exist before proposal or edits.

9.4 WHEN stop hook sees explicit pipeline completion without artifact or blocked artifact, THE tests SHALL prove completion is blocked.

9.5 WHEN gate taxonomy changes, THE tests SHALL prove controller gates, registry gates, artifact validation, docs references, and prompt-facing names remain aligned.

9.6 WHEN Eval Gate is required, THE final validation SHALL run `.agents/skills/workflow-eval-gate/scripts/run_eval.py` or explicitly report why it did not run.

### Requirement 10: Runtime Publication And Adoption Reporting

**User Story:** Como usuario, quero que validacao local seja separada de plugin instalado e runtime vivo, para que "funcionou aqui" nao seja confundido com disponibilidade global.

#### Acceptance Criteria

10.1 WHEN this enforcement is implemented, THE closeout SHALL report local repo validation separately from build `dist/**`, local installed cache, global Codex availability, and VPS/runtime adoption.

10.2 WHEN `src/**` changes, THE build output in `dist/**` SHALL be generated by `npm run build` and SHALL NOT be manually edited.

10.3 IF installed cache parity is claimed, THEN the report SHALL include proof from the installed cache path and not only from the source checkout.

10.4 IF global plugin availability is claimed, THEN a smoke from a clean directory outside the repo SHALL prove discovery and behavior.

10.5 IF VPS/runtime adoption is out of scope, THEN the report SHALL say so explicitly and SHALL NOT imply publication.

## Non-Functional Requirements

- **NFR-1 Fail-closed:** Enforcement surfaces must prefer `BLOCKED` over silent fallback when state, capabilities, or hook trust are unknown.
- **NFR-2 Minimal diff:** Future implementation must reuse existing hooks/runtime/stores/tests and avoid parallel governance systems.
- **NFR-3 No new dependencies:** Hook changes must continue using Node.js builtins unless the user explicitly approves a dependency.
- **NFR-4 Traceability:** Every PASS claim must map to persisted evidence or a validation command.
- **NFR-5 Operator clarity:** Final reports must separate local validation, installed cache, hook trust, and live runtime adoption.

## Out Of Scope

- Marketplace publication.
- VPS synchronization.
- Redesigning the full 45-agent architecture.
- Replacing the TypeScript controller with a new orchestration engine.
- Adding new package dependencies.
- Editing `dist/**` manually.

## Requirements Review Gate

- Numeric requirement IDs: PASS.
- EARS-style acceptance criteria: PASS.
- User-observable behavior separated from implementation detail: PASS, with implementation-specific paths retained only where the requirement is about observable plugin/runtime evidence.
- Scope boundaries explicit: PASS.
- No unresolved ambiguity requiring user clarification before design: PASS.
