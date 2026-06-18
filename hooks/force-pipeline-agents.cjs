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

const { recordHookEvent } = require('./hook-events.cjs');
const { GOVERNED_SKILLS, GOVERNED_SKILL_SET } = require('./governed-workflows.cjs');

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
  const canonicalUri = 'pipeline-orchestrator-for-codex(?=[)@/?#])[^)]*';
  const mentionBoundary = '(?=$|[\\s,.;:!?])';
  const patterns = [
    new RegExp(`\\[(?:[@$])?pipeline-orchestrator-for-codex\\]\\((?:plugin|app):\\/\\/${canonicalUri}\\)(?<tail>[\\s\\S]*)`, 'i'),
    new RegExp(`\\[(?:[@$])?pipeline orchestrator for codex\\]\\((?:plugin|app):\\/\\/${canonicalUri}\\)(?<tail>[\\s\\S]*)`, 'i'),
    new RegExp(`[@$]pipeline-orchestrator-for-codex${mentionBoundary}(?<tail>[\\s\\S]*)`, 'i'),
    new RegExp(`[@$]pipeline orchestrator for codex${mentionBoundary}(?<tail>[\\s\\S]*)`, 'i'),
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

  const slashMatch = trimmed.match(/^\/pipeline-orchestrator(?:-for-codex)?:(?<workflow>[a-z0-9-]+)\b/i);
  if (slashMatch?.groups?.workflow) {
    const workflow = normalizeWorkflowName(slashMatch.groups.workflow);
    if (workflow) {
      return { workflow, source: 'slash-command' };
    }
  }

  const pluginMention = detectPluginFrontDoorMention(trimmed);

  const tail = pluginMention?.groups?.tail;
  if (tail) {
    const workflowMatch = tail.match(GOVERNED_WORKFLOW_PATTERN);
    if (workflowMatch?.[1]) {
      const workflow = normalizeWorkflowName(workflowMatch[1].trim());
      if (workflow) {
        return { workflow, source: 'plugin-mention' };
      }
    }
  }

  if (pluginMention) {
    return { workflow: 'pipeline', source: 'plugin-mention-default' };
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

function isPipelineWorthy(prompt) {
  const trimmed = (prompt || '').trim();

  if (!trimmed) return false;
  if (isImplementationRequest(trimmed)) return true;
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

Hook enforcement mode: advisory. This hook can inject instructions, but it cannot prove that the host will block inline execution. A valid pipeline still requires deterministic runtime evidence and a validated governance artifact.

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
process.stdin.on('end', () => {
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

    const explicitWorkflow = detectExplicitWorkflow(prompt);
    if (explicitWorkflow) {
      recordHookEvent({
        hook: 'force-pipeline-agents',
        event: 'UserPromptSubmit',
        decision: explicitWorkflow.workflow === 'pipeline' ? 'inject_pipeline_skill_message' : 'inject_workflow_skill_message',
        attempted: explicitWorkflow.workflow,
        reason: `explicit ${explicitWorkflow.source} workflow`,
      });
      console.log(JSON.stringify(advisoryOutput(workflowSkillMessage(explicitWorkflow.workflow))));
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
        decision: 'block_pipeline_required',
        reason: 'pipeline-worthy prompt',
      });
      console.log(JSON.stringify(blockingOutput(
        'pipeline-required',
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
