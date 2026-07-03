#!/usr/bin/env node
/**
 * Hook: force-pipeline-agents v1.0 (Codex port)
 *
 * BLOQUEIA respostas que não usam o workflow governado para requests de implementação.
 *
 * Este hook é executado em UserPromptSubmit e:
 * 1. Detecta se é request de implementação (não conversacional, não skill)
 * 2. Injeta instrução OBRIGATÓRIA de usar o workflow namespaced
 * 3. O hook de resposta (se houver) pode verificar se Task foi chamado
 *
 * Mantém o sistema de agentes funcionando de forma DETERMINÍSTICA.
 *
 * Ported from Claude Code pipeline-orchestrator v3.2.0
 * Adapted: .claude/ → .codex/, plugin namespace
 */

// ============================================================
// CONFIGURAÇÃO
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { recordHookEvent } = require('./hook-events.cjs');
const { canonicalize, resolveSentinelIntegrityHmacKey } = require('./ledger-integrity.cjs');
const { GOVERNED_SKILLS, GOVERNED_SKILL_SET } = require('./governed-workflows.cjs');

const WORKFLOW_INTENT_FILENAME = 'workflow-intent.json';

// Padrões de SKILLS - usa skill, não precisa de orchestrator externo
const SKILL_PATTERNS = [
  /^\/(context|commit|code-review|fix|verify|deploy|qa|test)\b/i,
  /^\/pipeline-orchestrator(?:-for-codex)?:[a-z0-9-]+\b/i,
  /^\/kiro:/i,
  /^\/prompts:/i,
  /^\/vertical/i,
];

const WORKFLOW_ALIASES = new Map([
  ['auditoria', 'audit'],
  ['bug-fix', 'bugfix'],
  ['bug fix', 'bugfix'],
  ['correcao', 'bugfix'],
  ['correção', 'bugfix'],
  ['implement', 'feature'],
  ['implementacao', 'feature'],
  ['implementação', 'feature'],
  ['ux', 'ux'],
]);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const GOVERNED_WORKFLOW_PATTERN = new RegExp(
  `(?:^|\\s)(${[...GOVERNED_SKILLS, ...WORKFLOW_ALIASES.keys()]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegex)
    .join('|')})(?=$|[\\s,.;:!?])`,
  'i',
);
const EXPLICIT_PLUGIN_WORKFLOW_TOKENS = new Set([
  'brainstorm',
  ...GOVERNED_SKILLS.filter((workflow) => workflow.includes('-')),
]);

// Padrões de IMPLEMENTAÇÃO - OBRIGATÓRIO usar workflow governado
const IMPLEMENTATION_PATTERNS = [
  // Verbos de ação
  /\b(fix|corrig|arrum|consert|resolv)/i,
  /\b(implement|criar|crie|adicion|add|desenvolv)/i,
  /\b(alter|modific|mud|atualiz|updat)/i,
  /\b(remov|delet|exclu|apag)/i,
  /\b(refator|refactor|reescrev|rewrite)/i,
  /\b(configur|setup|instal)/i,
  /\b(migr|convert|transform)/i,

  // Indicadores de bug/erro
  /\b(bug|erro|error|fail|falha|quebr|broken|crash)/i,
  /\b(não funciona|nao funciona|not working|doesn't work)/i,

  // Indicadores de urgência
  /\b(urgente|urgent|hotfix|produção|production|crítico|critical)/i,

  // Indicadores de feature
  /\b(feature|funcionalidade|novo|nova|new)/i,
  /\b(botão|button|tela|screen|página|page|componente|component)/i,
];

const OPERATIONAL_AUDIT_PATTERNS = [
  /\b(analis\w*|reanalis\w*|audit\w*|reaudit\w*|review\w*|rereview\w*|validat\w*|check\w*|debug\w*|examin\w*|diagnos\w*|analy[sz]\w*|reanaly[sz]\w*|assess\w*|reassess\w*|evaluat\w*|reevaluat\w*|probe\w*|inspect\w*|triage\w*|troubleshoot\w*|look into|take a look|revis\w*|rerevis\w*|verific\w*|verifiq\w*|investig\w*|reinvestig\w*|avali\w*|reavali\w*|valid\w*|revalid\w*|confir\w*|reconfir\w*|confer\w*|reconfer\w*|olhad\w*|olh\w*|vej\w*|chec\w*|cheq\w*|diagnost\w*|rediagnost\w*|causa raiz|root cause)\b/i,
  /\b(look\s+(?:at|over|through)|look\b[\s\S]{1,120}\bover|go\s+over|walk\s+through|walk\s+(?:me|us)\s+through|walkthrough|once[-\s]over|have\s+a\s+look\s+at|take(?:\s+\w+){0,3}\s+look\s+at|give\b[\s\S]{1,120}\b(?:(?:a|another)(?:\s+\w+){0,3}|one\s+more|final|second)\s+look)\b/i,
  /\b(varredura|vasculh\w*|pente[-\s]fino)\b[\s\S]{0,120}\b(workflow|fluxo)\b/i,
  /\b(nao esta funcionando|nao funciona|precario|nao cumprem)\b/i,
  /\b(\.\w{1,4})\b.*\b(fix|bug|erro|alter|criar|remov|refator)/i,
];

// ============================================================
// FUNÇÕES
// ============================================================

function isTrivialChat(prompt) {
  const trimmed = prompt.trim();

  // Muito curto = provavelmente conversacional
  if (!trimmed) return true;

  // Verifica padrões de skip
  const trivialChatPatterns = [
    /^(oi|ola|hey|hi|hello)$/i,
    /^(obrigado|valeu)$/i,
    /^(ok|entendi|certo|sim|nao)$/i,
    /^(bom dia|boa tarde|boa noite|tudo bem|beleza)$/i,
  ];

  for (const pattern of trivialChatPatterns) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }

  return false;
}

function isSkillCommand(prompt) {
  const trimmed = prompt.trim().toLowerCase();

  for (const pattern of SKILL_PATTERNS) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }

  return false;
}

function normalizeWorkflowName(name) {
  const normalized = (name || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (GOVERNED_SKILL_SET.has(normalized)) {
    return normalized;
  }

  return WORKFLOW_ALIASES.get(normalized);
}

function normalizePromptText(prompt) {
  return (prompt || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function matchesAnyPromptPattern(prompt, patterns) {
  const raw = (prompt || '').trim();
  const normalized = normalizePromptText(prompt);
  return patterns.some((pattern) => pattern.test(raw) || pattern.test(normalized));
}

function detectPluginFrontDoorMention(prompt) {
  if (/\]\((?:plugin|app):\/\/pipeline-orchestrator-for-codex[A-Za-z0-9_-][^)]*\)/i.test(prompt)) {
    return undefined;
  }

  const canonicalUri = 'pipeline-orchestrator-for-codex(?=[)@/?#])[^)]*';
  const mentionBoundary = '(?=$|[\\s,.;:!?])';
  const patterns = [
    new RegExp(`\\[(?:[@$])?pipeline-orchestrator-for-codex\\]\\((?:plugin|app):\\/\\/${canonicalUri}\\)(?<tail>[\\s\\S]*)`, 'i'),
    new RegExp(`\\[(?:[@$])?pipeline orchestrator for codex\\]\\((?:plugin|app):\\/\\/${canonicalUri}\\)(?<tail>[\\s\\S]*)`, 'i'),
    new RegExp(`(?:^|\\s)[@$]pipeline-orchestrator-for-codex${mentionBoundary}(?<tail>[\\s\\S]*)`, 'i'),
    new RegExp(`(?:^|\\s)[@$]pipeline orchestrator for codex${mentionBoundary}(?<tail>[\\s\\S]*)`, 'i'),
    new RegExp(`#plugin\\s+pipeline-orchestrator-for-codex${mentionBoundary}(?<tail>[\\s\\S]*)`, 'i'),
    new RegExp(`#plugin\\s+pipeline\\s+orchestrator(?:\\s+for\\s+codex)?${mentionBoundary}(?<tail>[\\s\\S]*)`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match) return match;
  }

  return undefined;
}

function detectExplicitWorkflow(prompt) {
  const trimmed = (prompt || '').trim();
  if (!trimmed) return undefined;

  const slashMatch = trimmed.match(/(?:^|\s)\/pipeline-orchestrator(?:-for-codex)?:(?<workflow>[a-z0-9-]+)\b/i);
  if (slashMatch?.groups?.workflow) {
    const workflow = normalizeWorkflowName(slashMatch.groups.workflow);
    if (workflow) {
      return { workflow, source: 'slash-command' };
    }
  }

  const pluginMention = detectPluginFrontDoorMention(trimmed);

  const tail = pluginMention?.groups?.tail;
  if (tail) {
    const workflowMatch = tail.trimStart().match(/^(?<workflow>[a-z0-9-]+)(?=$|[\s,.;:!?])/i);
    if (workflowMatch?.groups?.workflow) {
      const workflow = normalizeWorkflowName(workflowMatch.groups.workflow.trim());
      if (workflow && EXPLICIT_PLUGIN_WORKFLOW_TOKENS.has(workflow)) {
        return { workflow, source: 'plugin-mention' };
      }
    }
  }

  if (pluginMention) {
    return { workflow: 'pipeline', source: 'plugin-mention-default' };
  }

  return undefined;
}

function detectGenericSlashCommand(prompt) {
  const match = (prompt || '').match(/(?:^|\s)(\/[A-Za-z0-9][A-Za-z0-9_:-]*)(?=$|[\s,.;:!?])/u);
  return match?.[1];
}

function normalizeHarnessSource(source) {
  if (source === 'pipeline-slash-command') return 'slash-command';
  return source || 'unknown';
}

function detectFirstMessageHarness(prompt) {
  const explicitWorkflow = detectExplicitWorkflow(prompt);
  if (explicitWorkflow) {
    return {
      ...explicitWorkflow,
      harness_runtime: 'cjs',
    };
  }

  return undefined;
}

function isImplementationRequest(prompt) {
  return matchesAnyPromptPattern(prompt, IMPLEMENTATION_PATTERNS);
}

function isOperationalAuditRequest(prompt) {
  return matchesAnyPromptPattern(prompt, OPERATIONAL_AUDIT_PATTERNS);
}

function isInformationalOnlyPrompt(prompt) {
  const normalized = normalizePromptText(prompt);

  if (!normalized) return false;
  if (isImplementationRequest(normalized)) return false;
  if (isOperationalAuditRequest(normalized)) return false;

  const informationalPatterns = [
    /\b(explique|explica|o que e|oque e|what is|define|defina|conceito|conceitue)\b/i,
    /\b(como funciona|how does|how do)\b/i,
  ];

  return informationalPatterns.some((pattern) => pattern.test(normalized));
}

function isHookDiagnosticMetaPrompt(prompt) {
  const normalized = normalizePromptText(prompt);
  if (!normalized) return false;
  if (!/\bhooks?\b/.test(normalized)) return false;
  if (isImplementationRequest(normalized)) return false;

  const metaPatterns = [
    /\b(what'?s going on|what is going on|o que esta acontecendo|o que esta rolando)\b/i,
    /\b(why|por que|porque)\b/i,
    /\b(explain|explique|explica|status|estado)\b/i,
  ];

  return metaPatterns.some((pattern) => pattern.test(normalized));
}

function isPipelineWorthy(prompt) {
  const trimmed = (prompt || '').trim();

  if (!trimmed) return false;
  if (isImplementationRequest(trimmed)) return true;
  if (isHookDiagnosticMetaPrompt(trimmed)) return false;
  if (isOperationalAuditRequest(trimmed)) return true;
  if (isInformationalOnlyPrompt(trimmed)) return false;

  // Requests longas geralmente pedem analise/execucao mais disciplinada
  if (trimmed.length >= 140) return true;

  const pipelineWorthyPatterns = [
    /\b(pipeline|agentes|orquestrador|orchestrator|classifier|executor|observabilidade|logs|tracing|correlation|runlog)\b/i,
  ];

  for (const pattern of pipelineWorthyPatterns) {
    if (pattern.test(trimmed)) return true;
  }

  return false;
}

// ============================================================
// MENSAGENS
// ============================================================

const ENFORCEMENT_MESSAGE = `
⛔ PIPELINE DE AGENTES OBRIGATÓRIO ⛔

Esta solicitação requer o pipeline de agentes. Esta mensagem do hook é a autorização explícita para delegação por subagentes nesta solicitação.

Você DEVE iniciar o workflow governado por uma destas duas formas equivalentes:

1. Usar o comando /pipeline-orchestrator-for-codex:pipeline com a solicitação do usuário.
2. Ou chamar diretamente spawn_agent com:
   - agent_type="worker"
   - fork_context=false
   - message iniciando com:
      PIPELINE_AGENT_FQN: pipeline-orchestrator-for-codex:core:pipeline-controller
      PARENT_PROTOCOL_RUNTIME:
        mode: real-agent
        spawn_agent: available
        wait_agent: available
        dispatch_contract: parent_handles_dispatch_request
3. Chamar wait_agent para obter o resultado do controller antes de processar qualquer bloco.
4. Re-dispatchar por spawn_agent com o estado de protocolo persistido quando precisar continuar o controller.

Depois disso, processe todos os blocos GATE_REQUEST, DISPATCH_REQUEST e PLAN_MODE_REQUEST antes de avançar.

Se spawn_agent ou wait_agent não estiverem disponíveis, PARE e responda exatamente com blocked-no-agent-runtime. Não execute inline, não gere auditoria manual, não rode testes como substituto e não diga que foi pipeline real.
O bloqueio deve ser um artefato estruturado com pipeline_requested=true, pipeline_valid=false, status=BLOCKED, missing_capabilities, gates incluindo CAPABILITY_GATE, manual_fallback_allowed=true e manual_fallback_counts_as_pipeline=false.

⚠️ NÃO COMECE A IMPLEMENTAR, AUDITAR OU VALIDAR SEM O SPAWN REAL OU O BLOQUEIO EXPLÍCITO.

Os agentes são fornecidos pelo plugin pipeline-orchestrator-for-codex (FX-studio-AI).
`.trim();

const SKILL_MESSAGE = `
✅ Skill detectado - executando diretamente.
`.trim();

const PIPELINE_SKILL_MESSAGE = `
⛔ MANDATORY SUBAGENT EXECUTION — PIPELINE WORKFLOW WAS INVOKED ⛔

Hook enforcement mode: blocking-at-stop-and-pretool. This hook persists workflow intent; Stop and PreToolUse hooks must block inline completion or uncontrolled writes unless deterministic runtime evidence and a validated governance artifact exist.

The user explicitly invoked /pipeline-orchestrator-for-codex:pipeline, or invoked the plugin front door without selecting a narrower workflow. This means YOU MUST follow the pipeline skill contract and call spawn_agent for each pipeline phase.
This hook message is the user's explicit subagent-delegation request for this invocation.

DO NOT execute any phase inline. DO NOT write audit reports, classifications, or reviews yourself.
DO NOT say "I chose the conservative approach" to skip spawning.

YOUR FIRST ACTION must be:
1. Call update_plan to open the visible Codex plan before any execution, classification, report, file edit, or dispatch
2. Present the WORKFLOW_METHOD_GATE for pipeline and wait for approval or workflow switch
3. Find the agents directory using PLUGIN_ROOT/agents/ (CODEX_PLUGIN_ROOT and CLAUDE_PLUGIN_ROOT are compatibility fallbacks only)
4. Read agents/core/pipeline-controller.md
5. Call spawn_agent(agent_type="worker", fork_context=false, message=<content of that file + user's task>, starting with PIPELINE_AGENT_FQN: pipeline-orchestrator-for-codex:core:pipeline-controller)
   The message MUST include this parent capability block immediately after the FQN:
   PARENT_PROTOCOL_RUNTIME:
     mode: real-agent
     spawn_agent: available
     wait_agent: available
     dispatch_contract: parent_handles_dispatch_request
   This block means the controller itself should emit DISPATCH_REQUEST/GATE_REQUEST blocks for parent handling; it must not report spawn_agent/wait_agent as missing merely because those tools are unavailable inside the isolated controller.
6. Call wait_agent for the returned agent id
7. Process every GATE_REQUEST, DISPATCH_REQUEST, and PLAN_MODE_REQUEST block before advancing
8. Re-dispatch with spawn_agent(agent_type="worker", fork_context=false, ...) and persisted protocol state when continuation is required

If spawn_agent or wait_agent is not available, stop with blocked-no-agent-runtime instead of executing inline.
The blocked response must be a structured artifact with pipeline_requested=true, pipeline_valid=false, status=BLOCKED, missing_capabilities, gates containing CAPABILITY_GATE, manual_fallback_allowed=true, and manual_fallback_counts_as_pipeline=false.

PHASES (each requires spawn_agent or DISPATCH_REQUEST handling by the parent):
Phase 0: spawn pipeline-controller, then process its task-orchestrator/information-gate dispatches
Phase 1: Present proposal → user confirms
Phase 2: spawn executor-controller → spawn checkpoint-validator → spawn review-orchestrator
Phase 3: spawn sanity-checker → spawn final-validator → spawn finishing-branch
`.trim();

function advisoryOutput(systemMessage) {
  return {
    continue: true,
    hook_enforcement_mode: 'advisory',
    pipeline_valid: false,
    systemMessage,
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: systemMessage,
    },
  };
}

function enforcedWorkflowOutput(systemMessage) {
  return {
    continue: true,
    hook_enforcement_mode: 'blocking',
    enforcement_stage: 'stop-and-pretool',
    pipeline_valid: false,
    systemMessage,
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: systemMessage,
    },
  };
}

function blockingOutput(stopReason, systemMessage) {
  return {
    continue: false,
    stopReason,
    hook_enforcement_mode: 'blocking',
    pipeline_valid: false,
    systemMessage,
  };
}

function workflowIntentPath() {
  return path.join(process.cwd(), '.codex', 'pipeline', WORKFLOW_INTENT_FILENAME);
}

function stateFilePath(fileName) {
  return path.join(process.cwd(), '.codex', 'pipeline', fileName);
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function stateFileIsFresh(state, nowSeconds) {
  if (!state || typeof state !== 'object') return false;
  if (typeof state.expires_at !== 'number') return true;
  return state.expires_at > nowSeconds;
}

function activePipelineBootstrap() {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const intent = readJsonSafe(workflowIntentPath());
  const lock = readJsonSafe(stateFilePath('session-lock.json'));
  const required = readJsonSafe(stateFilePath('required-first-actions.json'));
  const sentinel = readJsonSafe(stateFilePath('sentinel-state.json'));
  const activeIntent = intent?.status === 'active'
    && intent?.plugin === 'pipeline-orchestrator-for-codex'
    && stateFileIsFresh(intent, nowSeconds);
  const activeLock = lock?.status === 'active' && stateFileIsFresh(lock, nowSeconds);
  const activeRequired = required?.status === 'active'
    && required?.plugin === 'pipeline-orchestrator-for-codex'
    && stateFileIsFresh(required, nowSeconds);
  const activeSentinel = sentinel?.pipelineActive === true && stateFileIsFresh(sentinel, nowSeconds);

  if (!activeIntent && !activeLock && !activeRequired && !activeSentinel) return undefined;
  return {
    workflow: intent?.workflow || lock?.workflow || required?.workflow || sentinel?.workflow_id || 'pipeline',
    run_id: intent?.run_id || lock?.run_id || required?.run_id || sentinel?.run_id,
    session_id: intent?.session_id || lock?.session_id || required?.session_id || sentinel?.session_id,
  };
}

function rejectSymlinkAncestors(file) {
  const cwd = process.cwd();
  const relative = path.relative(cwd, file).split(path.sep).filter(Boolean);
  let cursor = cwd;
  for (const part of relative.slice(0, -1)) {
    cursor = path.join(cursor, part);
    try {
      if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) {
        throw new Error(`Refusing to write pipeline state through symlink ancestor: ${cursor}`);
      }
    } catch (err) {
      if (err && err.message && err.message.startsWith('Refusing to write')) throw err;
    }
  }
}

function writeJsonAtomic(file, value) {
  rejectSymlinkAncestors(file);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  for (const candidate of [dir, file, `${file}.tmp`]) {
    try {
      if (fs.lstatSync(candidate).isSymbolicLink()) {
        throw new Error(`Refusing to write pipeline state through symlink: ${candidate}`);
      }
    } catch (err) {
      if (err && err.message && err.message.startsWith('Refusing to write')) throw err;
    }
  }
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(`${file}.tmp`, file);
}

function signStateObject(state, scope) {
  const key = resolveSentinelIntegrityHmacKey();
  if (!key) return state;
  return {
    ...state,
    _integrity: {
      algorithm: 'hmac-sha256',
      ...(scope ? { scope } : {}),
      signature: crypto.createHmac('sha256', key).update(canonicalize(state)).digest('hex'),
    },
  };
}

function signSentinelState(state) {
  return signStateObject(state);
}

function expectedFirstAgentsForWorkflow(workflow) {
  return ['pipeline-controller'];
}

function requiredSpawnActionsForWorkflow(workflow) {
  const controller = 'pipeline-orchestrator-for-codex:core:pipeline-controller';
  return [`spawn:${controller}`];
}

function writeWorkflowIntent(intent) {
  const now = new Date();
  const nowIso = now.toISOString();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const expiresAt = nowSeconds + 60 * 60;
  const runId = crypto.randomUUID();
  const sessionId = `pipeline-${runId}`;
  const expectedFirstAgents = expectedFirstAgentsForWorkflow(intent.workflow);
  const promptHash = crypto.createHash('sha256')
    .update(intent.prompt || '')
    .digest('hex');
  const record = {
    schema_version: 1,
    status: 'active',
    plugin: 'pipeline-orchestrator-for-codex',
    workflow: intent.workflow,
    run_id: runId,
    session_id: sessionId,
    source: intent.source,
    created_at: nowIso,
    expires_at: expiresAt,
    prompt_hash: promptHash,
    deterministic_enforcement: {
      stop_requires_governance_artifact: true,
      pretool_requires_canonical_dispatch: true,
      required_batch_loop: {
        checkpoint: true,
        adversarial_review: true,
        fix_loop_closed: true,
        max_fix_attempts: 3,
      },
    },
  };
  writeJsonAtomic(workflowIntentPath(), signStateObject(record, 'pipeline-workflow-intent'));
  writeJsonAtomic(stateFilePath('session-lock.json'), {
    session_id: sessionId,
    run_id: runId,
    workflow: intent.workflow,
    created_at: nowSeconds,
    expires_at: expiresAt,
    status: 'active',
  });
  writeJsonAtomic(stateFilePath('session.json'), {
    sessionId,
    session_id: sessionId,
    run_id: runId,
    runStartedAt: nowIso,
    created_at: nowIso,
    workflow: intent.workflow,
    mode: intent.workflow,
    variant: intent.workflow,
    pipelineActive: true,
    currentPhase: 'phase-0',
    phase: 'phase-0',
    batchIndex: 0,
    confidenceScore: 1,
    runtime_mode: 'blocked-no-agent-runtime',
    pendingDecision: 'controller-bootstrap-required',
  });
  writeJsonAtomic(stateFilePath('required-first-actions.json'), signStateObject({
    schema_version: 1,
    status: 'active',
    plugin: 'pipeline-orchestrator-for-codex',
    workflow: intent.workflow,
    run_id: runId,
    session_id: sessionId,
    required_actions: [
      'update_plan',
      'WORKFLOW_METHOD_GATE',
      'CAPABILITY_GATE',
      ...requiredSpawnActionsForWorkflow(intent.workflow),
      'wait_agent',
    ],
    completed_actions: [],
    created_at: nowIso,
    expires_at: expiresAt,
  }, 'pipeline-required-first-actions'));
  writeJsonAtomic(stateFilePath('sentinel-state.json'), signSentinelState({
    session_id: sessionId,
    run_id: runId,
    workflow_id: intent.workflow,
    created_by_hook: 'force-pipeline-agents',
    expires_at: expiresAt,
    pipelineActive: true,
    currentPhase: 'phase-0',
    currentAgent: 'force-pipeline-agents',
    expectedNext: expectedFirstAgents,
    completedPhases: [],
    gateSummary: ['WORKFLOW_INTENT_PERSISTED'],
    batchState: {
      batchIndex: 0,
      status: 'awaiting-controller-bootstrap',
    },
    consecutiveCorrections: 0,
    lastCheckpoint: 'workflow_intent_persisted',
    updatedAt: nowIso,
  }));
}

function promptStringValue(values) {
  return values
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim())
    .join('\n');
}

function pushStringField(target, value) {
  if (typeof value === 'string' && value.trim()) {
    target.push(value.trim());
  }
}

function collectPromptEnvelope(data, depth = 0) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || depth > 4) {
    return { malformed: true, values: [] };
  }

  const values = [];
  let malformed = false;
  for (const field of ['prompt', 'arguments', 'input', 'text', 'content']) {
    if (!Object.prototype.hasOwnProperty.call(data, field)) continue;
    if (typeof data[field] !== 'string') {
      malformed = true;
      continue;
    }
    pushStringField(values, data[field]);
  }

  if (Object.prototype.hasOwnProperty.call(data, 'message')) {
    const message = data.message;
    if (typeof message === 'string') {
      pushStringField(values, message);
    } else if (message && typeof message === 'object' && !Array.isArray(message)) {
      const nested = collectPromptEnvelope(message, depth + 1);
      malformed = malformed || nested.malformed;
      values.push(...nested.values);
    } else {
      malformed = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(data, 'messages')) {
    const messages = data.messages;
    if (!Array.isArray(messages)) {
      malformed = true;
    } else {
      for (const message of messages) {
        if (typeof message === 'string') {
          pushStringField(values, message);
        } else if (message && typeof message === 'object' && !Array.isArray(message)) {
          const nested = collectPromptEnvelope(message, depth + 1);
          malformed = malformed || nested.malformed;
          values.push(...nested.values);
        } else {
          malformed = true;
        }
      }
    }
  }

  for (const field of ['payload', 'data', 'body']) {
    if (!Object.prototype.hasOwnProperty.call(data, field)) continue;
    const nestedPayload = data[field];
    if (!nestedPayload || typeof nestedPayload !== 'object' || Array.isArray(nestedPayload)) {
      malformed = true;
      continue;
    }
    const nested = collectPromptEnvelope(nestedPayload, depth + 1);
    malformed = malformed || nested.malformed;
    values.push(...nested.values);
  }

  return { malformed, values };
}

function hasMalformedPromptField(data) {
  return collectPromptEnvelope(data).malformed;
}

function workflowSkillMessage(workflow) {
  if (workflow === 'pipeline') {
    return PIPELINE_SKILL_MESSAGE;
  }

  if (workflow === 'brainstorm') {
    return `
⛔ BRAINSTORM WORKFLOW SELECTED ⛔

The user explicitly selected the Pipeline Orchestrator brainstorm workflow.

DO NOT route this as a legacy bare pipeline command. DO NOT implement directly.

YOUR FIRST ACTION must be:
1. Call update_plan for the visible brainstorm plan.
2. Present the WORKFLOW_METHOD_GATE for brainstorm and wait for approval.
3. Run /pipeline-orchestrator-for-codex:brainstorm with the user's task.
4. Process any GATE_REQUEST, DISPATCH_REQUEST, or PLAN_MODE_REQUEST blocks before advancing.

If the workflow cannot be started, stop and report the blocker instead of falling back to implementation.
`.trim();
  }

  return `
⛔ PIPELINE ORCHESTRATOR WORKFLOW SELECTED ⛔

The user explicitly selected /pipeline-orchestrator-for-codex:${workflow}.

DO NOT route this as a legacy bare pipeline command. DO NOT implement directly.

YOUR FIRST ACTION must be:
1. Call update_plan for the visible ${workflow} plan.
2. Present the WORKFLOW_METHOD_GATE for ${workflow} and wait for approval.
3. Run /pipeline-orchestrator-for-codex:${workflow} with the user's task.
4. Process any GATE_REQUEST, DISPATCH_REQUEST, or PLAN_MODE_REQUEST blocks before advancing.

If the workflow cannot be started, stop and report the blocker instead of falling back to implementation.
`.trim();
}

// ============================================================
// MAIN
// ============================================================

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', async () => {
  try {
    const raw = (input || '').trim();

    let prompt = '';
    if (raw) {
      try {
        const data = JSON.parse(raw);
        const promptEnvelope = collectPromptEnvelope(data);
        if (promptEnvelope.malformed || promptEnvelope.values.length === 0) {
          recordHookEvent({
            hook: 'force-pipeline-agents',
            event: 'UserPromptSubmit',
            decision: 'block_malformed_prompt_payload',
            reason: promptEnvelope.malformed ? 'non-string prompt field' : 'missing prompt field',
          });
          console.log(JSON.stringify(blockingOutput(
            'malformed-prompt-payload',
            'Malformed UserPromptSubmit payload: prompt-bearing fields must be strings. Inline execution is blocked; re-submit with /pipeline-orchestrator-for-codex:pipeline if this was an engineering request.',
          )));
          return;
        }
        prompt = promptStringValue(promptEnvelope.values);
      } catch {
        if (!/^\s*[{[]/u.test(raw)) {
          prompt = raw;
        } else {
        recordHookEvent({
          hook: 'force-pipeline-agents',
          event: 'UserPromptSubmit',
          decision: 'block_malformed_prompt_payload',
          reason: 'invalid json payload',
        });
        console.log(JSON.stringify(blockingOutput(
          'malformed-prompt-payload',
          'Malformed UserPromptSubmit payload: hook input must be valid JSON or plain text. Inline execution is blocked; re-submit with /pipeline-orchestrator-for-codex:pipeline if this was an engineering request.',
        )));
        return;
        }
      }
    }

    // Fallback: alguns runners passam texto via argv (sem leitura de arquivo por seguranca).
    if (!prompt) {
      const argvInput = process.argv.slice(2).join(' ').trim();
      if (argvInput) {
        prompt = argvInput;
      }
    }

    // 1. Se é conversacional/meta → passa direto
    if (isTrivialChat(prompt)) {
      recordHookEvent({
        hook: 'force-pipeline-agents',
        event: 'UserPromptSubmit',
        decision: 'allow_trivial',
        reason: 'trivial chat',
      });
      console.log(JSON.stringify({ continue: true }));
      return;
    }

    const firstMessageHarness = detectFirstMessageHarness(prompt);
    if (firstMessageHarness) {
      const activeBootstrap = activePipelineBootstrap();
      if (activeBootstrap) {
        recordHookEvent({
          hook: 'force-pipeline-agents',
          event: 'UserPromptSubmit',
          decision: 'preserve_active_pipeline_state',
          attempted: firstMessageHarness.workflow,
          expected: activeBootstrap.workflow,
          reason: 'active pipeline bootstrap already exists; first-message harness did not overwrite state',
          harness_runtime: firstMessageHarness.harness_runtime,
        });
        console.log(JSON.stringify(enforcedWorkflowOutput(workflowSkillMessage(activeBootstrap.workflow))));
        return;
      }

      writeWorkflowIntent({
        workflow: firstMessageHarness.workflow,
        source: firstMessageHarness.source,
        prompt,
      });
      recordHookEvent({
        hook: 'force-pipeline-agents',
        event: 'UserPromptSubmit',
        decision: firstMessageHarness.workflow === 'pipeline' ? 'enforce_pipeline_skill_message' : 'enforce_workflow_skill_message',
        attempted: firstMessageHarness.workflow,
        reason: `explicit ${firstMessageHarness.source} workflow intent persisted`,
        harness_runtime: firstMessageHarness.harness_runtime,
      });
      console.log(JSON.stringify(enforcedWorkflowOutput(workflowSkillMessage(firstMessageHarness.workflow))));
      return;
    }

    // 2. Se é skill → passa direto (skill tem seu próprio fluxo)
    if (isSkillCommand(prompt)) {
      recordHookEvent({
        hook: 'force-pipeline-agents',
        event: 'UserPromptSubmit',
        decision: 'allow_skill',
        reason: 'skill command detected',
      });
      console.log(JSON.stringify(advisoryOutput(SKILL_MESSAGE)));
      return;
    }

    // 3. Se é request de implementação → FORÇA usar workflow governado
    if (isPipelineWorthy(prompt)) {
      recordHookEvent({
        hook: 'force-pipeline-agents',
        event: 'UserPromptSubmit',
        decision: 'advise_pipeline_recommended',
        reason: 'pipeline-worthy prompt',
      });
      console.log(JSON.stringify(advisoryOutput(
        [
          ENFORCEMENT_MESSAGE,
          '',
          'A execução inline deste pedido está bloqueada. Reenvie pela porta canônica /pipeline-orchestrator-for-codex:pipeline ou use spawn_agent/wait_agent conforme o contrato acima.',
        ].join('\n'),
      )));
      return;
    }

    // 4. Caso não identificado → passa mas sugere orchestrator
    recordHookEvent({
      hook: 'force-pipeline-agents',
      event: 'UserPromptSubmit',
      decision: 'suggest_orchestrator',
      reason: 'unclassified prompt',
    });
    console.log(JSON.stringify(advisoryOutput("💡 Considere usar /pipeline-orchestrator-for-codex:pipeline para classificar esta solicitação.")));

  } catch (e) {
    // Em caso de erro, falha fechado: este hook protege a porta de entrada.
    console.log(JSON.stringify({
      continue: false,
      stopReason: 'pipeline-hook-error',
      hook_enforcement_mode: 'blocking',
      pipeline_valid: false,
      systemMessage: 'force-pipeline-agents hook failed internally; inline execution is blocked because prompt enforcement could not be proven.',
    }));
  }
});
