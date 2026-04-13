#!/usr/bin/env node
/**
 * Hook: force-pipeline-agents v1.0 (Codex port)
 *
 * BLOQUEIA respostas que não usam Task tool para requests de implementação.
 *
 * Este hook é executado em UserPromptSubmit e:
 * 1. Detecta se é request de implementação (não conversacional, não skill)
 * 2. Injeta instrução OBRIGATÓRIA de usar Task tool
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

// Padrões de SKILLS - usa skill, não precisa de orchestrator externo
const SKILL_PATTERNS = [
  /^\/(context|commit|code-review|fix|verify|deploy|qa|test|pipeline)/i,
  /^\/kiro:/i,
  /^\/prompts:/i,
  /^\/vertical/i,
];

// Padrões de IMPLEMENTAÇÃO - OBRIGATÓRIO usar Task tool
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

1. **USAR** a skill /pipeline — ela orquestra todo o fluxo automaticamente
   - Ou chamar o Agent tool com subagent_type="task-orchestrator"

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
⛔ MANDATORY SUBAGENT EXECUTION — /pipeline WAS INVOKED ⛔

The user explicitly invoked /pipeline. This means YOU MUST call spawn_agent for each pipeline phase.

DO NOT execute any phase inline. DO NOT write audit reports, classifications, or reviews yourself.
DO NOT say "I chose the conservative approach" to skip spawning.

YOUR FIRST ACTION must be:
1. Find the agents directory: find ~/.codex/plugins/cache -path "*/pipeline-orchestrator-for-codex/*/agents" -type d
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
      console.log(JSON.stringify({ continue: true }));
      return;
    }

    // 2. Se é skill → passa direto (skill tem seu próprio fluxo)
    if (isSkillCommand(prompt)) {
      const isPipelineSkill = /^\/(pipeline-orchestrator(-for-codex)?:pipeline|pipeline)\b/i.test(prompt.trim());
      console.log(JSON.stringify({
        continue: true,
        systemMessage: isPipelineSkill ? PIPELINE_SKILL_MESSAGE : SKILL_MESSAGE
      }));
      return;
    }

    // 3. Se é request de implementação → FORÇA usar Task tool
    if (isPipelineWorthy(prompt)) {
      console.log(JSON.stringify({
        continue: true,
        systemMessage: ENFORCEMENT_MESSAGE
      }));
      return;
    }

    // 4. Caso não identificado → passa mas sugere orchestrator
    console.log(JSON.stringify({
      continue: true,
      systemMessage: "💡 Considere usar o Task tool com task-orchestrator para classificar esta solicitação."
    }));

  } catch (e) {
    // Em caso de erro, não bloqueia
    console.log(JSON.stringify({ continue: true }));
  }
});
