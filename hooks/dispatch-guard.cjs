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

const PIPELINE_NAMESPACE = 'pipeline-orchestrator-for-codex';

const PIPELINE_AGENT_LEAVES = [
  ['core', 'adversarial-batch'],
  ['core', 'checkpoint-validator'],
  ['core', 'final-validator'],
  ['core', 'finishing-branch'],
  ['core', 'information-gate'],
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

function evaluateAgent(toolInput) {
  const subagentType = (toolInput && (toolInput.subagent_type || toolInput.subagentType)) || '';
  if (!subagentType) return { kind: 'allow' };

  if (subagentType.startsWith(`${PIPELINE_NAMESPACE}:`)) {
    const leaf = subagentType.split(':').pop();
    if (!isPipelineAgentLeaf(leaf)) {
      return {
        kind: 'deny',
        reason:
          `DISPATCH_GUARD: subagent_type="${subagentType}" uses the pipeline namespace ` +
          `but its leaf "${leaf}" is not a registered pipeline agent.`,
        attempted: subagentType,
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
    // Fail-open on internal error (sentinel + edit-guard cover the security paths)
    recordHookEvent({
      hook: 'dispatch-guard',
      event: 'PreToolUse',
      decision: 'allow-on-error',
      reason: `hook crash: ${err && err.message ? err.message : String(err)}`,
    });
  }
});
