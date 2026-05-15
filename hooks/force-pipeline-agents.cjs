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

  const pluginMention = trimmed.match(/\[(?:@)?pipeline-orchestrator-for-codex\]\(plugin:\/\/pipeline-orchestrator-for-codex@[^)]+\)(?<tail>[\s\S]*)/i)
    || trimmed.match(/@pipeline-orchestrator-for-codex(?<tail>[\s\S]*)/i);

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

  return undefined;
}

function isImplementationRequest(prompt) {
  const trimmed = prompt.trim();

  for (const pattern of IMPLEMENTATION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }

  return false;
}

function isPipelineWorthy(prompt) {
  const trimmed = (prompt || '').trim();

  if (!trimmed) return false;
  if (isImplementationRequest(trimmed)) return true;

  // Requests longas geralmente pedem analise/execucao mais disciplinada
  if (trimmed.length >= 140) return true;

  const pipelineWorthyPatterns = [
    /\b(analise|analisar|auditar|auditoria|revisar|verificar|investigar|diagnostic|causa raiz|root cause)\b/i,
    /\b(pipeline|agentes|orquestrador|orchestrator|classifier|executor|observabilidade|logs|tracing|correlation|runlog)\b/i,
    /\b(nao esta funcionando|nao funciona|precario|nao cumprem)\b/i,
    /\b(\.\w{1,4})\b.*\b(fix|bug|erro|alter|criar|remov|refator)/i,
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

Esta solicitação requer o pipeline de agentes. Você DEVE:

1. **USAR** o comando /pipeline-orchestrator-for-codex:pipeline — ele orquestra todo o fluxo automaticamente
   - Ou chamar spawn_agent com o prompt do agente task-orchestrator

2. **AGUARDAR** o orchestrator classificar e emitir ORCHESTRATOR_DECISION

3. O pipeline segue automaticamente:
   - task-orchestrator → information-gate → quality-gate-router → pre-tester
   - executor-controller → review-orchestrator → sanity-checker → final-validator

4. **SE trivial indicado**, pode executar direto após o ORCHESTRATOR_DECISION

⚠️ NÃO COMECE A IMPLEMENTAR SEM O PIPELINE PRIMEIRO!

Os agentes são fornecidos pelo plugin pipeline-orchestrator-for-codex (FX-studio-AI).
`.trim();

const SKILL_MESSAGE = `
✅ Skill detectado - executando diretamente.
`.trim();

const PIPELINE_SKILL_MESSAGE = `
⛔ MANDATORY SUBAGENT EXECUTION — PIPELINE WORKFLOW WAS INVOKED ⛔

The user explicitly invoked /pipeline-orchestrator-for-codex:pipeline. This means YOU MUST call spawn_agent for each pipeline phase.

DO NOT execute any phase inline. DO NOT write audit reports, classifications, or reviews yourself.
DO NOT say "I chose the conservative approach" to skip spawning.

YOUR FIRST ACTION must be:
1. Find the agents directory using CODEX_PLUGIN_ROOT/agents/ (CLAUDE_PLUGIN_ROOT is only a compatibility fallback for legacy harness tests)
2. Read agents/core/task-orchestrator.md
3. Call spawn_agent(agent_type="worker", message=<content of that file + user's task>)
4. Wait for the agent to return CLASSIFICATION output
5. Continue to next phase by spawning the next agent

If spawn_agent is not available, TELL THE USER instead of executing inline.

PHASES (each requires spawn_agent):
Phase 0: spawn task-orchestrator → spawn information-gate
Phase 1: Present proposal → user confirms
Phase 2: spawn executor-controller → spawn checkpoint-validator → spawn review-orchestrator
Phase 3: spawn sanity-checker → spawn final-validator → spawn finishing-branch
`.trim();

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
        prompt =
          data.prompt ||
          data.arguments ||
          data.input ||
          data.text ||
          data.message ||
          '';
      } catch {
        prompt = raw;
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
      console.log(JSON.stringify({
        continue: true,
        systemMessage: workflowSkillMessage(explicitWorkflow.workflow)
      }));
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
      console.log(JSON.stringify({
        continue: true,
        systemMessage: SKILL_MESSAGE
      }));
      return;
    }

    // 3. Se é request de implementação → FORÇA usar workflow governado
    if (isPipelineWorthy(prompt)) {
      recordHookEvent({
        hook: 'force-pipeline-agents',
        event: 'UserPromptSubmit',
        decision: 'inject_pipeline_message',
        reason: 'pipeline-worthy prompt',
      });
      console.log(JSON.stringify({
        continue: true,
        systemMessage: ENFORCEMENT_MESSAGE
      }));
      return;
    }

    // 4. Caso não identificado → passa mas sugere orchestrator
    recordHookEvent({
      hook: 'force-pipeline-agents',
      event: 'UserPromptSubmit',
      decision: 'suggest_orchestrator',
      reason: 'unclassified prompt',
    });
    console.log(JSON.stringify({
      continue: true,
      systemMessage: "💡 Considere usar /pipeline-orchestrator-for-codex:pipeline para classificar esta solicitação."
    }));

  } catch (e) {
    // Em caso de erro, não bloqueia
    console.log(JSON.stringify({ continue: true }));
  }
});
