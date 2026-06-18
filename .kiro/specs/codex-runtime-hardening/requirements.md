# Requirements Document: Codex Runtime Hardening

## Introduction

O projeto `pipeline-orchestrator-for-codex` precisa deixar de depender de um workflow hibrido que mistura contrato de Claude Code com execucao Codex. O diagnostico de entrada aponta que o problema central nao e falta de instrucao, mas falta de runtime Codex-native: partes criticas ainda assumem nomes de ferramentas, hooks, matchers e semanticas de Claude Code.

Esta spec transforma esse diagnostico em requisitos verificaveis para separar dois runtimes:

- **Claude_Runtime**: mantem compatibilidade com contratos Claude-only quando esse ambiente existir.
- **Codex_Runtime**: usa instrucoes Codex, hooks Codex, `apply_patch`, Bash guardado, subagentes Codex quando explicitamente disponiveis e um runner deterministico que controla a maquina de estados.

O principio de produto e o mesmo da Constitution local: evidencia acima de suposicao. Markdown instrui; runner ordena; hook bloqueia; schema valida; teste comprova.

## Source Evidence

- O arquivo de entrada do usuario esta em `C:/Users/win/.codex/attachments/a1f4c6bc-d02f-4af9-8477-2da857a196b9/pasted-text.txt`.
- A documentacao oficial de AGENTS.md confirma a descoberta em camadas, o uso de `AGENTS.override.md`, e o limite default `project_doc_max_bytes` de 32 KiB.
- A documentacao oficial de hooks confirma que `PreToolUse` intercepta `Bash`, edicoes por `apply_patch` e ferramentas MCP, e que o input canonico para edicoes ainda reporta `tool_name: "apply_patch"`.
- A documentacao oficial de subagentes confirma que Codex nao inicia subagentes automaticamente; o uso deve ser explicito.

## Glossary

- **Codex_Runtime**: caminho operacional para Codex, com contrato proprio, hooks Codex-native, runner deterministico e estado em `.pipeline/codex/**`.
- **Claude_Runtime**: caminho operacional legado/compatibilidade que pode manter nomes como `Agent`, `AskUserQuestion`, `Edit`, `Write`, `MultiEdit` e `Skill`.
- **CHANGE_CONTRACT**: contrato estruturado que define escopo permitido, arquivos permitidos/proibidos, checks, evidence e definicao de done para uma mudanca.
- **Runner_Deterministico**: processo fora do modelo que controla transicoes de estado e chama Codex para passos isolados.
- **Prompt_Facing_File**: arquivo carregado ou consultado pelo agente e capaz de influenciar comportamento, como `AGENTS.md`, `commands/pipeline.md`, hooks config, README e docs de runtime.
- **Fail_Closed**: comportamento que bloqueia a acao quando o runtime nao consegue provar escopo, estado ou contrato valido.

## Requirements

### Requirement 1: Codex Runtime Contract Override

**User Story:** As a maintainer running this plugin inside Codex, I want a short Codex-specific operational contract, so that Codex receives enforceable runtime rules instead of a large hybrid catalog.

#### Acceptance Criteria

1. WHEN the repository is opened by Codex, THE project SHALL provide a Codex-specific instruction surface that identifies `CODEX_RUNTIME` as the active runtime.
2. WHEN the Codex instruction surface is loaded, THE instruction surface SHALL explicitly quarantine Claude-only tool names (`AskUserQuestion`, `Agent`, `Skill`, `Edit`, `Write`, `MultiEdit`, `NotebookEdit`, `EnterPlanMode`) as non-operational in Codex unless a compatibility adapter proves otherwise.
3. WHEN `AGENTS.override.md` is introduced, THE file SHALL stay concise enough to remain under the project instruction budget and SHALL point to authoritative runtime files instead of duplicating long docs.
4. IF a project-level `AGENTS.override.md` conflicts with the existing `AGENTS.md`, THEN THE conflict SHALL be documented and resolved according to local authority order.
5. WHEN this requirement is implemented, THE root `AGENTS.md` SHALL remain documentation/context and SHALL NOT be overwritten or normalized by the global AGENTS template.

#### Prework Analysis

| AC | Testable | Tipo | Razao |
| --- | --- | --- | --- |
| 1.1 | yes - example | Runtime contract | Static check for CODEX_RUNTIME marker. |
| 1.2 | yes - example | Compatibility | Grep for quarantined Claude-only names. |
| 1.3 | yes - property | Prompt hygiene | Size check against instruction budget. |
| 1.4 | yes - example | Documentation | Conflict note visible in spec/runtime docs. |
| 1.5 | yes - example | Local authority | Git diff confirms AGENTS.md preserved. |

### Requirement 2: Runtime Manifest as SSOT for Prompt-Facing Drift

**User Story:** As a contributor, I want one manifest for runtime version, runtime entrypoints, agent counts and state paths, so that prompt-facing files do not send contradictory signals to Codex.

#### Acceptance Criteria

1. WHEN runtime metadata is needed, THE project SHALL read from `pipeline.runtime.json` or an equivalent single manifest.
2. WHEN prompt-facing files mention version, runtime contract version, canonical entrypoints, agent counts or Codex state paths, THE values SHALL match the manifest.
3. IF a prompt-facing file contains a stale literal such as an old hook version or contradictory agent count, THEN a test SHALL fail.
4. WHEN the manifest is updated, THE update SHALL identify whether it affects Claude_Runtime, Codex_Runtime, Paperclip, or shared docs.
5. WHEN docs intentionally describe historical behavior, THE docs SHALL mark it as historical and SHALL NOT present it as active runtime truth.

#### Prework Analysis

| AC | Testable | Tipo | Razao |
| --- | --- | --- | --- |
| 2.1 | yes - example | SSOT | Manifest existence and parse test. |
| 2.2 | yes - property | Consistency | Static scan over prompt-facing files. |
| 2.3 | yes - example | Regression guard | Test blocks known stale literals. |
| 2.4 | yes - example | Scope | Manifest schema includes affected runtime. |
| 2.5 | yes - example | Documentation honesty | Historical marker grep. |

### Requirement 3: Codex-Native Hook Configuration

**User Story:** As a security operator, I want hook configuration that matches Codex hook semantics, so that edits and shell writes are intercepted in the real Codex tool path.

#### Acceptance Criteria

1. WHEN Codex hooks are configured, THE Codex hook config SHALL use supported command handlers and Codex event names.
2. WHEN a `PreToolUse` hook protects file edits, THE matcher SHALL include `apply_patch` or aliases that actually match apply-patch edits in Codex.
3. WHEN a hook receives an edit event from Codex, THE hook SHALL parse `tool_name: "apply_patch"` and extract targets from the patch body.
4. WHEN a hook protects shell writes, THE hook SHALL evaluate Bash commands for redirects, moves, deletes and other write-like operations before allowing them.
5. IF an official Codex hook behavior is uncertain or changes, THEN THE implementation SHALL re-check official docs and capture the verification date in the design or KB.

#### Prework Analysis

| AC | Testable | Tipo | Razao |
| --- | --- | --- | --- |
| 3.1 | yes - example | Hook compatibility | Config schema/static parse. |
| 3.2 | yes - example | Edit interception | Matcher includes apply_patch/Edit/Write. |
| 3.3 | yes - property | Scope extraction | Patch parser target property tests. |
| 3.4 | yes - example | Bash guard | Integration test with shell write. |
| 3.5 | yes - example | Drift control | Verification date in KB/design. |

### Requirement 4: CHANGE_CONTRACT Fail-Closed Scope Lock

**User Story:** As a maintainer, I want Codex edits to be blocked unless an active CHANGE_CONTRACT permits the target files, so that Codex cannot bypass workflow governance by using `apply_patch`.

#### Acceptance Criteria

1. WHEN `PIPELINE_RUNTIME=codex` and no active CHANGE_CONTRACT exists, THE scope lock SHALL deny production file edits.
2. WHEN `apply_patch` targets one or more files, THE scope lock SHALL validate every target against `CHANGE_CONTRACT.allowed_files`.
3. IF any target cannot be resolved, THEN THE scope lock SHALL deny the edit with a sanitized reason.
4. WHEN a target is outside the allowed scope, THE scope lock SHALL deny the edit and record the denied target in `.pipeline/codex/events.jsonl`.
5. WHEN a target is allowed, THE scope lock SHALL allow the edit and record the decision provenance.

#### Prework Analysis

| AC | Testable | Tipo | Razao |
| --- | --- | --- | --- |
| 4.1 | yes - property | Fail-closed | No contract implies deny. |
| 4.2 | yes - property | Scope | All patch targets validated. |
| 4.3 | edge-case | Security | Unresolved targets denied. |
| 4.4 | yes - example | Auditability | Deny event persisted. |
| 4.5 | yes - example | Auditability | Allow event persisted. |

### Requirement 5: Deterministic Codex Pipeline Runner

**User Story:** As an operator, I want a deterministic runner to control the workflow, so that the model executes bounded steps instead of deciding the pipeline order from a long prompt.

#### Acceptance Criteria

1. WHEN a Codex pipeline run starts, THE `Runner_Deterministico` SHALL initialize state under `.pipeline/codex/`.
2. WHEN a step completes, THE runner SHALL validate structured JSON output before advancing.
3. IF a step emits invalid JSON, wrong step name, or wrong next step, THEN THE runner SHALL stop with `BLOCKED_INVALID_STEP_OUTPUT`.
4. WHEN a transition is requested, THE runner SHALL check an explicit transition table before executing the next step.
5. WHEN the run ends, THE runner SHALL persist final state as `VALIDATED`, `BLOCKED`, or `FAILED`, never as an implicit success.

#### Prework Analysis

| AC | Testable | Tipo | Razao |
| --- | --- | --- | --- |
| 5.1 | yes - example | State | Init creates expected files. |
| 5.2 | yes - property | Schema | Invalid output cannot advance. |
| 5.3 | edge-case | Robustness | Bad LLM output stops safely. |
| 5.4 | yes - property | State machine | Transition table enforced. |
| 5.5 | yes - example | Completion | Final states constrained. |

### Requirement 6: Structured Step Schemas

**User Story:** As a runtime maintainer, I want every Codex runner step to have an input and output schema, so that enforcement does not depend on prose-only instructions.

#### Acceptance Criteria

1. WHEN the runner calls Codex for `CLASSIFY_TASK`, THE output SHALL match a schema with task type, severity, required next step and evidence.
2. WHEN the runner calls Codex for `PLAN`, THE output SHALL include allowed files, checks, red/acceptance criteria and unanswered blockers.
3. WHEN the runner calls Codex for `IMPLEMENT`, THE output SHALL include changed files, rationale and expected checks.
4. WHEN the runner calls Codex for `ADVERSARIAL_REVIEW`, THE output SHALL include findings, severity, evidence and disposition.
5. WHEN any schema evolves, THE schema version SHALL be included in state and events.

#### Prework Analysis

| AC | Testable | Tipo | Razao |
| --- | --- | --- | --- |
| 6.1 | yes - example | Schema | CLASSIFY_TASK parse test. |
| 6.2 | yes - example | Schema | PLAN parse test. |
| 6.3 | yes - example | Schema | IMPLEMENT parse test. |
| 6.4 | yes - example | Schema | REVIEW parse test. |
| 6.5 | yes - property | Versioning | All events carry schema version. |

### Requirement 7: Completion Check and Trace Evidence

**User Story:** As a user reading the final report, I want proof that mandatory steps ran, so that the pipeline cannot claim done without checks, review and trace.

#### Acceptance Criteria

1. WHEN a run reaches completion, THE completion checker SHALL require patch evidence, checks evidence, adversarial review evidence and final trace.
2. IF required evidence is missing, THEN THE run SHALL end as `BLOCKED_INCOMPLETE_TRACE`.
3. WHEN checks are skipped, THE final trace SHALL include a concrete reason and the related requirement/task IDs.
4. WHEN adversarial review cannot run because subagents are unavailable, THE final trace SHALL say whether inline review was allowed or whether the run blocked.
5. WHEN completion succeeds, THE final report SHALL include links/paths to state, events, trace and checks output.

#### Prework Analysis

| AC | Testable | Tipo | Razao |
| --- | --- | --- | --- |
| 7.1 | yes - property | Done definition | Evidence checklist. |
| 7.2 | edge-case | Completion | Missing evidence blocks. |
| 7.3 | yes - example | Honesty | Skipped checks must be explained. |
| 7.4 | yes - example | Agent truth | No fake multi-agent claim. |
| 7.5 | yes - example | Report | Paths visible. |

### Requirement 8: Subagent Availability Is Explicit

**User Story:** As a maintainer, I want Codex subagent use to be explicit and detectable, so that the project does not claim real multi-agent execution when the runtime did not spawn agents.

#### Acceptance Criteria

1. WHEN a workflow requires real subagents, THE workflow SHALL detect subagent support before claiming multi-agent execution.
2. IF real subagents are required and unavailable, THEN THE workflow SHALL stop with `blocked-no-agent-runtime`.
3. WHEN subagents are optional, THE workflow SHALL record whether execution used real subagents, inline fallback, or no review.
4. WHEN a subagent is spawned, THE event log SHALL include subagent type, purpose, started timestamp and completed timestamp.
5. WHEN subagent docs or prompts mention automatic dispatch, THE text SHALL be corrected to say dispatch is explicit unless official runtime evidence proves otherwise.

#### Prework Analysis

| AC | Testable | Tipo | Razao |
| --- | --- | --- | --- |
| 8.1 | yes - example | Capability detection | Runtime probe or explicit adapter. |
| 8.2 | yes - property | Truthfulness | Required agent unavailable blocks. |
| 8.3 | yes - example | Observability | Fallback mode persisted. |
| 8.4 | yes - example | Event log | Spawn lifecycle events. |
| 8.5 | yes - example | Documentation | Prompt-facing text scan. |

### Requirement 9: Runtime Separation for Claude and Codex

**User Story:** As a contributor maintaining both ecosystems, I want Claude and Codex runtime files separated, so that one runtime does not inherit invalid tool names or hook assumptions from the other.

#### Acceptance Criteria

1. WHEN runtime files are organized, THE project SHALL separate Codex-specific runner/hooks/contracts from Claude-specific command/hook notes.
2. WHEN shared behavior exists, THE shared behavior SHALL live in a neutral module or doc and SHALL NOT mention runtime-specific tool names.
3. WHEN `commands/pipeline.md` remains as a public entrypoint, THE file SHALL stay short and route to the authoritative skill/runtime contract.
4. IF a Claude-only contract remains in the repository, THEN it SHALL be labeled as Claude_Runtime and not presented as Codex_Runtime.
5. WHEN the separation is complete, THE docs SHALL include a map from public command to effective Codex runtime path.

#### Prework Analysis

| AC | Testable | Tipo | Razao |
| --- | --- | --- | --- |
| 9.1 | yes - example | Structure | Directory/file map. |
| 9.2 | yes - example | Separation | Shared docs avoid tool-specific names. |
| 9.3 | yes - example | Entrypoint | commands/pipeline.md stays thin. |
| 9.4 | yes - example | Documentation | Labels present. |
| 9.5 | yes - example | Discoverability | Runtime map present. |

### Requirement 10: Acceptance Tests and Eval Gate Coverage

**User Story:** As a release owner, I want tests and Eval Gate evidence for runtime governance changes, so that the spec cannot pass by documentation alone.

#### Acceptance Criteria

1. WHEN any Codex runtime, hook, runner, command, skill or workflow file changes, THE relevant existing checks SHALL run.
2. WHEN the Eval Gate applies, THE local eval runner SHALL pass before declaring implementation PASS.
3. WHEN hooks are part of the claim, THE final report SHALL distinguish hook file changes from hooks actually trusted/active in Codex.
4. WHEN tests cannot exercise a live Codex hook or subagent path, THE implementation SHALL provide a deterministic fixture and mark the live runtime proof as not done.
5. WHEN the implementation completes, THE final report SHALL include changed files, checks run, assumptions, risks and anything not done.

#### Prework Analysis

| AC | Testable | Tipo | Razao |
| --- | --- | --- | --- |
| 10.1 | yes - example | Verification | Command log/report. |
| 10.2 | yes - example | Eval Gate | run_eval.py result. |
| 10.3 | yes - example | Honesty | Final report distinguishes active hooks. |
| 10.4 | yes - example | Test realism | Fixture vs live proof explicit. |
| 10.5 | yes - example | Closeout | Required sections present. |

## Non-Functional Requirements

### NFR-1 - Backward Compatibility

Existing Claude_Runtime assets SHALL continue to exist unless a task explicitly migrates or relabels them. Existing historical docs SHALL not be deleted merely because Codex_Runtime becomes primary.

### NFR-2 - Security

Hooks and runner validators SHALL fail closed for missing contract, malformed state, unresolved target paths, schema parse failures and internal exceptions. User-visible denial reasons SHALL be sanitized.

### NFR-3 - Observability

Every enforcement decision that blocks, allows, skips or falls back SHALL be written to `.pipeline/codex/events.jsonl` or an equivalent event log.

### NFR-4 - Minimal Diff

Implementation SHALL proceed in phases. P0 creates the smallest Codex-native enforcement floor before broader directory reorganization.

### NFR-5 - Documentation Honesty

README, commands, skills, hooks and KB docs SHALL not promise active Codex behavior until runtime, tests and live activation evidence support it.

## Out of Scope

- Publishing the plugin to marketplace/cache/VPS.
- Changing package version as part of this spec creation.
- Removing Claude_Runtime support.
- Rewriting the whole TypeScript controller.
- Treating hook files as active without `/hooks` trust evidence.
- Implementing the runtime in this spec creation task.

## Coverage Matrix

| Goal | Requirement | Priority | Covered |
| --- | --- | --- | --- |
| Codex contract override | R1 | P0 | yes |
| Runtime manifest drift control | R2 | P1 | yes |
| Codex-native hooks | R3 | P0 | yes |
| CHANGE_CONTRACT fail-closed | R4 | P0 | yes |
| Deterministic runner | R5 | P0 | yes |
| Step schemas | R6 | P1 | yes |
| Completion trace | R7 | P1 | yes |
| Explicit subagent availability | R8 | P1 | yes |
| Runtime separation | R9 | P2 | yes |
| Tests and Eval Gate | R10 | P2 | yes |

## Next Phase

```bash
/kiro:spec-design codex-runtime-hardening
```
