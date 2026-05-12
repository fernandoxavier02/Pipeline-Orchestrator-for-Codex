#!/usr/bin/env node
'use strict';

/**
 * dispatch-guard.cjs — PreToolUse:Agent / PreToolUse:Skill guard.
 *
 * Enforces the dispatch contract:
 *   - Pipeline agents must be spawned via Agent with FQN
 *     "pipeline-orchestrator-for-codex:<folder>:<leaf>".
 *   - Calling a pipeline agent leaf via Skill is denied.
 *   - Bare leaf names (no namespace) on Agent are denied with a hint.
 *
 * Output contract (Codex PreToolUse hook):
 *   exit 0 + {} → allow
 *   exit 0 + { hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason } } → deny
 */

const { recordHookEvent } = require('./hook-events.cjs');
const { GOVERNED_SKILL_SET } = require('./governed-workflows.cjs');
const fs = require('fs');
const path = require('path');

const PIPELINE_NAMESPACE = 'pipeline-orchestrator-for-codex';
const LEGACY_PIPELINE_NAMESPACE = 'pipeline-orchestrator';
const GOVERNED_SKILLS = GOVERNED_SKILL_SET;
const ALLOWED_AGENT_TYPES = new Set(['worker', 'default', 'explorer']);
const ALLOWED_GATES_AT = new Set(['phase-0', 'phase-1', 'phase-1.5', 'phase-2', 'phase-3', 'continue']);
const ALLOWED_SENTINEL_CHECKPOINTS = new Set([
  'post_orchestrator',
  'phase_0_to_1',
  'phase_1_to_2',
  'phase_2_to_3',
  'post_final_validator',
]);

const PIPELINE_AGENT_LEAVES = [
  ['brainstorm', 'step-00-intake'],
  ['brainstorm', 'step-01-explore'],
  ['core', 'brainstorm-controller'],
  ['core', 'adversarial-batch'],
  ['core', 'checkpoint-validator'],
  ['core', 'final-validator'],
  ['core', 'finishing-branch'],
  ['core', 'information-gate'],
  ['core', 'pipeline-controller'],
  ['core', 'sanity-checker'],
  ['core', 'sentinel'],
  ['core', 'task-orchestrator'],
  ['executor', 'executor-controller'],
  ['executor', 'executor-fix'],
  ['executor', 'executor-implementer-task'],
  ['executor', 'executor-quality-reviewer'],
  ['executor', 'executor-spec-reviewer'],
  ['executor/type-specific', 'adversarial-architecture-critic'],
  ['executor/type-specific', 'adversarial-review-coordinator'],
  ['executor/type-specific', 'adversarial-security-scanner'],
  ['executor/type-specific', 'audit-compliance-checker'],
  ['executor/type-specific', 'audit-domain-analyzer'],
  ['executor/type-specific', 'audit-intake'],
  ['executor/type-specific', 'audit-risk-matrix-generator'],
  ['executor/type-specific', 'bugfix-diagnostic-agent'],
  ['executor/type-specific', 'bugfix-regression-tester'],
  ['executor/type-specific', 'bugfix-root-cause-analyzer'],
  ['executor/type-specific', 'feature-implementer'],
  ['executor/type-specific', 'feature-integration-validator'],
  ['executor/type-specific', 'feature-vertical-slice-planner'],
  ['executor/type-specific', 'ux-accessibility-auditor'],
  ['executor/type-specific', 'ux-qa-validator'],
  ['executor/type-specific', 'ux-simulator'],
  ['quality', 'architecture-reviewer'],
  ['quality', 'design-interrogator'],
  ['quality', 'final-adversarial-orchestrator'],
  ['quality', 'plan-architect'],
  ['quality', 'pre-tester'],
  ['quality', 'quality-gate-router'],
  ['quality', 'review-orchestrator'],
  ['quality', 'adversarial-quality-reviewer'],
  ['quality', 'spec-format-gate'],
  ['quality', 'spec-content-reviewer'],
  ['quality', 'spec-post-impl-validator'],
  ['quality', 'spec-closer'],
];

const LEAF_TO_FQN = new Map(
  PIPELINE_AGENT_LEAVES.map(([folder, leaf]) => [leaf, `${PIPELINE_NAMESPACE}:${folder}:${leaf}`]),
);

function isPipelineAgentLeaf(name) {
  return LEAF_TO_FQN.has(name);
}

function fqnFor(leaf) {
  return LEAF_TO_FQN.get(leaf);
}

function skillLeafName(toolInput) {
  const skillName = (toolInput && (toolInput.skill || toolInput.skill_name || toolInput.skillName || toolInput.name)) || '';
  return skillName.includes(':') ? skillName.split(':').pop() : skillName;
}

function deny(reason, attempted, expected) {
  recordHookEvent({
    hook: 'dispatch-guard',
    event: 'PreToolUse',
    decision: 'deny',
    attempted: attempted || '',
    expected: expected || '',
    reason,
  });
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
}

function allow() {
  // Silent allow (consistent with sentinel hook)
}

function extractFrontmatterBlock(raw) {
  if (typeof raw !== 'string') return undefined;
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match ? match[1] : undefined;
}

function parseFrontmatterScalar(value) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatterValue(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map(parseFrontmatterScalar)
      .filter(Boolean);
  }
  return parseFrontmatterScalar(trimmed);
}

function parseFrontmatterYaml(raw) {
  if (typeof raw !== 'string') return undefined;
  const frontmatter = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!match) continue;
    frontmatter[match[1]] = parseFrontmatterValue(match[2] || '');
  }
  return frontmatter;
}

function loadTrustedSkillFrontmatter(skillName) {
  if (!skillName) return undefined;
  const leaf = skillName.includes(':') ? skillName.split(':').pop() : skillName;
  const roots = [
    process.env.CLAUDE_PLUGIN_ROOT,
  ].filter((entry) => typeof entry === 'string' && entry.length > 0);

  for (const root of roots) {
    const candidate = path.join(root, 'skills', leaf, 'SKILL.md');
    try {
      const block = extractFrontmatterBlock(fs.readFileSync(candidate, 'utf8'));
      if (block) return parseFrontmatterYaml(block);
    } catch {
      // Try the next trusted root.
    }
  }

  return undefined;
}

function resolveSkillFrontmatter(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return undefined;
  if (toolInput.frontmatter && typeof toolInput.frontmatter === 'object') {
    return toolInput.frontmatter;
  }
  if (typeof toolInput.frontmatter === 'string') {
    return parseFrontmatterYaml(toolInput.frontmatter);
  }
  const content = toolInput.content || toolInput.skill_content || toolInput.skillContent;
  const block = extractFrontmatterBlock(content);
  if (block) {
    return parseFrontmatterYaml(block);
  }
  return loadTrustedSkillFrontmatter(toolInput.skill || toolInput.skill_name || toolInput.skillName || toolInput.name);
}

function asStringArray(value) {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => (typeof entry === 'string' || typeof entry === 'number') && String(entry).trim().length > 0)
      .map((entry) => String(entry).trim());
  }
  if ((typeof value === 'string' || typeof value === 'number') && String(value).trim().length > 0) {
    return [String(value).trim()];
  }
  return [];
}

function isAllowedGateToken(entry) {
  return ALLOWED_GATES_AT.has(entry) || /^\d+$/.test(entry);
}

function isAllowedSentinelCheckpoint(entry) {
  return ALLOWED_SENTINEL_CHECKPOINTS.has(entry) || /^pre_\d+$/.test(entry) || /^post_[a-z0-9_-]+$/i.test(entry);
}

function validateSkillFrontmatter(toolInput) {
  const leaf = skillLeafName(toolInput);
  if (!GOVERNED_SKILLS.has(leaf)) {
    return { kind: 'allow' };
  }

  const frontmatter = loadTrustedSkillFrontmatter(leaf);
  if (!frontmatter) {
    return {
      kind: 'deny',
      reason: `DISPATCH_GUARD: governed skill "${leaf}" is missing required frontmatter.`,
      attempted: leaf,
      expected: 'agent_type,gates_at,sentinel_checkpoints',
    };
  }

  const agentType = frontmatter.agent_type;
  const disableModelInvocation = frontmatter['disable-model-invocation'];
  const hasValidAgentType = typeof agentType === 'string' && ALLOWED_AGENT_TYPES.has(agentType.trim());
  const isManualOnlySkill = disableModelInvocation === true || disableModelInvocation === 'true';

  if (!hasValidAgentType && !isManualOnlySkill) {
    return {
      kind: 'deny',
      reason: `DISPATCH_GUARD: skill frontmatter must declare agent_type (${Array.from(ALLOWED_AGENT_TYPES).join(', ')}) or disable-model-invocation: true.`,
      attempted: leaf,
      expected: 'agent_type|disable-model-invocation',
    };
  }

  const gatesAt = asStringArray(frontmatter.gates_at);
  if (gatesAt.length === 0 || gatesAt.some((entry) => !isAllowedGateToken(entry))) {
    return {
      kind: 'deny',
      reason: `DISPATCH_GUARD: skill frontmatter gates_at must use known phases or numeric step gates.`,
      attempted: leaf,
      expected: 'gates_at',
    };
  }

  const sentinelCheckpoints = asStringArray(frontmatter.sentinel_checkpoints);
  if (sentinelCheckpoints.length === 0 || sentinelCheckpoints.some((entry) => !isAllowedSentinelCheckpoint(entry))) {
    return {
      kind: 'deny',
      reason: `DISPATCH_GUARD: skill frontmatter sentinel_checkpoints must use known checkpoints or step checkpoints like pre_3.`,
      attempted: leaf,
      expected: 'sentinel_checkpoints',
    };
  }

  recordHookEvent({
    hook: 'dispatch-guard',
    event: 'PreToolUse',
    decision: 'allow',
    attempted: leaf,
    expected: 'agent_type,gates_at,sentinel_checkpoints',
    reason: 'frontmatter contract valid',
  });
  return { kind: 'allow' };
}

function evaluateAgent(toolInput) {
  const subagentType = (toolInput && (toolInput.subagent_type || toolInput.subagentType)) || '';
  if (!subagentType) return { kind: 'allow' };

  if (subagentType.startsWith(`${LEGACY_PIPELINE_NAMESPACE}:`)) {
    return {
      kind: 'deny',
      reason: `DISPATCH_GUARD: legacy namespace "${LEGACY_PIPELINE_NAMESPACE}" is not allowed. Use ${PIPELINE_NAMESPACE}.`,
      attempted: subagentType,
      expected: PIPELINE_NAMESPACE,
    };
  }

  if (subagentType.startsWith(`${PIPELINE_NAMESPACE}:`)) {
    const segments = subagentType.split(':');
    const leaf = segments.pop();
    if (!isPipelineAgentLeaf(leaf)) {
      return {
        kind: 'deny',
        reason:
          `DISPATCH_GUARD: subagent_type="${subagentType}" uses the pipeline namespace ` +
          `but its leaf "${leaf}" is not a registered pipeline agent.`,
        attempted: subagentType,
      };
    }
    const expectedFqn = fqnFor(leaf);
    if (subagentType !== expectedFqn) {
      return {
        kind: 'deny',
        reason:
          `DISPATCH_GUARD: subagent_type="${subagentType}" is not the expected canonical FQN. ` +
          `Use "${expectedFqn}".`,
        attempted: subagentType,
        expected: expectedFqn,
      };
    }
    return { kind: 'allow' };
  }

  if (isPipelineAgentLeaf(subagentType)) {
    return {
      kind: 'deny',
      reason:
        `DISPATCH_GUARD: subagent_type="${subagentType}" is missing the namespace. ` +
        `Use Agent with subagent_type="${fqnFor(subagentType)}" instead.`,
      attempted: subagentType,
      expected: fqnFor(subagentType),
    };
  }

  return { kind: 'allow' };
}

function evaluateSkill(toolInput) {
  const frontmatterVerdict = validateSkillFrontmatter(toolInput);
  if (frontmatterVerdict.kind === 'deny') {
    return frontmatterVerdict;
  }

  const skillName = (toolInput && (toolInput.skill || toolInput.skill_name || toolInput.skillName || toolInput.name)) || '';
  if (!skillName) return { kind: 'allow' };
  const leaf = skillName.includes(':') ? skillName.split(':').pop() : skillName;
  if (isPipelineAgentLeaf(leaf)) {
    return {
      kind: 'deny',
      reason:
        `DISPATCH_GUARD: Skill "${skillName}" maps to pipeline agent "${leaf}". ` +
        `Pipeline agents must be spawned via the Agent tool with ` +
        `subagent_type="${fqnFor(leaf)}", not via Skill.`,
      attempted: skillName,
      expected: fqnFor(leaf),
    };
  }
  return { kind: 'allow' };
}

function handle(input) {
  const toolName = (input && (input.tool_name || input.toolName)) || '';
  const toolInput = (input && (input.tool_input || input.toolInput)) || {};

  let verdict = { kind: 'allow' };

  if (toolName === 'Agent') {
    verdict = evaluateAgent(toolInput);
  } else if (toolName === 'Skill') {
    verdict = evaluateSkill(toolInput);
  } else {
    // Be tolerant: hosts may pass empty tool_name. Try both detectors.
    if (toolInput && (toolInput.subagent_type || toolInput.subagentType)) {
      verdict = evaluateAgent(toolInput);
    } else if (toolInput && (toolInput.skill || toolInput.skill_name || toolInput.skillName)) {
      verdict = evaluateSkill(toolInput);
    }
  }

  if (verdict.kind === 'deny') {
    deny(verdict.reason, verdict.attempted, verdict.expected);
    return;
  }
  allow();
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { buffer += chunk; });
process.stdin.on('end', () => {
  let parsed = {};
  const raw = (buffer || '').trim();
  if (raw) {
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }
  }
  try {
    handle(parsed);
  } catch (err) {
    // Fail-closed: any internal error in dispatch guard denies the operation.
    // The comment previously claimed fail-open was intentional, but the adversarial
    // security review determined that a crash in the last line of defense against
    // unauthorized agent spawning MUST deny. Non-pipeline tool calls are not affected
    // because this hook only fires for Agent/Skill PreToolUse events.
    const reason = `hook crash: ${err && err.message ? err.message : String(err)}`;
    recordHookEvent({
      hook: 'dispatch-guard',
      event: 'PreToolUse',
      decision: 'deny',
      reason,
    });
    deny(`DISPATCH_GUARD crashed internally: ${reason}. Denying as a security precaution.`);
  }
});
